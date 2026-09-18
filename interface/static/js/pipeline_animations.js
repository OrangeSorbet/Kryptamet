gsap.registerPlugin(ScrollTrigger);

document.querySelectorAll(".pipeline-step").forEach((step) => {
    gsap.from(step, {
        opacity: 0,
        y: 40,
        duration: 0.6,
        scrollTrigger: {
            trigger: step,
            start: "top 85%",
        },
    });
});

document.querySelectorAll(".flow-arrow").forEach((arrow, i) => {
    gsap.from(arrow, {
        opacity: 0,
        x: -10,
        duration: 0.4,
        delay: 0.2 * i,
        scrollTrigger: {
            trigger: arrow,
            start: "top 90%",
        },
    });
});

const SCRAMBLE_CHARS = "0123456789abcdef";

function scrambleReveal(el) {
    const finalText = el.textContent;
    const len = finalText.length;
    let frame = 0;
    const totalFrames = 20;

    const interval = setInterval(() => {
        frame++;
        let out = "";
        for (let i = 0; i < len; i++) {
            if (i < (len * frame) / totalFrames) {
                out += finalText[i];
            } else {
                out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
            }
        }
        el.textContent = out;
        if (frame >= totalFrames) {
            el.textContent = finalText;
            clearInterval(interval);
        }
    }, 30);
}

const scrambleObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            scrambleReveal(entry.target);
            scrambleObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.5 });

document.querySelectorAll("[data-scramble]").forEach((el) => scrambleObserver.observe(el));
