// Nested dolly zoom inside a chapter scene -- "a phase inside a phase".
// Reuses zoomUnits() from zoom_transition.js on two stacked layers inside a
// stage element instead of the page-level units, so a node of a diagram can
// be zoomed into (its internals rush in from the node's position) and back
// out again. Layers share one grid cell, so the stage is as tall as the
// taller layer and nothing is absolutely positioned.
//
//   const zs = createSubZoomStage(hostEl);   // {stage, outer, inner}
//   ...fill zs.outer (e.g. a graph)...
//   await subZoomInto(zs, '[data-node="inner"]', (innerEl) => { ...build... });
//   await subZoomOut(zs, '[data-node="inner"]', (outerEl) => { ...build... });
//   subZoomShow(zs, "inner");               // no animation (revisits)
//
// The selector names the element (inside the OUTER layer) the zoom is
// centred on. Both zooms resolve when the animation ends -- or immediately
// if the stage is no longer in the document (the user left the step).
// zoomUnits sets the global zoomInFlight for its 650 ms; its own timer
// always clears it, even if the stage is detached mid-zoom.
function createSubZoomStage(hostEl) {
    const stage = document.createElement("div");
    stage.className = "sub-zoom-stage";
    const outer = document.createElement("div");
    outer.className = "sub-zoom-layer";
    const inner = document.createElement("div");
    inner.className = "sub-zoom-layer";
    inner.style.display = "none";
    stage.append(outer, inner);
    hostEl.appendChild(stage);
    return { stage, outer, inner };
}

// Centre of `el` in `layer`'s own (untransformed) coordinates: offsets
// ignore CSS transforms, so this stays right even while an enclosing unit
// is mid-zoom, unlike getBoundingClientRect().
function subZoomOrigin(el, layer) {
    let x = el.offsetWidth / 2, y = el.offsetHeight / 2;
    for (let n = el; n && n !== layer; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
    for (let n = el.parentElement; n && n !== layer; n = n.parentElement) { x -= n.scrollLeft; y -= n.scrollTop; }
    return { x, y };
}

function subZoomShow(zs, which, build) {
    const show = which === "inner" ? zs.inner : zs.outer;
    const hide = which === "inner" ? zs.outer : zs.inner;
    hide.style.display = "none";
    show.style.display = "block";
    if (build) build(show);
}

function subZoomInto(zs, originSelector, buildInner) {
    return new Promise((resolve) => {
        if (!zs.stage.isConnected) { resolve(); return; }
        const originEl = zs.outer.querySelector(originSelector) || zs.outer;
        zoomUnits({
            fromEl: zs.outer, toEl: zs.inner, direction: "in",
            origin: subZoomOrigin(originEl, zs.outer),
            buildTo: buildInner, onDone: resolve,
        });
    });
}

function subZoomOut(zs, originSelector, buildOuter) {
    return new Promise((resolve) => {
        if (!zs.stage.isConnected) { resolve(); return; }
        // Lay the outer layer out (invisible) first so the origin node has
        // real offsets; zoomUnits then takes it from transparent to visible.
        zs.outer.style.opacity = "0";
        zs.outer.style.display = "block";
        if (buildOuter) buildOuter(zs.outer);
        const originEl = zs.outer.querySelector(originSelector) || zs.outer;
        zoomUnits({
            fromEl: zs.inner, toEl: zs.outer, direction: "out",
            origin: subZoomOrigin(originEl, zs.outer),
            onDone: resolve,
        });
    });
}
