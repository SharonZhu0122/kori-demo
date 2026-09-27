/* KORI — the celebration on the summary screen.
 *
 * It fills the screen on purpose. The words and the score sit on a layer
 * above this canvas, so paper can fall anywhere without ever covering the
 * number the player is waiting to read — which is what lets it be a proper
 * celebration rather than a polite one in the corners.
 *
 * Three sources, because one is never enough to look like joy:
 *   - two fountains from the bottom corners, firing inwards and upwards
 *   - a fall from above, across the whole width, that keeps going for a
 *     few seconds so the screen stays busy while the score counts up
 *   - a ring that bursts outwards from the middle on the first beat
 *
 * Drawn on a canvas rather than as DOM nodes: four hundred elements
 * animating at once is the one thing that makes an older laptop stutter,
 * and the summary is the moment least worth stuttering through.
 */
const KoriConfetti = (function () {

    // The character's own colours, so the celebration belongs to this game
    // and not to a generic party.
    const COLOURS = ['#F27BA6', '#2FCFD6', '#F4C95D', '#FFFFFF', '#7FA8E0', '#EAF2FF'];

    const BURST   = 150;   // the opening fountains
    const RING    = 70;    // the ring out of the middle
    const FALL    = 280;   // released from above over the seconds that follow
    const FALL_S  = 3.0;   // how long the fall keeps arriving

    let canvas = null, ctx = null, bits = [], raf = 0, t0 = 0;
    let pending = [], elapsed = 0;

    function fit() {
        if (!canvas) return;
        const d = window.devicePixelRatio || 1;
        canvas.width  = canvas.clientWidth  * d;
        canvas.height = canvas.clientHeight * d;
        ctx.setTransform(d, 0, 0, d, 0, 0);
    }

    function piece(x, y, vx, vy) {
        const ribbon = Math.random() < 0.28;
        return {
            x: x, y: y, vx: vx, vy: vy,
            w: ribbon ? 4 + Math.random() * 3 : 8 + Math.random() * 8,
            h: ribbon ? 20 + Math.random() * 16 : 11 + Math.random() * 10,
            rot: Math.random() * Math.PI,
            spin: (Math.random() - 0.5) * 10,
            colour: COLOURS[(Math.random() * COLOURS.length) | 0],
            // Paper does not accelerate for ever, it reaches a speed and
            // drifts down at it. Simple gravity was the first attempt and it
            // cleared the screen in about a second — a celebration you miss
            // if you blink. Each piece eases towards its own falling speed
            // instead, and ribbons fall slower than squares, which is what
            // keeps the screen busy while the score counts up.
            term: ribbon ? 70 + Math.random() * 80 : 120 + Math.random() * 150,
            drag: (ribbon ? 0.86 : 0.91) + Math.random() * 0.05,
            // A slow sideways drift, out of phase piece to piece, so it
            // flutters rather than falling on rails.
            sway: 1.4 + Math.random() * 2.2,
            swayAmp: 26 + Math.random() * 62,
            phase: Math.random() * 6.283
        };
    }

    function build() {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        bits = [];
        pending = [];
        elapsed = 0;

        // Two fountains from the bottom corners.
        for (let i = 0; i < BURST; i++) {
            const left = i % 2 === 0;
            const angle = (left ? -1.05 : -2.09) + (Math.random() - 0.5) * 0.95;
            const speed = 700 + Math.random() * 620;
            bits.push(piece(left ? w * 0.06 : w * 0.94, h * 1.02,
                            Math.cos(angle) * speed, Math.sin(angle) * speed));
        }

        // A ring out of the middle, so the centre of the screen is in the
        // celebration too rather than being a quiet hole in it.
        for (let i = 0; i < RING; i++) {
            const a = (i / RING) * Math.PI * 2;
            const speed = 380 + Math.random() * 300;
            bits.push(piece(w * 0.5, h * 0.46,
                            Math.cos(a) * speed, Math.sin(a) * speed * 0.8));
        }

        // And a fall from above, spread across the full width and released
        // over the next few seconds rather than all at once.
        for (let i = 0; i < FALL; i++) {
            const p = piece(Math.random() * w, -40 - Math.random() * 120,
                            (Math.random() - 0.5) * 190, 90 + Math.random() * 190);
            p.at = Math.random() * FALL_S;
            pending.push(p);
        }
        pending.sort((a, b) => a.at - b.at);
    }

    function frame(now) {
        const dt = Math.min(0.032, (now - t0) / 1000);
        t0 = now;
        elapsed += dt;
        const w = canvas.clientWidth, h = canvas.clientHeight;

        while (pending.length && pending[0].at <= elapsed) bits.push(pending.shift());

        ctx.clearRect(0, 0, w, h);

        let alive = 0;
        for (const b of bits) {
            // Ease towards the falling speed rather than accelerating for
            // ever: a fountain still arcs up and turns over, then drifts.
            b.vy += (b.term - b.vy) * 1.5 * dt;
            b.vx *= Math.pow(b.drag, dt * 60);
            b.x += (b.vx + Math.sin((elapsed + b.phase) * b.sway) * b.swayAmp) * dt;
            b.y += b.vy * dt;
            b.rot += b.spin * dt;
            if (b.y > h + 60) continue;
            alive++;
            if (b.y < -60) continue;

            ctx.save();
            ctx.translate(b.x, b.y);
            ctx.rotate(b.rot);
            // Squashing the width by the spin fakes a piece of paper
            // tumbling through its own plane.
            ctx.scale(Math.cos(b.rot * 1.7), 1);
            ctx.fillStyle = b.colour;
            ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
            ctx.restore();
        }

        if (alive > 0 || pending.length) raf = requestAnimationFrame(frame);
        else stop();
    }

    return {
        mount(el) {
            // Called again every time a session ends, so the resize listener
            // is only ever attached once — otherwise a player who goes again
            // a dozen times leaves a dozen listeners behind.
            if (canvas !== el) {
                canvas = el;
                ctx = canvas.getContext('2d');
                window.addEventListener('resize', fit);
            }
            fit();
            return this;
        },

        fire() {
            if (!canvas) return;
            fit();
            const calm = window.matchMedia &&
                         window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            build();

            // A player who has asked the system for less movement gets the
            // colour without the motion: one still scatter, nothing flying.
            if (calm) {
                bits = bits.concat(pending).slice(0, 220);
                pending = [];
                for (const b of bits) {
                    b.x = Math.random() * canvas.clientWidth;
                    b.y = Math.random() * canvas.clientHeight;
                    b.vx = b.vy = 0; b.term = 0; b.swayAmp = 0;
                    // A tumble near a quarter turn draws the paper edge-on,
                    // which is invisible in a picture that is only one frame.
                    b.rot = (Math.random() - 0.5) * 0.9;
                }
                t0 = performance.now();
                frame(t0 + 16);
                cancelAnimationFrame(raf);
                return;
            }

            cancelAnimationFrame(raf);
            t0 = performance.now();
            raf = requestAnimationFrame(frame);
        },

        stop() { stop(); }
    };

    function stop() {
        cancelAnimationFrame(raf);
        raf = 0;
        bits = [];
        pending = [];
        if (ctx) ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    }
})();
