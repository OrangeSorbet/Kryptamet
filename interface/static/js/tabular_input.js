// Tabular input panel (German Credit, price data): a picker of real test-set
// rows from the registry, and one editable field per column -- a number box
// for numeric columns (training range as a hint), a code list for
// categorical ones. Returns { get, set, focus, error }.
function createTabularInput(host, model) {
    const s = model.samples, fields = s.fields || [], rows = s.rows || [];
    const fieldHtml = (f, k) => f.type === "categorical"
        ? `<select class="dropdown tab-value" data-k="${k}">${f.codes.map((c) => `<option>${escapeHtml(String(c))}</option>`).join("")}</select>`
        : `<input class="input-text tab-value" data-k="${k}" type="number" step="any" placeholder="${fmtRange(f)}" title="training range ${fmtRange(f)}">`;
    host.innerHTML = `
        ${rows.length ? `<div class="tab-pick"><span class="overview-examples-label">Start from a real test row:</span>
            <select class="dropdown tab-row">${rows.map((r, i) => `<option value="${i}">row ${i + 1}: true label "${escapeHtml(r.label_name)}"</option>`).join("")}</select></div>` : ""}
        <div class="tab-grid">${fields.map((f, k) => `
            <label class="tab-field"><span class="tab-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>${fieldHtml(f, k)}</label>`).join("")}</div>
        ${s.note ? `<p class="step-text muted">${escapeHtml(s.note)}</p>` : ""}`;
    const inputs = [...host.querySelectorAll(".tab-value")];
    const set = (inp) => {
        const row = (inp && inp.row) || {};
        fields.forEach((f, k) => { if (row[f.name] !== undefined) inputs[k].value = String(row[f.name]); });
    };
    const picker = host.querySelector(".tab-row");
    if (picker) picker.addEventListener("change", () => set(rows[Number(picker.value)].input));
    if (rows.length) set(rows[0].input);
    return {
        get: () => ({ row: Object.fromEntries(fields.map((f, k) => [f.name, f.type === "categorical" ? inputs[k].value : Number(inputs[k].value)])) }),
        set,
        focus: () => (picker || inputs[0])?.focus(),
        error: () => {
            const empty = fields.filter((f, k) => f.type !== "categorical" && (inputs[k].value.trim() === "" || !Number.isFinite(Number(inputs[k].value))));
            return empty.length ? `Enter a number for ${empty.map((f) => f.name).join(", ")}.` : null;
        },
    };
}

function fmtRange(f) {
    const r = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : Number(v.toPrecision(4)));
    return `${r(f.min)} – ${r(f.max)}`;
}
