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
        // note: the actual value, as plain text (shown first, large); tex: KaTeX of what that value is /
        // how it is made (shown just below it).
        // plain: a plain-text line instead of tex (used by source-link previews).
        show(cell, tex, note, plain) {
            if (!cell || !cell.isConnected || !(tex || note || plain)) { pop.hide(); return; }
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
            el.hidden = false;
            // Never on top of the hovered cell: below it, else above it, else beside it (whichever side has room).
            const r = cell.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, gap = 6;
            const clampX = (x) => Math.min(Math.max(8, x), innerWidth - w - 8);
            const clampY = (y) => Math.min(Math.max(8, y), innerHeight - h - 8);
            if (r.bottom + gap + h <= innerHeight - 8) {
                el.style.top = `${r.bottom + gap}px`; el.style.left = `${clampX(r.left + r.width / 2 - w / 2)}px`;
            } else if (r.top - gap - h >= 8) {
                el.style.top = `${r.top - gap - h}px`; el.style.left = `${clampX(r.left + r.width / 2 - w / 2)}px`;
            } else {
                const right = innerWidth - r.right, left = r.left;
                el.style.top = `${clampY(r.top + r.height / 2 - h / 2)}px`;
                el.style.left = `${right >= left ? Math.min(r.right + gap, innerWidth - w - 8) : Math.max(8, r.left - gap - w)}px`;
            }
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
