// Tabular input panel (German Credit, price data): a picker of real test-set
// cases from the registry (with a price_chart.js line chart when the case has a
// price history), and one editable field per column -- a number box
// for numeric columns (training range as a hint), a code list for
// categorical ones. Returns { get, set, focus, error }.
function createTabularInput(host, model) {
    const s = model.samples, fields = s.fields || [], rows = s.rows || [];
    const optText = (f, c) => (f.meanings && f.meanings[c] ? `${c} · ${f.meanings[c]}` : String(c));
    const fieldHtml = (f, k) => f.type === "categorical"
        ? `<select class="dropdown tab-value" data-k="${k}">${f.codes.map((c) => `<option value="${escapeHtml(String(c))}">${escapeHtml(optText(f, c))}</option>`).join("")}</select>`
        : `<span class="tab-num"><input class="input-text tab-value" data-k="${k}" type="number" step="any" placeholder="${fmtRange(f)}" aria-label="training range ${fmtRange(f)}">
            <span class="tab-step"><button type="button" data-d="1" aria-label="increase ${escapeHtml(f.name)}"></button><button type="button" data-d="-1" aria-label="decrease ${escapeHtml(f.name)}"></button></span></span>`;
    host.innerHTML = `
        ${rows.length ? `<div class="tab-pick"><span class="overview-examples-label">Start from a real test case:</span>
            <select class="dropdown tab-row">${rows.map((r, i) => `<option value="${i}">case ${i + 1}${r.history ? ` (${r.history.day})` : ""}: true label "${escapeHtml(r.label_name)}"</option>`).join("")}</select></div>` : ""}
        ${rows.some((r) => r.history) ? `<div class="tab-chart"></div>` : ""}
        <div class="tab-grid">${fields.map((f, k) => `
            <label class="tab-field"><span class="tab-name" aria-label="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>${f.doc ? `<span class="tab-doc">${escapeHtml(f.doc)}${f.type === "numeric" ? ` · ${fmtRange(f)}` : ""}</span>` : ""}${fieldHtml(f, k)}</label>`).join("")}</div>
        ${s.note ? `<p class="step-text muted">${escapeHtml(s.note)}</p>` : ""}`;
    const inputs = [...host.querySelectorAll(".tab-value")];
    // Custom +/-1 steppers (the native spin buttons are hidden in tabular_input.css).
    host.querySelectorAll(".tab-step button").forEach((b) => b.addEventListener("click", () => {
        const input = b.closest(".tab-num").querySelector("input");
        input.value = String((Number(input.value) || 0) + Number(b.dataset.d));
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }));
    const set = (inp) => {
        const row = (inp && inp.row) || {};
        fields.forEach((f, k) => { if (row[f.name] !== undefined) inputs[k].value = String(row[f.name]); });
    };
    const picker = host.querySelector(".tab-row");
    const get = () => ({ row: Object.fromEntries(fields.map((f, k) => [f.name, f.type === "categorical" ? inputs[k].value : Number(inputs[k].value)])) });
    const chart = host.querySelector(".tab-chart");
    const redraw = () => {
        const hist = chart && picker && rows[Number(picker.value)].history;
        if (hist) chart.innerHTML = priceChartSvg(hist, get().row);
    };
    if (picker) picker.addEventListener("change", () => { set(rows[Number(picker.value)].input); redraw(); });
    host.addEventListener("input", redraw);
    if (rows.length) set(rows[0].input);
    redraw();
    return {
        get,
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
