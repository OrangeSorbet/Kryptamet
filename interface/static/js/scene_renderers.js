// Entry screen plus every chapter's step builders. Each buildXSteps(result)
// returns [{ what, why, formal, next, renderVisual(el) }]. `what` and
// `formal` are always computed from the real run; `why`/`next` are either
// the backend's per-operation text (PipelineRecorder events) or, for steps
// with no backend event (CKKS params, sigmoid, benchmarks rows, deep-dive),
// static text authored here once per step type. renderVisual may return a
// Promise (poly-grid reveals) -- the Scrubber's autoplay waits for it.

// --- Overview (entry form): see overview_form.js -----------------------------

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
// A traced value is a number, or a list for a one-hot category (German Credit).
const fmtFeatureShort = (v) => (Array.isArray(v) ? `${v.length} columns` : fmt(v));

function renderFeatureVector(el, trace, activeIdx) {
    const feats = trace.filter((s) => s.value !== null);
    return `<div class="vector-row">${feats.map((s, i) => `
        <div class="vector-cell${trace.indexOf(s) === activeIdx ? " active" : ""}${trace.indexOf(s) > activeIdx ? " pending" : ""}">
            <div class="vector-name">${escapeHtml(s.name)}</div>
            <div class="vector-value">${trace.indexOf(s) > activeIdx ? "?" : fmtFeatureShort(s.value)}</div>
        </div>`).join("")}</div>`;
}

// Symptom Diagnosis: every symptom column, the ones you picked lit (x_i = 1).
function buildSymptomFeatureSteps(result) {
    const t = result.feature_trace[0];
    const on = result.x.filter((v) => v === 1).length;
    return [{
        what: `${t.raw_computation}.`,
        why: t.why,
        formal: `x ∈ {0,1}^${result.feature_dim},  x_i = 1 ⇔ symptom i present`,
        next: t.next,
        renderVisual: (el) => {
            el.innerHTML = `<div class="scene-title">${on} of ${result.feature_dim} symptoms present</div>
                <div class="scene-body"><div class="vector-caption">One flag per column of the training table, in column order: x_i = 1 (lit) or 0.</div>
                <div class="sym-flags">${result.feature_names.map((n, i) => `<span class="sym-flag${result.x[i] === 1 ? " on" : ""}" title="x[${i}] = ${result.x[i]}">${escapeHtml(symptomLabel(n))}</span>`).join("")}</div></div>`;
        },
    }];
}

// MNIST: your 784 raw pixels, then the same pixels scaled to 0..1 (the vector that is encrypted).
function buildDigitFeatureSteps(result) {
    const raw = result.input.pixels, t = result.feature_trace[0];
    const inked = raw.filter((v) => v > 0).length;
    // float32, as the model was trained (data/features/mnist.py): exact match with Math.fround.
    const scaledOk = result.x.every((v, i) => v === Math.fround(raw[i] / 255));
    const view = (el, title, caption, checks) => {
        el.innerHTML = `<div class="scene-title">${escapeHtml(title)}</div><div class="scene-body">
            <div class="vector-caption">${escapeHtml(caption)}</div>${checks || ""}${digitGridSvg(raw, "digit-svg digit-feature")}</div>`;
    };
    return [
        {
            what: `Your drawing: a 28 × 28 grid = 784 pixels, ${inked} of them with ink (0 = background, 255 = full ink).`,
            why: "The model was trained on MNIST images of exactly this size, so the input is always 784 numbers, read row by row.",
            formal: "image ∈ {0..255}^(28×28)",
            next: "Next: each pixel is scaled to 0..1.",
            renderVisual: (el) => view(el, "Your digit, 784 pixels", "Each square is one pixel; brighter = more ink."),
        },
        {
            what: `${t.raw_computation}.`,
            why: t.why,
            formal: "x_(28r+c) = pixel(r, c) / 255",
            next: t.next,
            renderVisual: (el) => view(el, "Scaled to 0..1", `Row by row: x[28·row + col] = pixel / 255. ${inked} non-zero values.`,
                renderChecks([{ label: "browser: every x_i = float32(pixel_i / 255), exactly (all 784)", ok: scaledOk }])),
        },
    ];
}

function buildFeatureSteps(result) {
    if (result.input_kind === "symptoms") return buildSymptomFeatureSteps(result);
    if (result.input_kind === "image") return buildDigitFeatureSteps(result);
    // Small vectors (stylometric, tabular): one card per traced feature.
    // Large sparse TF-IDF: the bar view of the non-zero entries below.
    if (result.feature_trace && result.feature_dim <= 64) {
        const trace = result.feature_trace;
        return trace.map((step, idx) => ({
            what: step.raw_computation + (step.value !== null && !Array.isArray(step.value) ? ` = ${fmt(step.value)}` : ""),
            why: step.why,
            formal: (step.name === "assemble_vector" ? `x = [x_0, …, x_${result.feature_dim - 1}]` : FEATURE_FORMULAS[step.name]) || (result.input_kind === "tabular" ? (Array.isArray(step.value) ? "one-hot(code), then z = (v − μ) / σ per column" : "z = (v − μ) / σ  (μ, σ from the training data)") : ""),
            next: step.next,
            renderVisual: (el) => {
                el.innerHTML = `
                    <div class="scene-title">${escapeHtml(step.name)}${step.value !== null && !Array.isArray(step.value) ? " = " + fmt(step.value) : ""}</div>
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
                        <span class="tfidf-bar"><span data-w="${(v.value / max) * 100}"></span></span>
                        <span class="tfidf-value">${fmt(v.value)}</span>
                    </div>`).join("")}
                </div>
            </div>`;
        el.querySelectorAll(".tfidf-bar > span").forEach((b) => { b.style.width = `${b.dataset.w}%`; });
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

// --- CKKS Deep-Dive: see deep_dive_steps.js --------------------------------

// --- Computation: see computation_steps.js ---------------------------------

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
                    <p class="step-text muted centered">Only your secret key can do this. The compute node never had it.</p>
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
                        <p class="step-text centered">Difference: <strong>${diff.toExponential(2)}</strong> <span class="${result.scores_match ? "badge-match" : "badge-mismatch"}">${result.scores_match ? "within CKKS noise ✓" : "larger than expected ✕"}</span></p>
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
                        <div class="verdict ${result.match ? "ok" : "bad"}">Your input was classified as <strong>${escapeHtml(heLabel)}</strong></div>
                        <div class="compare-grid">
                            <div class="compare-col"><div class="compare-title">Plaintext</div><div class="compare-value">${result.plain_pred}</div><div class="step-text muted">${escapeHtml(plainLabel)}</div></div>
                            <div class="compare-col"><div class="compare-title">HE (decrypted)</div><div class="compare-value">${result.he_pred}</div><div class="step-text muted">${escapeHtml(heLabel)}</div></div>
                        </div>
                        <p class="step-text centered">Match: <span class="${result.match ? "badge-match" : "badge-mismatch"}">${result.match ? "yes ✓" : "no ✕"}</span></p>
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
            <p class="step-text muted">Saved measurements: the same trained model on plaintext vs. encrypted input. <strong>Slowdown</strong> = HE time / plaintext time. <strong>Peak memory</strong> is Python's tracemalloc peak during the run. <strong>Agreement</strong> = fraction of samples where both predicted the same.</p>
            <div class="table-scroll"><table class="benchmark-table">
                <tr><th>Model</th><th>Samples</th><th>Plaintext (s)</th><th>HE (s)</th><th>Slowdown</th><th>Plain mem</th><th>HE mem</th><th>Agreement</th></tr>
                ${rows.map((b, i) => `
                    <tr class="${i === active ? "active" : ""}">
                        <td>${escapeHtml(b.model)}</td><td>${b.n_samples}</td>
                        <td>${b.plaintext_time_sec.toFixed(4)}</td><td>${b.he_time_sec.toFixed(4)}</td>
                        <td>${b.slowdown_factor.toFixed(1)}x</td><td>${formatBytes(b.plaintext_peak_mem_bytes)}</td><td>${formatBytes(b.he_peak_mem_bytes)}</td><td>${b.plain_vs_he_agreement.toFixed(2)}</td>
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
        what: `${b.model}: ${b.n_samples} samples took ${b.plaintext_time_sec.toFixed(4)}s in plaintext vs ${b.he_time_sec.toFixed(4)}s encrypted -- ${b.slowdown_factor.toFixed(1)}x slower; peak memory ${formatBytes(b.plaintext_peak_mem_bytes)} vs ${formatBytes(b.he_peak_mem_bytes)}; agreement ${b.plain_vs_he_agreement.toFixed(2)}.`,
        why: "Every ciphertext multiply or add works on polynomials with thousands of large coefficients instead of single numbers, so HE has no shortcuts. Agreement 1.00 means encryption never changed an outcome.",
        formal: `slowdown = ${b.he_time_sec.toFixed(4)} / ${b.plaintext_time_sec.toFixed(4)} = ${b.slowdown_factor.toFixed(1)}x`,
        next: i < rows.length - 1 ? `Next: ${rows[i + 1].model}.` : "That's the end of the walkthrough -- go back to the chapters to revisit any of them, or try a new input.",
        renderVisual: (el) => renderBenchmarksTable(el, rows, i),
    }));
}
