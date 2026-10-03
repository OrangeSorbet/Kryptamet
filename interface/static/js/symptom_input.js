// Symptom input panel (Symptom Diagnosis): your own case by default -- every
// symptom column of the training table as a toggle chip, a filter box, a list
// of what you picked -- or a real test-set case as a preset (still editable).
// Returns { get, set, focus, error }.
const symptomLabel = (s) => s.replace(/_/g, " ").replace(/\s+/g, " ").trim();

function createSymptomInput(host, model) {
    const s = model.samples, names = s.symptoms || [], rows = s.rows || [];
    host.innerHTML = `
        <div class="tab-pick"><span class="overview-examples-label">Case:</span>
            <select class="dropdown sym-row"><option value="">My own case: pick symptoms below</option>${rows.map((r, i) => `<option value="${i}">case ${i + 1}: "${escapeHtml(r.label_name)}" (${r.input.symptoms.length} symptoms)</option>`).join("")}</select></div>
        <div class="sym-selected"></div>
        <div class="sym-bar"><input class="input-text sym-filter" type="search" placeholder="Filter ${names.length} symptoms..." aria-label="Filter symptoms">
            <span class="sym-count"></span><button type="button" class="example-chip sym-clear">Clear</button></div>
        <div class="sym-chips">${names.map((n, k) => `<button type="button" class="sym-chip" data-k="${k}" aria-pressed="false">${escapeHtml(symptomLabel(n))}</button>`).join("")}</div>`;
    const chips = [...host.querySelectorAll(".sym-chip")];
    const count = host.querySelector(".sym-count");
    const picked = host.querySelector(".sym-selected");
    const picker = host.querySelector(".sym-row");
    const on = new Set();
    const refresh = () => {
        chips.forEach((c, k) => c.setAttribute("aria-pressed", String(on.has(k))));
        count.textContent = `${on.size} selected`;
        picked.innerHTML = on.size
            ? `<span class="overview-examples-label">Your symptoms:</span>${[...on].map((k) => `<button type="button" class="sym-chip sym-picked" data-k="${k}" aria-pressed="true" aria-label="remove">${escapeHtml(symptomLabel(names[k]))} ×</button>`).join("")}`
            : `<span class="overview-examples-label">No symptoms yet: click any below (filter to find them).</span>`;
    };
    const set = (inp) => {
        on.clear();
        ((inp && inp.symptoms) || []).forEach((n) => { const k = names.indexOf(n); if (k >= 0) on.add(k); });
        refresh();
    };
    const toggle = (k) => { on.has(k) ? on.delete(k) : on.add(k); picker.value = ""; refresh(); };
    chips.forEach((c, k) => c.addEventListener("click", () => toggle(k)));
    picked.addEventListener("click", (e) => { const b = e.target.closest(".sym-picked"); if (b) toggle(Number(b.dataset.k)); });
    host.querySelector(".sym-filter").addEventListener("input", (e) => {
        const q = e.target.value.trim().toLowerCase();
        chips.forEach((c) => { c.hidden = !!q && !c.textContent.toLowerCase().includes(q); });
    });
    host.querySelector(".sym-clear").addEventListener("click", () => { picker.value = ""; set(null); });
    picker.addEventListener("change", () => set(picker.value === "" ? null : rows[Number(picker.value)].input));
    set(null);
    return {
        get: () => ({ symptoms: names.filter((_, k) => on.has(k)) }),
        set,
        focus: () => host.querySelector(".sym-filter").focus(),
        error: () => (on.size ? null : "Select at least one symptom."),
    };
}
