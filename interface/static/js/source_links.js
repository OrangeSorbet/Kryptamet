// "Where did this number come from?" links. A step that produces an important value declares it:
//   step.facts = [{ id: "pbkdf2_key", label: "the AES key from PBKDF2", value: "3fa1…" }]
// chapter_state.js registers every declared fact (with its chapter and step) after each run.
// Any later text can then point at it:
//   explanation strings:  srcRef("pbkdf2_key", "3fa1…")      (a token; linkExplanation turns it into a link)
//   scene HTML:           srcLinkHtml("pbkdf2_key", "3fa1…")
// The link glows; hovering previews the value and where it was made; clicking jumps there
// (chapter_state.js jumpToFact) and pulses the value; the navbar's "↩ Back" pill returns.
const FACTS = new Map();

function registerFacts(chapters, chapterSteps) {
    FACTS.clear();
    chapterSteps.forEach((entry, ci) => {
        if (!entry) return;
        const nums = stepNumbers(entry.steps);
        entry.steps.forEach((st, si) => (st.facts || []).forEach((f) => {
            FACTS.set(f.id, { ...f, chapter: ci, step: si, where: `${chapters[ci].label}, step ${nums[si]}` });
        }));
    });
}

const SRC_TOKEN = /⟦([\w.-]+)\|([^⟧]*)⟧/g;
const srcRef = (id, text) => `⟦${id}|${text}⟧`;
const srcLinkHtml = (id, text) => (FACTS.has(id)
    ? `<span class="src-link" data-fact="${escapeHtml(id)}" tabindex="0" role="link">${escapeHtml(text)}</span>`
    : escapeHtml(text));

// Explanation text → HTML: source tokens become links, the rest gets glossary terms.
function linkExplanation(text, seen) {
    let out = "", last = 0;
    const s = String(text);
    for (const m of s.matchAll(SRC_TOKEN)) {
        out += linkGlossaryTerms(s.slice(last, m.index), seen) + srcLinkHtml(m[1], m[2]);
        last = m.index + m[0].length;
    }
    return out + linkGlossaryTerms(s.slice(last), seen);
}

// The step a fact comes from marks the value with data-fact-src="<id>"; a jump pulses it.
function pulseFact(root, id) {
    root.querySelectorAll(`[data-fact-src="${CSS.escape(id)}"]`).forEach((el) => {
        el.classList.remove("src-pulse");
        void el.offsetWidth;
        el.classList.add("src-pulse");
        el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
}

function initSourceLinks(onJump) {
    const pop = createFormulaPop();
    formulaPops.delete(pop); // lives for the whole page; step changes must not destroy it
    const factOf = (el) => FACTS.get(el.dataset.fact);
    document.addEventListener("mouseover", (e) => {
        const el = e.target.closest(".src-link");
        if (!el) return;
        const f = factOf(el);
        if (f) pop.show(el, null, String(f.value ?? el.textContent), `${f.label}. Made in ${f.where}. Click to go there.`);
    });
    document.addEventListener("mouseout", (e) => { if (e.target.closest(".src-link")) pop.hide(); });
    const go = (el) => { pop.hide(); if (factOf(el)) onJump(el.dataset.fact, factOf(el)); };
    document.addEventListener("click", (e) => { const el = e.target.closest(".src-link"); if (el) go(el); });
    document.addEventListener("keydown", (e) => {
        const el = e.target.closest && e.target.closest(".src-link");
        if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); go(el); }
    });
}
