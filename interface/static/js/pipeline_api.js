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

async function runPipeline(model, text, passphrase) {
    if (!text.trim()) return { ok: false, error: "Type a sentence first." };
    const r = await postJson("/api/infer_text", { model, text, passphrase: passphrase || "" });
    if (r.ok) pipelineResult = r.data;
    return r;
}

async function fetchCkksDeepDive(model, text) {
    const r = await postJson("/api/ckks_deep_dive", { model, text });
    return r.ok ? r.data : null;
}
