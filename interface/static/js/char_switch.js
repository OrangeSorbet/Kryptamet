// Character chips for a drawing with several characters (MNIST / EMNIST): one chip per drawn character,
// showing its framed 28x28 image and its decrypted label. Every character had its own complete traced run
// (/api/infer char_runs); clicking a chip makes every chapter show that character's run (chapter_state.js
// selectCharacter). Hidden for single inputs and on the input screen.
function createCharSwitch(host, { characters, images, current, visible, loading, onSelect }) {
    host.hidden = !visible;
    if (!visible) { host.innerHTML = ""; return; }
    host.innerHTML = `<span class="char-switch-label">Character:</span>${characters.map((c, k) => `
        <button type="button" class="char-chip${k === current ? " active" : ""}${loading === k ? " loading" : ""}" data-k="${k}"
            aria-pressed="${k === current}" aria-label="character ${k + 1}: ${escapeHtml(c.he_label)}">
            ${digitGridSvg(images[k], "char-thumb")}<span class="char-chip-label">${escapeHtml(c.he_label)}</span>
        </button>`).join("")}`;
    host.querySelectorAll(".char-chip").forEach((b) => b.addEventListener("click", () => onSelect(Number(b.dataset.k))));
}
