// Play / pause / step / restart engine shared by every animated matrix
// (poly_grid.js, byte_matrix.js, the Encryption slot grid). The matrix
// supplies:
//   count       number of units (cells, rows or groups) to reveal
//   delay(u)    ms to show unit u before moving on (from window.gridSpeed)
//   show(u)     reveal unit u for good
//   point(u)    put the cursor on unit u (highlight + its formula)
//   clear()     hide every unit again (restart)
//   finish(f)   everything revealed; f = true after a played-through reveal
//   alive()     false once the matrix left the page (stops quietly)
//   skip        reveal everything at once (chapter already watched)
// Returns { play, pause, stepCell(±1), restart, revealed(), done, onChange };
// grid_controls.js draws the buttons, `done` is what the Scrubber waits on.
function createRevealController(m) {
    let next = 0, cursor = -1, playing = false, timer = null, resolveDone;
    const ctrl = { done: new Promise((r) => { resolveDone = r; }), onChange: null };
    const changed = () => ctrl.onChange && ctrl.onChange({ playing, cursor, revealed: next, total: m.count });
    const moveTo = (u) => { cursor = u; m.point(u); changed(); };
    const complete = (flash) => { playing = false; m.finish(flash); resolveDone(); changed(); };

    function tick() {
        if (!m.alive()) { playing = false; resolveDone(); return; }
        if (next >= m.count) { complete(true); return; }
        moveTo(next);
        timer = setTimeout(() => {
            m.show(next);
            next++;
            if (playing) tick(); else changed();
        }, m.delay(next));
    }

    ctrl.play = () => { if (playing || next >= m.count) return; playing = true; tick(); };
    ctrl.pause = () => { playing = false; clearTimeout(timer); changed(); };
    ctrl.stepCell = (dir) => {
        ctrl.pause();
        if (dir < 0) { if (cursor > 0) moveTo(cursor - 1); return; }
        if (cursor < next - 1) { moveTo(cursor + 1); return; }
        if (next >= m.count) return;
        m.show(next);
        next++;
        moveTo(next - 1);
        if (next >= m.count) complete(false);
    };
    ctrl.restart = () => { ctrl.pause(); m.clear(); next = 0; cursor = -1; ctrl.play(); };
    ctrl.revealed = () => next;
    ctrl.start = () => {
        if (m.skip) { while (next < m.count) m.show(next++); complete(false); } else ctrl.play();
        return ctrl;
    };
    return ctrl;
}

// Per-unit delay for the grid speed dial (1..10): base 300 ms × 0.6^(speed-1), the first `slowFirst` units
// `factor`× slower so the first formulas are readable before the rest speeds up.
function gridRevealDelay(u, slowFirst, factor = 4, base = 300) {
    const ms = base * Math.pow(0.6, (window.gridSpeed || 5) - 1);
    return Math.max(4, u < slowFirst ? ms * factor : ms);
}
