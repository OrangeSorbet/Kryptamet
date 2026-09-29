// Escapes a string for safe insertion via innerHTML. Anything derived from
// the user's typed text (feature traces, the input sentence) goes through
// this before landing in a template literal.
function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
