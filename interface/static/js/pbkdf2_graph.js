// Node graph with animated data flow: PBKDF2 (Key Setup), the CKKS pipeline (Encryption), AES-GCM counter
// mode (Transport); split_view.js shows it next to the node a step is about.
// Nodes are HTML boxes placed on a CSS grid; edges are SVG curves drawn
// behind them from the nodes' laid-out offsets (redrawn on resize, so it
// survives zoom transforms and phone widths). A glowing "packet" travels
// along edges stage by stage; a node lights up when a packet reaches it.
//
// renderPbkdf2Graph(containerEl, graph, options) -> Promise (flow finished)
//   graph   = { cols, rows, nodes: [{id, col, row, title, value, full}],
//               edges: [{from, to, label}] }       // label -> hover popup on the edge
//   options = { lit: [nodeIds lit before the flow starts],
//               focus: nodeId or [nodeIds],          // the node(s) being explained
//               flow: [[ "from>to", ... ], ...],     // stages, animated in order
//               skipAnimation: bool }                // jump to the end state
const SVG_NS = "http://www.w3.org/2000/svg";

function pbkdf2EdgeMs() {
    return Math.max(120, 700 * Math.pow(0.8, (window.stepSpeed || 5) - 1));
}

function renderPbkdf2Graph(containerEl, graph, options) {
    if (!containerEl || !containerEl.isConnected) return Promise.resolve();
    const o = options || {};
    containerEl.innerHTML = "";
    const scroll = document.createElement("div");
    scroll.className = "pg-scroll";
    const wrap = document.createElement("div");
    wrap.className = "pg-graph";
    wrap.style.gridTemplateColumns = `repeat(${graph.cols}, minmax(0, 1fr))`;
    wrap.style.gridTemplateRows = `repeat(${graph.rows}, auto)`;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "pg-edges");
    wrap.appendChild(svg);

    const nodeEls = {};
    graph.nodes.forEach((n) => {
        const el = document.createElement("div");
        el.className = "pg-node";
        el.dataset.node = n.id;
        el.style.gridColumn = String(n.col + 1);
        el.style.gridRow = String(n.row + 1);
        el.dataset.full = n.full || n.value || "";
        el.innerHTML = `<div class="pg-node-title">${escapeHtml(n.title)}</div><div class="pg-node-value">${escapeHtml(n.value || "")}</div>`;
        wrap.appendChild(el);
        nodeEls[n.id] = el;
    });
    // Hover a box: its full value (the box itself shows a shortened one).
    // Hover a box: its full value with the box's name underneath (the box itself shows a shortened one).
    attachFormulaHover(wrap, ".pg-node", (el) => {
        if (!el.dataset.full) return null;
        const name = el.querySelector(".pg-node-title").textContent;
        // KaTeX's \text only has glyphs for plain ASCII: subscript digits become digits, common symbols become
        // words, anything else non-ASCII is dropped (the note line above still shows the exact name).
        const ASCII = { "‖": "||", "⊕": " xor ", "→": " -> ", "·": " ", "×": "x", "…": "...", "Δ": "Delta", "σ": "sigma", "⁻¹": "^-1" };
        const texName = name.replace(/[\\{}_#%&$^~]/g, " ").replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080))
            .replace(/‖|⊕|→|·|×|…|Δ|σ|⁻¹/g, (c) => ASCII[c]).replace(/[^\x20-\x7e]/g, "");
        return { tex: kv(el.dataset.full, `\\text{${texName}}`), note: `${name}: ${el.dataset.full}` };
    });
    const lit = new Set(o.lit || []);
    const focus = new Set([].concat(o.focus || []));
    attachFormulaHover(svg, ".pg-edge-hit", (h) => ({ note: h.dataset.label }));
    const flowStages = o.skipAnimation ? [] : (o.flow || []);
    if (o.skipAnimation) (o.flow || []).flat().forEach((k) => lit.add(k.split(">")[1]));
    const pending = new Set(flowStages.flat());

    const edgeEls = {}, hitEls = {};
    graph.edges.forEach((e) => {
        const key = `${e.from}>${e.to}`;
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("class", "pg-edge" + (lit.has(e.from) && lit.has(e.to) && !pending.has(key) ? " lit" : ""));
        svg.appendChild(path);
        edgeEls[key] = path;
        if (e.label) { // a wide invisible twin of the edge catches the hover (cell_formula.js popup, no native tooltip)
            const hit = document.createElementNS(SVG_NS, "path");
            hit.setAttribute("class", "pg-edge-hit");
            hit.dataset.label = `${e.from} → ${e.to}: ${e.label}`;
            svg.appendChild(hit);
            hitEls[key] = hit;
        }
    });
    const refreshNodes = () => graph.nodes.forEach((n) => {
        nodeEls[n.id].classList.toggle("lit", lit.has(n.id));
        nodeEls[n.id].classList.toggle("focus", focus.has(n.id));
    });
    refreshNodes();
    scroll.appendChild(wrap);
    containerEl.appendChild(scroll);

    // Offsets are relative to .pg-graph (position: relative), unaffected by
    // any transform on an ancestor.
    function box(el) {
        return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    }
    function draw() {
        svg.setAttribute("width", wrap.offsetWidth);
        svg.setAttribute("height", wrap.offsetHeight);
        graph.edges.forEach((e) => {
            const a = box(nodeEls[e.from]), b = box(nodeEls[e.to]);
            const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
            let d;
            if (Math.abs(bx - ax) >= Math.abs(by - ay)) {
                const s = Math.sign(bx - ax) || 1;
                const x1 = ax + s * a.w / 2, x2 = bx - s * b.w / 2, m = (x2 - x1) / 2;
                d = `M${x1},${ay} C${x1 + m},${ay} ${x2 - m},${by} ${x2},${by}`;
            } else {
                const s = Math.sign(by - ay) || 1;
                const y1 = ay + s * a.h / 2, y2 = by - s * b.h / 2, m = (y2 - y1) / 2;
                d = `M${ax},${y1} C${ax},${y1 + m} ${bx},${y2 - m} ${bx},${y2}`;
            }
            edgeEls[`${e.from}>${e.to}`].setAttribute("d", d);
            if (hitEls[`${e.from}>${e.to}`]) hitEls[`${e.from}>${e.to}`].setAttribute("d", d);
        });
    }
    const ro = new ResizeObserver(() => {
        if (!wrap.isConnected) { ro.disconnect(); return; }
        draw();
    });
    ro.observe(wrap);
    draw();

    function movePacket(key) {
        return new Promise((resolve) => {
            const path = edgeEls[key];
            path.classList.add("flowing");
            const dot = document.createElementNS(SVG_NS, "circle");
            dot.setAttribute("class", "pg-packet");
            dot.setAttribute("r", "5");
            svg.appendChild(dot);
            const dur = pbkdf2EdgeMs();
            const t0 = performance.now();
            function frame(now) {
                if (!wrap.isConnected) { resolve(); return; }
                const t = Math.min(1, (now - t0) / dur);
                const len = path.getTotalLength();
                if (len > 0) {
                    const p = path.getPointAtLength(t * len);
                    dot.setAttribute("cx", p.x);
                    dot.setAttribute("cy", p.y);
                }
                if (t < 1) { requestAnimationFrame(frame); return; }
                dot.remove();
                path.classList.remove("flowing");
                path.classList.add("lit");
                resolve();
            }
            requestAnimationFrame(frame);
        });
    }

    return flowStages.reduce((chain, stage) => chain.then(() => {
        if (!wrap.isConnected) return undefined;
        return Promise.all(stage.map(movePacket)).then(() => {
            stage.forEach((k) => lit.add(k.split(">")[1]));
            refreshNodes();
        });
    }), Promise.resolve());
}
