// ============================================================
// KORI — Guide figure
//
// The sheep, in its kit: black shirt with red trim, red shorts, red
// shoes, a feather. It is drawn, not a sprite sheet, so it can hold any
// pose the choreography asks for — including a full overhead reach,
// which a flat cut-out cannot do.
//
// Underneath it is an ordinary skeleton: shoulders, elbows, wrists,
// hips, knees and ankles, all in torso units, with elbows and knees
// solved by two-bone inverse kinematics. Only the drawing on top of
// those joints is a sheep, which is what lets the character change
// without touching a line of the scoring.
//
// Geometry is mapped to pixels at the last step, with the feet pinned to
// the floor — so when the figure sinks, the shoulders come down, exactly
// as a real body does.
// ============================================================

(function () {

const SVG_NS = 'http://www.w3.org/2000/svg';

// Straight off the character art.
const C = {
    fleece:   '#FFFFFF',
    line:     '#7A4A2E',
    lineDark: '#5E351F',
    face:     '#FDFBEE',
    skin:     '#FBF6E4',      // the bare arms and legs
    earInner: '#F7DFC0',
    horn:     '#E0A56A',
    eye:      '#3B2314',
    blush:    '#F8CFC0',
    shirt:    '#1A1613',
    trim:     '#D6231F',
    shorts:   '#D6231F',
    shoe:     '#D6231F',
    sole:     '#F2EDE4',
    feather:  '#F0D9B0'
};

// Proportions, in torso units. The joints that matter to the scoring —
// shoulders, and the arm bones that reach the wrist targets — are human.
// The leg bones and every radius below are drawing only, set to the
// character's own stumpy build. Nothing scored ever reads them.
const B = {
    shoulderHalf: 0.34,
    upperArm: 0.60, foreArm: 0.54,
    hipHalf:  0.19, thigh:   0.50, shin:   0.46, standHeight: 0.92,
    hipDrop:  1.00,
    headR:    0.46, headY:  -0.66,
    // The shirt is wider than it is tall, like the character art. Taller
    // than wide read as a lanky figure in a long top, nothing like the
    // stocky little thing it is meant to be.
    bodyCy:   0.46, bodyRx:  0.53, bodyRy:  0.44
};

const SCALE = 112;
const CX    = 200;
const FLOOR = 556;

// Two framings of the same drawing grid: `tight` hugs the figure, for the
// preview card and the decorative figures; `scene` is a 4:3 window with
// the figure at about 60% of the height, for a panel with a background.
const VIEWS = {
    tight: { x:   10, y: 164, w: 380, h: 424 },
    scene: { x: -200, y:  16, w: 800, h: 600 }
};

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const TAU = Math.PI * 2;

function mk(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
}

// A closed shape whose edge is a ring of small outward arcs — the cloud
// silhouette that reads instantly as wool, at head, paw and any size.
function fleecePath(cx, cy, rx, ry, bumps) {
    let d = '';
    for (let i = 0; i <= bumps; i++) {
        const a = (i / bumps) * TAU;
        const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
        if (i === 0) { d = 'M' + x.toFixed(1) + ' ' + y.toFixed(1); continue; }
        const p = (i - 1) / bumps * TAU;
        const chord = Math.hypot(rx * (Math.cos(a) - Math.cos(p)),
                                 ry * (Math.sin(a) - Math.sin(p)));
        const r = (chord * 0.62).toFixed(1);
        d += ' A' + r + ' ' + r + ' 0 0 1 ' + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return d + ' Z';
}

// ------------------------------------------------------------
// Two-bone IK. `bias` is the direction the joint prefers to fold toward,
// which stops elbows bending backwards and knees bending inwards.
//
// `flatten` pulls the joint back toward the straight line between root
// and end. Real elbows and knees fold mostly *forward*, out of the plane
// a front-on camera can see, so solving strictly in 2D throws them out
// sideways and the figure comes out bow-legged with its elbows stuck out
// like a teapot. Flattening fakes that missing depth. It is cosmetic
// only — nothing scored ever reads an elbow or a knee.
// ------------------------------------------------------------
function solveIK(root, end, a, b, bias, flatten) {
    let dx = end.x - root.x, dy = end.y - root.y;
    let d = Math.hypot(dx, dy);
    const min = Math.abs(a - b) + 0.02, max = a + b - 0.02;
    if (d < min) d = min;
    if (d > max) d = max;
    const raw = Math.hypot(dx, dy) || 1;
    const ux = dx / raw, uy = dy / raw;
    const along = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - along * along));
    let nx = -uy, ny = ux;
    if (nx * bias.x + ny * bias.y < 0) { nx = -nx; ny = -ny; }
    const f = flatten == null ? 1 : flatten;
    return { x: root.x + ux * along + nx * h * f, y: root.y + uy * along + ny * h * f };
}

// A limb is one stroked polyline: a thick outline with a thinner fill
// laid over it. Two tapered polygons meeting at a joint leave a notch no
// amount of patching hides, and the character art draws its limbs as
// plain outlined tubes anyway.
function limbLine(a, b, c) {
    return 'M' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) +
           ' L' + b.x.toFixed(1) + ' ' + b.y.toFixed(1) +
           ' L' + c.x.toFixed(1) + ' ' + c.y.toFixed(1);
}

const lerpPt = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

const ARM_W = 22, LEG_W = 30, EDGE = 9;

// A rounded shoe, widened a little on whichever foot is forward.
function shoe(ank, side, front) {
    const w = 26 + front * 5, h = 15;
    const x = ank.x + side * 3, y = ank.y + 6;
    return 'M' + (x - w) + ' ' + y +
           ' Q' + (x - w) + ' ' + (y - h) + ' ' + x + ' ' + (y - h) +
           ' Q' + (x + w) + ' ' + (y - h) + ' ' + (x + w) + ' ' + y +
           ' Q' + (x + w) + ' ' + (y + h * 0.8) + ' ' + x + ' ' + (y + h * 0.8) +
           ' Q' + (x - w) + ' ' + (y + h * 0.8) + ' ' + (x - w) + ' ' + y + ' Z';
}

const Avatar = {
    svg: null, p: {}, blinkAt: 0, mounted: false,

    mount(container, frame) {
        if (!container) return this;
        container.innerHTML = '';
        const V = VIEWS[frame] || VIEWS.tight;
        const svg = mk('svg', {
            viewBox: V.x + ' ' + V.y + ' ' + V.w + ' ' + V.h,
            width: '100%', height: '100%'
        });
        svg.style.display = 'block';
        svg.style.overflow = 'visible';
        container.appendChild(svg);

        const p = {};
        const edge = w => mk('path', { fill: 'none', stroke: C.line, 'stroke-width': w,
                                       'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
        const fill = (w, col) => mk('path', { fill: 'none', stroke: col, 'stroke-width': w,
                                              'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
        const solid = (col, w) => mk('path', { fill: col, stroke: C.line,
                                               'stroke-width': w || 4, 'stroke-linejoin': 'round' });

        p.shadow = mk('ellipse', { cy: FLOOR + 8, rx: 74, ry: 12, fill: '#2E4A24', opacity: '0.16' });
        svg.appendChild(p.shadow);

        // legs, then the shorts over the top of them
        p.legEdgeL = edge(LEG_W + EDGE); p.legEdgeR = edge(LEG_W + EDGE);
        p.legFillL = fill(LEG_W, C.skin); p.legFillR = fill(LEG_W, C.skin);
        p.shoeL = solid(C.shoe); p.shoeR = solid(C.shoe);
        p.soleL = mk('path', { fill: C.sole, stroke: C.line, 'stroke-width': 2.5 });
        p.soleR = mk('path', { fill: C.sole, stroke: C.line, 'stroke-width': 2.5 });
        [p.legEdgeL, p.legEdgeR, p.legFillL, p.legFillR,
         p.shoeL, p.shoeR, p.soleL, p.soleR].forEach(e => svg.appendChild(e));

        p.shorts = solid(C.shorts, 4);
        p.shortsStripe = mk('path', { fill: C.sole, opacity: '0.9' });
        svg.appendChild(p.shorts); svg.appendChild(p.shortsStripe);

        // shirt before the arms: drawn after them the body swallowed the
        // upper arms entirely and the figure lost its shoulders
        p.shirt = solid(C.shirt, 4.5);
        p.hem = mk('path', { fill: C.trim, stroke: C.line, 'stroke-width': 3 });
        p.hemPattern = mk('path', { fill: 'none', stroke: C.shirt, 'stroke-width': 2.5,
                                    'stroke-linecap': 'round' });
        p.collar = mk('path', { fill: 'none', stroke: C.trim, 'stroke-width': 5,
                                'stroke-linecap': 'round' });
        p.emblem = mk('path', { fill: 'none', stroke: C.trim, 'stroke-width': 3,
                                'stroke-linecap': 'round' });
        [p.shirt, p.hem, p.hemPattern, p.collar, p.emblem].forEach(e => svg.appendChild(e));

        // bare arms, with a black sleeve and a red cuff over the top third
        p.armEdgeL = edge(ARM_W + EDGE); p.armEdgeR = edge(ARM_W + EDGE);
        p.armFillL = fill(ARM_W, C.skin); p.armFillR = fill(ARM_W, C.skin);
        p.sleeveL = fill(ARM_W + 2, C.shirt); p.sleeveR = fill(ARM_W + 2, C.shirt);
        p.cuffL = fill(ARM_W + 2, C.trim);    p.cuffR = fill(ARM_W + 2, C.trim);
        [p.armEdgeL, p.armEdgeR, p.armFillL, p.armFillR,
         p.sleeveL, p.sleeveR, p.cuffL, p.cuffR].forEach(e => svg.appendChild(e));

        // head, as one group so it can nod and tilt in one piece
        p.headG = mk('g', {});
        svg.appendChild(p.headG);

        const R = B.headR * SCALE;
        p.feather = mk('path', { fill: C.feather, stroke: C.line, 'stroke-width': 3,
                                 'stroke-linejoin': 'round' });
        p.featherSpine = mk('path', { fill: 'none', stroke: C.line, 'stroke-width': 2 });
        p.hornL = mk('ellipse', { cx: -R * 0.74, cy: -R * 0.62, rx: R * 0.30, ry: R * 0.26,
                                  fill: C.horn, stroke: C.line, 'stroke-width': 4 });
        p.hornR = mk('ellipse', { cx:  R * 0.74, cy: -R * 0.62, rx: R * 0.30, ry: R * 0.26,
                                  fill: C.horn, stroke: C.line, 'stroke-width': 4 });
        p.earL = mk('ellipse', { cx: -R * 1.16, cy: -R * 0.10, rx: R * 0.56, ry: R * 0.24,
                                 fill: C.fleece, stroke: C.line, 'stroke-width': 4,
                                 transform: 'rotate(-14 ' + (-R * 1.16) + ' ' + (-R * 0.10) + ')' });
        p.earR = mk('ellipse', { cx:  R * 1.16, cy: -R * 0.10, rx: R * 0.56, ry: R * 0.24,
                                 fill: C.fleece, stroke: C.line, 'stroke-width': 4,
                                 transform: 'rotate(14 ' + (R * 1.16) + ' ' + (-R * 0.10) + ')' });
        p.earInL = mk('ellipse', { cx: -R * 1.24, cy: -R * 0.08, rx: R * 0.34, ry: R * 0.12,
                                   fill: C.earInner,
                                   transform: 'rotate(-14 ' + (-R * 1.24) + ' ' + (-R * 0.08) + ')' });
        p.earInR = mk('ellipse', { cx:  R * 1.24, cy: -R * 0.08, rx: R * 0.34, ry: R * 0.12,
                                   fill: C.earInner,
                                   transform: 'rotate(14 ' + (R * 1.24) + ' ' + (-R * 0.08) + ')' });

        p.woolHead = mk('path', { d: fleecePath(0, 0, R, R, 15), fill: C.fleece,
                                  stroke: C.line, 'stroke-width': 4.5, 'stroke-linejoin': 'round' });
        p.face = mk('path', { d: fleecePath(0, R * 0.16, R * 0.66, R * 0.62, 13), fill: C.face,
                              stroke: C.line, 'stroke-width': 3.5, 'stroke-linejoin': 'round' });
        p.blushL = mk('ellipse', { cx: -R * 0.46, cy: R * 0.30, rx: R * 0.17, ry: R * 0.11, fill: C.blush });
        p.blushR = mk('ellipse', { cx:  R * 0.46, cy: R * 0.30, rx: R * 0.17, ry: R * 0.11, fill: C.blush });
        p.eyeL = mk('ellipse', { cx: -R * 0.26, cy: R * 0.06, rx: R * 0.105, ry: R * 0.145, fill: C.eye });
        p.eyeR = mk('ellipse', { cx:  R * 0.26, cy: R * 0.06, rx: R * 0.105, ry: R * 0.145, fill: C.eye });
        p.nose = mk('path', { d: 'M' + (-R * 0.10) + ' ' + (R * 0.24) +
                                   ' L' + (R * 0.10) + ' ' + (R * 0.24) + ' L0 ' + (R * 0.36) + ' Z',
                              fill: 'none', stroke: C.lineDark, 'stroke-width': 3.2,
                              'stroke-linejoin': 'round' });
        p.mouth = mk('path', { d: 'M' + (-R * 0.22) + ' ' + (R * 0.44) +
                                    ' Q0 ' + (R * 0.62) + ' ' + (R * 0.22) + ' ' + (R * 0.44) + ' Z',
                               fill: '#E8776B', stroke: C.lineDark, 'stroke-width': 3,
                               'stroke-linejoin': 'round' });

        [p.feather, p.featherSpine, p.hornL, p.hornR, p.earL, p.earR, p.earInL, p.earInR,
         p.woolHead, p.face, p.blushL, p.blushR, p.eyeL, p.eyeR, p.nose, p.mouth]
            .forEach(e => p.headG.appendChild(e));

        // paws above everything, head included: where the hands are is the
        // one thing the player has to be able to read, and with a head this
        // size a raised arm would otherwise disappear behind it
        p.pawL = mk('path', { fill: C.skin, stroke: C.line, 'stroke-width': 4, 'stroke-linejoin': 'round' });
        p.pawR = mk('path', { fill: C.skin, stroke: C.line, 'stroke-width': 4, 'stroke-linejoin': 'round' });
        svg.appendChild(p.pawL); svg.appendChild(p.pawR);

        this.svg = svg; this.p = p; this.mounted = true;
        this.blinkAt = performance.now() + 2500;
        return this;
    },

    render(t, now) {
        if (!this.mounted || !t) return;
        const p = this.p;

        // The bob has to be on the beat or it is worse than no bob at all.
        // A captured dance carries the tempo of the track it came from;
        // anything else falls back to a slow idle sway.
        const bounce = t.bounce || 0;
        const hz     = t.bounceHz || 0.55;
        const phase  = now / 1000 * Math.PI * 2 * hz;
        const bob    = bounce ? (1 + Math.sin(phase)) / 2 : 0;
        const sway   = bounce ? Math.sin(phase / 2) * 0.07 * bounce : 0;

        // The 0.4545 is not a taste decision: the tracker defines lean as
        // (shoulderMid - hipMid) / torso * 2.2, so this is its exact
        // inverse. The figure leans by precisely as much as it asks for.
        const hip = { x: -t.lean * 0.4545 + t.stance.shift * 0.10 + sway, y: B.hipDrop };

        const legLen = B.standHeight * (1 - 0.30 * t.sink - 0.04 * bob * bounce);
        const half   = t.stance.width / 2;
        const drop   = Math.sqrt(Math.max(0.09, legLen * legLen - half * half));

        const frontL = t.stance.front < 0 ? -t.stance.front : 0;
        const frontR = t.stance.front > 0 ?  t.stance.front : 0;

        const hipL = { x: hip.x - B.hipHalf, y: hip.y };
        const hipR = { x: hip.x + B.hipHalf, y: hip.y };
        const ankL = { x: hip.x - half - frontL * 0.06, y: hip.y + drop + frontL * 0.05 };
        const ankR = { x: hip.x + half + frontR * 0.06, y: hip.y + drop + frontR * 0.05 };

        const kneeL = solveIK(hipL, ankL, B.thigh, B.shin, { x: -1, y: 0 }, 0.45);
        const kneeR = solveIK(hipR, ankR, B.thigh, B.shin, { x:  1, y: 0 }, 0.45);

        const shL = { x: -B.shoulderHalf, y:  t.lean * 0.07 };
        const shR = { x:  B.shoulderHalf, y: -t.lean * 0.07 };

        const elbL = solveIK(shL, t.L, B.upperArm, B.foreArm, { x: -0.45, y: 0.89 }, 0.5);
        const elbR = solveIK(shR, t.R, B.upperArm, B.foreArm, { x:  0.45, y: 0.89 }, 0.5);

        const footY = Math.max(ankL.y, ankR.y);
        const offY  = FLOOR - footY * SCALE;
        const S = q => ({ x: CX + q.x * SCALE, y: q.y * SCALE + offY });

        const sShL = S(shL),  sShR = S(shR);
        const sElL = S(elbL), sElR = S(elbR);
        const sHnL = S(t.L),  sHnR = S(t.R);
        const sHipL = S(hipL), sHipR = S(hipR);
        const sKnL = S(kneeL), sKnR = S(kneeR);
        const sAnL = S(ankL),  sAnR = S(ankR);

        // ---- legs and shoes
        const legL = limbLine(sHipL, sKnL, sAnL), legR = limbLine(sHipR, sKnR, sAnR);
        p.legEdgeL.setAttribute('d', legL); p.legFillL.setAttribute('d', legL);
        p.legEdgeR.setAttribute('d', legR); p.legFillR.setAttribute('d', legR);
        p.shoeL.setAttribute('d', shoe(sAnL, -1, frontL));
        p.shoeR.setAttribute('d', shoe(sAnR,  1, frontR));
        p.soleL.setAttribute('d', 'M' + (sAnL.x - 26) + ' ' + (sAnL.y + 11) +
                                  ' Q' + sAnL.x + ' ' + (sAnL.y + 17) + ' ' + (sAnL.x + 26) + ' ' + (sAnL.y + 11));
        p.soleR.setAttribute('d', 'M' + (sAnR.x - 26) + ' ' + (sAnR.y + 11) +
                                  ' Q' + sAnR.x + ' ' + (sAnR.y + 17) + ' ' + (sAnR.x + 26) + ' ' + (sAnR.y + 11));

        // ---- shorts, sitting over the hips
        const hipC = S({ x: hip.x, y: B.hipDrop - 0.06 });
        const sw = 0.46 * SCALE, sh = 0.26 * SCALE;
        p.shorts.setAttribute('d',
            'M' + (hipC.x - sw) + ' ' + (hipC.y - sh) +
            ' Q' + hipC.x + ' ' + (hipC.y - sh * 1.25) + ' ' + (hipC.x + sw) + ' ' + (hipC.y - sh) +
            ' L' + (hipC.x + sw * 0.92) + ' ' + (hipC.y + sh) +
            ' Q' + hipC.x + ' ' + (hipC.y + sh * 0.45) + ' ' + (hipC.x - sw * 0.92) + ' ' + (hipC.y + sh) + ' Z');
        p.shortsStripe.setAttribute('d',
            'M' + (hipC.x + sw * 0.34) + ' ' + (hipC.y - sh * 0.9) +
            ' l6 0 l-4 ' + (sh * 1.85) + ' l-6 0 Z');

        // ---- shirt
        const bodyC = S({ x: hip.x * 0.55, y: B.bodyCy });
        const bw = B.bodyRx * SCALE, bh = B.bodyRy * SCALE;
        p.shirt.setAttribute('d',
            'M' + (bodyC.x - bw * 0.86) + ' ' + (bodyC.y - bh * 0.72) +
            ' Q' + bodyC.x + ' ' + (bodyC.y - bh * 1.08) + ' ' + (bodyC.x + bw * 0.86) + ' ' + (bodyC.y - bh * 0.72) +
            ' Q' + (bodyC.x + bw * 1.06) + ' ' + bodyC.y + ' ' + (bodyC.x + bw * 0.88) + ' ' + (bodyC.y + bh * 0.82) +
            ' L' + (bodyC.x - bw * 0.88) + ' ' + (bodyC.y + bh * 0.82) +
            ' Q' + (bodyC.x - bw * 1.06) + ' ' + bodyC.y + ' ' + (bodyC.x - bw * 0.86) + ' ' + (bodyC.y - bh * 0.72) + ' Z');
        const hemY = bodyC.y + bh * 0.58, hemH = bh * 0.24;
        p.hem.setAttribute('d',
            'M' + (bodyC.x - bw * 0.885) + ' ' + hemY +
            ' L' + (bodyC.x + bw * 0.885) + ' ' + hemY +
            ' L' + (bodyC.x + bw * 0.88) + ' ' + (hemY + hemH) +
            ' L' + (bodyC.x - bw * 0.88) + ' ' + (hemY + hemH) + ' Z');
        // a running zigzag on the trim, the way the kit is patterned
        let zig = 'M' + (bodyC.x - bw * 0.80) + ' ' + (hemY + hemH * 0.5);
        for (let i = 0; i < 8; i++) {
            const x0 = bodyC.x - bw * 0.80 + (bw * 1.60 / 8) * i;
            zig += ' L' + (x0 + bw * 0.10) + ' ' + (hemY + hemH * (i % 2 ? 0.75 : 0.25));
        }
        p.hemPattern.setAttribute('d', zig);
        p.collar.setAttribute('d',
            'M' + (bodyC.x - bw * 0.34) + ' ' + (bodyC.y - bh * 0.80) +
            ' Q' + bodyC.x + ' ' + (bodyC.y - bh * 0.52) + ' ' + (bodyC.x + bw * 0.34) + ' ' + (bodyC.y - bh * 0.80));
        // a small koru on the chest
        const ex = bodyC.x + bw * 0.30, ey = bodyC.y - bh * 0.10;
        p.emblem.setAttribute('d',
            'M' + ex + ' ' + (ey + 12) + ' Q' + (ex - 10) + ' ' + (ey + 4) + ' ' + (ex - 4) + ' ' + (ey - 4) +
            ' Q' + (ex + 4) + ' ' + (ey - 12) + ' ' + (ex + 8) + ' ' + (ey - 2));

        // ---- arms
        //
        // Drawn from the edge of the shirt rather than from the shoulder
        // joint. The joint sits at 0.34 and the shirt is half again as
        // wide, so an arm drawn from the true shoulder spends its first
        // third buried under the body — and with a black sleeve on a black
        // shirt, the paws ended up floating with nothing joining them on.
        // The IK still solves from the real shoulder; only the drawing
        // starts further out, and nothing scored reads either.
        const drawShL = S({ x: -B.bodyRx * 0.80, y: shL.y + 0.05 });
        const drawShR = S({ x:  B.bodyRx * 0.80, y: shR.y + 0.05 });
        const armL = limbLine(drawShL, sElL, sHnL), armR = limbLine(drawShR, sElR, sHnR);
        p.armEdgeL.setAttribute('d', armL); p.armFillL.setAttribute('d', armL);
        p.armEdgeR.setAttribute('d', armR); p.armFillR.setAttribute('d', armR);
        const sleeve = (sh0, el) => 'M' + sh0.x.toFixed(1) + ' ' + sh0.y.toFixed(1) +
                                    ' L' + lerpPt(sh0, el, 0.36).x.toFixed(1) + ' ' +
                                           lerpPt(sh0, el, 0.36).y.toFixed(1);
        const cuff = (sh0, el) => 'M' + lerpPt(sh0, el, 0.36).x.toFixed(1) + ' ' +
                                        lerpPt(sh0, el, 0.36).y.toFixed(1) +
                                  ' L' + lerpPt(sh0, el, 0.50).x.toFixed(1) + ' ' +
                                         lerpPt(sh0, el, 0.50).y.toFixed(1);
        p.sleeveL.setAttribute('d', sleeve(drawShL, sElL));
        p.sleeveR.setAttribute('d', sleeve(drawShR, sElR));
        p.cuffL.setAttribute('d', cuff(drawShL, sElL));
        p.cuffR.setAttribute('d', cuff(drawShR, sElR));

        p.pawL.setAttribute('d', fleecePath(sHnL.x, sHnL.y, 22, 20, 7));
        p.pawR.setAttribute('d', fleecePath(sHnR.x, sHnR.y, 22, 20, 7));

        // ---- head
        const R = B.headR * SCALE;
        const headPos = S({ x: sway - t.lean * 0.12, y: B.headY });
        p.feather.setAttribute('d',
            'M' + (R * 0.34) + ' ' + (-R * 0.98) +
            ' Q' + (R * 0.62) + ' ' + (-R * 1.62) + ' ' + (R * 0.50) + ' ' + (-R * 1.92) +
            ' Q' + (R * 0.24) + ' ' + (-R * 1.58) + ' ' + (R * 0.28) + ' ' + (-R * 0.98) + ' Z');
        p.featherSpine.setAttribute('d',
            'M' + (R * 0.32) + ' ' + (-R * 1.00) + ' Q' + (R * 0.44) + ' ' + (-R * 1.50) +
            ' ' + (R * 0.49) + ' ' + (-R * 1.86));
        const tilt = clamp((t.R.y - t.L.y) * 8, -9, 9) + t.lean * 8;
        p.headG.setAttribute('transform',
            'translate(' + headPos.x + ',' + headPos.y + ') rotate(' + tilt + ')');

        p.shadow.setAttribute('cx', CX + hip.x * SCALE);
        p.shadow.setAttribute('rx', 40 + t.stance.width * 40);

        if (now > this.blinkAt) {
            const dt = now - this.blinkAt;
            if (dt < 130) { p.eyeL.setAttribute('ry', 1.5); p.eyeR.setAttribute('ry', 1.5); }
            else {
                p.eyeL.setAttribute('ry', R * 0.145); p.eyeR.setAttribute('ry', R * 0.145);
                this.blinkAt = now + 2600 + Math.random() * 2600;
            }
        }
    }
};

// Each call gives an independent figure with its own SVG and blink timer,
// so the guide, the preview and the decorative figures never fight over
// the same nodes.
Avatar.create = function () { return Object.create(Avatar); };

window.KoriAvatar = Avatar;
window.KoriAvatarIK = solveIK;

})();
