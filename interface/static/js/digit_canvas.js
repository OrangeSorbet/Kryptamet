// Handwriting input panel (MNIST / EMNIST): a drawing strip as wide as the
// panel, empty at first. Strokes are kept as vector paths. Strokes whose
// horizontal extents overlap form one character (so an "i" dot joins its
// stem); a gap between characters splits them. Each character is re-rendered
// the way its dataset was made (renderGlyph): drawn at 4x resolution with a
// pen whose width is a fixed share of the character box, softened, scaled down
// to 28x28. The "sends" row shows those images, which are exactly what get()
// returns. Sample words (real test images side by side) sit in one row under
// the strip and are sent untouched. Returns { get, set, focus, error }.
// digitGridSvg() draws any 784-pixel image (also used by the Feature and
// Result chapters).
const DIGIT_N = 28;
const GLYPH_SCALE = 4; // characters are rendered at 112x112, then averaged 4x4 down to 28x28

// cells: one rect per pixel (data-i), including empty ones, so every pixel can be hovered.
function digitGridSvg(pixels, cls, cells) {
    const px = [];
    pixels.forEach((v, i) => {
        if (cells && !v) px.push(`<rect x="${i % DIGIT_N}" y="${Math.floor(i / DIGIT_N)}" width="1" height="1" class="digit-cell" data-i="${i}"/>`);
        if (v > 0) px.push(`<rect x="${i % DIGIT_N}" y="${Math.floor(i / DIGIT_N)}" width="1" height="1" fill-opacity="${(v / 255).toFixed(3)}" class="digit-ink"${cells ? ` data-i="${i}"` : ""}/>`);
    });
    return `<svg class="${cls || "digit-svg"}" viewBox="0 0 ${DIGIT_N} ${DIGIT_N}" role="img" aria-label="28 by 28 pixel image">
        <rect width="${DIGIT_N}" height="${DIGIT_N}" class="digit-bg"/>${px.join("")}</svg>`;
}

// One character's strokes -> 784 pixels, framed like its dataset (registry samples.framing):
// box = ink extent in pixels (MNIST 20, EMNIST 24), pen = stroke width as a share of the box (both ~0.13,
// measured on the test sets), blur = softening in 28x28 pixels, center = "mass" (MNIST: centre of mass at
// the image centre) or "box" (EMNIST: bounding box centred).
function renderGlyph(strokes, f) {
    const S = GLYPH_SCALE, R = DIGIT_N * S;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    strokes.forEach((st) => st.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
    const pen = f.pen * f.box * S;
    const s = Math.max(0, f.box * S - pen) / Math.max(x1 - x0, y1 - y0, 1e-6);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const canvas = (ctxOpts) => { const c = document.createElement("canvas"); c.width = c.height = R; return [c, c.getContext("2d", ctxOpts)]; };
    const [big, g] = canvas();
    g.fillStyle = "#000";
    g.fillRect(0, 0, R, R);
    g.strokeStyle = g.fillStyle = "#fff";
    g.lineWidth = pen;
    g.lineCap = g.lineJoin = "round";
    strokes.forEach((st) => {
        const P = st.map(([x, y]) => [R / 2 + (x - cx) * s, R / 2 + (y - cy) * s]);
        g.beginPath();
        if (P.length === 1) { g.arc(P[0][0], P[0][1], pen / 2, 0, 2 * Math.PI); g.fill(); return; }
        g.moveTo(P[0][0], P[0][1]);
        P.slice(1).forEach(([x, y]) => g.lineTo(x, y));
        g.stroke();
    });
    // Soften once (one blur pass over the whole glyph), then average each 4x4 block (exact, same in every
    // browser) and stretch so the darkest ink is 255.
    const [, soft] = canvas({ willReadFrequently: true });
    soft.filter = f.blur ? `blur(${f.blur * S}px)` : "none";
    soft.drawImage(big, 0, 0);
    const d = soft.getImageData(0, 0, R, R).data, out = new Array(DIGIT_N * DIGIT_N).fill(0);
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) out[Math.floor(y / S) * DIGIT_N + Math.floor(x / S)] += d[(y * R + x) * 4] / (S * S);
    const peak = Math.max(...out) || 1;
    let img = out.map((v) => Math.round((v * 255) / peak));
    if (f.center === "mass") {
        let m = 0, mx = 0, my = 0;
        img.forEach((v, i) => { m += v; mx += v * (i % DIGIT_N); my += v * Math.floor(i / DIGIT_N); });
        const ox = Math.round(DIGIT_N / 2 - mx / m), oy = Math.round(DIGIT_N / 2 - my / m);
        const shifted = new Array(DIGIT_N * DIGIT_N).fill(0);
        img.forEach((v, i) => {
            const x = (i % DIGIT_N) + ox, y = Math.floor(i / DIGIT_N) + oy;
            if (v && x >= 0 && y >= 0 && x < DIGIT_N && y < DIGIT_N) shifted[y * DIGIT_N + x] = v;
        });
        img = shifted;
    }
    return img;
}

// Groups strokes into characters: strokes whose x-extents (widened by the pen) overlap are one character.
function groupStrokes(strokes, pen) {
    const spans = strokes.map((st) => {
        const xs = st.map((p) => p[0]);
        return { a: Math.min(...xs) - pen / 2, b: Math.max(...xs) + pen / 2, st };
    }).sort((u, v) => u.a - v.a);
    const groups = [];
    spans.forEach((sp) => {
        const last = groups[groups.length - 1];
        if (last && sp.a <= last.b) { last.b = Math.max(last.b, sp.b); last.strokes.push(sp.st); }
        else groups.push({ b: sp.b, strokes: [sp.st] });
    });
    return groups.map((gr) => gr.strokes);
}

function createDigitInput(host, model) {
    const s = model.samples, rows = s.rows || [];
    const framing = s.framing || { box: 20, center: "mass", pen: 0.13, blur: 0.5 }, maxChars = s.max_chars || 8;
    const H = 224; // internal strip height in canvas pixels
    // Strip width: ~170 px tall at the panel's width, but always room for the longest sample word.
    const longest = Math.max(0, ...rows.map((r) => r.input.images.length));
    const cols = Math.max(56, longest * (DIGIT_N + 4), Math.min(168, Math.round((DIGIT_N * (host.clientWidth || 700)) / 170)));
    const Wd = Math.round((H * cols) / DIGIT_N), PEN = H * 0.08;
    // Models that also know letters (EMNIST) get a "Read as" switch: the client picks the best class among
    // the allowed ones after decrypting all scores.
    const letters = model.class_names.some((c) => /[a-z]/i.test(c));
    let charset = "all";
    host.innerHTML = `
        <div class="digit-panel">
            <canvas class="digit-canvas" width="${Wd}" height="${H}" aria-label="Drawing strip"></canvas>
            <div class="digit-bar">
                <button type="button" class="example-chip digit-clear">Clear</button>
                ${rows.length ? `<span class="overview-examples-label">Real test images:</span>
                ${rows.map((r, i) => `<button type="button" class="digit-sample" data-i="${i}" aria-label="${escapeHtml(`"${r.label_name}": real ${model.label.split(" ")[0]} test images of classes ${[...r.classes].join(", ")}`)}">${r.input.images.map((im) => digitGridSvg(im, "digit-thumb")).join("")}</button>`).join("")}` : ""}
            </div>
            <div class="digit-sends"><span class="digit-count"></span><span class="digit-sent"></span>
                ${letters ? `<span class="digit-charset" role="group" aria-label="Read as">Read as:
                    ${[["all", "digits + letters"], ["digits", "digits"], ["letters", "letters"]].map(([v, t]) => `<button type="button" class="sym-chip" data-cs="${v}" aria-pressed="${v === "all"}">${t}</button>`).join("")}</span>` : ""}</div>
        </div>`;
    const canvas = host.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const count = host.querySelector(".digit-count"), sent = host.querySelector(".digit-sent");
    let strokes = [];  // drawn strokes, each a list of [x, y] in canvas pixels
    let sample = null; // a sample's real images, sent untouched
    let images = [];   // what get() sends

    const bg = getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim() || "black";
    const draw = () => {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, Wd, H);
        if (sample) {
            const cell = H / DIGIT_N;
            sample.forEach((im, k) => im.forEach((v, i) => {
                if (!v) return;
                ctx.fillStyle = `rgb(${v},${v},${v})`;
                ctx.fillRect((k * (DIGIT_N + 4) + (i % DIGIT_N)) * cell, Math.floor(i / DIGIT_N) * cell, cell + 0.5, cell + 0.5);
            }));
        }
        ctx.strokeStyle = ctx.fillStyle = "#e6e6e6";
        ctx.lineWidth = PEN;
        ctx.lineCap = ctx.lineJoin = "round";
        strokes.forEach((st) => {
            ctx.beginPath();
            if (st.length === 1) { ctx.arc(st[0][0], st[0][1], PEN / 2, 0, 2 * Math.PI); ctx.fill(); return; }
            ctx.moveTo(st[0][0], st[0][1]);
            st.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
            ctx.stroke();
        });
        count.textContent = images.length ? `${images.length} character${images.length > 1 ? "s" : ""}${images.length > maxChars ? ` (max ${maxChars})` : ""} · sends:` : "Nothing drawn yet.";
        sent.innerHTML = images.map((im) => digitGridSvg(im, "digit-thumb small")).join("");
    };
    const point = (e) => {
        const r = canvas.getBoundingClientRect();
        return [((e.clientX - r.left) / r.width) * Wd, ((e.clientY - r.top) / r.height) * H];
    };
    const reframe = () => { images = sample ? sample.map((im) => im.slice()) : groupStrokes(strokes, PEN).map((g) => renderGlyph(g, framing)); draw(); };
    canvas.addEventListener("pointerdown", (e) => {
        canvas.setPointerCapture(e.pointerId);
        if (sample) sample = null; // drawing starts a fresh strip
        strokes.push([point(e)]);
        draw();
    });
    canvas.addEventListener("pointermove", (e) => { if (e.buttons === 1 && strokes.length) { strokes[strokes.length - 1].push(point(e)); draw(); } });
    canvas.addEventListener("pointerup", reframe);
    const set = (inp) => {
        strokes = [];
        const imgs = (inp && (inp.images || (inp.pixels && [inp.pixels]))) || [];
        sample = imgs.length ? imgs.slice(0, Math.floor((cols + 4) / (DIGIT_N + 4))) : null;
        reframe();
    };
    host.querySelector(".digit-clear").addEventListener("click", () => set(null));
    host.querySelectorAll("[data-cs]").forEach((b) => b.addEventListener("click", () => {
        charset = b.dataset.cs;
        host.querySelectorAll("[data-cs]").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
    }));
    host.querySelectorAll(".digit-sample").forEach((b) => b.addEventListener("click", () => set(rows[Number(b.dataset.i)].input)));
    set(null);
    return {
        get: () => ({ images: images.map((im) => im.slice()), ...(letters ? { charset } : {}) }),
        set,
        focus: () => canvas.focus(),
        error: () => (!images.length ? "Draw something first."
            : images.length > maxChars ? `At most ${maxChars} characters per run (found ${images.length}).` : null),
    };
}
