// Bottom-docked playback control shared by every chapter's detail view,
// ported from Snek's Scrubber.tsx + ExplanationGrid.tsx: play/pause/prev/next,
// restart, a step counter, the collapsible speed dial (speed_dial.js), a
// fixed-height 2x2 what/why/formal/next explanation grid with glossary
// term-linking (glossary.js), and the step slider (step_slider.js).
// On phones the 2x2 grid becomes one cell at a time behind a tab row.
//
// onStepChange(index, step) may return a Promise (e.g. a poly-grid reveal);
// autoplay waits for it to settle before starting the next step's timer, so
// a step's animation is never cut off mid-way. onEnd (optional) is what Next
// does on the last step: chapter_state.js zooms out and into the next chapter
// (`nextLabel` names it in the button's tooltip).
const SCRUBBER_ICONS = {
    play: '<path d="M8 5v14l11-7z"/>',
    pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
    prev: '<path d="M18 6v12l-8.5-6zM6 6h2v12H6z"/>',
    next: '<path d="M6 6v12l8.5-6zM16 6h2v12h-2z"/>',
    restart: '<path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/>',
};
const scrubberIcon = (name) => `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">${SCRUBBER_ICONS[name]}</svg>`;

const EXPLANATION_CELLS = [
    { key: "what", title: "What happened", short: "What" },
    { key: "why", title: "Why", short: "Why" },
    { key: "formal", title: "Formal notation", short: "Formal", mono: true },
    { key: "next", title: "What's next", short: "Next" },
];

function createScrubber(containerEl, { steps, chapters, meta, onStepChange, onRestart, onEnd, nextLabel }) {
    let index = 0;
    let playing = false;
    let timer = null;
    let playToken = 0; // bumped on every stop, so a stale awaited step can't reschedule
    let settledNow;    // what the current step's onStepChange returned (its animation)

    containerEl.innerHTML = `
        <div class="scrubber-controls">
            <button class="scrubber-btn" data-act="play" type="button" title="Play/pause (Space)">${scrubberIcon("play")}</button>
            <button class="scrubber-btn" data-act="prev" type="button" title="Previous step (&larr;)">${scrubberIcon("prev")}</button>
            <span class="scrubber-counter"></span>
            <button class="scrubber-btn" data-act="next" type="button" title="Next step (&rarr;)">${scrubberIcon("next")}</button>
            <button class="scrubber-btn" data-act="restart" type="button" title="Restart chapter and replay its animation">${scrubberIcon("restart")}</button>
            <div class="scrubber-speed-slot"></div>
            <span class="scrubber-meta"></span>
        </div>
        <div class="explanation-tabs">
            ${EXPLANATION_CELLS.map((c) => `<button type="button" class="explanation-tab" data-tab="${c.key}">${c.short}</button>`).join("")}
        </div>
        <div class="explanation-grid" data-tab="what">
            ${EXPLANATION_CELLS.map((c) => `
                <div class="explanation-cell" data-key="${c.key}">
                    <div class="explanation-title">${c.title}</div>
                    <div class="explanation-text${c.mono ? " explanation-mono" : ""}"></div>
                </div>`).join("")}
        </div>
        <div class="scrubber-slider-slot"></div>
    `;

    const q = (sel) => containerEl.querySelector(sel);
    const playBtn = q('[data-act="play"]');
    const prevBtn = q('[data-act="prev"]');
    const nextBtn = q('[data-act="next"]');
    const counter = q(".scrubber-counter");
    const grid = q(".explanation-grid");
    const textEls = {};
    EXPLANATION_CELLS.forEach((c) => { textEls[c.key] = q(`.explanation-cell[data-key="${c.key}"] .explanation-text`); });
    q(".scrubber-meta").textContent = meta || "";

    createSpeedDial(q(".scrubber-speed-slot"));
    const slider = createStepSlider(q(".scrubber-slider-slot"), {
        total: steps.length,
        current: 0,
        chapters: chapters || [],
        onSeek: (i) => { stop(); seek(i); },
    });

    function setTab(key) {
        grid.dataset.tab = key;
        containerEl.querySelectorAll(".explanation-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === key));
    }
    containerEl.querySelectorAll(".explanation-tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
    setTab("what");

    function stop() {
        playing = false;
        playToken++;
        playBtn.innerHTML = scrubberIcon("play");
        if (timer) clearTimeout(timer);
        timer = null;
    }

    // Autoplay interval: speed 1 -> 4.0s per step, speed 10 -> 0.4s.
    function intervalMs() {
        return (11 - (window.stepSpeed || 5)) * 400;
    }

    function scheduleNext(settled) {
        const token = playToken;
        Promise.resolve(settled).then(() => {
            if (!playing || token !== playToken) return;
            timer = setTimeout(() => {
                if (!playing || token !== playToken) return;
                if (index >= steps.length - 1) { stop(); return; }
                scheduleNext(seek(index + 1));
            }, intervalMs());
        });
    }

    function render() {
        const step = steps[index] || {};
        counter.textContent = `Step ${steps.length ? index + 1 : 0} / ${steps.length}`;
        const seen = new Set();
        EXPLANATION_CELLS.forEach((c) => {
            const text = step[c.key] || "";
            const el = textEls[c.key];
            el.innerHTML = linkGlossaryTerms(text, seen);
            el.parentElement.title = text; // full text on hover when the cell clamps
        });
        grid.classList.remove("step-fade-in");
        void grid.offsetWidth; // restart the fade animation
        grid.classList.add("step-fade-in");
        const atEnd = index >= steps.length - 1;
        prevBtn.disabled = index <= 0;
        nextBtn.disabled = atEnd && !onEnd;
        nextBtn.classList.toggle("scrubber-next-chapter", atEnd && !!onEnd);
        nextBtn.title = atEnd && onEnd ? `Next chapter${nextLabel ? `: ${nextLabel}` : ""} (→)` : "Next step (→)";
        slider.update(index);
    }

    // Returns whatever onStepChange returned (possibly a Promise).
    function seek(i) {
        index = Math.max(0, Math.min(steps.length - 1, i));
        render();
        settledNow = onStepChange ? onStepChange(index, steps[index]) : undefined;
        return settledNow;
    }

    function togglePlay() {
        if (steps.length === 0) return;
        if (playing) { stop(); return; }
        playing = true;
        playToken++;
        playBtn.innerHTML = scrubberIcon("pause");
        if (index >= steps.length - 1) scheduleNext(seek(0));
        else scheduleNext(settledNow); // let a running step animation finish first
    }

    function restart() {
        stop();
        if (onRestart) onRestart();
        seek(0);
    }

    playBtn.addEventListener("click", togglePlay);
    prevBtn.addEventListener("click", () => { stop(); seek(index - 1); });
    // Next on the last step leaves for the next chapter (if the host gave onEnd).
    function forward() {
        stop();
        if (index >= steps.length - 1 && onEnd) onEnd();
        else seek(index + 1);
    }
    nextBtn.addEventListener("click", forward);
    q('[data-act="restart"]').addEventListener("click", restart);

    function onKey(e) {
        if (window.introCardOpen) return;
        const t = e.target;
        if (e.key === " " && t && t.closest && t.closest(".grid-ctl")) return; // Space presses the focused grid button
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
        if (e.key === " ") { togglePlay(); e.preventDefault(); }
        else if (e.key === "ArrowRight") { forward(); e.preventDefault(); }
        else if (e.key === "ArrowLeft") { stop(); seek(index - 1); e.preventDefault(); }
        else if (e.key === "Home") { stop(); seek(0); e.preventDefault(); }
        else if (e.key === "End") { stop(); seek(steps.length - 1); e.preventDefault(); }
    }
    document.addEventListener("keydown", onKey);

    return {
        restart,
        seek: (i) => { stop(); return seek(i); },
        getIndex: () => index,
        destroy: () => { stop(); document.removeEventListener("keydown", onKey); },
    };
}
