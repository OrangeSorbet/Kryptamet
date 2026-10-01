// App-level navigation/state: overview (input form) -> flowchart (chapter
// boxes) -> a single chapter's zoomed-in detail view (Scrubber-driven), and
// back. Two permanent zoom units (#flowchartUnit, #chapterUnit) alternate
// visibility via zoomUnits() -- content is always built into its real,
// final location before a transition starts, so what's previewed during
// the zoom and what's left on screen afterward are always identical.
let currentView = "overview"; // "overview" | "flowchart" | a chapter index
let chapterSteps = [];        // resolved CHAPTERS[i].steps, filled after a run
let stepIndices = {};         // chapterIndex -> last-seen step index (restored on re-entry)
let doneChapters = new Set();
let lastVisited = -1;         // chapter index highlighted on the flowchart
let scrubberInstance = null;
let chapterMinimap = null;
let ckksDeepDiveResult = null;
let forceReplay = false;      // set by the Scrubber's restart: replay animations once

const $ = (id) => document.getElementById(id);

function buildAllChapterSteps() {
    chapterSteps = CHAPTERS.map((c) => {
        if (c.requiresResult && !pipelineResult) return null;
        if (c.requiresDeepDive && !ckksDeepDiveResult) return null;
        return {
            steps: c.buildSteps(pipelineResult, ckksDeepDiveResult),
            bands: c.stepBands ? c.stepBands(pipelineResult) : [],
        };
    });
}

function chapterEnabled(index) {
    const c = CHAPTERS[index];
    if (!c.requiresResult) return true;
    return !!chapterSteps[index] && chapterSteps[index].steps.length > 0;
}

function renderFlowchart(el, animateIn) {
    renderFlowchartInto(el, {
        chapters: CHAPTERS,
        enabled: chapterEnabled,
        stepCount: (i) => (chapterSteps[i] ? chapterSteps[i].steps.length : null),
        summary: (i) => CHAPTERS[i].summary(pipelineResult, ckksDeepDiveResult),
        done: doneChapters,
        lastVisited,
        animateIn,
        onSelect: (i, box) => enterChapter(i, box),
    });
}

function setChapterChrome(visible) {
    $("backToFlowchartBtn").style.display = visible ? "flex" : "none";
    $("chapterHelpBtn").style.display = visible ? "flex" : "none";
    $("minimapContainer").style.display = visible ? "flex" : "none";
    $("scrubberDock").style.display = visible ? "block" : "none";
}

function hideChapterChrome() {
    setChapterChrome(false);
    if (scrubberInstance) { scrubberInstance.destroy(); scrubberInstance = null; }
}

// Builds a chapter's real, interactive content (visual + scrubber + chrome)
// directly into the permanent DOM. Called BEFORE a zoom starts (so the zoom
// previews the exact final content) and also for in-place rebuilds
// (passphrase re-lock) that don't need any zoom at all.
function buildChapterVisual(index) {
    setChapterChrome(true);
    const el = $("sceneContent");
    el.classList.add("chapter-scene");
    el.innerHTML = "";

    const entry = chapterSteps[index];
    if (scrubberInstance) scrubberInstance.destroy();
    scrubberInstance = createScrubber($("scrubberDock"), {
        steps: entry.steps,
        chapters: entry.bands,
        meta: `Chapter ${index + 1} · ${CHAPTERS[index].label}`,
        onRestart: () => { forceReplay = true; },
        onStepChange: (i, step) => {
            stepIndices[index] = i;
            window.sceneAlreadyVisited = doneChapters.has(index) && !forceReplay;
            forceReplay = false;
            const settled = step.renderVisual(el);
            el.classList.remove("step-fade-in");
            void el.offsetWidth; // restart the fade animation
            el.classList.add("step-fade-in");
            if (i >= entry.steps.length - 1) doneChapters.add(index);
            chapterMinimap.update(index, doneChapters);
            return settled;
        },
    });
    scrubberInstance.seek(stepIndices[index] || 0);
    chapterMinimap.update(index, doneChapters);
}

function originOf(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function enterChapter(index, originEl) {
    if (zoomInFlight) return;
    currentView = index;
    lastVisited = index;
    zoomUnits({
        fromEl: $("flowchartUnit"),
        toEl: $("chapterUnit"),
        origin: originOf(originEl),
        direction: "in",
        buildTo: () => buildChapterVisual(index),
        onDone: () => maybeShowIntroCard(CHAPTERS[index].id),
    });
    updateNavbar();
}

function exitToFlowchart(originEl) {
    if (zoomInFlight) return;
    currentView = "flowchart";
    if (scrubberInstance) { scrubberInstance.destroy(); scrubberInstance = null; }
    zoomUnits({
        fromEl: $("chapterUnit"),
        toEl: $("flowchartUnit"),
        origin: originOf(originEl),
        direction: "out",
        buildTo: () => renderFlowchart($("flowchartContainer"), false),
        onDone: () => { hideChapterChrome(); updateNavbar(); },
    });
}

function showOverview() {
    const el = $("sceneContent");
    el.classList.remove("chapter-scene", "step-fade-in");
    renderOverviewScene(el);
    if (pipelineResult) {
        $("modelSelect").value = pipelineResult.model;
        $("modelSelect").dispatchEvent(new Event("change"));
        $("textInput").value = pipelineResult.input_text;
    }
}

function returnToOverview() {
    if (zoomInFlight || currentView === "overview") return;
    const fromEl = currentView === "flowchart" ? $("flowchartUnit") : $("chapterUnit");
    currentView = "overview";
    if (fromEl === $("chapterUnit")) {
        // Same unit hosts both views: swap in place, no zoom.
        hideChapterChrome();
        showOverview();
        updateNavbar();
        return;
    }
    zoomUnits({
        fromEl,
        toEl: $("chapterUnit"),
        origin: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
        direction: "out",
        buildTo: () => { hideChapterChrome(); showOverview(); },
        onDone: () => { updateNavbar(); $("textInput").focus(); },
    });
}

function updateNavbar() {
    const info = $("navbarRunInfo");
    const onOverview = currentView === "overview";
    $("newInputBtn").style.display = pipelineResult && !onOverview ? "inline-flex" : "none";
    $("flowchartHelpBtn").style.display = currentView === "flowchart" ? "inline-flex" : "none";
    if (pipelineResult && !onOverview) {
        const t = pipelineResult.input_text;
        info.textContent = `${pipelineResult.model} · "${t.length > 48 ? t.slice(0, 48) + "…" : t}"`;
        info.title = t;
    } else {
        info.textContent = "";
        info.title = "";
    }
}

function startAfterInference() {
    buildAllChapterSteps();
    currentView = "flowchart";
    zoomUnits({
        fromEl: $("chapterUnit"),
        toEl: $("flowchartUnit"),
        origin: originOf($("runInferenceBtn") || $("sceneContent")),
        direction: "in",
        buildTo: () => renderFlowchart($("flowchartContainer"), true),
        onDone: () => { hideChapterChrome(); updateNavbar(); maybeShowIntroCard("flowchart"); },
    });
}

// Called by the overview form. Runs the real pipeline + deep-dive, resets
// per-run progress, then zooms to the flowchart. Resolves to { ok, error }.
window.onRunRequested = async (model, text) => {
    const r = await runPipeline(model, text, "");
    if (!r.ok) return r;
    ckksDeepDiveResult = await fetchCkksDeepDive(model, text);
    doneChapters = new Set();
    stepIndices = {};
    lastVisited = -1;
    startAfterInference();
    return r;
};

window.onPassphraseRelock = () => {
    buildAllChapterSteps();
    const keyIndex = CHAPTERS.findIndex((c) => c.id === "key");
    // Land back on the step that holds the passphrase controls (flagged `relock`).
    const steps = chapterSteps[keyIndex].steps;
    const relockIdx = steps.findIndex((s) => s.relock);
    stepIndices[keyIndex] = relockIdx >= 0 ? relockIdx : steps.length - 1;
    buildChapterVisual(keyIndex);
};

document.addEventListener("keydown", (e) => {
    if (window.introCardOpen || e.key !== "Escape") return;
    if (typeof currentView === "number") exitToFlowchart($("backToFlowchartBtn"));
});

function initChapterState() {
    chapterMinimap = initMinimap($("minimapContainer"), CHAPTERS.map((c) => c.label), (i) => {
        if (typeof currentView !== "number" || i === currentView || !chapterEnabled(i)) return;
        // Jump straight between chapters from the minimap.
        lastVisited = i;
        currentView = i;
        buildChapterVisual(i);
        maybeShowIntroCard(CHAPTERS[i].id);
    });
    $("backToFlowchartBtn").addEventListener("click", (e) => exitToFlowchart(e.currentTarget));
    $("chapterHelpBtn").addEventListener("click", () => {
        if (typeof currentView === "number") openIntroCard(CHAPTERS[currentView].id);
    });
    $("flowchartHelpBtn").addEventListener("click", () => openIntroCard("flowchart"));
    $("newInputBtn").addEventListener("click", returnToOverview);
    showOverview();
    updateNavbar();
}
