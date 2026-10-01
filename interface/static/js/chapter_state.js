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
// Proof badges: per chapter, per step, how many browser checks (.ks-check chips)
// ended ✓ or ✕ while that step was on screen. Pending checks are not counted.
let proofs = {};
let shownStep = null;         // { index, i } of the step currently rendered

function tallyShown() {
    if (!shownStep) return;
    const el = $("sceneContent");
    (proofs[shownStep.index] ||= {})[shownStep.i] = {
        ok: el.querySelectorAll(".ks-check.ok").length,
        bad: el.querySelectorAll(".ks-check.bad").length,
    };
}

function proofOf(index) {
    const steps = Object.values(proofs[index] || {});
    if (!steps.length) return null;
    return steps.reduce((a, s) => ({ ok: a.ok + s.ok, bad: a.bad + s.bad }), { ok: 0, bad: 0 });
}

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
        proof: proofOf,
        lastVisited,
        animateIn,
        onSelect: (i, box) => enterChapter(i, box),
    });
}

function setChapterChrome(visible) {
    ["backToFlowchartBtn", "chapterHelpBtn", "minimapContainer", "scrubberDock"].forEach((id) => { $(id).hidden = !visible; });
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
    tallyShown(); // the step on screen before a minimap jump or re-lock
    shownStep = null;
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
        onEnd: () => goToNextChapter(index),
        nextLabel: nextChapterIndex(index) >= 0 ? CHAPTERS[nextChapterIndex(index)].label : "back to the chapters",
        onStepChange: (i, step) => {
            tallyShown();
            stepIndices[index] = i;
            window.sceneAlreadyVisited = doneChapters.has(index) && !forceReplay;
            forceReplay = false;
            const settled = step.renderVisual(el);
            const here = { index, i };
            shownStep = here;
            Promise.resolve(settled).then(() => { if (shownStep === here) tallyShown(); });
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

function nextChapterIndex(index) {
    for (let j = index + 1; j < CHAPTERS.length; j++) if (chapterEnabled(j)) return j;
    return -1;
}

// Next on a chapter's last step: zoom out to the flowchart, then into the
// next available chapter's box (or stay on the flowchart after the last one).
function goToNextChapter(index) {
    const j = nextChapterIndex(index);
    exitToFlowchart($("backToFlowchartBtn"), j < 0 ? null : () => {
        enterChapter(j, $("flowchartContainer").querySelector(`.fc-box[data-index="${j}"]`) || $("flowchartContainer"));
    });
}

function exitToFlowchart(originEl, then) {
    if (zoomInFlight) return;
    tallyShown();
    shownStep = null;
    currentView = "flowchart";
    if (scrubberInstance) { scrubberInstance.destroy(); scrubberInstance = null; }
    zoomUnits({
        fromEl: $("chapterUnit"),
        toEl: $("flowchartUnit"),
        origin: originOf(originEl),
        direction: "out",
        buildTo: () => renderFlowchart($("flowchartContainer"), false),
        onDone: () => { hideChapterChrome(); updateNavbar(); if (then) then(); },
    });
}

let overviewForm = null;

function showOverview() {
    const el = $("sceneContent");
    el.classList.remove("chapter-scene", "step-fade-in");
    overviewForm = renderOverviewScene(el, pipelineResult && { model: pipelineResult.model, input: pipelineResult.input });
}

function returnToOverview() {
    if (zoomInFlight || currentView === "overview") return;
    tallyShown();
    shownStep = null;
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
        onDone: () => { updateNavbar(); if (overviewForm) overviewForm.focus(); },
    });
}

function updateNavbar() {
    const info = $("navbarRunInfo");
    const onOverview = currentView === "overview";
    $("newInputBtn").hidden = !(pipelineResult && !onOverview);
    $("flowchartHelpBtn").hidden = currentView !== "flowchart";
    if (pipelineResult && !onOverview) {
        info.textContent = `${pipelineResult.model} · ${inputSummary(pipelineResult)}`;
        info.title = info.textContent;
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
window.onRunRequested = async (model, input) => {
    const r = await runPipeline(model, input, "");
    if (!r.ok) return r;
    ckksDeepDiveResult = await fetchCkksDeepDive(model, input);
    doneChapters = new Set();
    stepIndices = {};
    proofs = {};
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
