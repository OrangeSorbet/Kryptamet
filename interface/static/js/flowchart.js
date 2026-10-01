// Chapter flowchart, ported from Snek's PhaseFlowchart.tsx: the 9 chapters
// as boxes in a "snake" layout (row 1 left->right, row 2 right->left) joined
// by arrow connectors, so the pipeline reads as a pipeline instead of a
// card list. Phones get a single column. The chart is sized once in fixed
// pixels, then scaled down (never up) to fit the pane.
//
// A connector lights up (with a dot travelling along it) once the chapter
// it leaves is done. Box states: done (green + ✓), last-visited (glow),
// disabled (no inference yet).
const FLOWCHART_PHONE_QUERY = "(max-width: 640px)";

function flowchartGeometry(count, phone) {
    const g = phone
        ? { boxW: 260, boxH: 84, gapX: 0, gapY: 22, cols: 1 }
        : { boxW: 184, boxH: 124, gapX: 40, gapY: 56, cols: Math.ceil(count / 2) };
    const rows = Math.ceil(count / g.cols);
    g.width = g.cols * g.boxW + (g.cols - 1) * g.gapX;
    g.height = rows * g.boxH + (rows - 1) * g.gapY;
    return g;
}

function flowchartCell(i, g) {
    const row = Math.floor(i / g.cols);
    const col = row % 2 === 0 ? i % g.cols : g.cols - 1 - (i % g.cols);
    return { x: col * (g.boxW + g.gapX), y: row * (g.boxH + g.gapY) };
}

function flowchartConnectorHtml(i, g, done) {
    const a = flowchartCell(i, g);
    const b = flowchartCell(i + 1, g);
    const down = a.x === b.x;
    const left = b.x < a.x;
    const dir = down ? "down" : left ? "left" : "right";
    const box = down
        ? { left: a.x + g.boxW / 2 - 12, top: a.y + g.boxH, width: 24, height: g.gapY }
        : { left: Math.min(a.x, b.x) + g.boxW, top: a.y + g.boxH / 2 - 12, width: g.gapX, height: 24 };
    return `
        <div class="fc-connector fc-${dir}${done ? " done" : ""}" data-geo="${box.left},${box.top},${box.width},${box.height}">
            <div class="fc-line"></div>
            <svg class="fc-arrow" width="9" height="9" viewBox="0 0 10 10"><path d="M0 0 L10 5 L0 10 Z"/></svg>
            ${done ? '<span class="fc-travel-dot"></span>' : ""}
        </div>`;
}

// opts: { chapters, enabled(i), stepCount(i), summary(i), done:Set, proof(i) -> {ok, bad}|null, lastVisited,
//         animateIn, onSelect(i, boxEl) }
// "✓ 23 browser checks" / "✕ 1 of 24 failed": checks your browser ran in that chapter.
function proofBadge(p) {
    if (!p || !(p.ok + p.bad)) return "";
    const n = p.ok + p.bad;
    return p.bad
        ? ` · <span class="fc-proof bad" title="Browser checks that failed while you watched this chapter">✕ ${p.bad} of ${n} failed</span>`
        : ` · <span class="fc-proof ok" title="Checks your browser recomputed while you watched this chapter">✓ ${n} browser check${n === 1 ? "" : "s"}</span>`;
}

function renderFlowchartInto(el, opts) {
    const n = opts.chapters.length;
    const doneCount = opts.chapters.filter((_, i) => opts.done.has(i)).length;
    el.innerHTML = `
        <div class="fc-header">
            <div class="scene-title">Choose a chapter</div>
            <div class="fc-subtitle">${doneCount} of ${n} chapters watched · click a box to zoom in</div>
        </div>
        <div class="fc-stage"><div class="fc-chart${opts.animateIn ? " fc-animate-in" : ""}"></div></div>
    `;
    const stage = el.querySelector(".fc-stage");
    const chart = el.querySelector(".fc-chart");

    function layout() {
        const phone = window.matchMedia(FLOWCHART_PHONE_QUERY).matches;
        const g = flowchartGeometry(n, phone);
        let html = "";
        for (let i = 0; i < n - 1; i++) html += flowchartConnectorHtml(i, g, opts.done.has(i));
        opts.chapters.forEach((c, i) => {
            const { x, y } = flowchartCell(i, g);
            const enabled = opts.enabled(i);
            const done = opts.done.has(i);
            const cls = ["fc-box", done ? "done" : "", i === opts.lastVisited ? "last" : "", enabled ? "" : "disabled"].join(" ");
            const steps = opts.stepCount(i);
            html += `
                <button type="button" class="${cls}" data-index="${i}" ${enabled ? "" : "disabled"} data-geo="${x},${y},${g.boxW},${g.boxH}">
                    <span class="fc-index">${i + 1}${done ? ' <span class="fc-check">&#10003;</span>' : ""}</span>
                    <span class="fc-label">${escapeHtml(c.label)}</span>
                    <span class="fc-summary">${enabled ? escapeHtml(opts.summary(i) || "") : "run inference first"}</span>
                    ${enabled && steps != null ? `<span class="fc-steps">${steps} step${steps === 1 ? "" : "s"}${proofBadge(opts.proof && opts.proof(i))}</span>` : ""}
                </button>`;
        });
        chart.innerHTML = html;
        // Geometry is computed per layout, so it is applied here rather than as style attributes.
        chart.querySelectorAll("[data-geo]").forEach((node) => {
            const [l, t, w, h] = node.dataset.geo.split(",");
            Object.assign(node.style, { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${h}px` });
            if (node.dataset.index) node.style.setProperty("--i", node.dataset.index);
        });
        chart.style.width = g.width + "px";
        chart.style.height = g.height + "px";
        chart.querySelectorAll(".fc-box:not([disabled])").forEach((box) => {
            box.addEventListener("click", () => opts.onSelect(Number(box.dataset.index), box));
        });
        fit(g);
    }

    function fit(g) {
        const pad = 16;
        const w = stage.clientWidth - 2 * pad;
        const h = stage.clientHeight - 2 * pad;
        if (w <= 0 || h <= 0) return;
        const scale = Math.min(1, w / g.width, h / g.height);
        chart.style.transform = `translate(-50%, -50%) scale(${scale})`;
    }

    // Re-layout on resize (also switches snake <-> column across the phone
    // breakpoint). Disconnects itself once this flowchart is replaced.
    let lastPhone = null;
    const ro = new ResizeObserver(() => {
        if (!chart.isConnected) { ro.disconnect(); return; }
        const phone = window.matchMedia(FLOWCHART_PHONE_QUERY).matches;
        if (phone !== lastPhone) { lastPhone = phone; layout(); }
        else fit(flowchartGeometry(n, phone));
    });
    ro.observe(stage);
    layout();
}
