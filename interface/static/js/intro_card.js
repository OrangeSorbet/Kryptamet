// Chapter theory primer modal, ported from Snek's IntroCard.tsx. Opens
// automatically the first time each chapter (or the flowchart) is shown --
// "seen" is remembered per browser in localStorage, best-effort -- and can be
// reopened any time with the "?" button. Dismiss with ✕, Escape, or a click
// on the backdrop. While open, window.introCardOpen tells the Scrubber's and
// flowchart's keyboard handlers to stand down.
const INTRO_SEEN_PREFIX = "kryptamet.introSeen.";

function introSeen(id) {
    try { return localStorage.getItem(INTRO_SEEN_PREFIX + id) === "1"; } catch (e) { return false; }
}

function markIntroSeen(id) {
    try { localStorage.setItem(INTRO_SEEN_PREFIX + id, "1"); } catch (e) { /* ignore */ }
}

function closeIntroCard() {
    const el = document.getElementById("introCardHost");
    if (el) el.remove();
    window.introCardOpen = false;
    document.removeEventListener("keydown", _introKeyHandler, true);
}

function _introKeyHandler(e) {
    if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        closeIntroCard();
    }
}

function openIntroCard(id) {
    const c = CHAPTER_INTROS[id];
    if (!c) return;
    closeIntroCard();
    markIntroSeen(id);
    const host = document.createElement("div");
    host.id = "introCardHost";
    host.className = "intro-backdrop";
    host.innerHTML = `
        <div class="intro-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(c.title)}">
            <button type="button" class="intro-close" aria-label="Close">&#10005;</button>
            <div class="intro-title">${escapeHtml(c.title)}</div>
            ${c.io ? `<div class="intro-io">${escapeHtml(c.io)}</div>` : ""}
            ${c.sections.map(([heading, body]) => `
                <div class="intro-section">
                    <div class="intro-heading">${escapeHtml(heading)}</div>
                    <div class="intro-body">${escapeHtml(body)}</div>
                </div>`).join("")}
            <button type="button" class="btn intro-ok">Got it</button>
        </div>
    `;
    host.addEventListener("click", (e) => { if (e.target === host) closeIntroCard(); });
    host.querySelector(".intro-close").addEventListener("click", closeIntroCard);
    host.querySelector(".intro-ok").addEventListener("click", closeIntroCard);
    document.body.appendChild(host);
    window.introCardOpen = true;
    document.addEventListener("keydown", _introKeyHandler, true);
    host.querySelector(".intro-ok").focus();
}

function maybeShowIntroCard(id) {
    if (!introSeen(id)) openIntroCard(id);
}
