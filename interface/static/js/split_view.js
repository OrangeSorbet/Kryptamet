// Split screen for the steps inside a chapter's graph (PBKDF2 in Key Setup,
// the CKKS pipeline in Encryption, AES-GCM counter mode in Transport): the
// graph step itself shows the whole graph (number N), and every step about
// one of its nodes (N.1, N.2, ... -- scrubber.js stepNumbers) is drawn as
//   left:  that node's own content (the step's renderVisual)
//   right: the whole graph, the node(s) highlighted, the edges into them flowing.
//
// subStep(step, { graph, focus: [ids], lit: [ids], flow, caption }) marks the step `sub` and wraps its
// renderVisual; the returned Promise waits for both halves.
function subStep(step, spec) {
    const draw = step.renderVisual;
    return {
        ...step,
        sub: true,
        renderVisual: (el) => {
            el.innerHTML = `
                <div class="split-view">
                    <div class="split-left"></div>
                    <div class="split-right">
                        <div class="split-graph-caption">${escapeHtml(spec.caption || "")}</div>
                        <div class="split-graph"></div>
                    </div>
                </div>`;
            const left = draw(el.querySelector(".split-left"));
            const right = renderPbkdf2Graph(el.querySelector(".split-graph"), spec.graph, {
                lit: spec.lit, focus: spec.focus, flow: spec.flow, skipAnimation: !!window.sceneAlreadyVisited,
            });
            return Promise.all([left, right]);
        },
    };
}
