// 256-cell coefficient grid used by every CKKS deep-dive step. Each cell
// first shows its KaTeX equation in a floating overlay (absolutely
// positioned, so it never resizes the grid's columns), then settles to its
// numeric value. Returns a Promise that resolves when the reveal finishes --
// the Scrubber's autoplay waits on it. If the grid is removed from the DOM
// mid-reveal (the user moved to another step), the reveal stops quietly.
//
// Pace comes from window.gridRevealSpeed (1..10): per-cell delay is
// 300ms * 0.6^(speed-1). The first row (16 cells) is revealed 4x slower so
// the equations are readable before the rest fills in quickly.
const POLY_GRID_COLS = 16;

function polyRevealDelay(i) {
    const base = 300 * Math.pow(0.6, (window.gridRevealSpeed || 5) - 1);
    return Math.max(4, i < POLY_GRID_COLS ? base * 4 : base);
}

function renderPolyGrid(containerEl, coeffs, equations, options) {
    options = options || {};
    containerEl.innerHTML = "";
    // The host sits in a centered flex column, which would shrink-wrap it;
    // this class gives it the full available width (see poly_grid.css).
    containerEl.classList.add("poly-grid-host");
    const scroller = document.createElement("div");
    scroller.className = "poly-grid-scroll";
    const grid = document.createElement("div");
    grid.className = "poly-grid";
    const overlay = document.createElement("div");
    overlay.className = "poly-eq-overlay";
    const cells = coeffs.map(() => {
        const cell = document.createElement("div");
        cell.className = "poly-cell";
        grid.appendChild(cell);
        return cell;
    });
    grid.appendChild(overlay);
    scroller.appendChild(grid);
    containerEl.appendChild(scroller);

    function showValue(cell, v) {
        cell.textContent = typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : v;
        cell.title = cell.textContent;
    }

    function finish() {
        overlay.style.display = "none";
        if (options.onDone) options.onDone();
    }

    if (options.skipAnimation) {
        cells.forEach((cell, i) => showValue(cell, coeffs[i]));
        finish();
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        let i = 0;
        function revealNext() {
            if (!grid.isConnected) { resolve(); return; }
            if (i >= cells.length) {
                cells.forEach((c, idx) => {
                    setTimeout(() => {
                        c.classList.add("highlight");
                        setTimeout(() => c.classList.remove("highlight"), 300);
                    }, idx * 4);
                });
                finish();
                resolve();
                return;
            }
            const cell = cells[i];
            const eq = (equations && equations[i]) || "";
            cell.classList.add("active");
            // Anchor the overlay over the active cell, clamped inside the grid.
            // Below the cell in the top half, above it in the bottom half, so
            // it never spills past the grid's edge.
            const col = i % POLY_GRID_COLS;
            const lowerHalf = Math.floor(i / POLY_GRID_COLS) >= cells.length / POLY_GRID_COLS / 2;
            overlay.style.display = "block";
            overlay.style.top = lowerHalf ? "" : `${cell.offsetTop + cell.offsetHeight + 4}px`;
            overlay.style.bottom = lowerHalf ? `${grid.clientHeight - cell.offsetTop + 4}px` : "";
            overlay.style.left = col < POLY_GRID_COLS / 2 ? `${cell.offsetLeft}px` : "";
            overlay.style.right = col < POLY_GRID_COLS / 2 ? "" : `${grid.clientWidth - cell.offsetLeft - cell.offsetWidth}px`;
            if (window.katex) {
                try { katex.render(eq, overlay, { throwOnError: false, displayMode: false }); }
                catch (e) { overlay.textContent = eq; }
            } else {
                overlay.textContent = eq;
            }
            setTimeout(() => {
                cell.classList.remove("active");
                showValue(cell, coeffs[i]);
                i++;
                revealNext();
            }, polyRevealDelay(i));
        }
        revealNext();
    });
}
