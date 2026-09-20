// ============================================================
// KORI — Pose tracking and scoring
//
// Replaces the old hand-only 3x3 grid. MediaPipe Pose gives 33 body
// landmarks; this module turns them into the same body-frame
// coordinates the choreography is written in, then measures how close
// the player is to the target the guide figure is currently showing.
//
// Only Pose runs now. The old build ran Hands and Pose on every frame,
// which is two models per frame for a signal that could only ever say
// "which ninth of the screen is the palm in".
// ============================================================

(function () {

// MediaPipe landmark indices we care about.
const LM = {
    nose: 0,
    shoulderL: 11, shoulderR: 12,
    elbowL: 13,    elbowR: 14,
    wristL: 15,    wristR: 16,
    hipL: 23,      hipR: 24,
    kneeL: 25,     kneeR: 26,
    ankleL: 27,    ankleR: 28
};

const MIN_VIS = 0.5;          // landmark confidence we insist on
const SMOOTH  = 0.55;         // exponential smoothing on the body frame
const LAG_SEC = 0.35;         // players follow the guide slightly late;
                              // score against where the guide was, not is

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function vis(lm, i) { const p = lm[i]; return p && (p.visibility == null || p.visibility > MIN_VIS); }

const Tracker = {
    ready: false,          // a usable body frame exists right now
    hipsVisible: false,
    legsVisible: false,
    frame: null,           // { L, R, elbowL, elbowR, ankleSpread, kneeBend, lean, torsoPx }
    raw: null,             // last raw landmark array, for the overlay
    lastAt: 0,
    _u: 0.25,              // smoothed torso length in normalised image units
    _ox: 0.5, _oy: 0.4,    // smoothed shoulder-mid

    // Turn a landmark set into body-frame coordinates.
    // Screen x is mirrored first so the player sees themselves the way a
    // mirror would: raise your left arm, the figure's left arm rises.
    update(landmarks, nowMs) {
        this.raw = landmarks;
        if (!landmarks) { this.ready = false; return; }

        // Shoulders are the one thing we cannot do without.
        if (!vis(landmarks, LM.shoulderL) || !vis(landmarks, LM.shoulderR)) {
            this.ready = false; return;
        }

        const m = i => ({ x: 1 - landmarks[i].x, y: landmarks[i].y });

        // MediaPipe's "left" is the subject's left. After mirroring it also
        // lands on the left of the picture, so the naming stays honest.
        const shL = m(LM.shoulderL), shR = m(LM.shoulderR);
        const shoulderMid = mid(shL, shR);
        const shoulderSpan = Math.hypot(shL.x - shR.x, shL.y - shR.y);

        // The unit is torso length, measured shoulders to hips. Plenty of
        // players sit close to a laptop with their hips out of shot, and the
        // first build simply refused to track them — every check stayed dark
        // and nothing was ever scored. Shoulder width is a reliable stand-in:
        // it runs about 0.68 of a torso, so it can stand in for the unit and
        // the arms can still be scored. Legs drop out on their own further
        // down, since they are not in shot either.
        this.hipsVisible = vis(landmarks, LM.hipL) && vis(landmarks, LM.hipR);

        let hipMid, u;
        if (this.hipsVisible) {
            hipMid = mid(m(LM.hipL), m(LM.hipR));
            u = Math.hypot(hipMid.x - shoulderMid.x, hipMid.y - shoulderMid.y);
        } else {
            u = shoulderSpan / 0.68;
            hipMid = { x: shoulderMid.x, y: shoulderMid.y + u };
        }
        if (u < 0.03) { this.ready = false; return; }   // player far too small in frame

        // Smooth the frame itself, not the joints — the reference stays
        // steady while real movement still comes through instantly.
        this._u  = this._u  * SMOOTH + u * (1 - SMOOTH);
        this._ox = this._ox * SMOOTH + shoulderMid.x * (1 - SMOOTH);
        this._oy = this._oy * SMOOTH + shoulderMid.y * (1 - SMOOTH);

        const U = this._u;
        const toBody = p => ({ x: (p.x - this._ox) / U, y: (p.y - this._oy) / U });

        const f = {
            L: toBody(m(LM.wristL)),
            R: toBody(m(LM.wristR)),
            elbowL: toBody(m(LM.elbowL)),
            elbowR: toBody(m(LM.elbowR)),
            shoulderL: toBody(shL),
            shoulderR: toBody(shR),
            hipMid: toBody(hipMid),
            shoulderWidth: Math.hypot(shL.x - shR.x, shL.y - shR.y) / U,
            torsoPx: U
        };

        // Torso lean: how far the shoulders sit to one side of the hips.
        f.lean = clamp((shoulderMid.x - hipMid.x) / U * 2.2, -1, 1);

        // Legs are optional — plenty of players will be framed from the
        // waist up, and the session must still work for them.
        const legs = [LM.kneeL, LM.kneeR, LM.ankleL, LM.ankleR];
        if (this.hipsVisible && legs.every(i => vis(landmarks, i))) {
            const ankL = toBody(m(LM.ankleL)), ankR = toBody(m(LM.ankleR));
            const kneeL = toBody(m(LM.kneeL)), kneeR = toBody(m(LM.kneeR));
            f.ankleSpread = Math.abs(ankR.x - ankL.x);
            // Hip to ankle is about 1.70 torso-lengths on a straight leg.
            // Bending the knees pulls that number in, and that shortening is
            // what "sinking" looks like from the front.
            const legDrop = ((ankL.y + ankR.y) / 2) - f.hipMid.y;
            f.kneeBend = clamp((1.70 - legDrop) / 0.45, 0, 1);
            f.weightShift = clamp(((kneeL.x + kneeR.x) / 2 - f.hipMid.x) * 2.0, -1, 1);
            this.legsVisible = true;
        } else {
            f.ankleSpread = null;
            f.kneeBend = null;
            f.weightShift = null;
            this.legsVisible = false;
        }

        this.frame = f;
        this.ready = true;
        this.lastAt = nowMs;
    },

    stale(nowMs) { return !this.ready || (nowMs - this.lastAt) > 500; },

    // The player's outline in raw (unmirrored) image coordinates, so the
    // camera view can be framed on them instead of on their bedroom.
    bounds() {
        const lm = this.raw;
        if (!lm) return null;
        let x0 = 1, y0 = 1, x1 = 0, y1 = 0, n = 0;
        for (let i = 0; i < lm.length; i++) {
            const p = lm[i];
            if (!p || (p.visibility != null && p.visibility < MIN_VIS)) continue;
            if (p.x < x0) x0 = p.x;
            if (p.x > x1) x1 = p.x;
            if (p.y < y0) y0 = p.y;
            if (p.y > y1) y1 = p.y;
            n++;
        }
        if (n < 4) return null;
        return { x0: x0, y0: y0, x1: x1, y1: y1 };
    },
    // The box the camera should try to show: the player plus enough room
    // for their arms wherever they put them.
    //
    // Framing on the bounding box of what is visible looked right and was
    // wrong. With the arms down the box is narrow, so the view zooms in;
    // the player then opens their arms right out and their hands leave the
    // picture — the fully extended positions, the ones the routines are
    // built on, are the ones you cannot see yourself reach.
    //
    // This box is measured from the torso instead, so it does not breathe
    // with the arms. A torso is one unit and a full sideways reach is about
    // 1.48 of them, so 1.75 each side leaves room for the reach and a
    // margin beyond it. Because the unit is the player's own torso, a short
    // player with a short reach and a tall player with a long one both get
    // the same amount of space around them.
    reserve(videoAspect) {
        if (!this.ready || !this._u) return null;
        const u = this._u;
        const va = videoAspect || 4 / 3;
        // x is a fraction of the width and y a fraction of the height, so a
        // width in torso units has to be divided by the aspect to become one.
        const halfW = (1.75 * u) / va;
        const halfH = 2.00 * u;
        const cx = 1 - this._ox;          // bounds() is unmirrored; so is this
        const cy = this._oy + 0.5 * u;    // mid-torso, not the shoulders
        return { x0: cx - halfW, x1: cx + halfW,
                 y0: cy - halfH, y1: cy + halfH };
    },


    // Body frame back to normalised image space. Used to paint the target
    // hand positions straight onto the camera view, so a player who cannot
    // read the guide figure can still just chase the two circles.
    // Returns MIRRORED coordinates, matching what the player sees.
    toImage(p) {
        return { x: this._ox + p.x * this._u, y: this._oy + p.y * this._u };
    }
};


// ------------------------------------------------------------
// Scoring
//
// Everything is a 0..1 similarity, combined by weight. Tolerances are
// deliberately loose: the brief is kaumatua wellbeing, not gymnastics
// marking, so "roughly there" should read as success.
// ------------------------------------------------------------

const WRIST_TOL   = 0.95;   // torso-lengths of error before a wrist scores zero
const STANCE_TOL  = 0.55;
const LEAN_TOL    = 0.9;
const SINK_TOL    = 0.7;
const STILL_TOL   = 0.12;   // wrist drift allowed during a hold

function similarity(err, tol) { return clamp(1 - err / tol, 0, 1); }

// The wrist term is sharpened before it counts. A straight linear falloff
// hands out so much partial credit that a player standing perfectly still
// scored nearly half marks, which made the meter meaningless — the gap
// between doing nothing and genuinely trying has to be visible.
function sharpen(x) { return Math.pow(x, 1.6); }

// Flowing moves ask the player to move; held moves ask the opposite, and
// the two are scored as opposites.
//
// The amount of movement expected is read off the guide itself rather than
// set to a constant. A fixed threshold looked reasonable until it was
// simulated: tai chi hands travel so slowly that a player following the
// guide perfectly failed it, while someone flapping at random passed. The
// question is not "are you moving fast enough", it is "are you moving as
// much as the guide is".
const ENGAGE_FLOOR = 0.35;   // credit kept for being present but still
const ENGAGE_DEAD  = 0.02;   // guide movement below this asks nothing

const Scorer = {
    history: [],          // recent player + guide wrist samples
    lastScore: 0,

    reset() { this.history = []; this.lastScore = 0; },

    push(frame, target, nowMs) {
        this.history.push({ L: frame.L, R: frame.R, tL: target.L, tR: target.R, t: nowMs });
        while (this.history.length && nowMs - this.history[0].t > 900) this.history.shift();
    },

    // How far the wrists drifted over the recent window — for the player,
    // and for the guide they are copying.
    drift(nowMs) {
        const recent = this.history.filter(h => nowMs - h.t < 600);
        if (recent.length < 3) return { player: 0, guide: 0 };
        let p = 0, g = 0;
        const a = recent[0];
        for (const h of recent) {
            p = Math.max(p, Math.hypot(h.L.x - a.L.x, h.L.y - a.L.y),
                            Math.hypot(h.R.x - a.R.x, h.R.y - a.R.y));
            g = Math.max(g, Math.hypot(h.tL.x - a.tL.x, h.tL.y - a.tL.y),
                            Math.hypot(h.tR.x - a.tR.x, h.tR.y - a.tR.y));
        }
        return { player: p, guide: g };
    },

    // Returns { total, wrists, parts:{} }
    score(frame, target, nowMs) {
        const errL = Math.hypot(frame.L.x - target.L.x, frame.L.y - target.L.y);
        const errR = Math.hypot(frame.R.x - target.R.x, frame.R.y - target.R.y);
        const sL = sharpen(similarity(errL, WRIST_TOL));
        const sR = sharpen(similarity(errR, WRIST_TOL));
        const wrists = (sL + sR) / 2;

        const parts = { wristL: sL, wristR: sR };
        let sum = wrists * 0.62, weight = 0.62;

        // Torso lean is available whenever the upper body is, and is what
        // separates a tai chi turn from an arm wave.
        const leanScore = similarity(Math.abs(frame.lean - target.lean), LEAN_TOL);
        parts.lean = leanScore;
        sum += leanScore * 0.13; weight += 0.13;

        // Legs only count when the camera can actually see them, so a player
        // sitting down, or framed from the waist up, is not marked down for it.
        if (frame.ankleSpread != null) {
            const stanceScore = similarity(Math.abs(frame.ankleSpread - target.stance.width), STANCE_TOL);
            const sinkScore   = similarity(Math.abs(frame.kneeBend - target.sink), SINK_TOL);
            parts.stance = stanceScore;
            parts.sink   = sinkScore;
            sum += stanceScore * 0.15 + sinkScore * 0.10;
            weight += 0.25;
        }

        let total = sum / weight;
        const d = this.drift(nowMs);

        if (target.move.hold && target.arrived) {
            const stillness = similarity(Math.max(0, d.player - STILL_TOL), 0.22);
            parts.stillness = stillness;
            total = total * (0.55 + 0.45 * stillness);
        } else if (!target.move.rest && d.guide > ENGAGE_DEAD) {
            // Capped at 1: matching the guide's effort is full credit, and
            // flapping harder than the guide earns nothing extra.
            const engagement = clamp(d.player / d.guide, ENGAGE_FLOOR, 1);
            parts.engagement = engagement;
            total = total * engagement;
        }

        this.lastScore = total;
        return { total: total, wrists: wrists, parts: parts };
    }
};

window.KoriTracker = Tracker;
window.KoriScorer  = Scorer;
window.KoriLM      = LM;
window.KoriLagSec  = LAG_SEC;

})();
