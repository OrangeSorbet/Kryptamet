// Explanation level, switched in the navbar and remembered per browser:
//   "eli1"     toy numbers: every hard idea worked by hand with tiny values, then "the real run does this"
//   "eli5"     plain words and everyday comparisons, still built from this run's real values
//   "advanced" the exact terms, numbers and formulas
// A Scrubber step keeps its advanced text in what/why/formal/next, the plain one in step.eli5 and the
// toy-number one in step.eli1 (each { what, why, formal, next }; formal is titled "Significance" at
// ELI1/ELI5). A missing eli1 falls back to eli5, a missing eli5 to the advanced text. Chapter primers
// (chapter_intros.js) carry `eli5` / `eli1` twins too. Changing the level fires "explainlevel" on
// document; scrubber.js and intro_card.js re-render their text.
const EXPLAIN_LEVELS = [["eli1", "ELI1"], ["eli5", "ELI5"], ["advanced", "Advanced"]];

window.explainLevel = (() => {
    try {
        const v = localStorage.getItem("kryptamet.level");
        return EXPLAIN_LEVELS.some(([k]) => k === v) ? v : "eli5";
    } catch (e) { return "eli5"; }
})();

// The plain twin for obj at the current level (eli1, falling back to eli5), or null at Advanced.
function levelTwin(obj) {
    if (!obj || window.explainLevel === "advanced") return null;
    return (window.explainLevel === "eli1" && obj.eli1) || obj.eli5 || null;
}

// The variables a step's text may show as values (var_label.js): the ELI1 twin's own toy `vars`, or else the
// step's real `vars` (ELI5 and Advanced share the real run's values).
function levelVars(obj) {
    if (!obj) return null;
    if (window.explainLevel === "eli1" && obj.eli1) return obj.eli1.vars || null;
    return obj.vars || null;
}

// The text of `key` at the current level.
function levelText(obj, key) {
    if (!obj) return "";
    const twin = levelTwin(obj);
    return twin && twin[key] !== undefined ? twin[key] : obj[key];
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
