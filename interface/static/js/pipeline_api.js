// Client for the two backend endpoints /live uses. Holds the latest real
// run in `pipelineResult` (global -- chapter_state.js and the chapter step
// builders read it). Both calls resolve to { ok, error } instead of
// throwing or alert()ing, so callers can show the error inline.
let pipelineResult = null;

async function postJson(url, body) {
    try {
        const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok) return { ok: false, error: (data && data.error) || `HTTP ${resp.status}` };
        return { ok: true, data };
    } catch (e) {
        return { ok: false, error: "Could not reach the server -- is `uv run python -m interface.app` running?" };
    }
}

// `input` is the model's input object: {text} / {row} / {symptoms} / {images}
// (inference/model_registry.py validates it).
async function runPipeline(model, input, passphrase) {
    const r = await postJson("/api/infer", { model, input, passphrase: passphrase || "" });
    if (r.ok) pipelineResult = r.data;
    return r;
}

async function fetchCkksDeepDive(model, input) {
    const r = await postJson("/api/ckks_deep_dive", { model, input });
    return r.ok ? r.data : null;
}

let modelCatalog = null;
// The registry's models with their input kinds and real sample inputs (GET /api/models), fetched once.
async function fetchModels() {
    if (modelCatalog) return { ok: true, data: modelCatalog };
    try {
        const resp = await fetch("/api/models");
        if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
        modelCatalog = await resp.json();
        return { ok: true, data: modelCatalog };
    } catch (e) {
        return { ok: false, error: "Could not reach the server -- is `uv run python -m interface.app` running?" };
    }
}

// One line describing a run's input, for the navbar.
function inputSummary(result) {
    const inp = result.input || {};
    const cut = (t, n) => (t.length > n ? t.slice(0, n) + "…" : t);
    if (inp.text !== undefined) return `"${cut(inp.text, 48)}"`;
    if (inp.symptoms) return cut(`${inp.symptoms.length} symptoms: ${inp.symptoms.map(symptomLabel).join(", ")}`, 60);
    if (inp.images) return `a drawing, ${inp.images.length} character${inp.images.length > 1 ? "s" : ""}`;
    if (inp.pixels) return `a drawn digit, ${inp.pixels.filter((v) => v > 0).length} inked pixels`;
    if (inp.row) return cut(Object.entries(inp.row).map(([k, v]) => `${k} ${typeof v === "number" ? Number(v.toPrecision(5)) : v}`).join(", "), 60);
    return "";
}
