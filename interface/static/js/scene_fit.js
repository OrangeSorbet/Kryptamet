// Scales a chapter step's content up to fill the free area between the chapter
// chrome and the docked Scrubber (CSS zoom on #sceneContent's children via --fit,
// see scrubber.css). Only ever scales up; measured with layout offsets, so it
// is unaffected by the dolly-zoom transform that may be running.
const FIT_FILL = 0.9;
const FIT_MAX = 1.6;

function fitSceneContent(el) {
    const kids = [...el.children];
    el.style.setProperty("--fit", "1");
    if (!kids.length || !el.classList.contains("chapter-scene")) return;
    const cs = getComputedStyle(el);
    const availH = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const last = kids[kids.length - 1];
    const contentH = last.offsetTop + last.offsetHeight - kids[0].offsetTop;
    if (availH <= 0 || contentH <= 0) return;
    let z = Math.min(FIT_MAX, (availH * FIT_FILL) / contentH);
    if (z <= 1.02) return;
    // Safety net: zoomed text can re-wrap; back off until nothing overflows.
    for (; z > 1; z -= 0.05) {
        el.style.setProperty("--fit", z.toFixed(2));
        if (el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1) return;
    }
    el.style.setProperty("--fit", "1");
}

window.addEventListener("resize", () => {
    const el = document.getElementById("sceneContent");
    if (el) fitSceneContent(el);
});
