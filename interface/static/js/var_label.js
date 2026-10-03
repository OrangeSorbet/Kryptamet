// Numbers labelled with their variable: the number, and the variable in small type just below it.
//   explanation strings:  vn(4350, "c₀ of x₁")      a token; linkExplanation (source_links.js) renders it
//   scene HTML:           vnHtml(4350, "c₀ of x₁")
//   popups (KaTeX):       kv(4350, "c_{0}")          \underset: the variable under the value
//   both, as strings:     richText(text) renders the tokens in any scene text (no glossary links)
// linkExplanation also
//   - labels every plain "name = number" automatically (VN_AUTO), so "s = 3" shows s under 3, and
//   - swaps every variable the step declares (step.vars = { "q₀": "1152…", … }) for its value with the
//     variable underneath, except where the variable is being assigned ("q₀ = …"), which keeps the symbol.
// Values longer than VN_MAX characters show as first…last (n digits); clicking one shows it whole.
const VN_MAX = 40;
const vn = (value, label) => `⟨${value}|${label}⟩`;

function vnShort(v) {
    const s = String(v);
    return s.length <= VN_MAX ? s : `${s.slice(0, 16)}…${s.slice(-16)}`;
}

function vnHtml(value, label, innerHtml) {
    const s = String(value);
    const v = innerHtml ?? (s.length <= VN_MAX
        ? escapeHtml(s)
        : `<span class="vn-long" role="button" tabindex="0" data-full="${escapeHtml(s)}" data-short="${escapeHtml(vnShort(s))}">${escapeHtml(vnShort(s))}</span><span class="vn-len">${s.length} digits</span>`);
    return `<span class="vn"><span class="vn-v">${v}</span><span class="vn-l">${escapeHtml(label)}</span></span>`;
}

// KaTeX: value (monospace, shortened past VN_MAX with its length) with the variable (TeX) underneath.
function kv(value, labelTex) {
    // Escape TeX specials that can occur in data (a passphrase's _ and friends); braces are kept, so a value
    // may itself be TeX such as 2^{60}.
    const s = String(value), short = vnShort(s).replace(/[_#%&$]/g, (c) => `\\${c}`).replace("…", "\\ldots ");
    const tail = s.length > VN_MAX ? `\\,{\\scriptstyle(${s.length}\\text{ digits})}` : "";
    return `\\underset{\\scriptstyle ${labelTex}}{\\mathtt{${short}}${tail}}`;
}

// Clicking a shortened value toggles the whole number (it wraps, so nothing is hidden under it).
document.addEventListener("click", (e) => {
    const el = e.target.closest && e.target.closest(".vn-long");
    if (!el) return;
    const full = el.textContent === el.dataset.short;
    el.textContent = full ? el.dataset.full : el.dataset.short;
    el.classList.toggle("vn-open", full);
});

// "name = number": a name (letters, digits, subscripts, primes, an optional [index]; or a "quoted name") then " = " and a number
// (minus sign, thousands commas, decimals, exponent, %). Hex like 0x5e and words after the number don't match.
const VN_AUTO = /(?<![\p{L}\p{N}_])(\p{L}[\p{L}\p{N}_₀-₉ᵢⱼ′]*(?:\[[^\]\s]{1,8}\])?|"[^"\n]{1,32}") = ([−-]?\d(?:[\d,]*\d)?(?:\.\d+)?(?:e[−+-]?\d+)?%?)(?![\p{L}\p{N}_]|\.\d|\s*[×÷+*·^⊕/−-]\s*[\d(⟨])/gu;

// Plain text → HTML: auto-labelled "name = number", the rest through `plain` (glossary linking or escaping).
function vnAuto(text, plain) {
    let out = "", last = 0;
    for (const m of text.matchAll(VN_AUTO)) {
        out += plain(text.slice(last, m.index) + m[1] + " = ") + vnHtml(m[2], m[1].replace(/^"|"$/g, ""));
        last = m.index + m[0].length;
    }
    return out + plain(text.slice(last));
}

// Declared variables → value with the variable underneath. A whole-symbol match only (not inside a longer
// name), and never where the symbol is being assigned (followed by "=").
const _varRe = new Map();
function vnVars(text, vars, plain) {
    const keys = Object.keys(vars || {});
    if (!keys.length) return plain(text);
    const sig = keys.join("\u0000");
    if (!_varRe.has(sig)) {
        const alt = [...keys].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
        // Not inside a word ("it's", "e.g."), not right after "-"/"'" and not before "(" (a function name).
        _varRe.set(sig, new RegExp(`(?<![\\p{L}\\p{N}_₀-₉′'’.\\-])(${alt})(?![\\p{L}\\p{N}_₀-₉′'’(]|\\.\\p{L})(?!\\s*=(?!=))`, "gu"));
    }
    let out = "", last = 0;
    for (const m of text.matchAll(_varRe.get(sig))) {
        out += plain(text.slice(last, m.index)) + vnHtml(vars[m[1]], m[1]);
        last = m.index + m[0].length;
    }
    return out + plain(text.slice(last));
}

// Source-link tokens ⟦id|text|label?⟧ and number tokens ⟨value|label⟩, in one pass.
const RICH_TOKEN = /⟦([\w.-]+)\|([^⟧|]*)(?:\|([^⟧]*))?⟧|⟨([^|⟩]*)\|([^⟩]*)⟩/g;

function richText(text, plain = escapeHtml, auto = false, vars = null) {
    const s = String(text);
    const withVars = (t) => vnVars(t, vars, plain);
    const rest = (t) => (auto ? vnAuto(t, withVars) : withVars(t));
    let out = "", last = 0;
    for (const m of s.matchAll(RICH_TOKEN)) {
        out += rest(s.slice(last, m.index));
        if (m[1] !== undefined) out += m[3] ? vnHtml(m[2], m[3], srcLinkHtml(m[1], m[2])) : srcLinkHtml(m[1], m[2]);
        else out += vnHtml(m[4], m[5]);
        last = m.index + m[0].length;
    }
    return out + rest(s.slice(last));
}

// Gives every step that has none of its own the chapter's variables (a step's own `vars` win, key by key).
function withVars(steps, vars) {
    steps.forEach((st) => { st.vars = { ...vars, ...(st.vars || {}) }; });
    return steps;
}
