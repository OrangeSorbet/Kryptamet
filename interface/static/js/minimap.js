const MINIMAP_STAGES = [
    { key: "client_start", x: 15, y: 15, label: "You" },
    { key: "encrypt", x: 105, y: 15, label: "Encrypt" },
    { key: "server", x: 195, y: 15, label: "Server" },
    { key: "result", x: 195, y: 75, label: "Result" },
    { key: "decrypt", x: 105, y: 75, label: "Decrypt" },
    { key: "client_end", x: 15, y: 75, label: "You" },
];

function initMinimap(containerEl) {
    const pathD = "M15,15 L105,15 L195,15 L195,75 L105,75 L15,75";
    containerEl.innerHTML = `
        <div class="minimap-label" id="minimapStepLabel">Idle</div>
        <svg viewBox="0 0 220 100">
            <path class="minimap-path" d="${pathD}"></path>
            <path class="minimap-path-done" id="minimapDone" d="${pathD}" stroke-dasharray="1000" stroke-dashoffset="1000"></path>
            ${MINIMAP_STAGES.map(s => `<circle cx="${s.x}" cy="${s.y}" r="3" fill="var(--color-border)"></circle><text class="minimap-node-label" x="${s.x}" y="${s.y - 8}" text-anchor="middle">${s.label}</text>`).join("")}
            <circle class="minimap-dot" id="minimapDot" cx="15" cy="15" r="5"></circle>
        </svg>
    `;

    const donePath = containerEl.querySelector("#minimapDone");
    const totalLength = donePath.getTotalLength();
    donePath.style.strokeDasharray = totalLength;
    donePath.style.strokeDashoffset = totalLength;

    const dot = containerEl.querySelector("#minimapDot");
    const label = containerEl.querySelector("#minimapStepLabel");

    return {
        goTo: (stageKey) => {
            const idx = MINIMAP_STAGES.findIndex(s => s.key === stageKey);
            if (idx === -1) return;
            const stage = MINIMAP_STAGES[idx];
            dot.setAttribute("cx", stage.x);
            dot.setAttribute("cy", stage.y);
            label.textContent = stage.label;
            const fraction = idx / (MINIMAP_STAGES.length - 1);
            donePath.style.transition = "stroke-dashoffset 0.6s ease";
            donePath.style.strokeDashoffset = totalLength * (1 - fraction);
        },
        reset: () => {
            dot.setAttribute("cx", 15);
            dot.setAttribute("cy", 15);
            label.textContent = "Idle";
            donePath.style.strokeDashoffset = totalLength;
        },
    };
}