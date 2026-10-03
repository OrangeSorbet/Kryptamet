// Explanation level, switched in the navbar and remembered per browser:
//   "eli5"     plain words and everyday comparisons, still built from this run's real values
//   "advanced" the exact terms, numbers and formulas
// Every Scrubber step carries both: its advanced text in what/why/formal/next and the plain one in
// step.eli5 = { what, why, formal, next } (formal = "In one line" at ELI5). Chapter primers
// (chapter_intros.js) carry an `eli5` twin too. Changing the level fires "explainlevel" on document;
// scrubber.js and intro_card.js re-render their text.
const EXPLAIN_LEVELS = [["eli5", "ELI5"], ["advanced", "Advanced"]];

window.explainLevel = (() => {
    try {
        const v = localStorage.getItem("kryptamet.level");
        return EXPLAIN_LEVELS.some(([k]) => k === v) ? v : "eli5";
    } catch (e) { return "eli5"; }
})();

// The text of `key` at the current level: the eli5 twin when there is one, otherwise the advanced text.
function levelText(obj, key) {
    if (!obj) return "";
    if (window.explainLevel === "eli5" && obj.eli5 && obj.eli5[key] !== undefined) return obj.eli5[key];
    return obj[key];
}

function createLevelSwitch(host) {
    host.innerHTML = `<span class="level-switch-label">Explain:</span>${EXPLAIN_LEVELS.map(([k, t]) =>
        `<button type="button" class="level-btn" data-level="${k}" aria-pressed="${k === window.explainLevel}">${t}</button>`).join("")}`;
    host.querySelectorAll(".level-btn").forEach((b) => b.addEventListener("click", () => {
        if (b.dataset.level === window.explainLevel) return;
        window.explainLevel = b.dataset.level;
        try { localStorage.setItem("kryptamet.level", window.explainLevel); } catch (e) { /* ignore */ }
        host.querySelectorAll(".level-btn").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
        document.dispatchEvent(new CustomEvent("explainlevel"));
    }));
}
