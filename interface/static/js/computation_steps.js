// Computation chapter (runs on the server): what is computed, the real
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

    // Plain-words twin of each event (explain_level.js), from the same event data.
    const sign = (v) => `${v >= 0 ? "+" : ""}${fmt(v)}`;
    const computeEli5 = (ev, op) => {
        const a = ev.data_after || {};
        if (op === "compute_overview") return {
            what: `The server runs the model on your locked numbers. The model (logistic regression) is ${ov.k} score${ov.k > 1 ? "s" : ""}, one per possible answer: score = w₀·x₀ + w₁·x₁ + … + w${ov.d - 1}·x${ov.d - 1} + b. x is ${srcRef("feature_x", "your list of numbers")} (locked), each w is a weight the model learned in training (a plus sign pushes toward that answer, a minus away), and b is the bias, the score before any input. The server has W (${ov.k} × ${ov.d} weights), b and the locked package. It never has x, the secret key or the scores.`,
            why: "A score like this is only multiplications and additions, exactly the two things CKKS can do on locked data. Turning scores into percentages needs eˣ, which CKKS can't do, so that step waits for you, after unlocking.",
            formal: "score = w · x + b, for each answer",
            next: "Next: the one real locked calculation.",
        };
        if (op === "compute_general_form") return {
            what: `The whole model ran on the locked package in one operation, Enc(x)·Wᵀ + b, in ${fmt(a.he_elapsed_ms, 0)} ms. Inside: the locked slots are multiplied by the weights (plain numbers), the scale is brought back down by dividing by one ${result.ckks_params.global_scale_bits}-bit prime ("rescaling"), the slots are slid round and added to total them (using the rotation keys), and the bias is added. Out comes a new locked package of ${formatBytes(a.output_ciphertext_size)} holding the score${ov.k > 1 ? "s" : ""}, fingerprint ${srcRef("result_ct_sha", ksShort(a.output_ciphertext_sha256))}.`,
            why: `Why it gives the right answer: unlocking is c₀ + c₁·s, only adds and multiplies, so multiplying or adding the locked parts does the same to the hidden numbers. Why rescale: x × w makes the scale 2^${result.ckks_params.global_scale_bits} × 2^${result.ckks_params.global_scale_bits}; dividing by a prime of about 2^${result.ckks_params.global_scale_bits} brings it back and uses up one prime. Why slide-and-add: locked slots can only be added position by position, never across, so sliding a copy is the only way to total them. The server can't read its own result; the next steps replay the sum in plain numbers only to show what happened inside.`,
            formal: "locked scores = Enc(x) · Wᵀ + b",
            next: "Next: the biggest contributions, one by one (a plain replay).",
        };
        if (op === "weight_multiply") {
            const t = ev.data_before, k = terms.indexOf(ev), prod = a.product;
            return {
                what: `Replay ${k + 1}: "${t.name}" has weight ${sign(t.weight)}, your value is ${fmt(t.input)}, so it adds ${sign(prod)}. Running total: ${fmt(a.running_sum)}.`,
                why: `A positive weight pushes the answer toward "${bias.row_class}", a negative one away, and bigger values push harder. This is only a plain replay; the real sum happened locked.`,
                formal: `${fmt(t.weight)} × ${fmt(t.input)} = ${fmt(prod)}`,
                next: k < terms.length - 1 ? `Next: "${terms[k + 1].data_before.name}", the next-biggest contribution.` : "Next: everything smaller, added up together.",
            };
        }
        if (op === "smaller_terms") return {
            what: `The remaining ${a.count} smaller contributions add ${sign(a.sum)} in total. Running total: ${fmt(a.running_sum)}.`,
            why: "Each of them barely moves the score, so they're shown together.",
            formal: `${a.count} small terms = ${fmt(a.sum)}`,
            next: "Next: the values that are zero.",
        };
        if (op === "zero_terms") return {
            what: `${a.count} of your values are 0, and anything × 0 = 0, so together they add nothing.`,
            why: "Most of the model's inputs don't apply to your input, so they drop out of the sum.",
            formal: `${a.count} × (weight × 0) = 0`,
            next: "Next: the fixed offset.",
        };
        return {
            what: `Finally the model's fixed offset (${sign(a.bias)}) is added: score for "${a.row_class}" = ${fmt(a.score)}.`,
            why: "The bias is the score an all-zero input would get. In the locked run the bias is first scaled to match the locked total (else it would be added in the wrong units). This replayed total is exactly what the locked score will unlock to, up to tiny noise; the server itself never sees it.",
            formal: `score = ${fmt(a.running_sum)} + ${fmt(a.bias)} = ${fmt(a.score)}`,
            next: "Next chapter: the locked result travels back to the client.",
        };
    };

    // Toy-number twins (ELI1) for the steps whose idea isn't already a small sum.
    const computeEli1 = (op) => {
        if (op === "compute_overview") return {
            what: `Toy from "How HE works": score = ${TOY.w1} × x₁ + (${TOY.w2}) × x₂ + ${TOY.b}. With x₁ = ${TOY.x1.x} and x₂ = ${TOY.x2.x}: ${TOY.w1 * TOY.x1.x} − ${TOY.x2.x} + ${TOY.b} = ${(TOY.w1 * TOY.x1.x + TOY.w2 * TOY.x2.x + TOY.b).toFixed(2)}.`,
            why: `Your real model does the same with ${ov.d} numbers${ov.k > 1 ? `, once for each of the ${ov.k} answers` : ""}.`,
            formal: "toy: 3·x₁ − x₂ + 0.1.",
            next: "Next: the locked version.",
        };
        if (op === "compute_general_form") {
            const s = [2, 5, 1, 4], r2 = s.map((v, j) => v + s[(j + 2) % 4]), r1 = r2.map((v, j) => v + r2[(j + 1) % 4]);
            return {
                what: `Rescaling toy (Δ = 1000): 0.25 is stored as 250, weight 3 as 3000. Product 250 × 3000 = 750,000, at scale 1000 × 1000. Divide by 1000: 750, i.e. 0.75 at the normal scale. Slide-and-add toy: slots [${s.join(", ")}]; slide by 2 and add: [${r2.join(", ")}]; slide by 1 and add: [${r1.join(", ")}]. Every slot now holds the total ${s.reduce((a, v) => a + v, 0)}.`,
                why: "Each slide halves how far apart the pieces still are, so 4 slots need 2 rounds and 128 need 7.",
                formal: "toy: [2,5,1,4] → [3,9,3,9] → [12,12,12,12].",
                next: "Next: the plain replay.",
            };
        }
        if (op === "add_bias") return {
            what: `Toy: the bias ${TOY.b} at scale Δ = ${TOY.delta} is ${TOY.bm}, added to c₀ only: c₀ + ${TOY.bm}. Unlocking then gives the hidden number + ${TOY.bm}, i.e. + ${TOY.b}.`,
            why: "Adding a plain number only needs to touch c₀, because unlocking is c₀ + c₁·s.",
            formal: `toy: c₀ + ${TOY.bm}.`,
            next: "Next chapter: the result travels back.",
        };
        return null;
    };

    return events.map((ev) => {
        const step = { what: ev.description, why: ev.why, formal: ev.formal, next: ev.next_step };
        const op = ev.operation_name;
        step.eli5 = computeEli5(ev, op);
        const toy = computeEli1(op);
        if (toy) step.eli1 = toy;
        if (op === "compute_overview") {
            step.renderVisual = (el) => {
                el.innerHTML = `${title("What the server computes")}<div class="scene-body">
                    <div class="compute-current-line">score_j = W_j · x + b_j</div>
                    <div class="cmp-parties">
                        <div class="cmp-party"><div class="cmp-party-name">Server has</div>
                            <div>the model: W (${ov.k} × ${ov.d}) and b (${ov.k})</div><div>Enc(x): the ciphertext from leg 1</div><div>the public CKKS context (no secret key)</div></div>
                        <div class="cmp-party"><div class="cmp-party-name">Server never has</div>
                            <div>x itself (${ov.d} values)</div><div>the CKKS secret key</div><div>the decrypted score</div></div>
                    </div>
                    <p class="step-text muted">${escapeHtml(ov.decision_rule)}. Classes: ${ov.class_names.slice(0, 6).map(escapeHtml).join(", ")}${ov.class_names.length > 6 ? ", …" : ""}.</p></div>`;
            };
        } else if (op === "compute_general_form") {
            const d = ev.data_after;
            step.facts = [{ id: "result_ct_sha", label: "SHA-256 fingerprint of the encrypted result the server computed", value: d.output_ciphertext_sha256 }];
            step.renderVisual = (el) => {
                el.innerHTML = `${title("The real encrypted operation")}<div class="scene-body">
                    <div class="compute-current-line">Enc(x) · Wᵀ + b → Enc(score)</div>
                    ${renderChecks([
                        { label: `input = the ciphertext unwrapped on leg 1 (SHA-256 ${d.input_ciphertext_sha256.slice(0, 12)}…)`, ok: d.input_ciphertext_sha256 === leg1.payload_sha256 && d.input_ciphertext_sha256 === encSha },
                        { label: "server context is public-only (is_private = false)", ok: d.is_private === false },
                    ])}
                    <div class="ks-verify" data-fact-src="result_ct_sha">${tpCheck("cmpOut", "browser: SHA-256 of the output ciphertext")}</div>
                    <div class="ciphertext-box">${escapeHtml(d.output_ciphertext_b64)}</div>
                    <p class="step-text muted">Output: all ${d.output_ciphertext_size.toLocaleString()} bytes (${formatBytes(d.output_ciphertext_size)}), computed in ${fmt(d.he_elapsed_ms, 0)} ms. Weights ${d.weights_shape.join(" × ")}, server context SHA-256 ${escapeHtml(d.server_context_sha256.slice(0, 16))}…</p></div>`;
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
                        { label: `≈ the decrypted HE score ${fmt(he, 6)} (start of Result), off by ${Math.abs(he - score).toExponential(1)}`, ok: Math.abs(he - score) < 1e-2 },
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
