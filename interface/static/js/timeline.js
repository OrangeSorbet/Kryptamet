let currentSceneIndex = 0;
let typingTimer = null;
let typingDelay = null;
let visitedScenes = new Set();

function renderTimeline() {
    const container = document.getElementById("timelineContainer");
    container.innerHTML = "";

    SCENES.forEach((scene, i) => {
        const wrap = document.createElement("div");
        wrap.className = "timeline-tick-wrap";
        wrap.addEventListener("click", () => goToSceneIndex(i));

        const tick = document.createElement("div");
        tick.className = "timeline-tick" + (i === currentSceneIndex ? " current" : "");
        tick.style.height = (i === currentSceneIndex ? "20" : "14") + "px";
        wrap.appendChild(tick);

        wrap.addEventListener("mousemove", (e) => {
            const shortText = "CH" + scene.chapter + ":SC" + scene.scene;
            const fullText = "Chapter " + scene.chapter + "\n" + scene.chapterName + "\nScene " + scene.scene + "\n" + scene.sceneName;

            let tooltip = wrap.querySelector(".timeline-tooltip");
            if (!tooltip) {
                tooltip = document.createElement("div");
                tooltip.className = "timeline-tooltip";
                wrap.appendChild(tooltip);
                tooltip.textContent = shortText;

                clearInterval(typingTimer);
                clearTimeout(typingDelay);
                typingDelay = setTimeout(() => {
                    let idx = 0;
                    typingTimer = setInterval(() => {
                        tooltip.textContent = fullText.slice(0, idx + 1);
                        idx++;
                        if (idx >= fullText.length) clearInterval(typingTimer);
                    }, 15);
                }, 1000);
            }
        });

        wrap.addEventListener("mouseleave", () => {
            const tooltip = wrap.querySelector(".timeline-tooltip");
            if (tooltip) tooltip.remove();
            clearInterval(typingTimer);
            clearTimeout(typingDelay);
        });

        container.appendChild(wrap);
    });
}

function goToSceneIndex(i) {
    if (i < 0 || i >= SCENES.length) return;
    currentSceneIndex = i;
    window.sceneAlreadyVisited = visitedScenes.has(i);
    const el = document.getElementById("sceneContent");
    SCENES[i].render(el);
    visitedScenes.add(i);
    renderTimeline();

    const stageMap = { 1: "client_start", 2: "client_start", 3: "client_start", 4: "encrypt", 5: "server", 6: "server", 7: "decrypt", 8: "client_end", 9: "client_end" };
    if (minimapInstance && stageMap[SCENES[i].chapter]) {
        minimapInstance.goTo(stageMap[SCENES[i].chapter]);
    }
}