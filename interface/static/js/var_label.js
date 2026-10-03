// Numbers labelled with their variable: the number, and the variable in small type just below it.
//   explanation strings:  vn(4350, "c₀ of x₁")      a token; linkExplanation (source_links.js) renders it
//   scene HTML:           vnHtml(4350, "c₀ of x₁")
//   both, as strings:     richText(text) renders the tokens in any scene text (no glossary links)
// linkExplanation also labels every plain "name = number" automatically (VN_AUTO), so "s = 3" shows s under 3.
const vn = (value, label) => `⟨${value}|${label}⟩`;

function vnHtml(value, label, innerHtml) {
    return `<span class="vn"><span class="vn-v">${innerHtml ?? escapeHtml(String(value))}</span><span class="vn-l">${escapeHtml(label)}</span></span>`;
}

// "name = number": a name (letters, digits, subscripts, primes, an optional [index]; or a "quoted name") then " = " and a number
// (minus sign, thousands commas, decimals, exponent, %). Hex like 0x5e and words after the number don't match.
const VN_AUTO = /(?<![\p{L}\p{N}_])(\p{L}[\p{L}\p{N}_₀-₉ᵢⱼ′]*(?:\[[^\]\s]{1,8}\])?|"[^"\n]{1,32}") = ([−-]?\d[\d,]*(?:\.\d+)?(?:e[−+-]?\d+)?%?)(?![\p{L}\p{N}_]|\.\d|\s*[×÷+*·^⊕/−-]\s*[\d(⟨])/gu;

// Plain text → HTML: auto-labelled "name = number", the rest through `plain` (glossary linking or escaping).
function vnAuto(text, plain) {
    let out = "", last = 0;
    for (const m of text.matchAll(VN_AUTO)) {
        out += plain(text.slice(last, m.index) + m[1] + " = ") + vnHtml(m[2], m[1].replace(/^"|"$/g, ""));
        last = m.index + m[0].length;
    }
    return out + plain(text.slice(last));
}

// Source-link tokens ⟦id|text|label?⟧ and number tokens ⟨value|label⟩, in one pass.
const RICH_TOKEN = /⟦([\w.-]+)\|([^⟧|]*)(?:\|([^⟧]*))?⟧|⟨([^|⟩]*)\|([^⟩]*)⟩/g;

function richText(text, plain = escapeHtml, auto = false) {
    const s = String(text);
    const rest = (t) => (auto ? vnAuto(t, plain) : plain(t));
    let out = "", last = 0;
    for (const m of s.matchAll(RICH_TOKEN)) {
        out += rest(s.slice(last, m.index));
        if (m[1] !== undefined) out += m[3] ? vnHtml(m[2], m[3], srcLinkHtml(m[1], m[2])) : srcLinkHtml(m[1], m[2]);
        else out += vnHtml(m[4], m[5]);
        last = m.index + m[0].length;
    }
    return out + rest(s.slice(last));
}
