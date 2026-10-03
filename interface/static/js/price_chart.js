// Price direction case chart (tabular_input.js): the real closes of the 20
// trading days before the case's day as a line, then that day as a Low-High
// bar with an Open tick -- taken from the input fields, so it follows your
// edits -- and the day's real close (what the label is from, not a model input).
function priceChartSvg(hist, row) {
    const W = 640, H = 150, L = 56, R = 110, T = 12, B = 22;
    const closes = hist.close, n = closes.length, prev = closes[n - 1];
    const day = { open: row.Open, high: row.High, low: row.Low };
    const vals = [...closes, hist.day_close, day.open, day.high, day.low].filter(Number.isFinite);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const padV = (hi - lo) * 0.08 || 1;
    lo -= padV; hi += padV;
    const x = (i) => L + (i * (W - L - R)) / n;
    const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
    const f = (v) => v.toFixed(2);
    const line = closes.map((c, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(c).toFixed(1)}`).join("");
    const dx = x(n);
    const bar = [day.low, day.high, day.open].every(Number.isFinite)
        ? `<line class="pc-range" x1="${dx}" x2="${dx}" y1="${y(day.high)}" y2="${y(day.low)}"/>
           <line class="pc-range" x1="${dx - 7}" x2="${dx}" y1="${y(day.open)}" y2="${y(day.open)}"/>
           <text class="pc-tag" x="${dx + 10}" y="${y(day.high) + 4}">High ${f(day.high)}</text>
           <text class="pc-tag" x="${dx + 10}" y="${y(day.low) + 4}">Low ${f(day.low)}</text>`
        : "";
    const up = hist.day_close > prev;
    return `<svg class="price-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Closing prices before ${hist.day} and that day's range">
        <line class="pc-axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
        <text class="pc-label" x="${L - 6}" y="${y(hi - padV) + 4}" text-anchor="end">${f(hi - padV)}</text>
        <text class="pc-label" x="${L - 6}" y="${y(lo + padV) + 4}" text-anchor="end">${f(lo + padV)}</text>
        <line class="pc-prev" x1="${x(n - 1)}" x2="${dx + 4}" y1="${y(prev)}" y2="${y(prev)}"/>
        <path class="pc-line" d="${line}"/>
        <circle class="pc-dot" cx="${x(n - 1)}" cy="${y(prev)}" r="3"/>
        ${bar}
        <circle class="pc-close ${up ? "up" : "down"}" cx="${dx}" cy="${y(hist.day_close)}" r="4"/>
        <text class="pc-label" x="${L}" y="${H - 6}">${hist.dates[0]}</text>
        <text class="pc-label" x="${x(n - 1) - 8}" y="${y(prev) - 8}" text-anchor="end">prev close ${f(prev)}</text>
        <text class="pc-label pc-day" x="${dx}" y="${H - 6}" text-anchor="middle">${hist.day}</text>
    </svg>
    <div class="pc-legend"><span class="pc-key line"></span>closes of the ${n} trading days before
        <span class="pc-key range"></span>this day: Low–High bar, Open tick (your fields)
        <span class="pc-key close ${up ? "up" : "down"}"></span>real close ${f(hist.day_close)} (${up ? "above" : "not above"} prev close; not a model input)</div>`;
}
