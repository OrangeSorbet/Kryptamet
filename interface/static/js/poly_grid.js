function renderPolyGrid(containerEl, coeffs, equations, options) {
    options = options || {};
    containerEl.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "poly-grid";
    const cells = [];

    coeffs.forEach((v, i) => {
        const cell = document.createElement("div");
        cell.className = "poly-cell";
        grid.appendChild(cell);
        cells.push(cell);
    });
    containerEl.appendChild(grid);

    function showValue(cell, v) {
        const display = typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : v;
        cell.textContent = display;
    }

    if (options.skipAnimation) {
        cells.forEach((cell, i) => showValue(cell, coeffs[i]));
        if (options.onDone) options.onDone();
        return;
    }

    let i = 0;
    function revealNext() {
        if (i >= cells.length) {
            cells.forEach((c, idx) => {
                setTimeout(() => {
                    c.classList.add("highlight");
                    setTimeout(() => c.classList.remove("highlight"), 300);
                }, idx * 4);
            });
            if (options.onDone) options.onDone();
            return;
        }
        const cell = cells[i];
        const eq = (equations && equations[i]) || "";
        cell.classList.add("equation-phase");
        cell.innerHTML = '<span class="cell-eq"></span>';
        const eqSpan = cell.querySelector(".cell-eq");
        if (window.katex) {
            try {
                katex.render(eq, eqSpan, { throwOnError: false, displayMode: false });
            } catch (e) {
                eqSpan.textContent = eq;
            }
        } else {
            eqSpan.textContent = eq;
        }

        const speed = window.gridRevealSpeed || 5;
        const delay = Math.max(15, 220 - speed * 20);
        setTimeout(() => {
            cell.classList.remove("equation-phase");
            showValue(cell, coeffs[i]);
            i++;
            revealNext();
        }, delay);
    }
    revealNext();
}