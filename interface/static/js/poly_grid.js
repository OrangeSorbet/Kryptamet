// 256-cell coefficient grid used by every CKKS deep-dive step. Cells reveal
// one at a time with their KaTeX equation in a popup (cell_formula.js), then
// settle to their value; once revealed, hovering any cell shows its equation
// and exact value again. Coefficients may be decimal strings (exact BigInt
// values past 2^53): a cell shows a short form, the readout under the
// controls and the popup show the exact value.
//
// Returns the reveal controller (reveal_controller.js): { play, pause,
// stepCell(±1), restart, done, onChange }. `done` resolves when every cell is
// revealed (or the grid leaves the DOM); the Scrubber's autoplay waits on it.
// Pace: window.gridSpeed; the first row (16 cells) is revealed 4x slower.
const POLY_GRID_COLS = 16;

// 2 significant digits for long integers: "-3.6e15". The exact value is in the readout and the popup.
function polyShort(v) {
    if (typeof v === "number" && !Number.isInteger(v)) return v.toFixed(2);
    const s = String(v), neg = s[0] === "-", d = neg ? s.slice(1) : s;
    return d.length <= 5 ? s : `${neg ? "−" : ""}${d[0]}.${d[1]}e${d.length - 1}`;
}

function renderPolyGrid(containerEl, coeffs, equations, options) {
    options = options || {};
    const n = coeffs.length, name = options.name || "c";
    containerEl.innerHTML = `<div class="grid-ctl"></div><div class="poly-readout"></div>`;
    // The host sits in a centered flex column, which would shrink-wrap it;
    // this class gives it the full available width (see poly_grid.css).
    containerEl.classList.add("poly-grid-host");
    const readout = containerEl.querySelector(".poly-readout");
    const scroller = document.createElement("div");
    scroller.className = "poly-grid-scroll";
    const grid = document.createElement("div");
    grid.className = "poly-grid";
    const cells = coeffs.map((_, i) => {
        const cell = document.createElement("div");
        cell.className = "poly-cell";
        cell.dataset.i = i;
        grid.appendChild(cell);
        return cell;
    });
    scroller.appendChild(grid);
    containerEl.appendChild(scroller);

    const pop = createFormulaPop();
    const eqOf = (i) => (equations && equations[i]) || "";
    const exact = (i) => `${name}[${i}] = ${coeffs[i]}`;
    let shown = 0;
    const ctrl = createRevealController({
        count: n,
        delay: (i) => gridRevealDelay(i, POLY_GRID_COLS),
        show: (i) => { cells[i].textContent = polyShort(coeffs[i]); shown = i + 1; readout.textContent = exact(i); },
        point: (i) => {
            cells.forEach((c) => c.classList.remove("active"));
            cells[i].classList.add("active");
            pop.show(cells[i], eqOf(i), i < shown ? exact(i) : null);
            readout.textContent = i < shown ? exact(i) : `${name}[${i}] = …`;
        },
        clear: () => { cells.forEach((c) => { c.textContent = ""; }); shown = 0; pop.hide(); },
        finish: (flash) => {
            pop.hide();
            cells.forEach((c) => c.classList.remove("active"));
            if (flash) {
                cells.forEach((c, idx) => setTimeout(() => {
                    c.classList.add("highlight");
                    setTimeout(() => c.classList.remove("highlight"), 300);
                }, idx * 4));
            }
            if (!flash) readout.textContent = `${n} coefficients · hover any cell for its equation and exact value`;
        },
        alive: () => grid.isConnected,
        skip: options.skipAnimation,
    });
    attachFormulaHover(grid, ".poly-cell", (cell) => {
        const i = +cell.dataset.i;
        return i < shown ? { tex: eqOf(i), note: exact(i) } : null;
    });
    createGridControls(containerEl.querySelector(".grid-ctl"), ctrl);
    return ctrl.start();
}
