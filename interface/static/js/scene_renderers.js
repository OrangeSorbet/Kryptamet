function renderOverviewScene(el) {
    el.innerHTML = `
        <div class="scene-title">Homomorphic encryption, live</div>
        <div class="scene-body">
            <p class="step-text">Pick a model and type real input. Every step that follows uses your actual data.</p>
            <div class="select-group">
                <select id="modelSelect" class="dropdown">
                    <option value="human_vs_ai_text">Human vs AI Text</option>
                    <option value="sms_spam">SMS Spam</option>
                </select>
            </div>
            <textarea id="textInput" class="input-text" rows="3" placeholder="Type a real sentence here..."></textarea>
            <button id="runInferenceBtn" class="btn" style="margin-top:1rem">Run</button>
        </div>
    `;
    document.getElementById("runInferenceBtn").addEventListener("click", async () => {
        const ok = await runPipeline("");
        if (ok) {
            await rebuildScenesAfterInference(pipelineResult);
            renderTimeline();
            goToSceneIndex(1);
        }
    });
}

function renderFeatureStepScene(el, step) {
    el.innerHTML = `
        <div class="scene-title">${step.name}${step.value !== null ? ' = ' + step.value.toFixed(4) : ''}</div>
        <div class="scene-body">
            <div class="data-preview">${step.raw_computation}</div>
            <p class="step-text"><strong>Why:</strong> ${step.why}</p>
            <p class="step-text"><strong>Next:</strong> ${step.next}</p>
        </div>
    `;
}

function renderTfidfScene(el, result, nonZero) {
    const rows = nonZero.map((e) => `<div class="result-row"><span>${e.description}</span></div>`).join("");
    el.innerHTML = `
        <div class="scene-title">TF-IDF vectorization</div>
        <div class="scene-body">
            <p class="step-text">Your text "${result.input_text}" is converted into a ${result.feature_dim}-dimension vector. Each dimension is one vocabulary word; the value is how important that word is in your sentence (TF-IDF weight). Below: non-zero entries.</p>
            <div class="data-preview">${rows}</div>
            <p class="step-text muted">Next: this full vector gets encrypted.</p>
        </div>
    `;
}

function buildIndexedEquations(n, template) {
    const out = [];
    for (let k = 0; k < n; k++) out.push(template(k));
    return out;
}

function renderCkksEncodeScene(el) {
    el.innerHTML = `
        <div class="scene-title">Real CKKS: Encoding</div>
        <div class="scene-body">
            <p class="step-text">Your real feature vector is encoded into a real polynomial with N=256 coefficients using canonical embedding: each coefficient is a dot product of one row of the inverse Vandermonde matrix with your (conjugate-extended) input vector.</p>
            <div class="poly-label">m(X): the encoded plaintext polynomial (256 real coefficients)</div>
            <div id="gridEncode"></div>
        </div>
    `;
    const coeffs = ckksDeepDiveResult.encode.m_coeffs;
    const eqs = buildIndexedEquations(coeffs.length, (k) => `m_{${k}} = \\sum_j V^{-1}_{${k},j}\\, z_j`);
    renderPolyGrid(document.getElementById("gridEncode"), coeffs, eqs, { skipAnimation: window.sceneAlreadyVisited });
}

function renderCkksSecretKeyScene(el) {
    el.innerHTML = `
        <div class="scene-title">Real CKKS: Secret key</div>
        <div class="scene-body">
            <p class="step-text">A real ternary secret key polynomial s(X) is generated -- each coefficient is randomly -1, 0, or 1. This key never leaves your machine.</p>
            <div class="poly-label">s(X): secret key (256 coefficients, each in {-1, 0, 1})</div>
            <div id="gridSecret"></div>
        </div>
    `;
    const coeffs = ckksDeepDiveResult.keygen.secret_key_s;
    const eqs = buildIndexedEquations(coeffs.length, (k) => `s_{${k}} \\leftarrow \\{-1,0,1\\}`);
    renderPolyGrid(document.getElementById("gridSecret"), coeffs, eqs, { skipAnimation: window.sceneAlreadyVisited });
}

function renderCkksPublicKeyScene(el) {
    el.innerHTML = `
        <div class="scene-title">Real CKKS: Public key</div>
        <div class="scene-body">
            <p class="step-text">The public key is computed as b = -a*s + e (mod q), using real negacyclic polynomial multiplication in Z[X]/(X^256+1). 'a' is uniformly random, 'e' is a small real error term. Wrap-around terms (index sum >= 256) carry a sign flip since X^256 = -1.</p>
            <div class="grid-pair">
                <div><div class="poly-label">a(X): random polynomial</div><div id="gridA"></div></div>
                <div><div class="poly-label">b(X) = -a*s + e (mod q)</div><div id="gridB"></div></div>
            </div>
        </div>
    `;
    const aCoeffs = ckksDeepDiveResult.keygen.public_key_a.map(v => v % 1000);
    const bCoeffs = ckksDeepDiveResult.keygen.public_key_b.map(v => v % 1000);
    const aEqs = buildIndexedEquations(aCoeffs.length, (k) => `a_{${k}} \\leftarrow \\text{Uniform}(0,q)`);
    const bEqs = buildIndexedEquations(bCoeffs.length, (k) => `b_{${k}} = \\Big(-\\!\\!\\sum_{i+j\\equiv ${k}}\\! a_i s_j + e_{${k}}\\Big) \\bmod q`);
    renderPolyGrid(document.getElementById("gridA"), aCoeffs, aEqs, { skipAnimation: window.sceneAlreadyVisited });
    renderPolyGrid(document.getElementById("gridB"), bCoeffs, bEqs, { skipAnimation: window.sceneAlreadyVisited });
}

function renderCkksC0Scene(el) {
    el.innerHTML = `
        <div class="scene-title">Real CKKS: Encrypting (c0)</div>
        <div class="scene-body">
            <p class="step-text">c0 = b*u + e1 + m (mod q). 'u' is a fresh ephemeral ternary polynomial; e1 is fresh error; m is your encoded message polynomial from the Encoding step.</p>
            <div class="poly-label">c0(X): first ciphertext polynomial</div>
            <div id="gridC0"></div>
        </div>
    `;
    const coeffs = ckksDeepDiveResult.encrypt.c0.map(v => v % 1000);
    const eqs = buildIndexedEquations(coeffs.length, (k) => `c0_{${k}} = \\Big(\\sum_{i+j\\equiv ${k}}\\! b_i u_j\\Big) + e1_{${k}} + m_{${k}} \\bmod q`);
    renderPolyGrid(document.getElementById("gridC0"), coeffs, eqs, { skipAnimation: window.sceneAlreadyVisited });
}

function renderCkksC1Scene(el) {
    el.innerHTML = `
        <div class="scene-title">Real CKKS: Encrypting (c1)</div>
        <div class="scene-body">
            <p class="step-text">c1 = a*u + e2 (mod q). Together (c0, c1) form the complete ciphertext -- neither reveals your data on its own.</p>
            <div class="poly-label">c1(X): second ciphertext polynomial</div>
            <div id="gridC1"></div>
        </div>
    `;
    const coeffs = ckksDeepDiveResult.encrypt.c1.map(v => v % 1000);
    const eqs = buildIndexedEquations(coeffs.length, (k) => `c1_{${k}} = \\Big(\\sum_{i+j\\equiv ${k}}\\! a_i u_j\\Big) + e2_{${k}} \\bmod q`);
    renderPolyGrid(document.getElementById("gridC1"), coeffs, eqs, { skipAnimation: window.sceneAlreadyVisited });
}

function renderCkksDecryptScene(el) {
    const orig = ckksDeepDiveResult.original_vector;
    const rec = ckksDeepDiveResult.decrypt.recovered_vector;
    el.innerHTML = `
        <div class="scene-title">Real CKKS: Decrypting</div>
        <div class="scene-body">
            <p class="step-text">m' = c0 + c1*s (mod q). Only the secret key s can cancel out the public-key term, leaving your original message plus tiny noise.</p>
            <div class="poly-label">m'(X): recovered plaintext polynomial</div>
            <div id="gridDecrypt"></div>
            <p class="step-text">Decoded back to your original values:</p>
            <div class="data-preview">Original: [${orig.map(v => v.toFixed(4)).join(", ")}]<br>Recovered: [${rec.map(v => v.toFixed(4)).join(", ")}]</div>
        </div>
    `;
    const coeffs = ckksDeepDiveResult.decrypt.m_prime;
    const eqs = buildIndexedEquations(coeffs.length, (k) => `m'_{${k}} = \\Big(c0_{${k}} + \\sum_{i+j\\equiv ${k}}\\! c1_i s_j\\Big) \\bmod q`);
    renderPolyGrid(document.getElementById("gridDecrypt"), coeffs, eqs, { skipAnimation: window.sceneAlreadyVisited });
}

function renderKeyScene(el) {
    const wrapEvent = pipelineResult.events.find((e) => e.operation_name === "passphrase_aes_wrap");
    const usedPassphrase = pipelineResult.used_passphrase;

    el.innerHTML = `
        <div class="scene-title">Key setup</div>
        <div class="scene-body">
            <p class="step-text">A CKKS key pair was generated for the homomorphic math itself: a <strong>secret key</strong> (kept only by you) and a <strong>public key</strong> (used to encrypt, safe to share).</p>
            <p class="step-text">Now, optionally, lock the transport step with your own passphrase instead of a random key:</p>
            <input type="text" id="keyPassphraseInput" class="input-text" placeholder="Type your own passphrase">
            <button id="lockKeyBtn" class="btn" style="margin-top:0.75rem">Lock with my passphrase</button>
            <div id="keyResultSlot" style="margin-top:1rem">
                ${usedPassphrase ? `
                    <p class="step-text">Your passphrase was run through <strong>PBKDF2 (200,000 iterations)</strong> to derive a real 256-bit AES key.</p>
                    <div class="data-preview">Derived key fingerprint: ${wrapEvent ? wrapEvent.data_after.key_fingerprint : ''}...</div>
                ` : `<p class="step-text muted">No passphrase locked yet -- a random AES+RSA wrap will be used for transport if you skip this.</p>`}
            </div>
            <p class="step-text muted">Next: your feature vector is encrypted with the CKKS public key.</p>
        </div>
    `;
    document.getElementById("lockKeyBtn").addEventListener("click", async () => {
        const val = document.getElementById("keyPassphraseInput").value;
        if (!val.trim()) { alert("Type a passphrase first."); return; }
        const ok = await runPipeline(val);
        if (ok) renderKeyScene(el);
    });
}

function renderEncryptScene(el) {
    const ev = pipelineResult.events.find((e) => e.operation_name === "ckks_encrypt");
    el.innerHTML = `
        <div class="scene-title">Encryption</div>
        <div class="scene-body">
            <p class="step-text">${ev.description}</p>
            <div class="ciphertext-box">${ev.data_after.hex_preview}...</div>
            <p class="step-text muted">Ciphertext size: ${ev.data_after.ciphertext_size} bytes. This unreadable blob is what gets sent for computation.</p>
        </div>
    `;
}

function renderComputeScene(el) {
    el.innerHTML = `
        <div class="scene-title">Computation on encrypted data</div>
        <div class="scene-body" style="max-width:1100px">
            <p class="step-text muted">Every line is a real weight multiplication happening on your ciphertext.</p>
            <div class="smoke-feed" id="logFeed" style="height:60vh"></div>
            <div class="control-row">
                <label>Speed</label>
                <input type="range" id="speedSlider" min="1" max="10" value="5">
            </div>
        </div>
    `;
    const computeEvents = pipelineResult.events.filter((e) => e.stage === "compute");
    const lines = computeEvents.map((e) => e.description);
    const feed = createSmokeFeed(document.getElementById("logFeed"), lines, {
        speedGetter: () => parseInt(document.getElementById("speedSlider").value, 10),
    });
    if (window.sceneAlreadyVisited) {
        feed.showAllInstant();
    } else {
        feed.start();
    }
}

function renderTransportScene(el) {
    const passphraseWrap = pipelineResult.events.find((e) => e.operation_name === "passphrase_aes_wrap");
    const rsaWrap = pipelineResult.events.find((e) => e.operation_name === "rsa_aes_wrap");
    const ev = passphraseWrap || rsaWrap;
    el.innerHTML = `
        <div class="scene-title">Secure transport</div>
        <div class="scene-body">
            <p class="step-text">${ev.description}</p>
            <div class="ciphertext-box">${ev.data_after.hex_preview}...</div>
            <p class="step-text muted">${passphraseWrap ? "This used your own passphrase-derived key." : "This used a randomly generated key (no passphrase entered)."}</p>
        </div>
    `;
}

function renderDecryptScene(el) {
    const ev = pipelineResult.events.find((e) => e.operation_name === "ckks_decrypt");
    el.innerHTML = `
        <div class="scene-title">Decryption</div>
        <div class="scene-body">
            <p class="step-text">${ev.description}</p>
            <p class="step-text muted">Only your secret key can do this. The server never had it.</p>
        </div>
    `;
}

function renderResultScene(el) {
    el.innerHTML = `
        <div class="scene-title">Result</div>
        <div class="scene-body">
            <div class="compare-grid">
                <div class="compare-col"><div class="compare-title">Plaintext</div><div class="compare-value">${pipelineResult.plain_pred}</div></div>
                <div class="compare-col"><div class="compare-title">HE (decrypted)</div><div class="compare-value">${pipelineResult.he_pred}</div></div>
            </div>
            <p class="step-text">Match: <span class="${pipelineResult.match ? 'badge-match' : 'badge-mismatch'}">${pipelineResult.match}</span></p>
        </div>
    `;
}

function renderBenchmarksScene(el) {
    el.innerHTML = `<div class="scene-title">Benchmarks</div><div class="scene-body" id="benchmarksSlot"></div>`;
    const src = document.getElementById("benchmarkTableSource");
    if (src) document.getElementById("benchmarksSlot").innerHTML = src.innerHTML;
}