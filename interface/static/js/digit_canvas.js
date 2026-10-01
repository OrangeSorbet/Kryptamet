// Digit input panel (MNIST): a 28x28 drawing grid (mouse/touch/pen) with a
// soft brush, Clear, and real MNIST test images as presets. The 784 pixel
// values (0..255) are exactly what gets sent. Returns { get, set, focus, error }.
// digitGridSvg() draws any 784-pixel image (also used by the Feature chapter).
const DIGIT_N = 28;

function digitGridSvg(pixels, cls) {
    const px = [];
    pixels.forEach((v, i) => {
        if (v > 0) px.push(`<rect x="${i % DIGIT_N}" y="${Math.floor(i / DIGIT_N)}" width="1" height="1" fill-opacity="${(v / 255).toFixed(3)}" class="digit-ink"/>`);
    });
    return `<svg class="${cls || "digit-svg"}" viewBox="0 0 ${DIGIT_N} ${DIGIT_N}" role="img" aria-label="28 by 28 pixel image">
        <rect width="${DIGIT_N}" height="${DIGIT_N}" class="digit-bg"/>${px.join("")}</svg>`;
}

function createDigitInput(host, model) {
    const rows = model.samples.rows || [];
    const SIZE = 280, CELL = SIZE / DIGIT_N;
    host.innerHTML = `
        <div class="digit-panel">
            <canvas class="digit-canvas" width="${SIZE}" height="${SIZE}" aria-label="Draw a digit"></canvas>
            <div class="digit-side">
                <button type="button" class="example-chip digit-clear">Clear</button>
                ${rows.length ? `<span class="overview-examples-label">Or load a real MNIST test image:</span>
                <div class="digit-samples">${rows.map((r, i) => `<button type="button" class="digit-sample" data-i="${i}" title="test image ${i + 1}, label ${escapeHtml(r.label_name)}">${digitGridSvg(r.input.pixels, "digit-thumb")}</button>`).join("")}</div>` : ""}
                <span class="digit-count"></span>
            </div>
        </div>`;
    const canvas = host.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const count = host.querySelector(".digit-count");
    let px = new Array(DIGIT_N * DIGIT_N).fill(0);

    const bg = getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim() || "black";
    const draw = () => {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, SIZE, SIZE);
        px.forEach((v, i) => {
            if (!v) return;
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            ctx.fillRect((i % DIGIT_N) * CELL, Math.floor(i / DIGIT_N) * CELL, CELL, CELL);
        });
        count.textContent = `${px.filter((v) => v > 0).length} of 784 pixels inked`;
    };
    // Soft brush: full ink at the centre cell, less on its neighbours (like MNIST's anti-aliased strokes).
    const paint = (e) => {
        const r = canvas.getBoundingClientRect();
        const cx = ((e.clientX - r.left) / r.width) * DIGIT_N, cy = ((e.clientY - r.top) / r.height) * DIGIT_N;
        for (let y = Math.floor(cy) - 1; y <= Math.floor(cy) + 1; y++) {
            for (let x = Math.floor(cx) - 1; x <= Math.floor(cx) + 1; x++) {
                if (x < 0 || y < 0 || x >= DIGIT_N || y >= DIGIT_N) continue;
                const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
                const add = Math.round(255 * Math.max(0, 1 - d / 1.6));
                px[y * DIGIT_N + x] = Math.min(255, px[y * DIGIT_N + x] + add);
            }
        }
        draw();
    };
    canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); paint(e); });
    canvas.addEventListener("pointermove", (e) => { if (e.buttons === 1) paint(e); });
    host.querySelector(".digit-clear").addEventListener("click", () => { px = px.map(() => 0); draw(); });
    host.querySelectorAll(".digit-sample").forEach((b) => b.addEventListener("click", () => {
        px = rows[Number(b.dataset.i)].input.pixels.slice();
        draw();
    }));
    const set = (inp) => { px = inp && inp.pixels ? inp.pixels.slice() : px.map(() => 0); draw(); };
    set(rows.length ? rows[0].input : null);
    return {
        get: () => ({ pixels: px.slice() }),
        set,
        focus: () => canvas.focus(),
        error: () => (px.some((v) => v > 0) ? null : "Draw a digit first."),
    };
}
