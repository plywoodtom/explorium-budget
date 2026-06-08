// Explorium Budget Tracker
// Loads data.json, renders sections + items, supports in-app edits.
// Save POSTs to a Cloudflare Worker that commits to GitHub.

const WORKER_URL = "https://explorium-budget-worker.plywoodtom.workers.dev";
const SECRET_STORAGE_KEY = "explorium_budget_secret";

const CATEGORIES = [
  { value: "electronics", label: "Electronics" },
  { value: "materials",   label: "Building Materials" },
  { value: "consumables", label: "Consumables" },
  { value: "labor",       label: "Labor" },
  { value: "tools",       label: "Tools" },
  { value: "overhead",    label: "Overhead / Fixed Costs" },
  { value: "misc",        label: "Misc" }
];

let data = { lastModified: null, sections: [] };
let dirty = false;
let searchTerm = "";

// --- Helpers ---------------------------------------------------------------

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return "$0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return sign + "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n) {
  if (!isFinite(n)) return "";
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(1) + "%";
}

function uid(prefix) {
  return prefix + "-" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

function isFilled(item) {
  return item.actualCost !== null && item.actualCost !== undefined && item.actualCost !== "" && Number(item.actualCost) > 0;
}

function isAdded(item) {
  return item.scope === "added";
}

function isOriginal(item) {
  return item.scope !== "added";
}

function totalEst(item) {
  return (Number(item.qty) || 0) * (Number(item.unitCost) || 0);
}

function actual(item) {
  return Number(item.actualCost) || 0;
}

function sectionTotalEst(sec) {
  return sec.items.reduce((s, i) => s + totalEst(i), 0);
}

function sectionFilledEst(sec) {
  return sec.items.filter(isFilled).reduce((s, i) => s + totalEst(i), 0);
}

function sectionTotalAct(sec) {
  return sec.items.reduce((s, i) => s + actual(i), 0);
}

function sectionFilledCount(sec) {
  return sec.items.filter(isFilled).length;
}

function sectionTargetCount(sec) {
  return Math.max(Number(sec.targetItems) || 0, sec.items.length);
}

function grandTotalEst() {
  return data.sections.reduce((s, sec) => s + sectionTotalEst(sec), 0);
}

function grandTotalAct() {
  return data.sections.reduce((s, sec) => s + sectionTotalAct(sec), 0);
}

function grandOriginalSpent() {
  return data.sections.reduce(
    (s, sec) => s + sec.items.filter(isOriginal).reduce((a, i) => a + actual(i), 0),
    0
  );
}

function grandAddedSpent() {
  return data.sections.reduce(
    (s, sec) => s + sec.items.filter(isAdded).reduce((a, i) => a + actual(i), 0),
    0
  );
}

function depositAmount() {
  return Number(data.deposit) || 0;
}

function depositRemaining() {
  return depositAmount() - grandOriginalSpent();
}

function grandFilledCount() {
  return data.sections.reduce((s, sec) => s + sectionFilledCount(sec), 0);
}

function grandTargetCount() {
  return data.sections.reduce((s, sec) => s + sectionTargetCount(sec), 0);
}

function markDirty() {
  dirty = true;
  setStatus("Unsaved changes", "dirty");
}

function setStatus(msg, cls) {
  const el = document.getElementById("save-status");
  el.textContent = msg;
  el.className = "save-status " + (cls || "");
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function normalizeDesc(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// --- Duplicate detection ---------------------------------------------------

function findDuplicateSet() {
  const counts = {};
  data.sections.forEach(sec => sec.items.forEach(it => {
    const k = normalizeDesc(it.description);
    if (!k) return;
    counts[k] = (counts[k] || 0) + 1;
  }));
  return new Set(Object.keys(counts).filter(k => counts[k] > 1));
}

// --- Search ----------------------------------------------------------------

function onSearch(term) {
  searchTerm = (term || "").toLowerCase().trim();
  document.getElementById("search-clear").style.display = searchTerm ? "" : "none";
  render();
  if (searchTerm) {
    // Auto-expand sections that contain matches
    data.sections.forEach(sec => {
      const matched = sec.items.some(it => normalizeDesc(it.description).includes(normalizeDesc(searchTerm)));
      if (matched) sec.collapsed = false;
    });
    render();
  }
}

function clearSearch() {
  document.getElementById("search").value = "";
  onSearch("");
}

function itemMatchesSearch(item) {
  if (!searchTerm) return false;
  return normalizeDesc(item.description).includes(normalizeDesc(searchTerm))
    || normalizeDesc(item.notes || "").includes(normalizeDesc(searchTerm));
}

function sectionHasSearchMatch(sec) {
  if (!searchTerm) return true;
  return sec.items.some(itemMatchesSearch);
}

// --- Expand / Collapse all -------------------------------------------------

function expandAll() {
  data.sections.forEach(sec => sec.collapsed = false);
  render();
}

function collapseAll() {
  data.sections.forEach(sec => sec.collapsed = true);
  render();
}

// --- Rendering --------------------------------------------------------------

function render() {
  const root = document.getElementById("sections");
  root.innerHTML = "";
  const dupSet = findDuplicateSet();
  data.sections.forEach((sec, si) => {
    root.appendChild(renderSection(sec, si, dupSet));
  });
  renderTotals();
}

function renderTotals() {
  const deposit = depositAmount();
  const origSpent = grandOriginalSpent();
  const addedSpent = grandAddedSpent();
  const totalSpent = origSpent + addedSpent;
  const remaining = deposit - origSpent;

  // Deposit band (top)
  const depEl = document.getElementById("deposit-band");
  if (deposit > 0) {
    depEl.style.display = "";
    document.getElementById("deposit-value").textContent = fmt(deposit);
    const meta = [];
    if (data.depositDate) meta.push("received " + data.depositDate);
    if (data.contractTotal) meta.push("50pct of " + fmt(data.contractTotal) + " contract");
    document.getElementById("deposit-meta").textContent = meta.length ? "- " + meta.join(" - ") : "";
  } else {
    depEl.style.display = "none";
  }

  // Original Spent cell
  document.getElementById("grand-orig-spent").textContent = fmt(origSpent)
    + (deposit > 0 ? " (" + ((origSpent / deposit) * 100).toFixed(1) + "%)" : "");

  // Deposit Remaining
  const remEl = document.getElementById("grand-deposit-remaining");
  remEl.textContent = fmt(remaining);
  remEl.className = "gt-value " + (remaining < 0 ? "over" : remaining > 0 ? "under" : "");

  // Add-ons Spent
  document.getElementById("grand-addons-spent").textContent = fmt(addedSpent);

  // Total Out of Pocket
  document.getElementById("grand-total-spent").textContent = fmt(totalSpent);
}

function renderSection(sec, si, dupSet) {
  const el = document.createElement("div");
  el.className = "section";
  el.dataset.category = sec.category || "misc";
  if (searchTerm && !sectionHasSearchMatch(sec)) el.classList.add("dim");

  const totalEstVal = sectionTotalEst(sec);
  const filledEstVal = sectionFilledEst(sec);
  const totalActVal = sectionTotalAct(sec);
  const filledCount = sectionFilledCount(sec);
  const targetCount = sectionTargetCount(sec);

  // Section delta = actual - estimated of FILLED items only (apples to apples)
  const sectionDelta = totalActVal - filledEstVal;
  const sectionPct = filledEstVal > 0 ? (sectionDelta / filledEstVal) * 100 : 0;
  const dCls = sectionDelta > 0 ? "over" : sectionDelta < 0 ? "under" : "";

  const collapsed = sec.collapsed !== false;
  const chev = "&#9656;"; // small right triangle, rotates 90deg when open

  const summary = [];
  summary.push(`<span class="ss-cell"><span class="ss-label">Budget</span><span class="ss-value">${fmt(totalEstVal)}</span></span>`);
  summary.push(`<span class="ss-cell"><span class="ss-label">Filled</span><span class="ss-value ss-target" onclick="event.stopPropagation();editTarget(${si})">${filledCount} / ${targetCount}</span></span>`);
  if (filledCount > 0) {
    summary.push(`<span class="ss-cell"><span class="ss-label">Spent</span><span class="ss-value">${fmt(totalActVal)}</span></span>`);
    summary.push(`<span class="ss-cell"><span class="ss-label">Delta</span><span class="ss-value ${dCls}">${sectionDelta >= 0 ? "+" : ""}${fmt(sectionDelta)} ${filledEstVal > 0 ? "(" + fmtPct(sectionPct) + ")" : ""}</span></span>`);
  }

  el.innerHTML = `
    <div class="section-stripe"></div>
    <div class="section-header ${collapsed ? "collapsed" : ""}" onclick="toggleSection(${si})">
      <div>
        <div class="section-title-row">
          <span class="section-chevron">${chev}</span>
          <span class="section-name">${escapeHtml(sec.name)}</span>
        </div>
        <div class="section-summary">${summary.join("")}</div>
      </div>
      <div class="section-actions">
        <button class="small" onclick="event.stopPropagation();editSection(${si})">Edit</button>
        <button class="small danger" onclick="event.stopPropagation();deleteSection(${si})">Del</button>
      </div>
    </div>
    ${collapsed ? "" : `
      <div class="section-body">
        <textarea class="section-notes" placeholder="Section notes (optional)" oninput="updateSectionNotes(${si}, this.value)">${escapeHtml(sec.notes || "")}</textarea>
        <div class="items">
          ${sec.items.map((it, ii) => renderItem(it, si, ii, dupSet)).join("")}
        </div>
        <button class="add-item-btn" onclick="addItem(${si})">+ Add Item</button>
      </div>
    `}
  `;
  return el;
}

function renderItem(item, si, ii, dupSet) {
  const est = totalEst(item);
  const act = actual(item);
  const filled = isFilled(item);
  const d = act - est;
  const dCls = d > 0 ? "over" : d < 0 ? "under" : "";
  const matched = itemMatchesSearch(item);
  const isDup = dupSet && dupSet.has(normalizeDesc(item.description));
  const classes = ["item"];
  if (matched) classes.push("match-highlight");
  if (isDup) classes.push("duplicate");
  return `
    <div class="${classes.join(" ")}">
      <div class="item-row1">
        <div>
          <div class="item-desc">${escapeHtml(item.description)}${isAdded(item) ? ' <span class="addon-badge">Add-on</span>' : ""}${isDup ? ' <span class="dup-flag">Possible duplicate</span>' : ""}</div>
          <div class="item-meta">Qty ${item.qty || 0} &times; ${fmt(item.unitCost || 0)}${item.dateAdded ? " &middot; " + escapeHtml(item.dateAdded) : ""}</div>
        </div>
        <div class="item-actions">
          <button class="small" onclick="editItem(${si},${ii})">Edit</button>
          <button class="small danger" onclick="deleteItem(${si},${ii})">Del</button>
        </div>
      </div>
      <div class="item-row2">
        <div class="cell">
          <span class="cell-label">Estimated</span>
          <span class="cell-value">${fmt(est)}</span>
        </div>
        <div class="cell">
          <span class="cell-label">Actual</span>
          <span class="cell-value">${filled ? fmt(act) : "&mdash;"}</span>
        </div>
        <div class="cell">
          <span class="cell-label">Delta</span>
          <span class="cell-value ${dCls}">${filled ? (d >= 0 ? "+" : "") + fmt(d) : "&mdash;"}</span>
        </div>
      </div>
      ${item.notes ? `<div class="item-notes">${escapeHtml(item.notes)}</div>` : ""}
      ${item.receiptPath ? `<div class="item-receipt">Receipt: ${escapeHtml(item.receiptPath)}</div>` : ""}
    </div>
  `;
}

function toggleSection(si) {
  data.sections[si].collapsed = !(data.sections[si].collapsed !== false);
  // Don't mark dirty for collapse-state changes alone; they're UI only.
  render();
}

// --- Modals -----------------------------------------------------------------

function showModal(html) {
  document.getElementById("modal").innerHTML = html;
  document.getElementById("modal-backdrop").classList.add("show");
}

function closeModal() {
  document.getElementById("modal-backdrop").classList.remove("show");
}

document.getElementById("modal-backdrop").addEventListener("click", e => {
  if (e.target.id === "modal-backdrop") closeModal();
});

// --- Sections CRUD ----------------------------------------------------------

function categoryOptions(selected) {
  return CATEGORIES.map(c => `<option value="${c.value}" ${c.value === selected ? "selected" : ""}>${c.label}</option>`).join("");
}

function addSection() {
  showModal(`
    <h3>Add Section</h3>
    <div class="modal-form">
      <label>Name <input type="text" id="m-name" autofocus></label>
      <label>Category
        <select id="m-cat">${categoryOptions("misc")}</select>
      </label>
      <label>Target item count
        <input type="number" id="m-target" value="1" min="0" step="1">
      </label>
      <label>Notes (optional) <textarea id="m-notes" rows="3"></textarea></label>
      <div class="modal-actions">
        <button onclick="closeModal()">Cancel</button>
        <button class="primary" onclick="saveNewSection()">Add</button>
      </div>
    </div>
  `);
}

function saveNewSection() {
  const name = document.getElementById("m-name").value.trim();
  if (!name) return;
  data.sections.push({
    id: uid("sec"),
    name,
    category: document.getElementById("m-cat").value,
    targetItems: Number(document.getElementById("m-target").value) || 0,
    collapsed: false,
    notes: document.getElementById("m-notes").value,
    items: []
  });
  markDirty();
  closeModal();
  render();
}

function editSection(si) {
  const sec = data.sections[si];
  showModal(`
    <h3>Edit Section</h3>
    <div class="modal-form">
      <label>Name <input type="text" id="m-name" value="${escapeHtml(sec.name)}" autofocus></label>
      <label>Category
        <select id="m-cat">${categoryOptions(sec.category || "misc")}</select>
      </label>
      <label>Target item count
        <input type="number" id="m-target" value="${Number(sec.targetItems) || 0}" min="0" step="1">
      </label>
      <label>Notes <textarea id="m-notes" rows="3">${escapeHtml(sec.notes || "")}</textarea></label>
      <div class="modal-actions">
        <button onclick="closeModal()">Cancel</button>
        <button class="primary" onclick="saveEditSection(${si})">Save</button>
      </div>
    </div>
  `);
}

function saveEditSection(si) {
  const sec = data.sections[si];
  sec.name = document.getElementById("m-name").value.trim() || sec.name;
  sec.category = document.getElementById("m-cat").value;
  sec.targetItems = Number(document.getElementById("m-target").value) || 0;
  sec.notes = document.getElementById("m-notes").value;
  markDirty();
  closeModal();
  render();
}

function deleteSection(si) {
  const sec = data.sections[si];
  if (!confirm(`Delete section "${sec.name}" and ${sec.items.length} items?`)) return;
  data.sections.splice(si, 1);
  markDirty();
  render();
}

function updateSectionNotes(si, val) {
  data.sections[si].notes = val;
  markDirty();
}

function editTarget(si) {
  const sec = data.sections[si];
  const cur = Number(sec.targetItems) || sec.items.length;
  const val = prompt(`Target item count for "${sec.name}"? (current ${cur}, items already in list: ${sec.items.length})`, cur);
  if (val === null) return;
  const n = Number(val);
  if (isNaN(n) || n < 0) return;
  sec.targetItems = n;
  markDirty();
  render();
}

// --- Items CRUD -------------------------------------------------------------

function addItem(si) {
  showModal(`
    <h3>Add Item</h3>
    <div class="modal-form">
      <label>Description <input type="text" id="m-desc" autofocus></label>
      <div class="modal-form-row">
        <label>Qty <input type="number" id="m-qty" value="1" step="any"></label>
        <label>Unit Cost (est) <input type="number" id="m-unit" value="0" step="any"></label>
      </div>
      <label>Actual Cost (optional) <input type="number" id="m-act" step="any"></label>
      <label>Receipt path (optional, set by Tom-and-Claude later) <input type="text" id="m-receipt"></label>
      <label>Payment method
        <select id="m-paymethod">
          <option value="">(none yet)</option>
          <option value="Cash">Cash</option>
          <option value="Debit">Debit</option>
          <option value="Credit Card">Credit Card</option>
          <option value="Zelle">Zelle</option>
          <option value="ACH">ACH</option>
          <option value="Check">Check</option>
          <option value="Other">Other</option>
        </select>
      </label>
      <label>Scope
        <select id="m-scope">
          <option value="original">Original (planned, deposit-funded)</option>
          <option value="added">Add-on (extra, beyond original budget)</option>
        </select>
      </label>
      <label>Notes <textarea id="m-notes" rows="2"></textarea></label>
      <div class="modal-actions">
        <button onclick="closeModal()">Cancel</button>
        <button class="primary" onclick="saveNewItem(${si})">Add</button>
      </div>
    </div>
  `);
}

function saveNewItem(si) {
  const desc = document.getElementById("m-desc").value.trim();
  if (!desc) return;
  const receipt = document.getElementById("m-receipt").value.trim();
  const paymethod = document.getElementById("m-paymethod").value.trim();
  const scope = document.getElementById("m-scope").value || "original";
  data.sections[si].items.push({
    id: uid("item"),
    description: desc,
    qty: Number(document.getElementById("m-qty").value) || 0,
    unitCost: Number(document.getElementById("m-unit").value) || 0,
    actualCost: document.getElementById("m-act").value ? Number(document.getElementById("m-act").value) : null,
    notes: document.getElementById("m-notes").value,
    receiptPath: receipt || null,
    paymentMethod: paymethod || null,
    scope: scope,
    dateAdded: new Date().toISOString().slice(0, 10)
  });
  markDirty();
  closeModal();
  render();
}

function editItem(si, ii) {
  const it = data.sections[si].items[ii];
  showModal(`
    <h3>Edit Item</h3>
    <div class="modal-form">
      <label>Description <input type="text" id="m-desc" value="${escapeHtml(it.description)}" autofocus></label>
      <div class="modal-form-row">
        <label>Qty <input type="number" id="m-qty" value="${it.qty || 0}" step="any"></label>
        <label>Unit Cost (est) <input type="number" id="m-unit" value="${it.unitCost || 0}" step="any"></label>
      </div>
      <label>Actual Cost <input type="number" id="m-act" value="${it.actualCost ?? ""}" step="any"></label>
      <label>Receipt path <input type="text" id="m-receipt" value="${escapeHtml(it.receiptPath || "")}"></label>
      <label>Payment method
        <select id="m-paymethod">
          <option value="" ${!it.paymentMethod ? "selected" : ""}>(none yet)</option>
          <option value="Cash" ${it.paymentMethod === "Cash" ? "selected" : ""}>Cash</option>
          <option value="Debit" ${it.paymentMethod === "Debit" ? "selected" : ""}>Debit</option>
          <option value="Credit Card" ${it.paymentMethod === "Credit Card" ? "selected" : ""}>Credit Card</option>
          <option value="Zelle" ${it.paymentMethod === "Zelle" ? "selected" : ""}>Zelle</option>
          <option value="ACH" ${it.paymentMethod === "ACH" ? "selected" : ""}>ACH</option>
          <option value="Check" ${it.paymentMethod === "Check" ? "selected" : ""}>Check</option>
          <option value="Other" ${it.paymentMethod === "Other" ? "selected" : ""}>Other</option>
        </select>
      </label>
      <label>Scope
        <select id="m-scope">
          <option value="original" ${(it.scope || "original") === "original" ? "selected" : ""}>Original (planned, deposit-funded)</option>
          <option value="added" ${it.scope === "added" ? "selected" : ""}>Add-on (extra, beyond original budget)</option>
        </select>
      </label>
      <label>Notes <textarea id="m-notes" rows="2">${escapeHtml(it.notes || "")}</textarea></label>
      <div class="modal-actions">
        <button onclick="closeModal()">Cancel</button>
        <button class="primary" onclick="saveEditItem(${si},${ii})">Save</button>
      </div>
    </div>
  `);
}

function saveEditItem(si, ii) {
  const it = data.sections[si].items[ii];
  it.description = document.getElementById("m-desc").value.trim() || it.description;
  it.qty = Number(document.getElementById("m-qty").value) || 0;
  it.unitCost = Number(document.getElementById("m-unit").value) || 0;
  const actVal = document.getElementById("m-act").value;
  it.actualCost = actVal === "" ? null : Number(actVal);
  it.receiptPath = document.getElementById("m-receipt").value.trim() || null;
  it.paymentMethod = document.getElementById("m-paymethod").value.trim() || null;
  it.scope = document.getElementById("m-scope").value || "original";
  it.notes = document.getElementById("m-notes").value;
  markDirty();
  closeModal();
  render();
}

function deleteItem(si, ii) {
  const it = data.sections[si].items[ii];
  if (!confirm(`Delete item "${it.description}"?`)) return;
  data.sections[si].items.splice(ii, 1);
  markDirty();
  render();
}

// --- Save (POST to Worker) --------------------------------------------------

function getSecret() {
  let s = localStorage.getItem(SECRET_STORAGE_KEY);
  if (!s) {
    s = prompt("Enter edit secret (one-time setup):");
    if (s) localStorage.setItem(SECRET_STORAGE_KEY, s);
  }
  return s;
}

async function save() {
  if (!dirty) {
    setStatus("Nothing to save", "saved");
    return;
  }
  const secret = getSecret();
  if (!secret) {
    setStatus("Secret required", "error");
    return;
  }
  data.lastModified = new Date().toISOString();
  setStatus("Saving...", "saving");
  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Edit-Secret": secret },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HTTP ${res.status}: ${txt}`);
    }
    dirty = false;
    setStatus("Saved", "saved");
  } catch (e) {
    setStatus("Save failed: " + e.message, "error");
    console.error(e);
  }
}

// --- Load -------------------------------------------------------------------

async function load() {
  try {
    const res = await fetch("data.json?t=" + Date.now());
    if (res.ok) {
      data = await res.json();
      if (!data.sections) data.sections = [];
      // Ensure each section has defaults
      data.sections.forEach(sec => {
        if (typeof sec.collapsed !== "boolean") sec.collapsed = true;
        if (!sec.category) sec.category = "misc";
        if (typeof sec.targetItems !== "number") sec.targetItems = sec.items.length;
        sec.items.forEach(it => {
          if (!it.scope) it.scope = "original";
        });
      });
      render();
      setStatus("Loaded - " + (data.lastModified ? new Date(data.lastModified).toLocaleString() : "no save yet"), "saved");
    } else {
      setStatus("data.json not found - starting empty", "dirty");
      data = { lastModified: null, sections: [] };
      render();
    }
  } catch (e) {
    setStatus("Load error: " + e.message, "error");
    data = { lastModified: null, sections: [] };
    render();
  }
}

window.addEventListener("DOMContentLoaded", load);

// Prevent accidental nav away with unsaved changes
window.addEventListener("beforeunload", e => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
