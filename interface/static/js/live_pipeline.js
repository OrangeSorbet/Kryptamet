let currentResult = null;
let feedTimer = null;

document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
});

async function fetchInference() {
    const model = document.getElementById("modelSelect").value;
    const text = document.getElementById("textInput").value;
    if (!text.trim()) {
        alert("Type a sentence first.");
        return null;
    }
    const resp = await fetch("/api/infer_text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, text }),
    });
    if (!resp.ok) {
        alert("Inference failed: " + resp.status);
        return null;
    }
    return await resp.json();
}

function renderStaticSections(result) {
    const events = result.events;

    document.getElementById("resultSummary").innerHTML = `
        <div class="summary-box">
            <div class="summary-cell"><div class="value">${result.feature_dim}</div><div class="label">Feature dimensions</div></div>
            <div class="summary-cell"><div class="value">${result.plain_pred}</div><div class="label">Plaintext prediction</div></div>
            <div class="summary-cell"><div class="value">${result.he_pred}</div><div class="label">HE prediction</div></div>
            <div class="summary-cell"><div class="value" style="color:${result.match ? 'var(--color-success)' : 'var(--color-error)'}">${result.match}</div><div class="label">Match</div></div>
        </div>
    `;

    const encryptEvent = events.find((e) => e.operation_name === "ckks_encrypt");
    document.getElementById("encryptionContent").innerHTML = encryptEvent ? `
        <p class="step-text">${encryptEvent.description}</p>
        <div class="ciphertext-box">${encryptEvent.data_after.hex_preview}...</div>
        <div class="data-preview"><span class="data-label">Ciphertext size:</span> ${encryptEvent.data_after.ciphertext_size} bytes</div>
    ` : "No encryption event found.";

    const wrapEvent = events.find((e) => e.operation_name === "rsa_aes_wrap");
    const unwrapEvent = events.find((e) => e.operation_name === "rsa_aes_unwrap");
    document.getElementById("transportContent").innerHTML = wrapEvent ? `
        <p class="step-text">${wrapEvent.description}</p>
        <div class="ciphertext-box">${wrapEvent.data_after.hex_preview}...</div>
        <div class="data-preview">
            <span class="data-label">AES payload size:</span> ${wrapEvent.data_after.aes_ciphertext_size} bytes<br>
            <span class="data-label">RSA-wrapped key size:</span> ${wrapEvent.data_after.rsa_key_size} bytes<br>
            <span class="data-label">Integrity after unwrap:</span> ${unwrapEvent ? unwrapEvent.data_after.integrity_preserved : "?"}
        </div>
    ` : "No transport event found.";

    const decryptEvent = events.find((e) => e.operation_name === "ckks_decrypt");
    document.getElementById("decryptionContent").innerHTML = decryptEvent ? `
        <p class="step-text">${decryptEvent.description}</p>
        <div class="data-preview">
            <span class="data-label">Raw score:</span> ${decryptEvent.data_after.raw_score.toFixed(6)}<br>
            <span class="data-label">Sigmoid probability:</span> ${decryptEvent.data_after.sigmoid.toFixed(6)}
        </div>
        <div class="compare-grid">
            <div class="compare-col"><div class="compare-title">Plaintext</div><div class="compare-value">${result.plain_pred}</div></div>
            <div class="compare-col"><div class="compare-title">HE (decrypted)</div><div class="compare-value">${result.he_pred}</div></div>
        </div>
    ` : "No decryption event found.";
}

function renderLogFeedInstant(events) {
    const feed = document.getElementById("logFeed");
    feed.innerHTML = "";
    const computeEvents = events.filter((e) => e.stage === "compute");
    computeEvents.forEach((e) => {
        const line = document.createElement("div");
        line.className = "log-line stage-" + e.stage;
        line.textContent = e.description;
        feed.appendChild(line);
    });
    feed.scrollTop = feed.scrollHeight;
}

function renderLogFeedAnimated(events) {
    const feed = document.getElementById("logFeed");
    feed.innerHTML = "";
    const computeEvents = events.filter((e) => e.stage === "compute");
    let i = 0;
    if (feedTimer) clearInterval(feedTimer);

    function tick() {
        const speed = parseInt(document.getElementById("speedSlider").value, 10);
        const linesPerTick = Math.max(1, Math.round(speed / 10));
        for (let k = 0; k < linesPerTick && i < computeEvents.length; k++, i++) {
            const line = document.createElement("div");
            line.className = "log-line stage-" + computeEvents[i].stage;
            line.textContent = computeEvents[i].description;
            feed.appendChild(line);
        }
        feed.scrollTop = feed.scrollHeight;
        if (i >= computeEvents.length) {
            clearInterval(feedTimer);
        }
    }

    feedTimer = setInterval(tick, 20);
}

document.getElementById("runInstantBtn").addEventListener("click", async () => {
    const result = await fetchInference();
    if (!result) return;
    currentResult = result;
    renderStaticSections(result);
    renderLogFeedInstant(result.events);
});

document.getElementById("runAnimatedBtn").addEventListener("click", async () => {
    const result = await fetchInference();
    if (!result) return;
    currentResult = result;
    renderStaticSections(result);
    document.querySelector('[data-tab="computation"]').click();
    renderLogFeedAnimated(result.events);
});
