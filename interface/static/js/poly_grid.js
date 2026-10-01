// 256-cell coefficient grid used by every CKKS deep-dive step. Each cell
// first shows its KaTeX equation in a floating overlay (absolutely
// positioned, so it never resizes the grid's columns), then settles to its
// value. Coefficients may be decimal strings (exact BigInt values past 2^53):
// a cell shows a short form, and the readout under the controls shows the
// exact value of the cell being revealed or stepped to.
//
// Returns a controller { play, pause, stepCell(±1), restart, done, onChange }.
// `done` resolves when every cell is revealed (or the grid leaves the DOM);
// the Scrubber's autoplay waits on it. grid_controls.js draws the buttons.
//
// Pace comes from window.gridSpeed (1..10, the grid's own speed dial):
// per-cell delay is 300ms * 0.6^(speed-1). The first row (16 cells) is
// revealed 4x slower so the equations are readable before the rest fills in.
const POLY_GRID_COLS = 16;

function polyRevealDelay(i) {
    const base = 300 * Math.pow(0.6, (window.gridSpeed || 5) - 1);
    return Math.max(4, i < POLY_GRID_COLS ? base * 4 : base);
}

// 2 significant digits for long integers: "-3.6e15". Exact value in title/readout.
function polyShort(v) {
    if (typeof v === "number" && !Number.isInteger(v)) return v.toFixed(2);
    const s = String(v), neg = s[0] === "-", d = neg ? s.slice(1) : s;
    return d.length <= 5 ? s : `${neg ? "−" : ""}${d[0]}.${d[1]}e${d.length - 1}`;
}

function renderPolyGrid(containerEl, coeffs, equations, options) {
    options = options || {};
    const n = coeffs.length;
    containerEl.innerHTML = `<div class="grid-ctl"></div><div class="poly-readout"></div>`;
    // The host sits in a centered flex column, which would shrink-wrap it;
    // this class gives it the full available width (see poly_grid.css).
    containerEl.classList.add("poly-grid-host");
    const readout = containerEl.querySelector(".poly-readout");
    const scroller = document.createElement("div");
    scroller.className = "poly-grid-scroll";
    const grid = document.createElement("div");
    grid.className = "poly-grid";
    const overlay = document.createElement("div");
    overlay.className = "poly-eq-overlay";
    const cells = coeffs.map((v, i) => {
        const cell = document.createElement("div");
        cell.className = "poly-cell";
        cell.title = `${options.name || "c"}[${i}] = ${v}`;
        grid.appendChild(cell);
        return cell;
    });
    grid.appendChild(overlay);
    scroller.appendChild(grid);
    containerEl.appendChild(scroller);

    let next = 0;        // cells revealed so far
    let cursor = -1;     // cell under the pointer
    let playing = false;
    let timer = null;
    let resolveDone;
    const ctrl = { done: new Promise((r) => { resolveDone = r; }), onChange: null };
    const changed = () => ctrl.onChange && ctrl.onChange({ playing, cursor, revealed: next, total: n });

    const showValue = (i) => { cells[i].textContent = polyShort(coeffs[i]); };

    function point(i) {
        cells.forEach((c) => c.classList.remove("active"));
        cursor = i;
        const cell = cells[i];
        cell.classList.add("active");
        // Anchor the overlay over the cell, clamped inside the grid: below it
        // in the top half, above it in the bottom half.
        const col = i % POLY_GRID_COLS;
        const lowerHalf = Math.floor(i / POLY_GRID_COLS) >= n / POLY_GRID_COLS / 2;
        overlay.style.display = "block";
        overlay.style.top = lowerHalf ? "" : `${cell.offsetTop + cell.offsetHeight + 4}px`;
        overlay.style.bottom = lowerHalf ? `${grid.clientHeight - cell.offsetTop + 4}px` : "";
        overlay.style.left = col < POLY_GRID_COLS / 2 ? `${cell.offsetLeft}px` : "";
        overlay.style.right = col < POLY_GRID_COLS / 2 ? "" : `${grid.clientWidth - cell.offsetLeft - cell.offsetWidth}px`;
        const eq = (equations && equations[i]) || "";
        if (window.katex) {
            try { katex.render(eq, overlay, { throwOnError: false, displayMode: false }); }
            catch (e) { overlay.textContent = eq; }
        } else {
            overlay.textContent = eq;
        }
        readout.textContent = `${options.name || "c"}[${i}] = ${i < next ? coeffs[i] : "…"}`;
        changed();
    }

    function complete(flash) {
        playing = false;
        overlay.style.display = "none";
        cells.forEach((c) => c.classList.remove("active"));
        if (flash) {
            cells.forEach((c, idx) => setTimeout(() => {
                c.classList.add("highlight");
                setTimeout(() => c.classList.remove("highlight"), 300);
            }, idx * 4));
        }
        resolveDone();
        changed();
    }

    function tick() {
        if (!grid.isConnected) { playing = false; resolveDone(); return; }
        if (next >= n) { complete(true); return; }
        point(next);
        timer = setTimeout(() => {
            showValue(next);
            next++;
            readout.textContent = `${options.name || "c"}[${next - 1}] = ${coeffs[next - 1]}`;
            if (playing) tick();
        }, polyRevealDelay(next));
    }

    ctrl.play = () => {
        if (playing || next >= n) return;
        playing = true;
        tick();
    };
    ctrl.pause = () => {
        playing = false;
        clearTimeout(timer);
        changed();
    };
    ctrl.stepCell = (dir) => {
        ctrl.pause();
        if (dir < 0) { if (cursor > 0) point(cursor - 1); return; }
        if (cursor < next - 1) { point(cursor + 1); return; }
        if (next >= n) return;
        showValue(next);
        next++;
        point(next - 1);
        if (next >= n) complete(false);
    };
    ctrl.restart = () => {
        ctrl.pause();
        cells.forEach((c) => { c.textContent = ""; });
        next = 0;
        cursor = -1;
        ctrl.play();
    };

    if (typeof createGridControls === "function") createGridControls(containerEl.querySelector(".grid-ctl"), ctrl);
    if (options.skipAnimation) {
        cells.forEach((_, i) => showValue(i));
        next = n;
        readout.textContent = `${n} coefficients · step ‹ › to read any one exactly`;
        complete(false);
    } else {
        ctrl.play();
    }
    return ctrl;
}
