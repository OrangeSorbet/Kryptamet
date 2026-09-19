let SCENES = [];

function buildStaticScenes() {
    return [
        {
            chapter: 1, chapterName: "Overview", scene: 1, sceneName: "Pick model and input",
            render: renderOverviewScene,
        },
    ];
}

function buildFeatureScenes(result) {
    const out = [];
    if (result.feature_trace) {
        result.feature_trace.forEach((step, i) => {
            out.push({
                chapter: 2, chapterName: "Feature extraction", scene: i + 1, sceneName: step.name,
                render: (el) => renderFeatureStepScene(el, step),
            });
        });
    } else {
        const weightEvents = result.events.filter((e) => e.stage === "compute");
        const nonZero = weightEvents.filter((e) => e.data_before && e.data_before.input !== 0).slice(0, 10);
        out.push({
            chapter: 2, chapterName: "Feature extraction", scene: 1, sceneName: "TF-IDF vectorization",
            render: (el) => renderTfidfScene(el, result, nonZero),
        });
    }
    return out;
}

function buildCkksDeepDiveScenes() {
    return [
        { chapter: 3, chapterName: "CKKS deep dive", scene: 1, sceneName: "Encoding", render: renderCkksEncodeScene },
        { chapter: 3, chapterName: "CKKS deep dive", scene: 2, sceneName: "Secret key", render: renderCkksSecretKeyScene },
        { chapter: 3, chapterName: "CKKS deep dive", scene: 3, sceneName: "Public key", render: renderCkksPublicKeyScene },
        { chapter: 3, chapterName: "CKKS deep dive", scene: 4, sceneName: "Encrypting (c0)", render: renderCkksC0Scene },
        { chapter: 3, chapterName: "CKKS deep dive", scene: 5, sceneName: "Encrypting (c1)", render: renderCkksC1Scene },
        { chapter: 3, chapterName: "CKKS deep dive", scene: 6, sceneName: "Decrypting", render: renderCkksDecryptScene },
    ];
}

function buildRestOfScenes() {
    return [
        { chapter: 4, chapterName: "Key setup", scene: 1, sceneName: "Generating keys", render: renderKeyScene },
        { chapter: 5, chapterName: "Encryption", scene: 1, sceneName: "Plaintext to ciphertext", render: renderEncryptScene },
        { chapter: 6, chapterName: "Computation", scene: 1, sceneName: "Live weight multiply feed", render: renderComputeScene },
        { chapter: 7, chapterName: "Transport", scene: 1, sceneName: "RSA+AES hybrid wrap", render: renderTransportScene },
        { chapter: 8, chapterName: "Decryption", scene: 1, sceneName: "Ciphertext to result", render: renderDecryptScene },
        { chapter: 9, chapterName: "Result", scene: 1, sceneName: "Plaintext vs HE", render: renderResultScene },
        { chapter: 10, chapterName: "Benchmarks", scene: 1, sceneName: "Cost of privacy", render: renderBenchmarksScene },
    ];
}

let ckksDeepDiveResult = null;

async function fetchCkksDeepDive(model, text) {
    const resp = await fetch("/api/ckks_deep_dive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, text }),
    });
    return resp.ok ? await resp.json() : null;
}

async function rebuildScenesAfterInference(result) {
    const model = document.getElementById("modelSelect").value;
    const text = document.getElementById("textInput").value;
    ckksDeepDiveResult = await fetchCkksDeepDive(model, text);
    SCENES = [...buildStaticScenes(), ...buildFeatureScenes(result), ...buildCkksDeepDiveScenes(), ...buildRestOfScenes()];
}