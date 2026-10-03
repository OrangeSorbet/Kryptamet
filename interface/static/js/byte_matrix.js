// Generic byte/word matrix: a sibling of poly_grid.js for hex data (key
// bytes, SHA-256 words, AES state). Cells reveal one at a time (or one row
// at a time with revealBy: "row") with the unit's KaTeX equation in a popup
// (cell_formula.js), then settle to their value; hovering any revealed cell
// shows its equation again. Animated matrices get the same controls as the
// CKKS grids (grid_controls.js + reveal_controller.js, pace window.gridSpeed).
// Returns a Promise that resolves when the reveal finishes (the Scrubber's
// autoplay waits on it); the reveal stops quietly if the matrix is detached.
//
// renderByteMatrix(containerEl, cells, {
//     cols: 8,                       // cells per row
//     rowLabels: ["t=0", ...],       // optional, one per row
//     colLabels: ["a", ...],         // optional, one per column
//     cellClass: (i) => "bm-salt",   // optional extra class per cell
//     title: (i) => "...",           // optional plain note per cell, shown under its equation
//     equation: (unit) => "KaTeX",   // unit = cell index, or row index when revealBy "row"
//     revealBy: "cell" | "row",
//     skipAnimation: bool,
// })
// Pace: cell mode first row 4x slower; row mode each row 2x base, first row 8x.
const bytesOfHex = (hex) => String(hex).match(/../g) || [];

function renderByteMatrix(containerEl, cells, options) {
    // A chained reveal can outlive its step (user moved on): nothing to draw.
    if (!containerEl || !containerEl.isConnected) return Promise.resolve();
    const o = options || {};
    const cols = o.cols || 8;
    const byRow = o.revealBy === "row";
    const rows = Math.ceil(cells.length / cols);
    containerEl.innerHTML = "";
    containerEl.classList.add("byte-matrix-host");

    const make = (cls, text) => {
        const d = document.createElement("div");
        d.className = cls;
        if (text !== undefined) d.textContent = text;
        return d;
    };
    const bar = make("grid-ctl");
    const scroller = make("byte-matrix-scroll");
    const grid = make("byte-matrix");
    // Each column as wide as its own widest value, so one long number doesn't widen every column.
    const colWidth = (c) => Math.max(2, ...cells.filter((_, i) => i % cols === c).map((v) => String(v).length));
    grid.style.gridTemplateColumns = `${o.rowLabels ? "auto " : ""}${Array.from({ length: cols }, (_, c) => `minmax(${colWidth(c) + 1.6}ch, auto)`).join(" ")}`;

    if (o.colLabels) {
        if (o.rowLabels) grid.appendChild(make("bm-label"));
        o.colLabels.forEach((l) => grid.appendChild(make("bm-label bm-col-label", l)));
    }
    const cellEls = [];
    for (let r = 0; r < rows; r++) {
        if (o.rowLabels) grid.appendChild(make("bm-label bm-row-label", o.rowLabels[r] ?? ""));
        for (let c = 0; c < cols; c++) {
            const i = r * cols + c;
            if (i >= cells.length) break;
            const cell = make("bm-cell" + (o.cellClass ? " " + (o.cellClass(i) || "") : ""));
            cell.dataset.i = i;
            grid.appendChild(cell);
            cellEls.push(cell);
        }
    }
    scroller.appendChild(grid);
    if (!o.skipAnimation) containerEl.appendChild(bar);
    containerEl.appendChild(scroller);

    const unitOf = (i) => (byRow ? Math.floor(i / cols) : i);
    const unitCells = (u) => (byRow ? cellEls.slice(u * cols, u * cols + cols) : [cellEls[u]]);
    const eqOf = (u) => (o.equation ? o.equation(u) : "");
    const noteOf = (i) => (o.title ? o.title(i) : null);
    const pop = createFormulaPop();
    let shown = 0;

    const ctrl = createRevealController({
        count: byRow ? rows : cellEls.length,
        delay: (u) => (byRow ? gridRevealDelay(u, 1, 4, 600) : gridRevealDelay(u, cols)),
        show: (u) => { unitCells(u).forEach((c) => { c.textContent = cells[+c.dataset.i]; }); shown = u + 1; },
        point: (u) => {
            cellEls.forEach((c) => c.classList.remove("active"));
            const group = unitCells(u);
            group.forEach((c) => c.classList.add("active"));
            pop.show(group[0], eqOf(u), byRow ? null : noteOf(u));
            // Tall matrices sit in a height-capped scroller: keep the active unit in view.
            if (scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop = group[0].offsetTop - scroller.clientHeight / 2;
        },
        clear: () => { cellEls.forEach((c) => { c.textContent = ""; }); shown = 0; pop.hide(); },
        finish: (flash) => {
            pop.hide();
            cellEls.forEach((c) => c.classList.remove("active"));
            if (flash) {
                cellEls.forEach((c, idx) => setTimeout(() => {
                    c.classList.add("flash");
                    setTimeout(() => c.classList.remove("flash"), 300);
                }, idx * 3));
            }
        },
        alive: () => grid.isConnected,
        skip: o.skipAnimation,
    });
    attachFormulaHover(grid, ".bm-cell", (cell) => {
        const i = +cell.dataset.i, u = unitOf(i);
        return u < shown ? { tex: eqOf(u), note: noteOf(i) || String(cells[i]) } : null;
    });
    if (!o.skipAnimation) createGridControls(bar, ctrl);
    return ctrl.start().done;
}
