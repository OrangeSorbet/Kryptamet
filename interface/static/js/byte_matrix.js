// Generic byte/word matrix: a sibling of poly_grid.js for hex data (key
// bytes, SHA-256 words, AES state). Cells reveal one at a time (or one row
// at a time with revealBy: "row") with the unit's KaTeX equation in a
// floating overlay, then settle to their value. After the reveal, hovering
// a cell shows its unit's equation again. Returns a Promise that resolves
// when the reveal finishes (the Scrubber's autoplay waits on it); the
// reveal stops quietly if the matrix is detached mid-way.
//
// renderByteMatrix(containerEl, cells, {
//     cols: 8,                       // cells per row
//     rowLabels: ["t=0", ...],       // optional, one per row
//     colLabels: ["a", ...],         // optional, one per column
//     cellClass: (i) => "bm-salt",   // optional extra class per cell
//     title: (i) => "...",           // optional native tooltip per cell
//     equation: (unit) => "KaTeX",   // unit = cell index, or row index when revealBy "row"
//     revealBy: "cell" | "row",
//     skipAnimation: bool,
// })
// Pace: same as poly_grid -- base 300ms * 0.6^(speed-1); first row 4x slower
// in cell mode; in row mode each row takes 2x base (first row 8x).
const bytesOfHex = (hex) => String(hex).match(/../g) || [];

function byteMatrixDelay(unit, cols, byRow) {
    const base = 300 * Math.pow(0.6, (window.stepSpeed || 5) - 1);
    if (byRow) return Math.max(8, unit === 0 ? base * 8 : base * 2);
    return Math.max(4, unit < cols ? base * 4 : base);
}

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
    const scroller = make("byte-matrix-scroll");
    const grid = make("byte-matrix");
    const width = Math.max(2, ...cells.map((c) => String(c).length));
    grid.style.gridTemplateColumns = `${o.rowLabels ? "auto " : ""}repeat(${cols}, minmax(${width + 1.6}ch, 1fr))`;

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
    const overlay = make("bm-eq-overlay");
    grid.appendChild(overlay);
    scroller.appendChild(grid);
    containerEl.appendChild(scroller);

    const unitOf = (i) => (byRow ? Math.floor(i / cols) : i);
    const unitCells = (u) => (byRow ? cellEls.slice(u * cols, u * cols + cols) : [cellEls[u]]);
    const unitCount = byRow ? rows : cellEls.length;

    function showValue(i) {
        const cell = cellEls[i];
        cell.textContent = cells[i];
        cell.title = o.title ? o.title(i) : String(cells[i]);
    }

    function placeOverlay(u) {
        const eq = o.equation ? o.equation(u) : "";
        if (!eq) { overlay.style.display = "none"; return; }
        const anchor = unitCells(u)[0];
        const r = byRow ? u : Math.floor(u / cols);
        const lowerHalf = r >= rows / 2 && rows > 1;
        overlay.style.display = "block";
        overlay.style.top = lowerHalf ? "" : `${anchor.offsetTop + anchor.offsetHeight + 4}px`;
        overlay.style.bottom = lowerHalf ? `${grid.clientHeight - anchor.offsetTop + 4}px` : "";
        const leftHalf = byRow || u % cols < cols / 2;
        overlay.style.left = leftHalf ? `${byRow ? 3 : anchor.offsetLeft}px` : "";
        overlay.style.right = leftHalf ? "" : `${grid.clientWidth - anchor.offsetLeft - anchor.offsetWidth}px`;
        if (window.katex) {
            try { katex.render(eq, overlay, { throwOnError: false, displayMode: false }); return; } catch (e) { /* fall through */ }
        }
        overlay.textContent = eq;
    }

    function enableHover() {
        grid.addEventListener("mouseover", (e) => {
            const cell = e.target.closest(".bm-cell");
            if (!cell) return;
            const u = unitOf(+cell.dataset.i);
            grid.querySelectorAll(".bm-cell.hover").forEach((c) => c.classList.remove("hover"));
            unitCells(u).forEach((c) => c.classList.add("hover"));
            placeOverlay(u);
        });
        grid.addEventListener("mouseleave", () => {
            overlay.style.display = "none";
            grid.querySelectorAll(".bm-cell.hover").forEach((c) => c.classList.remove("hover"));
        });
    }

    if (o.skipAnimation) {
        cellEls.forEach((_, i) => showValue(i));
        enableHover();
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        let u = 0;
        function revealNext() {
            if (!grid.isConnected) { resolve(); return; }
            if (u >= unitCount) {
                overlay.style.display = "none";
                cellEls.forEach((c, idx) => setTimeout(() => {
                    c.classList.add("flash");
                    setTimeout(() => c.classList.remove("flash"), 300);
                }, idx * 3));
                enableHover();
                resolve();
                return;
            }
            const group = unitCells(u);
            group.forEach((c) => c.classList.add("active"));
            placeOverlay(u);
            // Tall matrices sit in a height-capped scroller: keep the active unit centred.
            if (scroller.scrollHeight > scroller.clientHeight) {
                scroller.scrollTop = group[0].offsetTop - scroller.clientHeight / 2;
            }
            setTimeout(() => {
                group.forEach((c) => { c.classList.remove("active"); showValue(+c.dataset.i); });
                u++;
                revealNext();
            }, byteMatrixDelay(u, cols, byRow));
        }
        revealNext();
    });
}
