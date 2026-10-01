// Symptom input panel (Symptom Diagnosis): every symptom column of the
// training table as a toggle chip, a filter box, and real test-set cases as
// presets. Returns { get, set, focus, error }.
const symptomLabel = (s) => s.replace(/_/g, " ").replace(/\s+/g, " ").trim();

function createSymptomInput(host, model) {
    const s = model.samples, names = s.symptoms || [], rows = s.rows || [];
    host.innerHTML = `
        ${rows.length ? `<div class="tab-pick"><span class="overview-examples-label">Start from a real test case:</span>
            <select class="dropdown sym-row">${rows.map((r, i) => `<option value="${i}">case ${i + 1}: "${escapeHtml(r.label_name)}" (${r.input.symptoms.length} symptoms)</option>`).join("")}</select></div>` : ""}
        <div class="sym-bar"><input class="input-text sym-filter" type="search" placeholder="Filter ${names.length} symptoms..." aria-label="Filter symptoms">
            <span class="sym-count"></span><button type="button" class="example-chip sym-clear">Clear</button></div>
        <div class="sym-chips">${names.map((n, k) => `<button type="button" class="sym-chip" data-k="${k}" aria-pressed="false">${escapeHtml(symptomLabel(n))}</button>`).join("")}</div>`;
    const chips = [...host.querySelectorAll(".sym-chip")];
    const count = host.querySelector(".sym-count");
    const on = new Set();
    const refresh = () => {
        chips.forEach((c, k) => c.setAttribute("aria-pressed", String(on.has(k))));
        count.textContent = `${on.size} selected`;
    };
    const set = (inp) => {
        on.clear();
        ((inp && inp.symptoms) || []).forEach((n) => { const k = names.indexOf(n); if (k >= 0) on.add(k); });
        refresh();
    };
    chips.forEach((c, k) => c.addEventListener("click", () => { on.has(k) ? on.delete(k) : on.add(k); refresh(); }));
    host.querySelector(".sym-filter").addEventListener("input", (e) => {
        const q = e.target.value.trim().toLowerCase();
        chips.forEach((c) => { c.hidden = !!q && !c.textContent.toLowerCase().includes(q); });
    });
    host.querySelector(".sym-clear").addEventListener("click", () => set(null));
    const picker = host.querySelector(".sym-row");
    if (picker) picker.addEventListener("change", () => set(rows[Number(picker.value)].input));
    set(rows.length ? rows[0].input : null);
    return {
        get: () => ({ symptoms: names.filter((_, k) => on.has(k)) }),
        set,
        focus: () => host.querySelector(".sym-filter").focus(),
        error: () => (on.size ? null : "Select at least one symptom."),
    };
}
