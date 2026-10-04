// Formula popups for matrix and grid cells. Each popup is a fixed-position
// element on <body>, placed from the cell's on-screen rectangle, so no scroll
// box, CSS zoom or overflow can clip it. One shared popup serves hovering
// (attachFormulaHover); every animated matrix gets its own (createFormulaPop),
// since several can reveal at once. chapter_state.js calls clearFormulaPops()
// on every step change.
const formulaPops = new Set();
let hoverPop = null;

function createFormulaPop() {
    const el = document.createElement("div");
    el.className = "formula-pop";
    el.hidden = true;
    document.body.appendChild(el);
    const pop = {
        el,
        // note: the actual value, as plain text (shown first, large); tex: KaTeX of what that value is /
        // how it is made (shown just below it).
        // plain: a plain-text line instead of tex (used by source-link previews).
        // lines: plain-text step lines (a "## " prefix makes a heading), used by the (?) help tips (help_tip.js).
        show(cell, tex, note, plain, lines) {
            if (!cell || !cell.isConnected || !(tex || note || plain || lines)) { pop.hide(); return; }
            el.innerHTML = "";
            if (note) {
                const n = document.createElement("div");
                n.className = "formula-value";
                n.textContent = note;
                el.appendChild(n);
            }
            if (tex) {
                const eq = document.createElement("div");
                eq.className = "formula-meaning";
                try { katex.render(tex, eq, { throwOnError: false, displayMode: false }); } catch (e) { eq.textContent = tex; }
                el.appendChild(eq);
            }
            if (plain) {
                const p = document.createElement("div");
                p.className = "formula-meaning formula-plain";
                p.textContent = plain;
                el.appendChild(p);
            }
            (lines || []).forEach((l) => {
                const d = document.createElement("div");
                const head = l.startsWith("## ");
                d.className = head ? "formula-step-head" : "formula-step";
                d.textContent = head ? l.slice(3) : l;
                el.appendChild(d);
            });
            el.hidden = false;
            // Never on top of the hovered cell: below it, else above it, else beside it (whichever side has
            // room); and never on top of another visible popup: then beside / under / over that one instead.
            const r = cell.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, gap = 6;
            const clampX = (x) => Math.min(Math.max(8, x), innerWidth - w - 8);
            const clampY = (y) => Math.min(Math.max(8, y), innerHeight - h - 8);
            const cx = clampX(r.left + r.width / 2 - w / 2), cy = clampY(r.top + r.height / 2 - h / 2);
            const spots = [];
            if (r.bottom + gap + h <= innerHeight - 8) spots.push([cx, r.bottom + gap]);
            if (r.top - gap - h >= 8) spots.push([cx, r.top - gap - h]);
            const besideR = [clampX(r.right + gap), cy], besideL = [clampX(r.left - gap - w), cy];
            spots.push(...(innerWidth - r.right >= r.left ? [besideR, besideL] : [besideL, besideR]));
            const others = [...formulaPops].filter((p) => p.el !== el && !p.el.hidden).map((p) => p.el.getBoundingClientRect());
            // Buttons marked data-pop-avoid (the (?) help buttons) must stay clickable, so no popup covers them.
            const avoid = [...document.querySelectorAll("[data-pop-avoid]")].filter((b) => b !== cell).map((b) => b.getBoundingClientRect());
            others.forEach((o) => spots.push(
                [clampX(o.right + gap), clampY(r.top)], [clampX(o.left - gap - w), clampY(r.top)],
                [cx, clampY(o.bottom + gap)], [cx, clampY(o.top - gap - h)]));
            avoid.forEach((v) => spots.push([cx, clampY(v.bottom + gap)], [cx, clampY(v.top - gap - h)]));
            const free = (list) => ([x, y]) => list.every((o) => x + w + 4 <= o.left || x >= o.right + 4 || y + h + 4 <= o.top || y >= o.bottom + 4);
            // Best: clear of everything; else at least clear of the avoided buttons.
            const [x, y] = spots.find(free([...others, ...avoid])) || spots.find(free(avoid)) || spots[0];
            el.style.top = `${y}px`;
            el.style.left = `${x}px`;
        },
        hide() { el.hidden = true; },
        destroy() { el.remove(); formulaPops.delete(pop); },
    };
    formulaPops.add(pop);
    return pop;
}

// Hover any `selector` cell inside `root` to see formulaOf(cell) -> { tex, note } (or null: nothing).
function attachFormulaHover(root, selector, formulaOf) {
    if (!hoverPop) hoverPop = createFormulaPop();
    root.addEventListener("mouseover", (e) => {
        const cell = e.target.closest(selector);
        if (!cell || !root.contains(cell)) return;
        const f = formulaOf(cell);
        if (f) hoverPop.show(cell, f.tex, f.note); else hoverPop.hide();
    });
    root.addEventListener("mouseleave", () => hoverPop.hide());
}

function clearFormulaPops() {
    formulaPops.forEach((p) => (p === hoverPop ? p.hide() : p.destroy()));
}
