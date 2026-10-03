// Chapter-dot pill, ported from Snek's PhaseMinimap.tsx: one dot per real
// chapter (current glows, completed ones green). Only the active chapter
// shows its label -- the rest are dots with a hover title -- so the pill
// stays narrow enough for phones. Clicking a dot calls onSelect(index) to
// jump straight to that chapter.
function initMinimap(containerEl, chapterLabels, onSelect) {
    containerEl.className = "chapter-minimap";
    containerEl.innerHTML = chapterLabels.map((label, i) => `
        <button type="button" class="chapter-minimap-item" data-index="${i}" aria-label="Chapter ${i + 1}: ${label}">
            <span class="chapter-minimap-dot"></span>
            <span class="chapter-minimap-label">${label}</span>
        </button>
        ${i < chapterLabels.length - 1 ? '<span class="chapter-minimap-link"></span>' : ""}
    `).join("");

    containerEl.querySelectorAll(".chapter-minimap-item").forEach((el) => {
        el.addEventListener("click", () => onSelect && onSelect(Number(el.dataset.index)));
    });

    function update(activeIndex, doneIndices) {
        doneIndices = doneIndices || new Set();
        containerEl.querySelectorAll(".chapter-minimap-item").forEach((el) => {
            const i = Number(el.dataset.index);
            const isActive = i === activeIndex;
            el.classList.toggle("active", isActive);
            el.classList.toggle("done", doneIndices.has(i));
            el.setAttribute("aria-current", isActive ? "step" : "false");
        });
    }

    return { update };
}
