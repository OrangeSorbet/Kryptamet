// Entry screen plus every chapter's step builders. Each buildXSteps(result)
// returns [{ what, why, formal, next, renderVisual(el) }]. `what` and
// `formal` are always computed from the real run; `why`/`next` are either
// the backend's per-operation text (PipelineRecorder events) or, for steps
// with no backend event (CKKS params, sigmoid, benchmarks rows, deep-dive),
// static text authored here once per step type. renderVisual may return a
// Promise (poly-grid reveals) -- the Scrubber's autoplay waits for it.

// --- Overview (entry form) ------------------------------------------------
// Suggested inputs only -- the model's real prediction for each is whatever
// the run produces.
const EXAMPLE_INPUTS = {
    human_vs_ai_text: [
        "honestly no idea why the bus was so late today, ended up walking half the way lol",
        "Artificial intelligence represents a transformative paradigm shift, offering unprecedented opportunities to enhance efficiency across diverse industries.",
    ],
    sms_spam: [
        "URGENT! You have won a 1000 cash prize. Call now to claim your reward, reply YES.",
        "Hey, are we still on for dinner tonight? I'll be there around 7.",
    ],
};

function renderOverviewScene(el) {
    el.innerHTML = `
        <div class="overview">
            <div class="overview-eyebrow">Privacy-preserving ML, step by step</div>
            <div class="scene-title">Homomorphic encryption, live</div>
            <p class="overview-lede">Pick a model and type a sentence. It gets encrypted, a model scores it
                <em>without ever decrypting it</em>, and only you can read the answer. Every step that follows
                is the real computation on your actual input.</p>
            <label class="overview-label" for="modelSelect">Model</label>
            <select id="modelSelect" class="dropdown">
                <option value="human_vs_ai_text">Human vs AI Text -- 8 stylometric features</option>
                <option value="sms_spam">SMS Spam -- TF-IDF bag of words</option>
            </select>
            <label class="overview-label" for="textInput">Your input</label>
            <textarea id="textInput" class="input-text" rows="3" placeholder="Type a real sentence here..."></textarea>
            <div class="overview-examples"></div>
            <div class="overview-actions">
                <button id="runInferenceBtn" class="btn btn-run" type="button">
                    <span class="btn-spinner" aria-hidden="true"></span><span class="btn-run-label">Encrypt &amp; run</span>
                </button>
                <span class="overview-hint">Ctrl+Enter</span>
                <span id="runStatus" class="overview-status" role="status"></span>
            </div>
        </div>
    `;
    const select = el.querySelector("#modelSelect");
    const input = el.querySelector("#textInput");
    const btn = el.querySelector("#runInferenceBtn");
    const status = el.querySelector("#runStatus");
    const examples = el.querySelector(".overview-examples");

    function renderExamples() {
        examples.innerHTML = `<span class="overview-examples-label">Try:</span>` + EXAMPLE_INPUTS[select.value]
            .map((t, i) => `<button type="button" class="example-chip" data-i="${i}" title="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("");
        examples.querySelectorAll(".example-chip").forEach((chip) => chip.addEventListener("click", () => {
            input.value = EXAMPLE_INPUTS[select.value][Number(chip.dataset.i)];
            input.focus();
        }));
    }
    select.addEventListener("change", renderExamples);
    renderExamples();

    async function run() {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.classList.add("loading");
        status.className = "overview-status";
        status.textContent = "Extracting features, generating keys, encrypting, computing...";
        const r = await window.onRunRequested(select.value, input.value);
        btn.disabled = false;
        btn.classList.remove("loading");
        if (!r.ok) {
            status.className = "overview-status error";
            status.textContent = r.error;
        } else {
            status.textContent = "";
        }
    }
    btn.addEventListener("click", run);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(); });
}

// Class names come from the backend model registry with every run.
function resultLabel(model, pred) {
    const r = pipelineResult;
    return (r && r.model === model && r.class_names[pred]) ?? String(pred);
}

const FEATURE_FORMULAS = {
    word_count: "count(text.split())",
    char_count: "len(text)",
    avg_word_length: "char_count / word_count",
    sentence_count: "count([.!?])",
    avg_sentence_length: "word_count / sentence_count",
    lexical_diversity: "unique_words / word_count",
    punctuation_ratio: "punct_chars / char_count",
    uppercase_ratio: "upper_chars / char_count",
    assemble_vector: "x = [f_0, ..., f_7]",
};

const fmt = (v, d = 4) => (typeof v === "number" ? v.toFixed(d) : String(v));

function buildIndexedEquations(n, template) {
    const out = [];
    for (let k = 0; k < n; k++) out.push(template(k));
    return out;
}

// Real (index, value) pairs of the input vector -- the vector that was actually encrypted.
function inputVector(result) {
    return result.x.map((value, index) => ({ index, value, name: result.feature_names[index] }));
}

const findEv = (result, name) => result.events.find((e) => e.operation_name === name);

// --- Feature Extraction ------------------------------------------------
function renderFeatureVector(el, trace, activeIdx) {
    const feats = trace.filter((s) => s.value !== null);
    return `<div class="vector-row">${feats.map((s, i) => `
        <div class="vector-cell${trace.indexOf(s) === activeIdx ? " active" : ""}${trace.indexOf(s) > activeIdx ? " pending" : ""}">
            <div class="vector-name">${escapeHtml(s.name)}</div>
            <div class="vector-value">${trace.indexOf(s) > activeIdx ? "?" : fmt(s.value)}</div>
        </div>`).join("")}</div>`;
}

function buildFeatureSteps(result) {
    // Small vectors: one card per traced feature. Large sparse ones (TF-IDF,
    // pixels): the bar view of the non-zero entries below.
    if (result.feature_trace && result.feature_dim <= 64) {
        const trace = result.feature_trace;
        return trace.map((step, idx) => ({
            what: step.raw_computation + (step.value !== null ? ` = ${fmt(step.value)}` : ""),
            why: step.why,
            formal: FEATURE_FORMULAS[step.name] || "",
            next: step.next,
            renderVisual: (el) => {
                el.innerHTML = `
                    <div class="scene-title">${escapeHtml(step.name)}${step.value !== null ? " = " + fmt(step.value) : ""}</div>
                    <div class="scene-body">
                        <div class="data-preview">${escapeHtml(step.raw_computation)}</div>
                        <div class="vector-caption">Feature vector x, filling in:</div>
                        ${renderFeatureVector(el, trace, idx)}
                    </div>`;
            },
        }));
    }

    // TF-IDF path: one step for the whole vector, then one per vocabulary
    // word that actually occurs in the input (every other entry is 0).
    const vec = inputVector(result);
    const nonZero = vec.filter((v) => v.value !== 0).sort((a, b) => b.value - a.value);
    const renderBars = (el, activeIndex) => {
        const max = Math.max(...nonZero.map((v) => v.value), 1e-9);
        el.innerHTML = `
            <div class="scene-title">TF-IDF vectorization</div>
            <div class="scene-body">
                <div class="vector-caption">${nonZero.length} of ${result.feature_dim.toLocaleString()} vocabulary words occur in your text; the other ${(result.feature_dim - nonZero.length).toLocaleString()} entries are 0.</div>
                <div class="tfidf-bars">${nonZero.map((v) => `
                    <div class="tfidf-row${v.index === activeIndex ? " active" : ""}">
                        <span class="tfidf-word">${escapeHtml(v.name ?? "#" + v.index)}</span>
                        <span class="tfidf-bar"><span style="width:${(v.value / max) * 100}%"></span></span>
                        <span class="tfidf-value">${fmt(v.value)}</span>
                    </div>`).join("")}
                </div>
            </div>`;
    };
    const steps = [{
        what: `Your text was converted into a ${result.feature_dim.toLocaleString()}-dimension TF-IDF vector: one entry per vocabulary word, ${nonZero.length} of them non-zero.`,
        why: "TF-IDF weighs each vocabulary word by how important it is in your sentence relative to the whole training vocabulary -- more distinctive words get higher weight.",
        formal: "tfidf(t,d) = tf(t,d) * log(N / df(t)), then L2-normalized",
        next: nonZero.length ? "Next: each word that occurs in your text, one at a time." : "None of your words are in the vocabulary -- this all-zero vector is encrypted next.",
        renderVisual: (el) => renderBars(el, -1),
    }];
    nonZero.forEach((v, k) => steps.push({
        what: `"${v.name ?? "#" + v.index}" (vocabulary index ${v.index}) -> tf-idf ${fmt(v.value)}`,
        why: "A word's value is higher when it's frequent in your text but rare across the training messages -- common words like \"the\" score low.",
        formal: `x[${v.index}] = ${fmt(v.value)}`,
        next: k < nonZero.length - 1 ? "Next word." : "This full vector gets encrypted next.",
        renderVisual: (el) => renderBars(el, v.index),
    }));
    return steps;
}

// --- Key Setup: see key_setup_steps.js --------------------------------------

// --- Encryption: see encryption_steps.js ------------------------------------

// --- CKKS Deep-Dive ----------------------------------------------------
function buildDeepDiveSteps(deepDive) {
    if (!deepDive) return [];
    const coeffsEncode = deepDive.encode.m_coeffs;
    const coeffsSecret = deepDive.keygen.secret_key_s;
    const aCoeffs = deepDive.keygen.public_key_a.map((v) => v % 1000);
    const bCoeffs = deepDive.keygen.public_key_b.map((v) => v % 1000);
    const c0Coeffs = deepDive.encrypt.c0.map((v) => v % 1000);
    const c1Coeffs = deepDive.encrypt.c1.map((v) => v % 1000);
    const mPrimeCoeffs = deepDive.decrypt.m_prime;
    const orig = deepDive.original_vector;
    const rec = deepDive.decrypt.recovered_vector;
    const skip = () => ({ skipAnimation: window.sceneAlreadyVisited });
    const mod1000Note = `<div class="poly-note">Showing each coefficient mod 1000 -- the real values are up to q = ${deepDive.params.Q}.</div>`;

    return [
        {
            what: "Your real feature vector is encoded into a real polynomial with N=256 coefficients using canonical embedding: each coefficient is a dot product of one row of the inverse Vandermonde matrix with your (conjugate-extended) input vector.",
            why: "Encoding turns your plain numbers into a polynomial because CKKS's encryption math only operates on polynomials, not raw numbers directly.",
            formal: "m = round(scale * V^-1 . z) in Z[X]/(X^N+1)",
            next: "Next, a secret key is generated.",
            renderVisual: (el) => {
                el.innerHTML = `<div class="scene-title">Real CKKS: Encoding</div><div class="poly-label">m(X): the encoded plaintext polynomial (256 real coefficients)</div><div id="gridEncode"></div>`;
                const eqs = buildIndexedEquations(coeffsEncode.length, (k) => `m_{${k}} = \\sum_j V^{-1}_{${k},j}\\, z_j`);
                return renderPolyGrid(el.querySelector("#gridEncode"), coeffsEncode, eqs, skip());
            },
        },
        {
            what: "A real ternary secret key polynomial s(X) is generated -- each coefficient is randomly -1, 0, or 1. This key never leaves your machine.",
            why: "It's generated once, before any data exists to encrypt, because the public key (next step) and every later decryption both derive from this exact s(X) -- generate a new one mid-pipeline and nothing downstream would decrypt correctly.",
            formal: "s <- {-1,0,1}^N",
            next: "Next, the public key is derived from this secret key.",
            renderVisual: (el) => {
                el.innerHTML = `<div class="scene-title">Real CKKS: Secret key</div><div class="poly-label">s(X): secret key (256 coefficients, each in {-1, 0, 1})</div><div id="gridSecret"></div>`;
                const eqs = buildIndexedEquations(coeffsSecret.length, (k) => `s_{${k}} \\leftarrow \\{-1,0,1\\}`);
                return renderPolyGrid(el.querySelector("#gridSecret"), coeffsSecret, eqs, skip());
            },
        },
        {
            what: "The public key is computed as b = -a*s + e (mod q), using real negacyclic polynomial multiplication in Z[X]/(X^256+1). 'a' is uniformly random, 'e' is a small real error term.",
            why: "This is safe to hand to anyone (including a server) because recovering s from (a, b) alone means solving a hard lattice problem -- it's computed once here, alongside the secret key, so the same public key encrypts every value in this run.",
            formal: "b = -a*s + e (mod q)",
            next: "Next, your encoded message is encrypted using this public key, producing the first ciphertext half (c0).",
            renderVisual: (el) => {
                el.innerHTML = `
                    <div class="scene-title">Real CKKS: Public key</div>
                    <div class="grid-pair">
                        <div><div class="poly-label">a(X): random polynomial</div><div id="gridA"></div></div>
                        <div><div class="poly-label">b(X) = -a*s + e (mod q)</div><div id="gridB"></div></div>
                    </div>${mod1000Note}`;
                const aEqs = buildIndexedEquations(aCoeffs.length, (k) => `a_{${k}} \\leftarrow \\text{Uniform}(0,q)`);
                const bEqs = buildIndexedEquations(bCoeffs.length, (k) => `b_{${k}} = \\Big(-\\!\\!\\sum_{i+j\\equiv ${k}}\\! a_i s_j + e_{${k}}\\Big) \\bmod q`);
                return Promise.all([
                    renderPolyGrid(el.querySelector("#gridA"), aCoeffs, aEqs, skip()),
                    renderPolyGrid(el.querySelector("#gridB"), bCoeffs, bEqs, skip()),
                ]);
            },
        },
        {
            what: "c0 = b*u + e1 + m (mod q). 'u' is a fresh ephemeral ternary polynomial; e1 is fresh error; m is your encoded message polynomial from the Encoding step.",
            why: "c0 embeds your message masked by the public-key term b*u -- without the secret key, that mask can't be removed, so c0 reveals nothing about m on its own.",
            formal: "c0 = b*u + e1 + m (mod q)",
            next: "Next, c1 is computed to complete the ciphertext.",
            renderVisual: (el) => {
                el.innerHTML = `<div class="scene-title">Real CKKS: Encrypting (c0)</div><div class="poly-label">c0(X): first ciphertext polynomial</div><div id="gridC0"></div>${mod1000Note}`;
                const eqs = buildIndexedEquations(c0Coeffs.length, (k) => `c0_{${k}} = \\Big(\\sum_{i+j\\equiv ${k}}\\! b_i u_j\\Big) + e1_{${k}} + m_{${k}} \\bmod q`);
                return renderPolyGrid(el.querySelector("#gridC0"), c0Coeffs, eqs, skip());
            },
        },
        {
            what: "c1 = a*u + e2 (mod q). Together (c0, c1) form the complete ciphertext -- neither reveals your data on its own.",
            why: "c1 carries no message information by itself -- it exists purely so that multiplying it by the secret key later can cancel out the masking term buried in c0.",
            formal: "c1 = a*u + e2 (mod q)",
            next: "Together (c0, c1) are decrypted next to demonstrate recovery.",
            renderVisual: (el) => {
                el.innerHTML = `<div class="scene-title">Real CKKS: Encrypting (c1)</div><div class="poly-label">c1(X): second ciphertext polynomial</div><div id="gridC1"></div>${mod1000Note}`;
                const eqs = buildIndexedEquations(c1Coeffs.length, (k) => `c1_{${k}} = \\Big(\\sum_{i+j\\equiv ${k}}\\! a_i u_j\\Big) + e2_{${k}} \\bmod q`);
                return renderPolyGrid(el.querySelector("#gridC1"), c1Coeffs, eqs, skip());
            },
        },
        {
            what: "m' = c0 + c1*s (mod q). Only the secret key s can cancel out the public-key term, leaving your original message plus tiny noise.",
            why: "Only s can cancel the c1*s term buried in c0's masking -- this is exactly what makes the scheme secure against anyone without the secret key, and correct for anyone with it.",
            formal: "m' = c0 + c1*s (mod q)",
            next: "This concludes the CKKS internals walkthrough -- the production pipeline (TenSEAL) performs the same math, just faster and hidden behind an opaque library.",
            renderVisual: (el) => {
                el.innerHTML = `
                    <div class="scene-title">Real CKKS: Decrypting</div>
                    <div class="poly-label">m'(X): recovered plaintext polynomial</div>
                    <div id="gridDecrypt"></div>
                    <div class="recover-table">
                        <div class="recover-row head"><span></span>${orig.map((_, i) => `<span>x${i}</span>`).join("")}</div>
                        <div class="recover-row"><span>original</span>${orig.map((v) => `<span>${fmt(v)}</span>`).join("")}</div>
                        <div class="recover-row"><span>recovered</span>${rec.map((v) => `<span>${fmt(v)}</span>`).join("")}</div>
                    </div>`;
                const eqs = buildIndexedEquations(mPrimeCoeffs.length, (k) => `m'_{${k}} = \\Big(c0_{${k}} + \\sum_{i+j\\equiv ${k}}\\! c1_i s_j\\Big) \\bmod q`);
                return renderPolyGrid(el.querySelector("#gridDecrypt"), mPrimeCoeffs, eqs, skip());
            },
        },
    ];
}

// --- Computation ---------------------------------------------------------
const COMPUTE_BAND_LABELS = {
    compute_overview: "what is computed",
    compute_general_form: "the real encrypted op",
    weight_multiply: "non-zero terms (teaching mirror)",
    zero_terms: "zero terms",
    add_bias: "add bias",
};

function buildComputationSteps(result) {
    const events = result.events.filter((e) => e.stage === "compute");
    const names = result.feature_names || [];
    const termHtml = (ev) => {
        const i = ev.data_before.index;
        return `<span class="term-name">${escapeHtml(names[i] ?? "x[" + i + "]")}</span>
                <span>${fmt(ev.data_before.weight)} × ${fmt(ev.data_before.input)} = <strong>${fmt(ev.data_after.product)}</strong></span>`;
    };
    return events.map((ev, idx) => ({
        what: ev.description,
        why: ev.why,
        formal: ev.formal,
        next: ev.next_step,
        renderVisual: (el) => {
            let body;
            if (ev.operation_name === "weight_multiply") {
                const history = events.slice(Math.max(0, idx - 5), idx).filter((e) => e.operation_name === "weight_multiply");
                body = `
                    <div class="compute-ledger">
                        ${history.map((h) => `<div class="compute-term past">${termHtml(h)}</div>`).join("")}
                        <div class="compute-term current">${termHtml(ev)}</div>
                    </div>
                    <div class="compute-sum"><span>running sum</span><strong>${fmt(ev.data_after.running_sum)}</strong></div>`;
            } else if (ev.operation_name === "add_bias") {
                body = `
                    <div class="compute-current-line">${escapeHtml(ev.description)}</div>
                    <div class="compute-sum"><span>score (plaintext-equivalent)</span><strong>${fmt(ev.data_after.score)}</strong></div>`;
            } else if (ev.operation_name === "compute_general_form") {
                const d = ev.data_after;
                body = `
                    <div class="compute-current-line">${escapeHtml(ev.formal)}</div>
                    <div class="ciphertext-box">${escapeHtml(d.output_ciphertext_b64)}</div>
                    <p class="step-text muted">Encrypted result: ${d.output_ciphertext_size.toLocaleString()} bytes (${formatBytes(d.output_ciphertext_size)}), SHA-256 ${escapeHtml(d.output_ciphertext_sha256)}. Computed in ${fmt(d.he_elapsed_ms, 0)} ms on a context with no secret key.</p>`;
            } else {
                body = `<div class="compute-current-line">${escapeHtml(ev.description)}</div>`;
            }
            el.innerHTML = `<div class="scene-title">Computation on encrypted data</div><div class="scene-body">${body}</div>`;
        },
    }));
}

function buildComputationBands(result) {
    const events = result.events.filter((e) => e.stage === "compute");
    const bands = [];
    if (!events.length) return bands;
    let start = 0;
    let curOp = events[0].operation_name;
    const push = (end) => bands.push({ start, end, label: COMPUTE_BAND_LABELS[curOp] || curOp });
    events.forEach((ev, i) => {
        if (ev.operation_name !== curOp) {
            push(i - 1);
            start = i;
            curOp = ev.operation_name;
        }
    });
    push(events.length - 1);
    return bands;
}

// --- Transport: see transport_steps.js ---------------------------------------

// --- Decryption ------------------------------------------------------------
// Sigmoid curve over [-8, 8] with the real score marked (clamped to the plot).
function sigmoidPlotSvg(score) {
    const W = 360, H = 160, X0 = -8, X1 = 8;
    const sx = (x) => ((x - X0) / (X1 - X0)) * W;
    const sy = (y) => H - y * H;
    let d = "";
    for (let k = 0; k <= 80; k++) {
        const x = X0 + (k / 80) * (X1 - X0);
        d += `${k ? "L" : "M"}${sx(x).toFixed(1)} ${sy(1 / (1 + Math.exp(-x))).toFixed(1)} `;
    }
    const cx = Math.max(X0, Math.min(X1, score));
    const p = 1 / (1 + Math.exp(-score));
    return `
        <svg class="sigmoid-plot" viewBox="-30 -10 ${W + 40} ${H + 30}" role="img" aria-label="Sigmoid curve with your score marked">
            <line x1="0" y1="${sy(0.5)}" x2="${W}" y2="${sy(0.5)}" class="sig-mid"/>
            <line x1="${sx(0)}" y1="0" x2="${sx(0)}" y2="${H}" class="sig-mid"/>
            <path d="${d}" class="sig-curve"/>
            <circle cx="${sx(cx)}" cy="${sy(p)}" r="5" class="sig-point"/>
            <text x="-6" y="${sy(1) + 4}" class="sig-tick" text-anchor="end">1</text>
            <text x="-6" y="${sy(0.5) + 4}" class="sig-tick" text-anchor="end">0.5</text>
            <text x="-6" y="${sy(0) + 4}" class="sig-tick" text-anchor="end">0</text>
            <text x="${sx(0)}" y="${H + 16}" class="sig-tick" text-anchor="middle">score 0</text>
        </svg>`;
}

function buildDecryptionSteps(result) {
    const ev = findEv(result, "ckks_decrypt");
    const score = result.raw_score;
    const p = result.sigmoid_score;
    const decryptStep = {
        what: ev.description,
        why: ev.why,
        formal: ev.formal,
        next: ev.next_step,
        renderVisual: (el) => {
            el.innerHTML = `
                <div class="scene-title">Decryption</div>
                <div class="scene-body">
                    <div class="compute-current-line">Dec<sub>sk</sub>(ciphertext) &nbsp;→&nbsp; ${ev.data_after.scores.length === 1 ? fmt(score, 6) : `${ev.data_after.scores.length} class scores`}</div>
                    <p class="step-text muted" style="text-align:center">Only your secret key can do this. The compute node never had it.</p>
                </div>`;
        },
    };
    if (result.task === "multiclass") {
        const ranked = result.probabilities.map((pr, i) => ({ pr, i, s: result.scores[i] })).sort((a, b) => b.pr - a.pr).slice(0, 5);
        return [decryptStep, {
            what: `softmax over the ${result.scores.length} decrypted class scores: the top class is "${resultLabel(result.model, result.he_pred)}" with p = ${fmt(result.probabilities[result.he_pred])}.`,
            why: "Each class got its own linear score; softmax turns them into probabilities that sum to 1. Like the sigmoid, it isn't a polynomial, so it runs after decryption, on your side.",
            formal: "p_j = e^{s_j} / Σ_k e^{s_k};  prediction = argmax_j s_j",
            next: "Next it's compared against the plaintext result.",
            renderVisual: (el) => {
                el.innerHTML = `
                    <div class="scene-title">Scores → probabilities</div>
                    <div class="scene-body"><div class="compute-ledger">${ranked.map((r) => `
                        <div class="compute-term${r.i === result.he_pred ? " current" : ""}"><span class="term-name">${escapeHtml(resultLabel(result.model, r.i))}</span><span>score ${fmt(r.s)} · p = <strong>${fmt(r.pr)}</strong></span></div>`).join("")}
                    </div></div>`;
            },
        }];
    }
    return [
        decryptStep,
        {
            what: `sigmoid(${fmt(score)}) = 1 / (1 + e^${fmt(-score)}) = ${fmt(p)} -- a ${(p * 100).toFixed(1)}% probability of "${resultLabel(result.model, 1)}".`,
            why: "The raw score can be any real number; the sigmoid maps it to a probability between 0 and 1. It isn't a polynomial, so it's applied after decryption, on your side -- the server only ever computed the linear part.",
            formal: "p = σ(score) = 1 / (1 + e^-score)",
            next: `score ${score > 0 ? ">" : "<="} 0, so the prediction is ${score > 0 ? 1 : 0} ("${resultLabel(result.model, score > 0 ? 1 : 0)}"). Next it's compared against the plaintext result.`,
            renderVisual: (el) => {
                el.innerHTML = `
                    <div class="scene-title">Score → probability</div>
                    <div class="scene-body sigmoid-wrap">
                        ${sigmoidPlotSvg(score)}
                        <div class="compute-sum"><span>P("${escapeHtml(resultLabel(result.model, 1))}")</span><strong>${fmt(p)}</strong></div>
                    </div>`;
            },
        },
    ];
}

// --- Result ------------------------------------------------------------
function buildResultSteps(result) {
    const plainLabel = resultLabel(result.model, result.plain_pred);
    const heLabel = resultLabel(result.model, result.he_pred);
    const diff = Math.abs(result.raw_score - result.plaintext_equivalent_score);
    return [
        {
            what: `HE score (decrypted) ${fmt(result.raw_score, 6)} vs. plaintext score ${fmt(result.plaintext_equivalent_score, 6)} -- difference ${diff.toExponential(2)}.`,
            why: "CKKS is approximate: the encryption noise and fixed-point scale leave a tiny error in the result. It's far too small to move a score across the decision boundary, so the prediction is unaffected.",
            formal: `|Dec(f(Enc(x))) - f(x)| = ${diff.toExponential(2)}`,
            next: "Next: the predicted labels, side by side.",
            renderVisual: (el) => {
                el.innerHTML = `
                    <div class="scene-title">Encrypted vs plaintext score</div>
                    <div class="scene-body">
                        <div class="compare-grid">
                            <div class="compare-col"><div class="compare-title">Plaintext score</div><div class="compare-value">${fmt(result.plaintext_equivalent_score, 6)}</div></div>
                            <div class="compare-col"><div class="compare-title">HE score (decrypted)</div><div class="compare-value">${fmt(result.raw_score, 6)}</div></div>
                        </div>
                        <p class="step-text" style="text-align:center">Difference: <strong>${diff.toExponential(2)}</strong> <span class="${result.scores_match ? "badge-match" : "badge-mismatch"}">${result.scores_match ? "within CKKS noise ✓" : "larger than expected ✕"}</span></p>
                    </div>`;
            },
        },
        {
            what: `Plaintext prediction: ${result.plain_pred} (${plainLabel}). HE prediction: ${result.he_pred} (${heLabel}). ${result.match ? "They match." : "They DO NOT match."}`,
            why: "A match means the model reached the same conclusion on the encrypted ciphertext as it did on your original plaintext input -- proof the computation was correct even though the server never saw your real data.",
            formal: result.task === "multiclass" ? "argmax W·x + b  ==  argmax Dec_sk(Enc_pk(x)·Wᵀ + b)" : "predict(x) == [Dec_sk(Enc_pk(x)·wᵀ + b) > 0]",
            next: "See the Benchmarks chapter for how much slower this was compared to plaintext.",
            renderVisual: (el) => {
                el.innerHTML = `
                    <div class="scene-title">Result</div>
                    <div class="scene-body">
                        <div class="verdict ${result.match ? "ok" : "bad"}">Your text was classified as <strong>${escapeHtml(heLabel)}</strong></div>
                        <div class="compare-grid">
                            <div class="compare-col"><div class="compare-title">Plaintext</div><div class="compare-value">${result.plain_pred}</div><div class="step-text muted">${escapeHtml(plainLabel)}</div></div>
                            <div class="compare-col"><div class="compare-title">HE (decrypted)</div><div class="compare-value">${result.he_pred}</div><div class="step-text muted">${escapeHtml(heLabel)}</div></div>
                        </div>
                        <p class="step-text" style="text-align:center">Match: <span class="${result.match ? "badge-match" : "badge-mismatch"}">${result.match ? "yes ✓" : "no ✕"}</span></p>
                    </div>`;
            },
        },
    ];
}

// --- Benchmarks --------------------------------------------------------
// Rows come from benchmarks/results.json, injected into the page as
// window.BENCHMARKS by scenes.html. One step per measured model.
function renderBenchmarksTable(el, rows, active) {
    el.innerHTML = `
        <div class="scene-title">Benchmarks</div>
        <div class="scene-body">
            <p class="step-text muted">Saved measurements: the same trained model on plaintext vs. encrypted input. <strong>Slowdown</strong> = HE time / plaintext time. <strong>Agreement</strong> = fraction of samples where both predicted the same.</p>
            <div class="table-scroll"><table class="benchmark-table">
                <tr><th>Model</th><th>Samples</th><th>Plaintext (s)</th><th>HE (s)</th><th>Slowdown</th><th>Agreement</th></tr>
                ${rows.map((b, i) => `
                    <tr class="${i === active ? "active" : ""}">
                        <td>${escapeHtml(b.model)}</td><td>${b.n_samples}</td>
                        <td>${b.plaintext_time_sec.toFixed(4)}</td><td>${b.he_time_sec.toFixed(4)}</td>
                        <td>${b.slowdown_factor.toFixed(1)}x</td><td>${b.plain_vs_he_agreement.toFixed(2)}</td>
                    </tr>`).join("")}
            </table></div>
        </div>`;
}

function buildBenchmarksSteps() {
    const rows = window.BENCHMARKS || [];
    if (!rows.length) {
        return [{
            what: "No saved benchmark results were found (benchmarks/results.json is missing).",
            why: "Benchmarks are measured offline, not per request -- timing every model under HE takes minutes (the encrypted CNN alone takes several).",
            formal: "slowdown = t_HE / t_plain",
            next: "Run `uv run python -m benchmarks.metrics`, then reload this page.",
            renderVisual: (el) => { el.innerHTML = `<div class="scene-title">Benchmarks</div><p class="step-text muted">No results yet.</p>`; },
        }];
    }
    return rows.map((b, i) => ({
        what: `${b.model}: ${b.n_samples} samples took ${b.plaintext_time_sec.toFixed(4)}s in plaintext vs ${b.he_time_sec.toFixed(4)}s encrypted -- ${b.slowdown_factor.toFixed(1)}x slower, agreement ${b.plain_vs_he_agreement.toFixed(2)}.`,
        why: "Every ciphertext multiply or add works on polynomials with thousands of large coefficients instead of single numbers, so HE has no shortcuts. Agreement 1.00 means encryption never changed an outcome.",
        formal: `slowdown = ${b.he_time_sec.toFixed(4)} / ${b.plaintext_time_sec.toFixed(4)} = ${b.slowdown_factor.toFixed(1)}x`,
        next: i < rows.length - 1 ? `Next: ${rows[i + 1].model}.` : "That's the end of the walkthrough -- go back to the chapters to revisit any of them, or try a new input.",
        renderVisual: (el) => renderBenchmarksTable(el, rows, i),
    }));
}
