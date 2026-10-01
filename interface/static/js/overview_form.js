// Entry screen: pick any of the registry's models (GET /api/models) and give
// it an input with the panel for its input kind -- text_input.js,
// tabular_input.js, symptom_input.js, digit_canvas.js. `initial`
// ({ model, input }) restores the last run's choice when coming back.
const INPUT_PANELS = { text: createTextInput, tabular: createTabularInput, symptoms: createSymptomInput, image: createDigitInput };

function renderOverviewScene(el, initial) {
    el.innerHTML = `
        <div class="overview">
            <div class="overview-eyebrow">Privacy-preserving ML, step by step</div>
            <div class="scene-title">Homomorphic encryption, live</div>
            <p class="overview-lede">Pick a model and give it an input. It gets encrypted, a model scores it
                <em>without ever decrypting it</em>, and only you can read the answer. Every step that follows
                is the real computation on your actual input.</p>
            <label class="overview-label" for="modelSelect">Model</label>
            <select id="modelSelect" class="dropdown" disabled><option>Loading models...</option></select>
            <p class="overview-help step-text muted"></p>
            <div class="overview-label">Your input</div>
            <div class="overview-panel"></div>
            <div class="overview-actions">
                <button id="runInferenceBtn" class="btn btn-run" type="button" disabled>
                    <span class="btn-spinner" aria-hidden="true"></span><span class="btn-run-label">Encrypt &amp; run</span>
                </button>
                <span class="overview-hint">Ctrl+Enter</span>
                <span id="runStatus" class="overview-status" role="status"></span>
            </div>
        </div>`;
    const select = el.querySelector("#modelSelect");
    const help = el.querySelector(".overview-help");
    const host = el.querySelector(".overview-panel");
    const btn = el.querySelector("#runInferenceBtn");
    const status = el.querySelector("#runStatus");
    let models = [];
    let panel = null;

    const showError = (msg) => { status.className = "overview-status error"; status.textContent = msg; };

    function choose(id, input) {
        const m = models.find((x) => x.id === id) || models[0];
        select.value = m.id;
        help.textContent = `${m.input_help}${m.samples.note && m.input_kind !== "tabular" ? ` (${m.samples.note})` : ""}`;
        panel = INPUT_PANELS[m.input_kind](host, m);
        if (input) panel.set(input);
    }

    async function run() {
        if (btn.disabled || !panel) return;
        const err = panel.error();
        if (err) { showError(err); return; }
        btn.disabled = true;
        btn.classList.add("loading");
        status.className = "overview-status";
        status.textContent = "Extracting features, generating keys, encrypting, computing...";
        const r = await window.onRunRequested(select.value, panel.get());
        btn.disabled = false;
        btn.classList.remove("loading");
        if (!r.ok) showError(r.error);
        else status.textContent = "";
    }

    btn.addEventListener("click", run);
    el.querySelector(".overview").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(); });
    select.addEventListener("change", () => choose(select.value));

    fetchModels().then((r) => {
        if (!r.ok) { showError(r.error); return; }
        models = r.data;
        select.innerHTML = models.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join("");
        select.disabled = false;
        btn.disabled = false;
        choose(initial ? initial.model : models[0].id, initial && initial.input);
    });
    return { focus: () => panel && panel.focus() };
}
