// Computation chapter (runs on the client): what is computed, the real
// encrypted operation Enc(x)·Wᵀ + b, then the plaintext teaching mirror of
// the traced row: the largest terms one by one (value captions under w, x and
// w·x), the smaller terms summed, the zero terms, and the bias. A waterfall
// shows how each term moves the score. Every number is re-checked in the
// browser against the x that was encrypted (result.x) and the hashes of both
// transport legs. Events come from inference/he_infer.py (stage "compute").
const COMPUTE_BAND_LABELS = {
    compute_overview: "what is computed",
    compute_general_form: "the real encrypted op",
    weight_multiply: "largest terms (teaching mirror)",
    smaller_terms: "smaller terms",
    zero_terms: "zero terms",
    add_bias: "add bias",
};

// Waterfall of the running score: one row per item, each bar going from the
// sum before it to the sum after it. SVG geometry, so no inline styles.
// Drawn at the scene's real width (340..640 px), so its text stays 10.5 px on phones.
function cmpWaterfall(items, current, width) {
    const W = Math.round(Math.max(340, Math.min(640, width || 640)));
    const L = W < 480 ? 104 : 130, R = 66, ROW = 15, H = items.length * ROW + 24;
    let run = 0;
    const rows = items.map((it) => { const a = run; run += it.delta; return { ...it, a, b: run }; });
    const ends = [0, ...rows.map((r) => r.b)];
    const lo = Math.min(...ends), hi = Math.max(...ends), span = hi - lo || 1;
    const sx = (v) => L + ((v - lo) / span) * (W - L - R);
    const cut = (s) => (s.length > 16 ? s.slice(0, 15) + "…" : s);
    const bars = rows.map((r, k) => {
        const y = k * ROW + 4, x0 = sx(Math.min(r.a, r.b)), w = Math.max(1.5, Math.abs(sx(r.b) - sx(r.a)));
        const state = k === current ? " cmp-cur" : current >= 0 && k > current ? " cmp-future" : "";
        return `<g class="cmp-row${state}">
            <text x="${L - 8}" y="${y + 10}" text-anchor="end" class="cmp-label">${escapeHtml(cut(r.label))}</text>
            <rect x="${x0.toFixed(1)}" y="${y + 2}" width="${w.toFixed(1)}" height="${ROW - 5}" rx="2" class="${r.kind === "bias" ? "cmp-bias" : r.delta >= 0 ? "cmp-pos" : "cmp-neg"}"/>
            <text x="${W - R + 6}" y="${y + 10}" class="cmp-value">${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(4)}</text>
        </g>`;
    }).join("");
    const zx = sx(0).toFixed(1);
    return `<svg class="cmp-waterfall" viewBox="0 0 ${W} ${H}" role="img" aria-label="How each term moves the score">
        <line x1="${zx}" y1="0" x2="${zx}" y2="${H - 18}" class="cmp-zero"/>
        <text x="${zx}" y="${H - 4}" text-anchor="middle" class="cmp-label">0</text>
        ${bars}</svg>`;
}

function buildComputationSteps(result) {
    const events = result.events.filter((e) => e.stage === "compute");
    const x = result.x;
    const ov = events.find((e) => e.operation_name === "compute_overview").data_after;
    const terms = events.filter((e) => e.operation_name === "weight_multiply");
    const smaller = events.find((e) => e.operation_name === "smaller_terms");
    const bias = events.find((e) => e.operation_name === "add_bias").data_after;
    const leg1 = findEv(result, "leg1_unwrap").data_after, leg2 = findEv(result, "leg2_wrap").data_after;
    const encSha = findEv(result, "ckks_encrypt").data_after.serialization.sha256;
    const title = (s) => `<div class="scene-title">${escapeHtml(s)}</div>`;
    const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

    // Waterfall items: every shown term, the summed smaller terms, the bias.
    const items = [
        ...terms.map((t) => ({ label: t.data_before.name, delta: t.data_after.product, kind: "term" })),
        ...(smaller ? [{ label: `${smaller.data_after.count} smaller terms`, delta: smaller.data_after.sum, kind: "rest" }] : []),
        { label: "bias", delta: bias.bias, kind: "bias" },
    ];
    const waterfall = (el, cur) => `<div class="poly-label">How each term moves the score for '${escapeHtml(bias.row_class)}'</div>${cmpWaterfall(items, cur, el.clientWidth)}`;
    // The browser's own running sum before term k (from the encrypted x and the event's weights).
    const runBefore = (k) => terms.slice(0, k).reduce((s, t) => s + t.data_before.weight * x[t.data_before.index], 0);

    return events.map((ev) => {
        const step = { what: ev.description, why: ev.why, formal: ev.formal, next: ev.next_step };
        const op = ev.operation_name;
        if (op === "compute_overview") {
            step.renderVisual = (el) => {
                el.innerHTML = `${title("What the client computes")}<div class="scene-body">
                    <div class="compute-current-line">score_j = W_j · x + b_j</div>
                    <div class="cmp-parties">
                        <div class="cmp-party"><div class="cmp-party-name">Client has</div>
                            <div>the model: W (${ov.k} × ${ov.d}) and b (${ov.k})</div><div>Enc(x): the ciphertext from leg 1</div><div>the public CKKS context (no secret key)</div></div>
                        <div class="cmp-party"><div class="cmp-party-name">Client never has</div>
                            <div>x itself (${ov.d} values)</div><div>the CKKS secret key</div><div>the decrypted score</div></div>
                    </div>
                    <p class="step-text muted">${escapeHtml(ov.decision_rule)}. Classes: ${ov.class_names.slice(0, 6).map(escapeHtml).join(", ")}${ov.class_names.length > 6 ? ", …" : ""}.</p></div>`;
            };
        } else if (op === "compute_general_form") {
            const d = ev.data_after;
            step.renderVisual = (el) => {
                el.innerHTML = `${title("The real encrypted operation")}<div class="scene-body">
                    <div class="compute-current-line">Enc(x) · Wᵀ + b → Enc(score)</div>
                    ${renderChecks([
                        { label: `input = the ciphertext unwrapped on leg 1 (SHA-256 ${d.input_ciphertext_sha256.slice(0, 12)}…)`, ok: d.input_ciphertext_sha256 === leg1.payload_sha256 && d.input_ciphertext_sha256 === encSha },
                        { label: "client context is public-only (is_private = false)", ok: d.is_private === false },
                    ])}
                    <div class="ks-verify">${tpCheck("cmpOut", "browser: SHA-256 of the output ciphertext")}</div>
                    <div class="ciphertext-box">${escapeHtml(d.output_ciphertext_b64)}</div>
                    <p class="step-text muted">Output: all ${d.output_ciphertext_size.toLocaleString()} bytes (${formatBytes(d.output_ciphertext_size)}), computed in ${fmt(d.he_elapsed_ms, 0)} ms. Weights ${d.weights_shape.join(" × ")}, client context SHA-256 ${escapeHtml(d.client_context_sha256.slice(0, 16))}…</p></div>`;
                return encSha256(d.output_ciphertext_b64).then((s) => {
                    if (s.error) { tpSetCheck(el, "cmpOut", false, `browser: ${s.error}`); return; }
                    tpSetCheck(el, "cmpOut", s.hex === d.output_ciphertext_sha256 && s.hex === leg2.payload_sha256,
                        `browser SHA-256 of the output = the reported hash = the payload sealed on leg 2 (${s.hex.slice(0, 12)}…)`);
                });
            };
        } else if (op === "weight_multiply") {
            const k = terms.indexOf(ev), t = ev.data_before, c = ev.captions || {};
            step.renderVisual = (el) => {
                const prod = t.weight * x[t.index], run = runBefore(k) + prod;
                const val = (v, cap, cls) => `<div class="cmp-val${cls ? " " + cls : ""}"><span>${v}</span><span class="value-caption">${escapeHtml(cap || "")}</span></div>`;
                el.innerHTML = `${title(`Term ${k + 1}: '${t.name}'`)}<div class="scene-body">
                    <div class="cmp-term">
                        ${val(`${t.weight >= 0 ? "+" : ""}${fmt(t.weight)}`, c.weight)}<span class="cmp-op">×</span>
                        ${val(fmt(t.input), c.input)}<span class="cmp-op">=</span>
                        ${val(`${prod >= 0 ? "+" : ""}${fmt(prod)}`, c.product, "cmp-strong")}
                    </div>
                    ${renderChecks([
                        { label: `x[${t.index}] = the value that was encrypted`, ok: close(t.input, x[t.index]) },
                        { label: `browser: w·x = ${fmt(prod)}, running sum ${fmt(run)}`, ok: close(prod, ev.data_after.product) && close(run, ev.data_after.running_sum) },
                    ])}
                    ${waterfall(el, k)}</div>`;
            };
        } else if (op === "smaller_terms") {
            const s = ev.data_after;
            step.renderVisual = (el) => {
                const sum = s.terms.reduce((a, u) => a + u.weight * x[u.index], 0);
                el.innerHTML = `${title(`The other ${s.count} non-zero terms`)}<div class="scene-body">
                    ${renderChecks([
                        { label: `inputs = the encrypted x`, ok: s.terms.every((u) => close(u.input, x[u.index])) },
                        { label: `browser: Σ w·x = ${fmt(sum)}, running sum ${fmt(runBefore(terms.length) + sum)}`, ok: close(sum, s.sum) && close(runBefore(terms.length) + sum, s.running_sum) },
                    ])}
                    <div class="tp-table cmp-rest">
                        <div class="tp-row tp-row4 tp-headrow"><span>feature</span><span>w</span><span>x</span><span>w·x</span></div>
                        ${s.terms.map((u) => `<div class="tp-row tp-row4"><span>${escapeHtml(u.name)}</span><span>${fmt(u.weight)}</span><span>${fmt(u.input)}</span><span>${fmt(u.product)}</span></div>`).join("")}
                    </div>
                    ${waterfall(el, terms.length)}</div>`;
            };
        } else if (op === "zero_terms") {
            const z = ev.data_after;
            step.renderVisual = (el) => {
                const zeros = x.filter((v) => v === 0).length;
                el.innerHTML = `${title(`${z.count} zero features`)}<div class="scene-body">
                    ${renderChecks([
                        { label: `browser: ${zeros} of the ${x.length} encrypted values are 0`, ok: zeros === z.count },
                        { label: `running sum unchanged: ${fmt(z.running_sum)}`, ok: close(z.running_sum, (smaller ? smaller.data_after.running_sum : runBefore(terms.length))) },
                    ])}
                    ${z.largest_weight_zero_features.length ? `<div class="poly-label">The heaviest weights that multiply a 0</div>
                    <div class="compute-ledger">${z.largest_weight_zero_features.map((f) => `
                        <div class="compute-term past"><span class="term-name">${escapeHtml(f.name)}</span><span>${fmt(f.weight)} × 0 = 0 · rank ${f.rank} by |w|</span></div>`).join("")}</div>` : ""}
                    ${waterfall(el, -1)}</div>`;
            };
        } else if (op === "add_bias") {
            step.renderVisual = (el) => {
                const score = bias.running_sum + bias.bias, he = result.scores[bias.row];
                el.innerHTML = `${title("Add the bias")}<div class="scene-body">
                    <div class="compute-sum"><span>score for '${escapeHtml(bias.row_class)}'</span><strong>${fmt(score)}</strong></div>
                    ${renderChecks([
                        { label: `browser: ${fmt(bias.running_sum)} + (${fmt(bias.bias)}) = ${fmt(score)}`, ok: close(score, bias.score) },
                        { label: `= the plaintext model's score ${fmt(result.plain_scores[bias.row])}`, ok: close(score, result.plain_scores[bias.row]) },
                        { label: `≈ the decrypted HE score ${fmt(he, 6)} (Decryption chapter), off by ${Math.abs(he - score).toExponential(1)}`, ok: Math.abs(he - score) < 1e-2 },
                    ])}
                    ${waterfall(el, items.length - 1)}</div>`;
            };
        } else {
            step.renderVisual = (el) => { el.innerHTML = `${title("Computation")}<div class="compute-current-line">${escapeHtml(ev.description)}</div>`; };
        }
        return step;
    });
}

function buildComputationBands(result) {
    const events = result.events.filter((e) => e.stage === "compute");
    const bands = [];
    events.forEach((ev, i) => {
        const label = COMPUTE_BAND_LABELS[ev.operation_name] || ev.operation_name;
        const last = bands[bands.length - 1];
        if (last && last.label === label) last.end = i;
        else bands.push({ start: i, end: i, label });
    });
    return bands;
}
