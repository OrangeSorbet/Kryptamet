// Dolly-zoom between two permanent "unit" wrapper elements (never cloned
// content -- always the real, final DOM). `buildTo(toEl)` populates the
// destination's real content BEFORE the animation starts, so there is never
// a mismatch between what's previewed and what's finally shown. The
// destination is made visible (but transparent) before buildTo runs, so
// content that measures itself (the flowchart's fit-to-pane scale) sees
// real dimensions.
// direction "in": fromEl recedes/fades while toEl rushes in from near-zero.
// direction "out": reverse. Both layers blur while moving, so the outgoing
// view never reads as sharp, oversized text behind the incoming one.
const ZOOM_MS = 650;
let zoomInFlight = false;

function zoomUnits({ fromEl, toEl, origin, direction, buildTo, onDone }) {
    zoomInFlight = true;
    toEl.style.transition = "none";
    toEl.style.opacity = "0";
    toEl.style.display = "block";
    if (buildTo) buildTo(toEl);

    const originStr = `${origin.x}px ${origin.y}px`;
    fromEl.style.transformOrigin = originStr;
    toEl.style.transformOrigin = originStr;

    toEl.style.zIndex = "10";
    toEl.style.transform = direction === "in" ? "scale(0.05)" : "scale(2.2)";
    toEl.style.filter = "blur(6px)";

    fromEl.style.zIndex = "5";
    fromEl.style.transform = "scale(1)";
    fromEl.style.opacity = "1";
    fromEl.style.filter = "blur(0px)";

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toEl.style.transition = "";
            fromEl.style.transform = direction === "in" ? "scale(2.2)" : "scale(0.05)";
            fromEl.style.opacity = "0";
            fromEl.style.filter = "blur(8px)";
            toEl.style.transform = "scale(1)";
            toEl.style.opacity = "1";
            toEl.style.filter = "blur(0px)";
        });
    });

    setTimeout(() => {
        fromEl.style.display = "none";
        fromEl.style.zIndex = "";
        toEl.style.zIndex = "";
        // A lingering filter/transform would make this layer the containing
        // block for its position:fixed/absolute descendants -- clear both.
        fromEl.style.filter = "";
        toEl.style.filter = "";
        toEl.style.transform = "";
        zoomInFlight = false;
        if (onDone) onDone();
    }, ZOOM_MS);
}
