// ============================================================
// KORI — Choreography
//
// Every movement is described in BODY FRAME, not screen pixels:
//   origin = midpoint between the shoulders
//   unit   = torso length (shoulder-mid to hip-mid)
//   x      = sideways, negative is the player's LEFT (mirrored view)
//   y      = downward, so -1.0 is a torso-length above the shoulders
//
// A target of {x:-1.45, y:0} means "left arm straight out to the side
// at shoulder height" for a tall player and a short one alike, which
// is why height and distance from the camera stop mattering.
//
// The numbers come from real body proportions, not guesswork: a
// shoulder sits about 0.34 torso-lengths off centre and an arm is
// about 1.14 torso-lengths long, so full reach to the side lands at
// 1.48 and straight overhead at about -1.12. Every anchor below is
// inside that envelope — nothing asks the player to reach further
// than an arm actually goes.
//
// The same data drives the on-screen guide figure AND the scoring, so
// what the player is shown and what they are marked against cannot
// drift apart.
// ============================================================

(function () {

// Body proportions, in torso units. Used by the avatar's arm solver too.
const BODY = {
    shoulderHalf: 0.34,
    upperArm:     0.60,
    foreArm:      0.54,
    armReach:     1.14,
    hipHalf:      0.22,
    thigh:        0.90,
    shin:         0.85
};

// ------------------------------------------------------------
// Named hand positions for the player's LEFT hand. Mirror them with
// mir() for the right. Naming the shapes once keeps the sequences
// below readable and keeps every move inside the reach envelope.
// ------------------------------------------------------------
const A = {
    downSide:    { x: -0.42, y:  1.05 },   // arm hanging at the side
    lowFront:    { x: -0.26, y:  0.82 },   // hands low in front, at the waist
    waistSide:   { x: -0.64, y:  0.88 },
    hipLow:      { x: -0.55, y:  1.00 },
    chestMid:    { x: -0.09, y:  0.30 },   // hands together at the chest
    chestPush:   { x: -0.38, y:  0.22 },   // palms pushing forward
    shoulderOut: { x: -1.45, y:  0.00 },   // straight out to the side
    outLow:      { x: -1.24, y:  0.66 },   // out and down, 45 degrees
    outHigh:     { x: -1.20, y: -0.64 },   // out and up, 45 degrees
    upV:         { x: -0.78, y: -1.00 },   // up in a V
    upStraight:  { x: -0.28, y: -1.12 },   // straight overhead
    faceSide:    { x: -0.72, y: -0.30 },   // hand at face height
    temple:      { x: -0.45, y: -0.62 }    // hand beside the head
};

const mir = p => ({ x: -p.x, y: p.y });
const at  = (x, y) => ({ x: x, y: y });

// ------------------------------------------------------------
// Stances, in torso units, measured at the feet.
//   width = ankle separation
//   shift = weight, -1 fully on the left foot, +1 on the right
//   front = which foot steps forward (0 none, -1 left, +1 right)
// ------------------------------------------------------------
const STANCES = {
    'together':  { width: 0.30, shift:  0.00, front:  0 },
    'shoulder':  { width: 0.66, shift:  0.00, front:  0 },
    'wide':      { width: 1.00, shift:  0.00, front:  0 },
    'bow-left':  { width: 0.88, shift: -0.55, front: -1 },
    'bow-right': { width: 0.88, shift:  0.55, front:  1 },
    'sit-back':  { width: 0.88, shift:  0.45, front: -1 },
    'march':     { width: 0.58, shift:  0.00, front:  0 }
};


// ============================================================
// TAI CHI — a simplified Yang-style sequence.
//
// Each move carries a `via` point: the arc the hands travel through on
// the way in. That curve is what makes tai chi look like tai chi
// instead of two hands sliding between grid squares, and because the
// scorer reads the same curve, a player who cuts the corner scores
// lower than one who follows it round.
// ============================================================

const taiChi = [
{ n:'Commencing', cn:'起势', dur:20, travel:0.85, sink:0.20, lean:0, stance:'shoulder',
  cue:'Float both hands up to shoulder height, then press gently down',
  via:{ L:at(-0.32, 0.02), R:at(0.32, 0.02) },
  L:at(-0.30, 0.80), R:at(0.30, 0.80) },

{ n:'Ward Off', cn:'掤', dur:18, travel:0.8, sink:0.30, lean:-0.42, stance:'bow-left',
  cue:'Left arm rounds across your chest, right hand rests low',
  via:{ L:at(-0.45, 0.70), R:at(0.40, 0.55) },
  L:at(-0.05, 0.25), R:at(0.45, 0.90) },

{ n:'Roll Back', cn:'捋', dur:16, travel:0.85, sink:0.35, lean:0.36, stance:'sit-back',
  cue:'Sit back and let both hands sweep down to your right',
  via:{ L:at(0.02, 0.35), R:at(0.58, 0.65) },
  L:at(0.18, 0.55), R:at(0.70, 0.85) },

{ n:'Press', cn:'挤', dur:14, travel:0.75, sink:0.28, lean:-0.20, stance:'bow-left',
  cue:'Bring the hands together and press forward',
  via:{ L:at(-0.20, 0.55), R:at(0.22, 0.60) },
  L:at(-0.12, 0.28), R:at(0.06, 0.33) },

{ n:'Push', cn:'按', dur:14, travel:0.75, sink:0.25, lean:-0.15, stance:'bow-left',
  cue:'Draw back, then push both palms forward at chest height',
  via:{ L:at(-0.34, 0.62), R:at(0.34, 0.62) },
  L:A.chestPush, R:mir(A.chestPush) },

{ n:'Single Whip', cn:'单鞭', dur:18, travel:0.65, hold:true, sink:0.35, lean:0, stance:'wide',
  cue:'Open both arms wide and hold — steady and still',
  via:{ L:at(-0.15, 0.40), R:at(0.65, 0.15) },
  L:at(-1.30, 0.10), R:at(1.42, -0.08) },

{ n:'Rest and Breathe', dur:20, rest:true, travel:0.5, sink:0.05, lean:0, stance:'shoulder',
  cue:'Let the arms hang. Breathe in, breathe out',
  L:A.downSide, R:mir(A.downSide) },

{ n:'Cloud Hands', cn:'云手', dur:16, travel:0.9, sink:0.30, lean:-0.55, stance:'wide',
  cue:'Turn to the left — top hand at face height, lower hand at your waist',
  via:{ L:at(-0.15, 0.15), R:at(0.45, 0.45) },
  L:at(-0.72, -0.30), R:at(-0.06, 0.72) },

{ n:'Cloud Hands', cn:'云手', dur:16, travel:0.9, sink:0.30, lean:0.55, stance:'wide',
  cue:'Now turn to the right, the hands trading places',
  via:{ L:at(-0.45, 0.45), R:at(0.15, 0.15) },
  L:at(0.06, 0.72), R:at(0.72, -0.30) },

{ n:'White Crane Spreads Wings', cn:'白鹤亮翅', dur:18, travel:0.65, hold:true,
  sink:0.20, lean:0.30, stance:'bow-right',
  cue:'Right hand lifts above your head, left hand settles by your hip. Hold',
  via:{ L:at(-0.25, 0.50), R:at(0.40, -0.25) },
  L:at(-0.55, 0.95), R:at(0.55, -0.95) },

{ n:'Brush Knee', cn:'搂膝拗步', dur:16, travel:0.8, sink:0.30, lean:-0.35, stance:'bow-left',
  cue:'Left hand brushes past your knee as the right palm pushes forward',
  via:{ L:at(-0.20, 0.60), R:at(0.62, -0.35) },
  L:at(-0.62, 1.05), R:at(0.32, 0.10) },

{ n:'Brush Knee', cn:'搂膝拗步', dur:16, travel:0.8, sink:0.30, lean:0.35, stance:'bow-right',
  cue:'Change sides — right hand brushes, left palm pushes',
  via:{ L:at(-0.62, -0.35), R:at(0.20, 0.60) },
  L:at(-0.32, 0.10), R:at(0.62, 1.05) },

{ n:'Play the Lute', cn:'手挥琵琶', dur:16, travel:0.65, hold:true,
  sink:0.28, lean:0, stance:'bow-left',
  cue:'One hand high, one hand low, as if holding a small guitar. Hold',
  via:{ L:at(-0.50, 0.35), R:at(0.45, 0.75) },
  L:at(-0.20, -0.15), R:at(0.08, 0.50) },

{ n:'Repulse Monkey', cn:'倒卷肱', dur:15, travel:0.85, sink:0.25, lean:0.10, stance:'shoulder',
  cue:'Left palm pushes forward as the right hand draws back behind you',
  via:{ L:at(-0.55, 0.60), R:at(0.50, 0.38) },
  L:at(-0.14, 0.22), R:at(0.95, 0.72) },

{ n:'Repulse Monkey', cn:'倒卷肱', dur:15, travel:0.85, sink:0.25, lean:-0.10, stance:'shoulder',
  cue:'And the other way — right palm forward, left hand back',
  via:{ L:at(-0.50, 0.38), R:at(0.55, 0.60) },
  L:at(-0.95, 0.72), R:at(0.14, 0.22) },

{ n:'Rest and Breathe', dur:20, rest:true, travel:0.5, sink:0.05, lean:0, stance:'shoulder',
  cue:'Halfway through. Rest your arms and breathe',
  L:A.downSide, R:mir(A.downSide) },

{ n:'Fair Lady Works the Shuttles', cn:'玉女穿梭', dur:16, travel:0.8,
  sink:0.30, lean:-0.35, stance:'bow-left',
  cue:'Left hand guards above your forehead, right palm pushes out',
  via:{ L:at(-0.25, 0.12), R:at(0.50, 0.50) },
  L:at(-0.55, -0.75), R:at(0.26, 0.14) },

{ n:'High Pat on Horse', cn:'高探马', dur:14, travel:0.75, sink:0.20, lean:0, stance:'shoulder',
  cue:'Right hand reaches forward at face height, left hand draws to your waist',
  via:{ L:at(-0.12, 0.45), R:at(0.62, 0.25) },
  L:at(-0.50, 0.80), R:at(0.26, -0.20) },

{ n:'Needle at Sea Bottom', cn:'海底针', dur:14, travel:0.75, sink:0.50, lean:-0.10, stance:'bow-left',
  cue:'Sink down and let the right hand point toward the floor',
  via:{ L:at(-0.26, 0.55), R:at(0.45, 0.38) },
  L:at(-0.44, 0.85), R:at(0.14, 1.05) },

{ n:'Fan Through the Back', cn:'扇通背', dur:16, travel:0.65, hold:true,
  sink:0.28, lean:-0.15, stance:'bow-left',
  cue:'Open out like a fan — one hand high, one hand out. Hold',
  via:{ L:at(-0.38, 0.38), R:at(0.26, -0.12) },
  L:at(-1.15, 0.06), R:at(0.50, -0.70) },

{ n:'Cloud Hands', cn:'云手', dur:14, travel:0.9, sink:0.30, lean:-0.55, stance:'wide',
  cue:'Cloud hands once more, turning to the left',
  via:{ L:at(-0.15, 0.15), R:at(0.45, 0.45) },
  L:at(-0.72, -0.30), R:at(-0.06, 0.72) },

{ n:'Cloud Hands', cn:'云手', dur:14, travel:0.9, sink:0.30, lean:0.55, stance:'wide',
  cue:'And turning to the right',
  via:{ L:at(-0.45, 0.45), R:at(0.15, 0.15) },
  L:at(0.06, 0.72), R:at(0.72, -0.30) },

{ n:'Cross Hands', cn:'十字手', dur:16, travel:0.9, sink:0.25, lean:0, stance:'shoulder',
  cue:'Sweep both arms wide, then gather them crossed at your chest',
  via:{ L:at(-1.05, 0.00), R:at(1.05, 0.00) },
  L:at(0.09, 0.38), R:at(-0.09, 0.38) },

{ n:'Closing', cn:'收势', dur:20, travel:0.9, sink:0.05, lean:0, stance:'together',
  cue:'Let the hands press down and come to rest. Well done',
  via:{ L:at(-0.38, 0.28), R:at(0.38, 0.28) },
  L:A.downSide, R:mir(A.downSide) }
];


// ============================================================
// RHYTHM DANCE — timed against the filmed guide.
//
// The arm shapes follow what the dancers in the video are doing at
// that point in the music, so a player copying the screen is copying
// the thing being scored.
//
// Fifteen moves across 2:33, about ten seconds each. The first cut had
// nineteen and changed too fast to follow: this is the only mode where
// the guide is footage rather than the figure, so a move change is
// announced by nothing except the words changing. Duplicated shapes were
// dropped rather than every move being shortened.
// ============================================================

const rhythm = [
{ n:'Lift Them Up', dur:10, travel:0.7, stance:'march', bounce:1,
  cue:'Step in place and lift both arms up high',
  L:at(-0.60, -0.85), R:at(0.60, -0.85) },

{ n:'Big Sky', dur:10, travel:0.5, hold:true, stance:'march', bounce:0.4,
  cue:'Both arms up in a big V — hold it there',
  L:A.upV, R:mir(A.upV) },

{ n:'Right Arm Up', dur:10, travel:0.7, stance:'march', bounce:1,
  cue:'Right arm reaches up, left arm stays low',
  L:at(-0.50, 0.85), R:at(0.62, -0.92) },

{ n:'Left Arm Up', dur:10, travel:0.7, stance:'march', bounce:1,
  cue:'Now swap — left arm up',
  L:at(-0.62, -0.92), R:at(0.50, 0.85) },

{ n:'Arms Out', dur:10, travel:0.7, stance:'march', bounce:1,
  cue:'Both arms straight out at shoulder height',
  L:A.shoulderOut, R:mir(A.shoulderOut) },

{ n:'Open Wide', dur:10, travel:0.7, stance:'march', bounce:1,
  cue:'Open the arms wide and lift them a little',
  L:at(-1.38, -0.18), R:at(1.38, -0.18) },

{ n:'Sweep Down', dur:11, travel:0.7, stance:'march', bounce:1,
  cue:'Sweep both arms down and out',
  L:at(-0.80, 1.00), R:at(0.80, 1.00) },

{ n:'Right Diagonal', dur:10, travel:0.7, stance:'march', bounce:1,
  cue:'Reach up to the right corner',
  L:at(-0.38, 0.72), R:at(1.10, -0.72) },

{ n:'Left Diagonal', dur:10, travel:0.7, stance:'march', bounce:1,
  cue:'Now up to the left corner',
  L:at(-1.10, -0.72), R:at(0.38, 0.72) },

{ n:'Reach for the Sky', dur:10, travel:0.5, hold:true, stance:'march', bounce:0.4,
  cue:'Reach straight up and hold',
  L:A.upStraight, R:mir(A.upStraight) },

{ n:'Circle Out', dur:10, travel:0.85, stance:'march', bounce:1,
  cue:'Circle the arms out and up',
  via:{ L:at(-0.70, 0.70), R:at(0.70, 0.70) },
  L:at(-1.15, -0.50), R:at(1.15, -0.50) },

{ n:'Arms Out', dur:11, travel:0.7, stance:'march', bounce:1,
  cue:'Out to the sides one more time',
  L:at(-1.45, 0.06), R:at(1.45, 0.06) },

{ n:'Lift and Sway', dur:10, travel:0.7, stance:'march', bounce:1,
  cue:'Lift the arms and sway with the music',
  L:at(-0.82, -0.78), R:at(0.82, -0.78) },

{ n:'Gather Low', dur:10, travel:0.7, stance:'march', bounce:1,
  cue:'Bring the hands in low, at your waist',
  L:at(-0.24, 0.88), R:at(0.24, 0.88) },

{ n:'Big Finish', dur:11, travel:0.6, stance:'march', bounce:1,
  cue:'Arms up wide for the finish!',
  L:at(-0.80, -1.00), R:at(0.80, -1.00) }
];


// ============================================================
// BOLLYWOOD — bigger, brighter shapes, one rest in the middle.
// ============================================================

const bollywood = [
{ n:'Namaste', dur:12, travel:0.5, hold:true, stance:'march', bounce:0.4,
  cue:'Palms together at your chest to begin',
  L:A.chestMid, R:mir(A.chestMid) },

{ n:'Open to the Sides', dur:12, travel:0.7, stance:'march', bounce:1,
  cue:'Open both arms out wide',
  L:at(-1.38, -0.06), R:at(1.38, -0.06) },

{ n:'Right Hand Turns', dur:11, travel:0.7, stance:'march', bounce:1,
  cue:'Right hand up, turning the wrist like changing a light bulb',
  L:at(-0.48, 0.82), R:at(0.66, -0.86) },

{ n:'Left Hand Turns', dur:11, travel:0.7, stance:'march', bounce:1,
  cue:'Now the left hand up, turning',
  L:at(-0.66, -0.86), R:at(0.48, 0.82) },

{ n:'Both Hands High', dur:12, travel:0.45, hold:true, stance:'march', bounce:0.4,
  cue:'Both hands high above your head — hold',
  L:at(-0.34, -1.10), R:at(0.34, -1.10) },

{ n:'Sweep to the Right', dur:11, travel:0.85, stance:'march', bounce:1,
  cue:'Sweep both hands down across to the right',
  via:{ L:at(-0.10, -0.40), R:at(0.62, -0.45) },
  L:at(0.14, 0.70), R:at(0.82, 1.00) },

{ n:'Sweep to the Left', dur:11, travel:0.85, stance:'march', bounce:1,
  cue:'And sweep across to the left',
  via:{ L:at(-0.62, -0.45), R:at(0.10, -0.40) },
  L:at(-0.82, 1.00), R:at(-0.14, 0.70) },

{ n:'Shoulder Shimmy', dur:11, travel:0.6, stance:'march', bounce:1.3,
  cue:'Elbows in, shoulders shimmying',
  L:at(-0.62, 0.42), R:at(0.62, 0.42) },

{ n:'Point to the Right', dur:11, travel:0.7, stance:'march', bounce:1,
  cue:'Point away to your right',
  L:at(-0.30, 0.60), R:at(1.32, -0.30) },

{ n:'Point to the Left', dur:11, travel:0.7, stance:'march', bounce:1,
  cue:'Now point away to your left',
  L:at(-1.32, -0.30), R:at(0.30, 0.60) },

{ n:'Rest and Breathe', dur:20, rest:true, travel:0.5, stance:'shoulder', bounce:0,
  cue:'Take a breather. Shake the arms out',
  L:A.downSide, R:mir(A.downSide) },

{ n:'Lotus Hands', dur:11, travel:0.6, stance:'march', bounce:1,
  cue:'Both hands in front, wrists turned up',
  L:at(-0.34, 0.10), R:at(0.34, 0.10) },

{ n:'Big Circle', dur:12, travel:0.9, stance:'march', bounce:1,
  cue:'Draw a big circle with both arms',
  via:{ L:at(-0.75, 0.75), R:at(0.75, 0.75) },
  L:at(-1.22, -0.55), R:at(1.22, -0.55) },

{ n:'Gather Low', dur:11, travel:0.7, stance:'march', bounce:1,
  cue:'Bring the hands down low together',
  L:at(-0.22, 0.92), R:at(0.22, 0.92) },

{ n:'Reach Up Right', dur:11, travel:0.7, stance:'march', bounce:1,
  cue:'Reach to the top right corner',
  L:at(-0.46, 0.78), R:at(1.16, -0.74) },

{ n:'Reach Up Left', dur:11, travel:0.7, stance:'march', bounce:1,
  cue:'Reach to the top left corner',
  L:at(-1.16, -0.74), R:at(0.46, 0.78) },

{ n:'Hands at the Temples', dur:12, travel:0.45, hold:true, stance:'march', bounce:0.4,
  cue:'Hands beside your head — hold and smile',
  L:A.temple, R:mir(A.temple) },

{ n:'Wide and Proud', dur:11, travel:0.7, stance:'march', bounce:1,
  cue:'Open right out and stand tall',
  L:at(-1.45, -0.10), R:at(1.45, -0.10) },

{ n:'Turning Arms', dur:11, travel:0.85, stance:'march', bounce:1.2,
  cue:'One arm high, one arm low, turning through',
  L:at(-0.60, -0.42), R:at(1.00, 0.24) },

{ n:'Namaste to Close', dur:12, travel:0.5, hold:true, stance:'march', bounce:0.4,
  cue:'Palms together to finish. Beautiful',
  L:A.chestMid, R:mir(A.chestMid) }
];


// ------------------------------------------------------------
// Labels for the captured tai chi.
//
// The guide here is the video itself, so there are no poses to author —
// what is still needed is a line of text saying what the player is in the
// middle of. Each label covers a stretch of the clip and is named for
// what the demonstration actually does there, so the words never
// contradict the picture.
// ------------------------------------------------------------

const taiChiLabels = [
{ n:'Commencing',         dur:41, cue:'Sink your weight — one hand high, one low' },
{ n:'Cloud Hands',        dur:41, cue:'Slow circles, the hands trading places' },
{ n:'Settle and Breathe', dur:41, cue:'Lower and closer now. No hurry at all' },
{ n:'Sinking Lower',      dur:41, cue:'Hands low, weight sinking — very slowly' },
{ n:'Opening Again',      dur:41, cue:'Arms opening out again, still unhurried' },
{ n:'Widest Circles',     dur:41, cue:'The biggest, roundest shapes — right out to the sides' }
];


// ------------------------------------------------------------
// Labels for the captured rhythm dance.
//
// Broad sections, named from the capture itself — how high the hands
// get, how wide they reach, how far apart the two are — so the words
// stay true for the whole stretch. Naming each phrase after its biggest
// gesture was tried once and it lies constantly: the heading says "reach
// up high" while the figure, four seconds in, has its hands at its
// middle. Text that contradicts the picture is worse than no text.
// ------------------------------------------------------------

// ------------------------------------------------------------
// Labels for the captured Bollywood routine.
// ------------------------------------------------------------

const bollywoodLabels = [
{ n:'Namaste, then Away', dur:30, cue:'Palms together to begin, then keep your arms moving' },
{ n:'Low and Wide',       dur:30, cue:'Hands lower, arms opening out' },
{ n:'Open Right Out',     dur:30, cue:'Both arms wide — the biggest shape' },
{ n:'One Arm at a Time',  dur:30, cue:'One arm leads, then the other' },
{ n:'Together Again',     dur:30, cue:'Hands back in, moving as a pair' },
{ n:'Big Finish',         dur:29, cue:'Up and wide to finish' }
];


const rhythmLabels = [
{ n:'Warm Up',            dur:23, cue:'Copy the sheep — arms opening and lifting' },
{ n:'Finding the Beat',   dur:22, cue:'Steadier now — one arm leads, then the other' },
{ n:'Both Arms Swinging', dur:23, cue:'Both arms together, a little quicker' },
{ n:'Together and Easy',  dur:22, cue:'Both hands moving as a pair, gentler' },
{ n:'Wide and High',      dur:23, cue:'Open right out — hands at their highest' },
{ n:'Big Finish',         dur:22, cue:'Last stretch — keep it going' }
];


// ------------------------------------------------------------
// Duration fitting.
//
// The brief asked for exact session lengths. Rather than hand-tuning
// every move, the rest breaks are left untouched and every active move
// is scaled by one shared factor until the total lands on the
// requested time. Edit a move's length and the session still comes out
// at 2:32 / 3:30 / 6:00.
// ------------------------------------------------------------
function fitDuration(moves, targetSeconds) {
    const restTotal   = moves.reduce((s, m) => s + (m.rest ? m.dur : 0), 0);
    const activeTotal = moves.reduce((s, m) => s + (m.rest ? 0 : m.dur), 0);
    const k = (targetSeconds - restTotal) / activeTotal;
    let t = 0;
    moves.forEach(m => {
        if (!m.rest) m.dur = m.dur * k;
        m.startAt = t;
        t += m.dur;
    });
    return moves;
}


// ------------------------------------------------------------
// Interpolation — the single source of truth for "where should the
// hands be right now". Both the guide figure and the scorer call it.
// ------------------------------------------------------------
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp  = (a, b, t) => a + (b - a) * t;
const lerpP = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

// Quadratic bezier, so hands travelling through a `via` point curve
// rather than turning a corner.
function bez(a, c, b, t) {
    const u = 1 - t;
    return {
        x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * c.y + t * t * b.y
    };
}

// Slow in, slow out. Tai chi lives or dies on this curve.
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

// Read a captured performance at a moment in time. Frames are on a
// uniform grid, so this is an index and a blend rather than a search.
function sampleMocap(track, tSec) {
    const fr = track.frames;
    const x = clamp((tSec - fr[0].t) * track.fps, 0, fr.length - 1);
    const i = Math.floor(x);
    const j = Math.min(i + 1, fr.length - 1);
    const a = fr[i], b = fr[j], k = x - i;
    return {
        L: { x: lerp(a.L[0], b.L[0], k), y: lerp(a.L[1], b.L[1], k) },
        R: { x: lerp(a.R[0], b.R[0], k), y: lerp(a.R[1], b.R[1], k) },
        lean: lerp(a.lean, b.lean, k)
    };
}

function moveIndexAt(seq, tSec) {
    for (let i = seq.length - 1; i >= 0; i--) {
        if (tSec >= seq[i].startAt) return i;
    }
    return 0;
}

// The full target state at time tSec into the session.
function targetAt(seq, tSec) {
    // A captured sequence has no authored poses to interpolate: the hands
    // come straight off the performance and the labels only say what the
    // player is in the middle of. Legs are left neutral — the capture is
    // of a stylised character whose stance does not map onto a person's,
    // and a wrong stance target is worse than none.
    if (seq.mocap) {
        const i = moveIndexAt(seq, tSec);
        const m = seq[i];
        const p = sampleMocap(seq.mocap, tSec);
        // Feet closer together than a shoulder stance: the capture has no
        // legs in it, and two straight poles held wide apart read as a
        // lanky figure standing still rather than a stocky one dancing.
        const st = STANCES.march;
        return {
            L: p.L, R: p.R,
            stance: { width: st.width, shift: st.shift, front: st.front },
            sink: 0.12, lean: p.lean,
            bounce: seq.bounce || 0, bounceHz: seq.bounceHz || 0.55,
            move: m, index: i, localT: tSec - m.startAt,
            travelling: false, arrived: true
        };
    }

    const i     = moveIndexAt(seq, tSec);
    const m     = seq[i];
    const prev  = seq[i - 1] || m;
    const local = clamp(tSec - m.startAt, 0, m.dur);
    const travelSec = Math.max(0.35, m.dur * (m.travel != null ? m.travel : 0.7));

    let L, R;
    if (local < travelSec) {
        const t = ease(local / travelSec);
        if (m.via) {
            L = bez(prev.L, m.via.L, m.L, t);
            R = bez(prev.R, m.via.R, m.R, t);
        } else {
            L = lerpP(prev.L, m.L, t);
            R = lerpP(prev.R, m.R, t);
        }
    } else {
        L = { x: m.L.x, y: m.L.y };
        R = { x: m.R.x, y: m.R.y };
        // A held move stays genuinely still; anything else keeps breathing
        // so the figure never looks paused.
        if (!m.hold && !m.rest) {
            const s = Math.sin((local - travelSec) * 1.1);
            L.x -= 0.05 * s;  R.x += 0.05 * s;
            L.y -= 0.035 * Math.abs(s);
            R.y -= 0.035 * Math.abs(s);
        }
    }

    const prevStance = STANCES[prev.stance] || STANCES.shoulder;
    const curStance  = STANCES[m.stance]    || STANCES.shoulder;
    const se = ease(clamp(local / travelSec, 0, 1));

    return {
        L: L,
        R: R,
        stance: {
            width: lerp(prevStance.width, curStance.width, se),
            shift: lerp(prevStance.shift, curStance.shift, se),
            front: lerp(prevStance.front, curStance.front, se)
        },
        sink:   lerp(prev.sink || 0, m.sink || 0, se),
        lean:   lerp(prev.lean || 0, m.lean || 0, se),
        bounce: m.bounce || 0,
        move:   m,
        index:  i,
        localT: local,
        travelling: local < travelSec,
        arrived: local >= travelSec
    };
}

function totalDuration(seq) {
    const last = seq[seq.length - 1];
    return last.startAt + last.dur;
}

window.KoriChoreo = {
    // A fresh deep copy each time, so re-fitting never compounds.
    build: (targetSeconds, moves) =>
        fitDuration(JSON.parse(JSON.stringify(moves)), targetSeconds),

    // The same, but with a captured performance attached. The array of
    // labels is still the sequence, so everything downstream — the
    // heading, the preview, the progress bar — carries on unchanged.
    buildMocap: (targetSeconds, labels, track, opts) => {
        const seq = fitDuration(JSON.parse(JSON.stringify(labels)), targetSeconds);
        seq.mocap = track;
        // Legs are never captured, so a dance would otherwise stand on two
        // straight poles. A bob on the beat is what puts weight back in it.
        if (opts) { seq.bounce = opts.bounce; seq.bounceHz = opts.bounceHz; }
        return seq;
    },

    raw: { taiChi: taiChi, rhythm: rhythm, bollywood: bollywood,
           taiChiLabels: taiChiLabels, rhythmLabels: rhythmLabels,
           bollywoodLabels: bollywoodLabels },
    targetAt: targetAt,
    totalDuration: totalDuration,
    STANCES: STANCES,
    BODY: BODY
};

})();
