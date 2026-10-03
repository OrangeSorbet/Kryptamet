// Small control bar for one poly grid (poly_grid.js controller): play/pause
// the reveal, step one cell back/forward, restart, and the grid's own speed
// dial (window.gridSpeed). Separate from the Scrubber, which moves whole steps.
function createGridControls(barEl, ctrl) {
    barEl.innerHTML = `
        <button class="scrubber-btn" data-g="play" type="button" aria-label="Play/pause this grid">${scrubberIcon("pause")}</button>
        <button class="scrubber-btn" data-g="prev" type="button" aria-label="Previous cell">${scrubberIcon("prev")}</button>
        <button class="scrubber-btn" data-g="next" type="button" aria-label="Next cell">${scrubberIcon("next")}</button>
        <button class="scrubber-btn" data-g="restart" type="button" aria-label="Replay this grid">${scrubberIcon("restart")}</button>
        <div class="grid-ctl-speed"></div>
        <span class="grid-ctl-pos"></span>`;
    const btn = (g) => barEl.querySelector(`[data-g="${g}"]`);
    const pos = barEl.querySelector(".grid-ctl-pos");
    createSpeedDial(barEl.querySelector(".grid-ctl-speed"), { key: "gridSpeed", storage: "kryptamet.gridSpeed", label: "Grid reveal speed" });
    let playing = true;
    btn("play").addEventListener("click", () => (playing ? ctrl.pause() : ctrl.play()));
    btn("prev").addEventListener("click", () => ctrl.stepCell(-1));
    btn("next").addEventListener("click", () => ctrl.stepCell(1));
    btn("restart").addEventListener("click", () => ctrl.restart());
    ctrl.onChange = (st) => {
        playing = st.playing;
        btn("play").innerHTML = scrubberIcon(st.playing ? "pause" : "play");
        btn("play").disabled = !st.playing && st.revealed >= st.total;
        pos.textContent = `${st.revealed} / ${st.total}`;
    };
}
