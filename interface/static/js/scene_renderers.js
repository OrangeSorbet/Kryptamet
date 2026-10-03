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
        eli5: {
            what: `You picked ${on} symptom${on === 1 ? "" : "s"}. They become a list x of ${result.feature_dim} numbers, one per symptom the model knows, in a fixed order: 1 if you have it, 0 if not. ${on} of them are 1.`,
            why: `A model can only do maths on numbers, and the lock (CKKS) only locks numbers. Yes/no fits perfectly as 1/0. The order is fixed because the model learned one weight per position: position i always means the same symptom. It learned which combinations go with each of the ${result.class_names.length} conditions.`,
            formal: `x = ${result.feature_dim} numbers, each 0 or 1; ${on} are 1.`,
            next: "Next chapter: the keys that will lock these numbers.",
        },
        eli1: {
            what: `The first 5 positions of your list: ${result.feature_names.slice(0, 5).map((n, i) => `${symptomLabel(n)} = ${result.x[i]}`).join(", ")}. The whole list continues like this for all ${result.feature_dim} symptoms.`,
            why: "Think of a row of light switches labelled with symptoms: on = 1, off = 0. The model reads the row of 1s and 0s.",
            formal: `x = [${result.x.slice(0, 5).join(", ")}, …] (${result.feature_dim} numbers).`,
            next: "Next chapter: the keys.",
        },
        what: `${t.raw_computation}.`,
        why: t.why,
        formal: `x ∈ {0,1}^${result.feature_dim},  x_i = 1 ⇔ symptom i present`,
        next: t.next,
        renderVisual: (el) => {
            el.innerHTML = `<div class="scene-title">${on} of ${result.feature_dim} symptoms present</div>
                <div class="scene-body"><div class="vector-caption">One flag per column of the training table, in column order: x_i = 1 (lit) or 0.</div>
                <div class="sym-flags">${result.feature_names.map((n, i) => `<span class="sym-flag${result.x[i] === 1 ? " on" : ""}" data-i="${i}">${escapeHtml(symptomLabel(n))}</span>`).join("")}</div></div>`;
            attachFormulaHover(el.querySelector(".sym-flags"), ".sym-flag", (f) => {
                const i = +f.dataset.i;
                return { tex: `x_{${i}} = ${kv(result.x[i], `x_{${i}}`)}`, note: `"${symptomLabel(result.feature_names[i])}" ${result.x[i] === 1 ? "present" : "absent"} (column ${i})` };
            });
        },
    }];
}

// Handwriting (MNIST / EMNIST): the selected character's 784 raw pixels, then the same pixels scaled to
// 0..1 (the vector that is encrypted). Every character has its own run; the chips pick which one is shown.
function drawnImages(result) {
    return result.input.images || [result.input.pixels];
}

function buildDigitFeatureSteps(result) {
    const imgs = drawnImages(result), k = result.char_index || 0, raw = imgs[k], t = result.feature_trace[0];
    const of = imgs.length > 1 ? ` Character ${k + 1} of ${imgs.length}: every chapter now shows this character's own run; the chips at the top left switch to another.` : "";
    const inked = raw.filter((v) => v > 0).length;
    // float32, as the model was trained (data/features/mnist.py): exact match with Math.fround.
    const scaledOk = result.x.every((v, i) => v === Math.fround(raw[i] / 255));
    // scaled: hover shows x_i = pixel / 255 (step 2) instead of the raw pixel (step 1).
    const view = (el, title, caption, checks, scaled) => {
        el.innerHTML = `<div class="scene-title">${escapeHtml(title)}</div><div class="scene-body">
            <div class="vector-caption">${escapeHtml(caption)}</div>${checks || ""}${digitGridSvg(raw, "digit-svg digit-feature", true)}</div>`;
        attachFormulaHover(el.querySelector(".digit-feature"), "rect[data-i]", (c) => {
            const i = +c.dataset.i, r = Math.floor(i / 28), col = i % 28;
            return scaled
                ? { tex: `x_{${i}} = p_{${r},${col}} / 255 = ${kv(raw[i], `p_{${r},${col}}`)} / ${kv(255, "\\max")} = ${kv(fmt(result.x[i], 6), `x_{${i}}`)}`, note: `x[${i}] = ${result.x[i]}` }
                : { tex: `p_{${r},${col}} = ${kv(raw[i], `p_{${r},${col}}`)}`, note: `row ${r}, column ${col}: ${raw[i]} / 255 ink` };
        });
    };
    return [
        {
            eli5: {
                what: `Your drawing, resized and centred like the training images: a 28 × 28 grid of 784 squares (pixels), ${inked} of them with ink. Each pixel is a brightness from 0 (no ink) to 255 (full ink): 255 is the biggest number one byte can hold.${imgs.length > 1 ? ` This is character ${k + 1} of ${imgs.length}; pick another one with the chips at the top left.` : ""}`,
                why: "The model learned from 28 × 28 images only, so every drawing is shrunk, centred and thickened the same way first; otherwise the same letter drawn bigger or off-centre would look like a different shape to it.",
                formal: "drawing → 784 squares, 0 (empty) to 255 (full ink).",
                next: "Next: every square becomes a number between 0 and 1.",
            },
            what: `Your drawing, framed: a 28 × 28 grid = 784 pixels, ${inked} of them with ink (0 = background, 255 = full ink).${of}`,
            why: "The model was trained on MNIST images of exactly this size, so the input is always 784 numbers, read row by row.",
            formal: "image ∈ {0..255}^(28×28)",
            next: "Next: each pixel is scaled to 0..1.",
            renderVisual: (el) => view(el, imgs.length > 1 ? `Character ${k + 1} of ${imgs.length}, 784 pixels` : "Your character, 784 pixels", "Each square is one pixel; brighter = more ink."),
        },
        {
            eli5: {
                what: `Each pixel's brightness (0-255) is divided by 255, giving 784 numbers between 0 and 1, read row by row: x[28 × row + column]. ${scaledOk ? "✓" : "✕"} all 784 recomputed.`,
                why: "The model was trained on 0-to-1 numbers, so yours must be on the same scale or its weights would be 255 times too strong. Small numbers also keep the locked maths inside the lock's precision.",
                formal: "x = brightness / 255.",
                next: "Next chapter: the keys that will lock these 784 numbers.",
            },
            eli1: (() => {
                const i = raw.findIndex((v) => v > 0), v = i < 0 ? 0 : raw[i];
                return {
                    what: `Example: pixel ${i < 0 ? 0 : i} (row ${Math.floor(Math.max(i, 0) / 28)}, column ${Math.max(i, 0) % 28}) has brightness ${vn(v, "pixel")}. ${vn(v, "pixel")} ÷ ⟨255|max⟩ = ${vn((v / 255).toFixed(4), "x")}. Full ink: ⟨255|pixel⟩ ÷ ⟨255|max⟩ = ⟨1|x⟩. No ink: ⟨0|pixel⟩ ÷ ⟨255|max⟩ = ⟨0|x⟩.`,
                    why: "Dividing by the biggest possible value turns any brightness into a share between 0 and 1.",
                    formal: `${v} / 255 = ${(v / 255).toFixed(4)}.`,
                    next: "Next chapter: the keys.",
                };
            })(),
            what: `${t.raw_computation}.`,
            why: t.why,
            formal: "x_(28r+c) = pixel(r, c) / 255",
            next: t.next,
            renderVisual: (el) => view(el, "Scaled to 0..1", `Row by row: x[28·row + col] = pixel / 255. ${inked} non-zero values.`,
                renderChecks([{ label: "browser: every x_i = float32(pixel_i / 255), exactly (all 784)", ok: scaledOk }]), true),
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
            eli5: featureEli5(result, trace, idx),
            eli1: featureEli1(result, trace, idx),
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
        eli5: {
            what: `Your text becomes a list x of ${result.feature_dim.toLocaleString()} numbers, one per word in the model's vocabulary (the words it learned). ${nonZero.length} of your words are in that vocabulary, so ${nonZero.length} numbers are non-zero; the other ${(result.feature_dim - nonZero.length).toLocaleString()} are 0.`,
            why: "A model can only do maths on numbers, and the lock only locks numbers. TF-IDF (term frequency × inverse document frequency) gives each word a number: higher when the word appears in your text (TF) and is rare across all training messages (IDF). Rare, tell-tale words count most; words like \"the\" count almost nothing. Finally the list is scaled so its length is 1, so a long message doesn't score higher just for being long.",
            formal: `text → ${result.feature_dim.toLocaleString()} numbers, ${nonZero.length} non-zero.`,
            next: nonZero.length ? "Next: your words, one at a time." : "None of your words are known to the model, so this all-zero list is what gets locked.",
        },
        eli1: {
            what: `Toy: 3 training messages, "free prize now", "see you now", "the bus now". "free" appears in 1 of 3, so IDF = log(⟨3|messages⟩ ÷ ⟨1|with "free"⟩) = ${vn(Math.log(3).toFixed(2), "IDF(free)")}. "now" appears in all 3: log(⟨3|messages⟩ ÷ ⟨3|with "now"⟩) = ⟨0|IDF(now)⟩. In your message "free free now": "free" scores ⟨2|TF(free)⟩ × ${vn(Math.log(3).toFixed(2), "IDF(free)")} = ${vn((2 * Math.log(3)).toFixed(2), "TF·IDF")}, "now" scores ⟨0|TF·IDF⟩.`,
            why: "Words every message has tell the model nothing, so they score 0. The real model does this with thousands of training messages and then shrinks the list to length 1.",
            formal: `toy: free → ${vn((2 * Math.log(3)).toFixed(2), "TF·IDF")}, now → ⟨0|TF·IDF⟩.`,
            next: nonZero.length ? "Next: your real words." : "Next chapter: the keys.",
        },
        what: `Your text was converted into a ${result.feature_dim.toLocaleString()}-dimension TF-IDF vector: one entry per vocabulary word, ${nonZero.length} of them non-zero.`,
        why: "TF-IDF weighs each vocabulary word by how important it is in your sentence relative to the whole training vocabulary -- more distinctive words get higher weight.",
        formal: "tfidf(t,d) = tf(t,d) * log(N / df(t)), then L2-normalized",
        next: nonZero.length ? "Next: each word that occurs in your text, one at a time." : "None of your words are in the vocabulary -- this all-zero vector is encrypted next.",
        renderVisual: (el) => renderBars(el, -1),
    }];
    nonZero.forEach((v, k) => steps.push({
        eli5: {
            what: `"${v.name ?? "#" + v.index}" gets ${fmt(v.value)}${k === 0 ? ", the highest of your words" : ""}.`,
            why: "The number is bigger when the word is frequent in your text but rare in normal messages, so tell-tale words like 'free' or 'win' stand out and everyday words stay small.",
            formal: `"${v.name ?? "#" + v.index}" → ${fmt(v.value)}`,
            next: k < nonZero.length - 1 ? "Next word." : "Next chapter: the keys that will lock this list.",
        },
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
        eli5: {
            what: `The locked result arrives (fingerprint ${srcRef("result_ct_sha", "from Computation")}). You unlock it with your secret key s from Key Setup: c₀ + c₁·s gives the scores' formula plus tiny noise; plugging in the slot points and dividing by the scale gives ${ev.data_after.scores.length === 1 ? `the score ${fmt(score, 6)}` : `${ev.data_after.scores.length} scores, one per possible answer`}.`,
            why: "This is the first and only unlock in the whole run. The server computed on locked data and produced a locked answer: it never saw your input or the score. Only s makes the masks cancel, and s never left your computer.",
            formal: "score = decode(c₀ + c₁·s).",
            next: result.task === "multiclass" ? "Next: turning the scores into percentages." : "Next: turning the score into a probability.",
        },
        eli1: {
            what: `Toy from "How HE works": the locked score (${vn(TOY.score.c0, "c₀")}, ${vn(TOY.score.c1, "c₁")}); unlock (${vn(TOY.score.c0, "c₀")} + ${vn(TOY.score.c1, "c₁")} × ${vn(TOY.s, "s")}) mod ${vn(TOY.q, "q")} = ${vn(TOY.dec(TOY.score), "score·Δ")}; ÷ ${vn(TOY.delta, "Δ")} = ${vn(TOY.dec(TOY.score) / TOY.delta, "score")}.`,
            why: "Your real result is unlocked the same way, with 8192-coefficient formulas.",
            formal: `toy: → ${vn(TOY.dec(TOY.score) / TOY.delta, "score")}.`,
            next: "Next: percentages.",
        },
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
            eli5: {
                what: (() => { const top = ranked[0], second = ranked[1]; return `Each of the ${result.scores.length} possible answers got a score. Softmax turns them into percentages: each answer gets e^score (e ≈ 2.718), divided by the total of all of them. Top: "${resultLabel(result.model, top.i)}" score ${fmt(top.s, 2)} → ${(top.pr * 100).toFixed(1)}%${second ? `; next "${resultLabel(result.model, second.i)}" score ${fmt(second.s, 2)} → ${(second.pr * 100).toFixed(1)}%` : ""}.`; })(),
                why: "e^score is always positive and grows fast, so a slightly higher score gets a much bigger share; dividing by the total makes them add up to 100%. It runs after unlocking, on your side, because e^x isn't an addition or multiplication, so CKKS can't do it.",
                formal: "percentage = e^score ÷ sum of e^score.",
                next: "Next: is it the same answer the plain model gives?",
            },
            eli1: {
                what: `Toy scores 2, 1, 0: e² = ${Math.exp(2).toFixed(2)}, e¹ = ${Math.exp(1).toFixed(2)}, e⁰ = 1. Total ${(Math.exp(2) + Math.exp(1) + 1).toFixed(2)}. Shares: ${(Math.exp(2) / (Math.exp(2) + Math.exp(1) + 1) * 100).toFixed(1)}%, ${(Math.exp(1) / (Math.exp(2) + Math.exp(1) + 1) * 100).toFixed(1)}%, ${(1 / (Math.exp(2) + Math.exp(1) + 1) * 100).toFixed(1)}%.`,
                why: "A score just 1 higher gets about 2.7 times the share.",
                formal: "toy: (2, 1, 0) → 66.5%, 24.5%, 9.0%.",
                next: "Next: comparison.",
            },
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
            eli5: {
                what: `The score ${fmt(score)} becomes a probability with the sigmoid: 1 ÷ (1 + e^(−${vn(fmt(score), "score")})) = ${vn(`${(p * 100).toFixed(1)}%`, "p")} chance of "${resultLabel(result.model, 1)}". A score above 0 means more than 50%.`,
                why: "Scores can be any number; the sigmoid squeezes them into 0-100%: big positive → near 100%, big negative → near 0%, 0 → exactly 50%. It runs after unlocking, on your side, because e^x isn't an addition or multiplication, so CKKS can't do it.",
                formal: `${vn(fmt(score), "score")} → ${vn(`${(p * 100).toFixed(1)}%`, "p")}`,
                next: "Next: is it the same answer the plain model gives?",
            },
            eli1: {
                what: `Score 0: 1 ÷ (1 + e⁰) = 1 ÷ ⟨2|1 + e⁰⟩ = ⟨50%|p⟩. Score 2: 1 ÷ (1 + e⁻²) = 1 ÷ ${vn((1 + Math.exp(-2)).toFixed(3), "1 + e⁻²")} = ${vn((100 / (1 + Math.exp(-2))).toFixed(1) + "%", "p")}. Score −2: ${vn((100 / (1 + Math.exp(2))).toFixed(1) + "%", "p")}.`,
                why: `Yours, ${fmt(score, 2)}, gives ${(p * 100).toFixed(1)}%.`,
                formal: "toy: 0 → 50%, 2 → 88.1%.",
                next: "Next: comparison.",
            },
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
// Handwriting: what the whole drawing reads as, one encrypted inference per character.
function readingText(result, key) {
    return result.characters.map((c) => c[key]).join("");
}

// The three likeliest classes of one character: softmax of its decrypted scores over the allowed classes.
function topClasses(result, scores, n = 3) {
    const ids = result.allowed || scores.map((_, i) => i);
    const top = Math.max(...ids.map((i) => scores[i]));
    const e = ids.map((i) => Math.exp(scores[i] - top)), sum = e.reduce((a, v) => a + v, 0);
    return ids.map((i, k) => ({ label: result.class_names[i], p: e[k] / sum })).sort((a, b) => b.p - a.p).slice(0, n);
}

function buildReadingStep(result) {
    const chars = result.characters, imgs = drawnImages(result);
    const allMatch = chars.every((c) => c.match), maxDiff = Math.max(...chars.map((c) => c.max_abs_diff_vs_plain));
    const set = result.allowed ? ` Read as ${result.input.charset} only: after decrypting all ${result.class_names.length} scores, the client picks the best of the ${result.allowed.length} allowed classes (${result.allowed.map((i) => result.class_names[i]).join("")}).` : "";
    return {
        eli5: {
            what: `Your drawing reads "${readingText(result, "he_label")}". Each character was locked and computed on separately; the plain model reads "${readingText(result, "plain_label")}". ${allMatch ? "Same answer for every character." : "Some characters DIFFER."}`,
            why: `Every character went through the whole locked path on its own; the chips at the top left switch the chapters to any of them.${result.allowed ? ` Only ${result.input.charset} were allowed as answers.` : ""} Each card also shows the model's top-3 guesses.`,
            formal: `answer per character = best score after unlocking.`,
            next: `Next: character ${(result.char_index || 0) + 1}'s locked score next to the plain one.`,
        },
        what: `Your drawing reads "${readingText(result, "he_label")}" (decrypted), "${readingText(result, "plain_label")}" in plaintext: ${chars.length} character${chars.length > 1 ? "s" : ""}, each its own encrypted inference. ${allMatch ? "Every character matches." : "Some characters DO NOT match."}`,
        why: `${chars.length > 1 ? `Every character had its own complete run: its own keys, ciphertexts, transport legs and browser checks. The chips at the top left switch every chapter to that character (now: character ${(result.char_index || 0) + 1}). ` : ""}The largest gap between a decrypted score and its plaintext score is ${maxDiff.toExponential(2)}.${set}`,
        formal: `ŷ_j = argmax Dec_sk(Enc_pk(x_j)·Wᵀ + b), j = 1..${chars.length}; top-3 = softmax of the decrypted scores`,
        next: `Next: character ${(result.char_index || 0) + 1}'s encrypted vs plaintext score.`,
        renderVisual: (el) => {
            el.innerHTML = `
                <div class="scene-title">Your drawing reads "${escapeHtml(readingText(result, "he_label"))}"</div>
                <div class="scene-body">
                    <div class="reading-row">${chars.map((c, j) => `
                        <div class="reading-cell ${c.match ? "ok" : "bad"}${j === (result.char_index || 0) ? " current" : ""}">${digitGridSvg(imgs[j], "digit-thumb reading-img")}
                            <div class="reading-label">${escapeHtml(c.he_label)}</div>
                            <div class="step-text muted">plain ${escapeHtml(c.plain_label)} ${c.match ? "✓" : "✕"}</div>
                            <div class="reading-top">${topClasses(result, c.scores).map((t) => `${escapeHtml(t.label)} ${Math.round(t.p * 100)}%`).join(" · ")}</div>
                            <div class="step-text muted">Δ ${c.max_abs_diff_vs_plain.toExponential(1)}${j === (result.char_index || 0) ? " · shown" : ""}</div>
                        </div>`).join("")}</div>
                    ${renderChecks([{ label: `every character: decrypted class == plaintext class (${chars.filter((c) => c.match).length}/${chars.length})`, ok: allMatch }])}
                </div>`;
        },
    };
}

function buildResultSteps(result) {
    const plainLabel = resultLabel(result.model, result.plain_pred);
    const heLabel = resultLabel(result.model, result.he_pred);
    const diff = Math.abs(result.raw_score - result.plaintext_equivalent_score);
    // Multi-character drawings: these two steps are about the character the chips selected.
    const many = result.input_kind === "image" && result.characters && result.characters.length > 1;
    const ch = `Character ${(result.char_index || 0) + 1}`;
    const who = many ? ch : "Your input";
    // Class index for binary models (0/1 is the decision); the label itself for multiclass ones.
    const shown = (pred, label) => (result.task === "multiclass" ? label : String(pred));
    const sub = (pred, label) => (result.task === "multiclass" ? `class #${pred}` : label);
    return [
        ...(result.input_kind === "image" && result.characters ? [buildReadingStep(result)] : []),
        {
            eli5: {
                what: `${many ? `${ch}: ` : ""}locked maths gave ${fmt(result.raw_score, 6)}, the same model on your plain numbers gave ${fmt(result.plaintext_equivalent_score, 6)}. Difference: ${diff.toExponential(2)}.`,
                why: "The difference is CKKS's noise and rounding, divided by the huge scale: far too small to change any answer. (This comparison only exists because this demo runs both sides; in real use you wouldn't have the server's model to compare with.)",
                formal: "locked score ≈ plain score.",
                next: "Next: the final answer, side by side.",
            },
            eli1: {
                what: `Toy: locked 0.353 vs plain 0.35, off by 0.003 because the toy scale is only ${TOY.delta}. Real: off by ${diff.toExponential(1)}, because the scale is 2^${result.ckks_params.global_scale_bits}.`,
                why: "Bigger scale, smaller error.",
                formal: "toy error 0.003; real ≈ 1e-9.",
                next: "Next: the answers.",
            },
            what: `${many ? `${ch}: ` : ""}HE score (decrypted) ${fmt(result.raw_score, 6)} vs. plaintext score ${fmt(result.plaintext_equivalent_score, 6)} -- difference ${diff.toExponential(2)}.`,
            why: "CKKS is approximate: the encryption noise and fixed-point scale leave a tiny error in the result. It's far too small to move a score across the decision boundary, so the prediction is unaffected.",
            formal: `|Dec(f(Enc(x))) - f(x)| = ${diff.toExponential(2)}`,
            next: "Next: the predicted labels, side by side.",
            renderVisual: (el) => {
                el.innerHTML = `
                    <div class="scene-title">${many ? `${ch}: encrypted` : "Encrypted"} vs plaintext score</div>
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
            eli5: {
                what: `${many ? `${ch}: the` : "The"} plain model says "${plainLabel}", the locked run says "${heLabel}": ${result.match ? "the same answer" : "DIFFERENT answers"}.`,
                why: "The same answer means the calculation on locked data was right, even though the computer doing it never saw your input or the result. Privacy cost nothing in correctness here; it costs time, as the Benchmarks show.",
                formal: "plain answer = locked answer.",
                next: "Next: how much slower locked maths is (Benchmarks).",
            },
            what: `${many ? `${ch} -- p` : "P"}laintext prediction: ${plainLabel} (class #${result.plain_pred}). HE prediction: ${heLabel} (class #${result.he_pred}). ${result.match ? "They match." : "They DO NOT match."}`,
            why: "A match means the model reached the same conclusion on the encrypted ciphertext as it did on your original plaintext input -- proof the computation was correct even though the server that computed it never saw your real data.",
            formal: result.task === "multiclass" ? "argmax W·x + b  ==  argmax Dec_sk(Enc_pk(x)·Wᵀ + b)" : "predict(x) == [Dec_sk(Enc_pk(x)·wᵀ + b) > 0]",
            next: "See the Benchmarks chapter for how much slower this was compared to plaintext.",
            renderVisual: (el) => {
                el.innerHTML = `
                    <div class="scene-title">${many ? `${ch} result` : "Result"}</div>
                    <div class="scene-body">
                        <div class="verdict ${result.match ? "ok" : "bad"}">${who} was classified as <strong>${escapeHtml(heLabel)}</strong></div>
                        <div class="compare-grid">
                            <div class="compare-col"><div class="compare-title">Plaintext</div><div class="compare-value">${escapeHtml(shown(result.plain_pred, plainLabel))}</div><div class="step-text muted">${escapeHtml(sub(result.plain_pred, plainLabel))}</div></div>
                            <div class="compare-col"><div class="compare-title">HE (decrypted)</div><div class="compare-value">${escapeHtml(shown(result.he_pred, heLabel))}</div><div class="step-text muted">${escapeHtml(sub(result.he_pred, heLabel))}</div></div>
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
            eli5: {
                what: "No saved speed measurements were found.",
                why: "Measuring every model locked takes minutes, so it's done once, offline, not on every run.",
                formal: "slowdown = locked time / plain time.",
                next: "Run `uv run python -m benchmarks.metrics`, then reload.",
            },
            what: "No saved benchmark results were found (benchmarks/results.json is missing).",
            why: "Benchmarks are measured offline, not per request -- timing every model under HE takes minutes (the encrypted CNN alone takes several).",
            formal: "slowdown = t_HE / t_plain",
            next: "Run `uv run python -m benchmarks.metrics`, then reload this page.",
            renderVisual: (el) => { el.innerHTML = `<div class="scene-title">Benchmarks</div><p class="step-text muted">No results yet.</p>`; },
        }];
    }
    return rows.map((b, i) => ({
        eli5: {
            what: `${b.model}: ${b.n_samples} samples took ${b.plaintext_time_sec.toFixed(3)} s on plain numbers and ${b.he_time_sec.toFixed(2)} s locked, about ${Math.round(b.slowdown_factor).toLocaleString()}× slower. Peak memory ${formatBytes(b.plaintext_peak_mem_bytes)} plain vs ${formatBytes(b.he_peak_mem_bytes)} locked. Same answer in ${(b.plain_vs_he_agreement * 100).toFixed(0)}% of samples.`,
            why: "Each plain number becomes part of formulas with thousands of large coefficients, one locked multiply works on all of them, and every slide needs a key-switch, so locked maths costs orders of magnitude more time and memory. That is the price of privacy.",
            formal: `${Math.round(b.slowdown_factor).toLocaleString()}× slower, ${(b.plain_vs_he_agreement * 100).toFixed(0)}% same answers.`,
            next: i < rows.length - 1 ? "Next model." : "That's the whole pipeline. Pick another chapter, or try a new input.",
        },
        what: `${b.model}: ${b.n_samples} samples took ${b.plaintext_time_sec.toFixed(4)}s in plaintext vs ${b.he_time_sec.toFixed(4)}s encrypted -- ${b.slowdown_factor.toFixed(1)}x slower; peak memory ${formatBytes(b.plaintext_peak_mem_bytes)} vs ${formatBytes(b.he_peak_mem_bytes)}; agreement ${b.plain_vs_he_agreement.toFixed(2)}.`,
        why: "Every ciphertext multiply or add works on polynomials with thousands of large coefficients instead of single numbers, so HE has no shortcuts. Agreement 1.00 means encryption never changed an outcome.",
        formal: `slowdown = ${b.he_time_sec.toFixed(4)} / ${b.plaintext_time_sec.toFixed(4)} = ${b.slowdown_factor.toFixed(1)}x`,
        next: i < rows.length - 1 ? `Next: ${rows[i + 1].model}.` : "That's the end of the walkthrough -- go back to the chapters to revisit any of them, or try a new input.",
        renderVisual: (el) => renderBenchmarksTable(el, rows, i),
    }));
}

// Plain-words twin of one stylometric / tabular feature step (explain_level.js), from the real trace.
// Plain description of each style number; `ab` = the [a, b] of "a / b" in the trace, when there is one.
const STYLE_ELI5 = {
    word_count: (v) => `Split your text at the spaces and count the pieces: ${fmt(v, 0)} words.`,
    char_count: (v) => `Count every character, spaces and punctuation included: ${fmt(v, 0)}.`,
    avg_word_length: (v, ab) => `Average word length: all the letters in your words (${ab ? ab[0] : "?"}) ÷ the number of words (${ab ? ab[1] : "?"}) = ${fmt(v, 2)} letters.`,
    sentence_count: (v) => `Count the sentence endings (. ! ?): ${fmt(v, 0)}.`,
    avg_sentence_length: (v, ab) => `Average sentence length: words (${ab ? ab[0] : "?"}) ÷ sentences (${ab ? ab[1] : "?"}) = ${fmt(v, 2)} words.`,
    lexical_diversity: (v, ab) => `Word variety: different words (${ab ? ab[0] : "?"}) ÷ all words (${ab ? ab[1] : "?"}) = ${fmt(v, 2)}. 1 means no word was repeated.`,
    punctuation_ratio: (v, ab) => `Punctuation share: punctuation marks (${ab ? ab[0] : "?"}) ÷ all characters (${ab ? ab[1] : "?"}) = ${(v * 100).toFixed(1)}%.`,
    uppercase_ratio: (v, ab) => `Capital-letter share: capitals (${ab ? ab[0] : "?"}) ÷ all characters (${ab ? ab[1] : "?"}) = ${(v * 100).toFixed(1)}%.`,
};
const STYLE_WHY = {
    word_count: "Longer texts give the other numbers more to go on; AI answers also tend to have typical lengths.",
    char_count: "Needed to turn counts of punctuation and capitals into shares, so long and short texts compare fairly.",
    avg_word_length: "AI text tends to use longer, more formal words than casual human writing.",
    sentence_count: "Needed for the average sentence length.",
    avg_sentence_length: "AI text often has evenly long sentences; people mix short and long ones.",
    lexical_diversity: "Repetition and variety differ between people and AI models.",
    punctuation_ratio: "Punctuation habits (commas, exclamation marks) are a strong style signal.",
    uppercase_ratio: "People often skip capitals in casual text; AI usually capitalises properly.",
};

function featureEli5(result, trace, idx) {
    const step = trace[idx], n = trace.length;
    const next = idx < n - 1 ? `Next: ${trace[idx + 1].name === "assemble_vector" ? "all of them lined up" : `"${trace[idx + 1].name}"`}.` : "Next chapter: the keys that will lock these numbers.";
    if (step.name === "assemble_vector") return {
        what: `All ${result.feature_dim} numbers lined up in a fixed order: the list x. This list is exactly what gets locked and sent.`,
        why: "The model learned one weight per position, so every number must sit in the same position it was trained in; a shifted number would be multiplied by the wrong weight.",
        formal: `x = list of ${result.feature_dim} numbers.`,
        next,
    };
    if (STYLE_ELI5[step.name]) {
        const m = /= (\d+) \/ (\d+)/.exec(step.raw_computation || "");
        return {
            what: STYLE_ELI5[step.name](step.value, m ? [m[1], m[2]] : null),
            why: `${STYLE_WHY[step.name] || ""} The model sees only these ${result.feature_dim} style numbers, never your actual words.`,
            formal: `${step.name} = ${fmt(step.value)}`,
            next,
        };
    }
    const raw = result.input && result.input.row ? result.input.row[step.name] : undefined;
    if (Array.isArray(step.value)) return {
        what: `"${step.name}" = ${raw} is turned into a row of yes/no switches, one per possible code, with only ${raw}'s switch on; then each switch is rescaled like every other column.`,
        why: "Codes like A11 or A43 are labels, not amounts, so each gets its own switch instead of a number that would wrongly suggest an order.",
        formal: `${raw} → one switch on`,
        next,
    };
    const mu = step.mu, sd = step.sigma;
    return {
        what: mu === undefined
            ? `"${step.name}" = ${raw}: compared with the training data it is ${step.value >= 0 ? "above" : "below"} average by ${fmt(Math.abs(step.value), 2)} typical spreads (rescaled value ${fmt(step.value)}).`
            : `"${step.name}" = ${raw}. In the training data this column averages μ = ${fmt(mu, 2)} with a typical spread (standard deviation) σ = ${fmt(sd, 2)}. Rescaled: (${vn(raw, "value")} − ${vn(fmt(mu, 2), "μ")}) ÷ ${vn(fmt(sd, 2), "σ")} = ${vn(fmt(step.value), "z")}, i.e. ${fmt(Math.abs(step.value), 2)} spreads ${step.value >= 0 ? "above" : "below"} average.`,
        why: "Rescaling (\"standardizing\") puts every column on the same footing, so a big-number column (like an amount in DM) can't drown out a small one (like a rating from 1 to 4), and each weight's size reflects importance instead of units. μ and σ come from the training data and stay fixed.",
        formal: `${step.name}: ${vn(raw, "value")} → ${vn(fmt(step.value), "z")}`,
        next,
    };
}

// Toy-number twin of featureEli5 (ELI1): only the standardizing step gets its own; the rest fall back.
function featureEli1(result, trace, idx) {
    const step = trace[idx];
    if (step.mu === undefined || Array.isArray(step.value)) return undefined;
    const ages = [20, 30, 40], mean = 30, sd = Math.sqrt(ages.reduce((a, v) => a + (v - mean) ** 2, 0) / ages.length);
    return {
        what: `Toy: three people aged 20, 30 and 40. Average ⟨30|μ⟩; typical spread √((10² + 0² + 10²) ÷ 3) = ${vn(sd.toFixed(2), "σ")}. A 45-year-old becomes (⟨45|age⟩ − ⟨30|μ⟩) ÷ ${vn(sd.toFixed(2), "σ")} = ${vn(((45 - mean) / sd).toFixed(2), "z")}: "${((45 - mean) / sd).toFixed(2)} spreads above average".`,
        why: `Your "${step.name}" goes through the same sum with the training data's average (${fmt(step.mu, 2)}) and spread (${fmt(step.sigma, 2)}).`,
        formal: `toy: (⟨45|age⟩ − ⟨30|μ⟩) ÷ ${vn(sd.toFixed(2), "σ")} = ${vn(((45 - mean) / sd).toFixed(2), "z")}.`,
        next: featureEli5(result, trace, idx).next,
    };
}
