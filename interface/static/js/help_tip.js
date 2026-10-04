// "(?)" help buttons. A button carries data-help="<key>"; HELP_TIPS maps the key to the step lines shown in a
// formula popup (cell_formula.js createFormulaPop; "## " lines are headings).
//   hover        shows the tip, un-hover hides it
//   click        pins it (it stays after un-hover); click the button again to unpin
//   click elsewhere, or Esc, closes every pinned tip (a click inside a tip keeps it)
// Every button has its own popup, and createFormulaPop places popups so that none covers another; when the
// screen is too small for two, the newest tip replaces the older ones.
// A tip's lines are computed by the step that registers them, from the run's own numbers.
const HELP_TIPS = new Map();
const helpPops = new WeakMap();
const helpPinned = new Set();

const helpTipHtml = (key) => `<button class="help-q" type="button" data-pop-avoid data-help="${escapeHtml(key)}" aria-label="Show the steps">(?)</button>`;
// ⟪?key⟫ inside scene text becomes a (?) button.
const withHelpTips = (html) => html.replace(/⟪\?([\w-]+)⟫/g, (_, key) => helpTipHtml(key));

function helpPopOf(btn) {
    let pop = helpPops.get(btn);
    if (!pop || !pop.el.isConnected) {   // a step change destroys the popups (clearFormulaPops)
        pop = createFormulaPop();
        pop.el.classList.add("help-pop");
        helpPops.set(btn, pop);
    }
    return pop;
}
const showHelp = (btn) => { const lines = HELP_TIPS.get(btn.dataset.help); if (lines) helpPopOf(btn).show(btn, null, null, null, lines); };
const hideHelp = (btn) => { const pop = helpPops.get(btn); if (pop) pop.hide(); };
// True when this button's tip covers another visible help tip.
function helpOverlaps(btn) {
    const me = helpPops.get(btn).el.getBoundingClientRect();
    return [...helpPinned].some((o) => {
        const pop = o !== btn && helpPops.get(o);
        if (!pop || pop.el.hidden) return false;
        const r = pop.el.getBoundingClientRect();
        return !(me.right <= r.left || r.right <= me.left || me.bottom <= r.top || r.bottom <= me.top);
    });
}
function closeAllHelp() { helpPinned.forEach(hideHelp); helpPinned.clear(); }

document.addEventListener("mouseover", (e) => { const b = e.target.closest && e.target.closest(".help-q"); if (b && !helpPinned.has(b)) showHelp(b); });
document.addEventListener("mouseout", (e) => { const b = e.target.closest && e.target.closest(".help-q"); if (b && !helpPinned.has(b)) hideHelp(b); });
document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".help-q");
    if (b) {
        if (helpPinned.has(b)) { helpPinned.delete(b); hideHelp(b); } else {
            helpPinned.add(b);
            showHelp(b);
            // No room for two tips side by side or stacked (small screen): the newest one replaces the others.
            if (helpPops.has(b) && helpOverlaps(b)) {
                [...helpPinned].filter((o) => o !== b).forEach((o) => { helpPinned.delete(o); hideHelp(o); });
                showHelp(b);
            }
        }
    } else if (!(e.target.closest && e.target.closest(".help-pop"))) closeAllHelp();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAllHelp(); });
