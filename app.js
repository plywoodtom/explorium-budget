// Explorium Budget Tracker
// Loads data.json, renders sections + items, supports in-app edits.
// Save POSTs to a Cloudflare Worker that commits to GitHub.

const WORKER_URL = "https://explorium-budget-worker.plywoodtom.workers.dev"; // updated when Worker deploys
const SECRET_STORAGE_KEY = "explorium_budget_secret";

let data = { lastModified: null, sections: [] };
let dirty = false;

// --- Helpers ---------------------------------------------------------------

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return "$0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return sign + "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtShort(n) {
  if (n === null || n === undefined || isNaN(n)) return "$0";
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function uid(prefix) {
  return prefix + "-" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

function totalEst(item) {
  return (Number(item.qty) || 0) * (Number(item.unitCost) || 0);
}

function actual(item) {
  return Number(item.actualCost) || 0;
}

function delta(item) {
  return actual(item) - totalEst(item);
}

function sectionTotalEst(sec) {
  return sec.items.reduce((s, i) => s + totalEst(i), 0);
}

function sectionTotalAct(sec) {
  return sec.items.reduce((s, i) => s + actual(i), 0);
}

function sectionItemCount(sec) {
  return sec.items.length;
}

function grandTotalEst() {
  return data.sections.reduce((s, sec) => s + sectionTotalEst(sec), 0);
}

function grandTotalAct() {
  return data.sections.reduce((s, sec) => s + sectionTotalAct(sec), 0);
}

function grandItemCount() {
  return data.sections.reduce((s, sec) => s + sec.items.length, 0);
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

// --- Rendering --------------------------------------------------------------

function render() {
  const root = document.getElementById("sections");
  root.innerHTML = "";
  data.sections.forEach((sec, si) => {
    root.appendChild(renderSection(sec, si));
  });
  renderTotals();
}

function renderTotals() {
  const est = grandTotalEst();
  const act = grandTotalAct();
  const d = act - est;
  document.getElementById("grand-est").textContent = fmt(est);
  document.getElementById("grand-act").textContent = fmt(act);
  const deltaEl = document.getElementById("grand-delta");
  deltaEl.textContent = (d >= 0 ? "+" : "") + fmt(d);
  deltaEl.className = "delta " + (d > 0 ? "over" : d < 0 ? "under" : "");
  document.getElementById("grand-count").textContent = grandItemCount();
}

function renderSection(sec, si) {
  const el = document.createElement("div");
  el.className = "section";
  const est = sectionTotalEst(sec);
  const act = sectionTotalAct(sec);
  const d = act - est;
  el.innerHTML = `
    <div class="section-header" onclick="toggleSection(${si})">
      <div>
        <h2>${escapeHtml(sec.name)}</h2>
        <div class="section-totals">
          ${sec.items.length} items · Est ${fmt(est)} · Act ${fmt(act)} · <span class="delta ${d > 0 ? "over" : d < 0 ? "under" : ""}">${d >= 0 ? "+" : ""}${fmt(d)}</span>
        </div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="small" onclick="event.stopPropagation();editSection(${si})">Edit</button>
        <button class="small danger" onclick="event.stopPropagation();deleteSection(${si})">Del</button>
      </div>
    </div>
    <div class="section-body" id="sec-body-${si}">
      <textarea class="section-notes" placeholder="Section notes (optional)" oninput="updateSectionNotes(${si}, this.value)">${escapeHtml(sec.notes || "")}</textarea>
      <div class="items">
        ${sec.items.map((it, ii) => renderItem(it, si, ii)).join("")}
      </div>
      <button class="add-item-btn" onclick="addItem(${si})">+ Add Item</button>
    </div>
  `;
  return el;
}

function renderItem(item, si, ii) {
  const est = totalEst(item);
  const act = actual(item);
  const d = act - est;
  const dCls = d > 0 ? "over" : d < 0 ? "under" : "";
  return `
    <div class="item">
      <div class="item-row1">
        <div>
          <div class="item-desc">${escapeHtml(item.description)}</div>
          <div class="item-meta">Qty ${item.qty || 0} × ${fmt(item.unitCost || 0)} ${item.dateAdded ? "· " + escapeHtml(item.dateAdded) : ""}</div>
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
          <span class="cell-value">${act ? fmt(act) : "—"}</span>
        </div>
        <div class="cell">
          <span class="cell-label">Delta</span>
          <span class="cell-value ${dCls}">${act ? (d >= 0 ? "+" : "") + fmt(d) : "—"}</span>
        </div>
      </div>
      ${item.notes ? `<div class="item-notes">${escapeHtml(item.notes)}</div>` : ""}
    </div>
  `;
}

function toggleSection(si) {
  const body = document.getElementById("sec-body-" + si);
  body.style.display = body.style.display === "none" ? "" : "none";
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

function addSection() {
  showModal(`
    <h3>Add Section</h3>
    <div class="modal-form">
      <label>Name <input type="text" id="m-name" autofocus></label>
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
      <label>Notes <textarea id="m-notes" rows="3">${escapeHtml(sec.notes || "")}</textarea></label>
      <div class="modal-actions">
        <button onclick="closeModal()">Cancel</button>
        <button class="primary" onclick="saveEditSection(${si})">Save</button>
      </div>
    </div>
  `);
}

function saveEditSection(si) {
  data.sections[si].name = document.getElementById("m-name").value.trim() || data.sections[si].name;
  data.sections[si].notes = document.getElementById("m-notes").value;
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
  data.sections[si].items.push({
    id: uid("item"),
    description: desc,
    qty: Number(document.getElementById("m-qty").value) || 0,
    unitCost: Number(document.getElementById("m-unit").value) || 0,
    actualCost: document.getElementById("m-act").value ? Number(document.getElementById("m-act").value) : null,
    notes: document.getElementById("m-notes").value,
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
      render();
      setStatus("Loaded · " + (data.lastModified ? new Date(data.lastModified).toLocaleString() : "no save yet"), "saved");
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
