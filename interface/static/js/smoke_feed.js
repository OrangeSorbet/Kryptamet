function createSmokeFeed(containerEl, lines, options) {
    options = options || {};
    const cssClass = options.cssClass || "";
    const H = containerEl.clientHeight;
    let i = 0;
    let timer = null;
    let speedGetter = options.speedGetter || (() => 5);

    function spawn() {
        if (i >= lines.length) {
            if (options.onDone) options.onDone();
            return;
        }
        const el = document.createElement("div");
        el.className = "smoke-line " + cssClass;
        el.textContent = lines[i];
        el.style.transition = "top 0.9s cubic-bezier(0,0,0.2,1), opacity 0.3s linear, filter 0.3s linear";
        containerEl.appendChild(el);

        requestAnimationFrame(() => {
            el.style.top = "45%";
            el.style.opacity = "1";
            el.style.filter = "blur(0px)";
        });

        setTimeout(() => {
            el.style.transition = "top 0.9s cubic-bezier(0.6,0,1,0.4), opacity 0.3s linear, filter 0.3s linear";
            el.style.top = (H + 20) + "px";
            el.style.opacity = "0";
            el.style.filter = "blur(8px)";
        }, 400);

        setTimeout(() => el.remove(), 1300);

        if (options.onStep) options.onStep(lines[i], i);

        i++;
        const spd = 11 - speedGetter();
        timer = setTimeout(spawn, spd * 90);
    }

    return {
        start: () => { i = 0; spawn(); },
        stop: () => { if (timer) clearTimeout(timer); },
        showAllInstant: () => {
            containerEl.innerHTML = "";
            lines.forEach((text) => {
                const el = document.createElement("div");
                el.className = "smoke-line " + cssClass;
                el.textContent = text;
                el.style.position = "static";
                el.style.opacity = "1";
                el.style.filter = "none";
                el.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
                el.style.padding = "2px 0";
                containerEl.appendChild(el);
            });
        },
    };
}