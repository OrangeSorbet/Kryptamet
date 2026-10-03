// Collapsible playback-speed dial, ported from Snek's Scrubber.tsx
// SpeedControl: a bolt button that reveals a small draggable slider on hover
// and stays open on click. Writes a speed (1..10) to a window global and
// remembers it per browser (localStorage, best-effort). Two dials exist:
// window.stepSpeed (the Scrubber: autoplay and step animations) and
// window.gridSpeed (each poly grid's own reveal, grid_controls.js).
const SPEED_MIN = 1;
const SPEED_MAX = 10;
const STEP_SPEED = { key: "stepSpeed", storage: "kryptamet.speed", label: "Playback speed" };

function loadSavedSpeed(storage) {
    try {
        const v = parseInt(localStorage.getItem(storage), 10);
        if (v >= SPEED_MIN && v <= SPEED_MAX) return v;
    } catch (e) { /* storage blocked -- use default */ }
    return 5;
}

window.stepSpeed = loadSavedSpeed("kryptamet.speed");
window.gridSpeed = loadSavedSpeed("kryptamet.gridSpeed");

function createSpeedDial(containerEl, opts) {
    const { key, storage, label } = opts || STEP_SPEED;
    containerEl.innerHTML = `
        <div class="speed-dial">
            <button class="scrubber-btn speed-dial-btn" type="button" aria-label="${label}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>
            </button>
            <div class="speed-dial-drawer">
                <div class="speed-dial-track" role="slider" tabindex="0" aria-label="${label}"
                     aria-valuemin="${SPEED_MIN}" aria-valuemax="${SPEED_MAX}">
                    <div class="speed-dial-fill"></div>
                    <div class="speed-dial-thumb"></div>
                </div>
                <span class="speed-dial-value"></span>
            </div>
        </div>
    `;
    const root = containerEl.querySelector(".speed-dial");
    const btn = root.querySelector(".speed-dial-btn");
    const track = root.querySelector(".speed-dial-track");
    const fill = root.querySelector(".speed-dial-fill");
    const thumb = root.querySelector(".speed-dial-thumb");
    const valueEl = root.querySelector(".speed-dial-value");

    function render() {
        const v = window[key];
        const pct = ((v - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100;
        fill.style.width = pct + "%";
        thumb.style.left = pct + "%";
        valueEl.textContent = `${v}/${SPEED_MAX}`;
        track.setAttribute("aria-valuenow", v);
        btn.ariaLabel = `${label}: ${v}/${SPEED_MAX}`;
    }

    function set(v) {
        window[key] = Math.max(SPEED_MIN, Math.min(SPEED_MAX, v));
        try { localStorage.setItem(storage, String(window[key])); } catch (e) { /* ignore */ }
        render();
    }

    function setFromClientX(clientX) {
        const rect = track.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        set(Math.round(SPEED_MIN + ratio * (SPEED_MAX - SPEED_MIN)));
    }

    btn.addEventListener("click", () => root.classList.toggle("pinned"));
    track.addEventListener("pointerdown", (e) => {
        track.setPointerCapture(e.pointerId);
        setFromClientX(e.clientX);
    });
    track.addEventListener("pointermove", (e) => { if (e.buttons === 1) setFromClientX(e.clientX); });
    track.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") { set(window[key] + 1); e.preventDefault(); e.stopPropagation(); }
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") { set(window[key] - 1); e.preventDefault(); e.stopPropagation(); }
    });

    render();
}
