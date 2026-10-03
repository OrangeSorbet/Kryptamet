// Send / receive chart of the whole protocol (like a TCP sequence diagram). What travels is named plainly:
// the CKKS ciphertext (your input, homomorphically encrypted), the AES-sealed ciphertext (that, AES-256-GCM
// encrypted) and the RSA-wrapped AES key (the AES key, RSA-OAEP encrypted with the receiver's public key).
// Two lifelines, Client (you) on the left and Server (compute node) on the right, time running down. Every
// message that crosses the network is one arrow labelled with what travels and its real size; every
// operation is listed on the side that does it, in order. Built from the run's events; `highlight` lists
// the message ids a step is about (the others are dimmed). Used by Key Setup and both Transport chapters.
function protocolMessages(result) {
    const ev = (n) => findEv(result, n).data_after;
    const ck = ev("ckks_keygen"), rc = ev("rsa_keygen_client"), rs = ev("rsa_keygen_server");
    const w1 = ev("leg1_wrap"), w2 = ev("leg2_wrap");
    return [
        { id: "ctx", dir: 1, label: "CKKS public key bundle", note: `${formatBytes(ck.public_context.size_bytes)}: lets the server compute on the ciphertext, never decrypt it` },
        { id: "rsaC", dir: 1, label: "client's RSA public key", note: `RSA-${rc.key_size}: the server will lock its reply's AES key with it` },
        { id: "rsaS", dir: -1, label: "server's RSA public key", note: `RSA-${rs.key_size}: the client locks its AES key with it` },
        { id: "leg1", dir: 1, label: "AES-sealed ciphertext + RSA-wrapped AES key", note: `${formatBytes(w1.aes_ciphertext_size)} + ${w1.encrypted_aes_key_size} B (+ nonce, tamper tag)` },
        { id: "leg2", dir: -1, label: "AES-sealed result + RSA-wrapped AES key", note: `${formatBytes(w2.aes_ciphertext_size)} + ${w2.encrypted_aes_key_size} B (+ nonce, tamper tag)` },
    ];
}

// What each side does / holds after message i (index 0 = before anything is sent), one line per entry.
const PROTOCOL_STATES = [
    { client: ["has: your text, CKKS keys,", "its RSA key pair"], server: ["has: the model, its RSA key pair"] },
    { client: [], server: ["+ CKKS public bundle (compute only)"] },
    { client: [], server: ["+ client's RSA public key"] },
    { client: ["your input → CKKS encrypt → CKKS ciphertext", "CKKS ciphertext → AES → AES-sealed ciphertext", "AES key → RSA (server's public key)", "   → RSA-wrapped AES key", "send both"], server: [] },
    { client: [], server: ["RSA-wrapped key → its RSA private key → AES key", "AES-sealed ciphertext → AES key → CKKS ciphertext", "compute on the CKKS ciphertext → CKKS result", "   (never sees your input)", "CKKS result → new AES key → AES-sealed result", "new AES key → RSA (client's public key)", "   → RSA-wrapped AES key", "send both"] },
    { client: ["RSA-wrapped key → its RSA private key → AES key", "AES-sealed result → AES key → CKKS result", "CKKS result → CKKS secret key → your answer"], server: [] },
];

function sequenceChartSvg(result, highlight) {
    const msgs = protocolMessages(result), hot = new Set(highlight || msgs.map((m) => m.id));
    const W = 1180, L = 400, R = 780, TOP = 56, LINE = 17;
    // Row k (message k) is tall enough for the label above its arrow and the side notes it triggers.
    const rowH = (k) => Math.max(96, 40 + LINE * Math.max(PROTOCOL_STATES[k + 1].client.length, PROTOCOL_STATES[k + 1].server.length));
    const head = 34 + LINE * Math.max(PROTOCOL_STATES[0].client.length, PROTOCOL_STATES[0].server.length);
    const ys = [];
    msgs.reduce((y, _, k) => { ys.push(y); return y + rowH(k); }, TOP + head + 34);
    const H = ys[ys.length - 1] + rowH(msgs.length - 1) + 30;
    const lines = (arr, x, y, side) => (arr.length
        ? `<text class="seq-state" x="${x}" y="${y}" text-anchor="${side === "client" ? "end" : "start"}">${arr.map((l, i) => `<tspan x="${x}" dy="${i ? LINE : 0}">${escapeHtml(l)}</tspan>`).join("")}</text>`
        : "");
    const xs = (side) => (side === "client" ? L - 14 : R + 14);
    const arrows = msgs.map((m, k) => {
        const y0 = ys[k], y1 = y0 + 38, [x0, x1] = m.dir > 0 ? [L, R] : [R, L];
        const st = PROTOCOL_STATES[k + 1], on = hot.has(m.id) ? "on" : "off";
        return `<g class="seq-msg ${on}">
            <text class="seq-label" x="${(L + R) / 2}" y="${y0 - 22}" text-anchor="middle">${escapeHtml(m.label)}</text>
            <text class="seq-note" x="${(L + R) / 2}" y="${y0 - 6}" text-anchor="middle">${escapeHtml(m.note)}</text>
            <line class="seq-arrow" x1="${x0}" y1="${y0}" x2="${x1 - m.dir * 8}" y2="${y1}" marker-end="url(#seqHead)"/>
            ${lines(st.client, xs("client"), y1 + 18, "client")}${lines(st.server, xs("server"), y1 + 18, "server")}
        </g>`;
    }).join("");
    return `<svg class="seq-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Messages between the client and the server, in time order">
        <defs><marker id="seqHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="seq-head"/></marker></defs>
        <text class="seq-party" x="${L}" y="20" text-anchor="middle">Client (you)</text>
        <text class="seq-party" x="${R}" y="20" text-anchor="middle">Server (compute node)</text>
        <text class="seq-legend" x="${W / 2}" y="44" text-anchor="middle">CKKS ciphertext = your input, homomorphically encrypted · AES-sealed = AES-256-GCM on top · RSA-wrapped AES key = for the receiver only</text>
        <line class="seq-life" x1="${L}" y1="${TOP}" x2="${L}" y2="${H - 8}"/>
        <line class="seq-life" x1="${R}" y1="${TOP}" x2="${R}" y2="${H - 8}"/>
        ${lines(PROTOCOL_STATES[0].client, xs("client"), TOP + 18, "client")}${lines(PROTOCOL_STATES[0].server, xs("server"), TOP + 18, "server")}
        ${arrows}
        <text class="seq-time" x="${W - 6}" y="${H - 10}" text-anchor="end">time ↓</text>
    </svg>`;
}
