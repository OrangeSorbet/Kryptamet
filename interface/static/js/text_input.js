// Text input panel (SMS Spam, Human vs AI): a textarea plus the registry's
// sample texts as one-click chips. Returns { get, set, focus, error }.
function createTextInput(host, model) {
    const samples = (model.samples.rows || []).map((r) => r.input.text);
    host.innerHTML = `
        <textarea id="textInput" class="input-text" rows="3" placeholder="Type a real sentence here..." aria-label="Your text"></textarea>
        <div class="overview-examples">${samples.length ? `<span class="overview-examples-label">Try:</span>` : ""}${samples.map((t, i) => `
            <button type="button" class="example-chip" data-i="${i}" title="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("")}</div>`;
    const area = host.querySelector("textarea");
    host.querySelectorAll(".example-chip").forEach((chip) => chip.addEventListener("click", () => {
        area.value = samples[Number(chip.dataset.i)];
        area.focus();
    }));
    return {
        get: () => ({ text: area.value }),
        set: (inp) => { area.value = (inp && inp.text) || ""; },
        focus: () => area.focus(),
        error: () => (area.value.trim() ? null : "Type a sentence first."),
    };
}
