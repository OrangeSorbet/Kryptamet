// Draggable step track with chapter tick marks + hover tooltip, ported from
// Snek's StepSlider.tsx. `chapters` is an optional array of
// { start, end, label } sub-groupings within the current chapter's steps
// (e.g. Computation splits into "weight multiplies" / "bias" / "vectorized
// compute" bands). The visible track is 4px; the hit area around it is 16px.
function createStepSlider(containerEl, { total, current, chapters, onSeek }) {
    chapters = chapters || [];
    let shown = current;
    containerEl.innerHTML = `
        <div class="step-slider-tooltip" hidden></div>
        <div class="step-slider-hit">
            <div class="step-slider-track">
                <div class="step-slider-fill"></div>
                <div class="step-slider-thumb"></div>
            </div>
        </div>
    `;
    const tooltip = containerEl.querySelector(".step-slider-tooltip");
    const hit = containerEl.querySelector(".step-slider-hit");
    const track = containerEl.querySelector(".step-slider-track");
    const fill = containerEl.querySelector(".step-slider-fill");
    const thumb = containerEl.querySelector(".step-slider-thumb");

    chapters.forEach((c) => {
        if (c.start === 0) return; // a tick at the very start marks nothing
        const tick = document.createElement("div");
        tick.className = "step-slider-tick";
        tick.style.left = `${(c.start / Math.max(1, total - 1)) * 100}%`;
        track.appendChild(tick);
    });

    function indexFromClientX(clientX) {
        const rect = track.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        return Math.round(ratio * (total - 1));
    }

    function chapterAt(index) {
        return chapters.find((c) => index >= c.start && index <= c.end) || null;
    }

    function render(index) {
        shown = index;
        const progress = total > 1 ? index / (total - 1) : 0;
        fill.style.width = `${progress * 100}%`;
        thumb.style.left = `${progress * 100}%`;
    }

    function seekTo(idx) {
        if (idx !== shown) onSeek(idx);
    }

    hit.addEventListener("pointerdown", (e) => {
        hit.setPointerCapture?.(e.pointerId);
        seekTo(indexFromClientX(e.clientX));
    });
    hit.addEventListener("pointermove", (e) => {
        const idx = indexFromClientX(e.clientX);
        const chap = chapterAt(idx);
        tooltip.hidden = false;
        tooltip.textContent = `Step ${idx + 1}` + (chap ? ` · ${chap.label}` : "");
        tooltip.style.left = `${e.clientX - track.getBoundingClientRect().left}px`;
        if (e.buttons === 1) seekTo(idx);
    });
    hit.addEventListener("pointerleave", () => { tooltip.hidden = true; });

    render(current);
    return { update: render };
}
