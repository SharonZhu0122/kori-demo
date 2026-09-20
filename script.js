// ============================================================
// KORI — Move with Mana
//
// Choose an activity, count in, move, see how it went. There is no
// separate camera-setup step: it asked people to satisfy three checks
// before they were allowed to start, which is a lot of screen for a
// question the game can answer for itself while it plays.
//
// One MediaPipe Pose model runs the whole session.
// ============================================================

(function () {

const BUILD = '20260921-0413';
console.log('KORI build ' + BUILD);

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

// Tai Chi is led by a filmed demonstration, and scored against a capture
// of that same demonstration — so the thing being shown and the thing
// being marked are one and the same by construction. Its length is the
// clip's length; there is nothing to pad it out with.
// All three are now led by a filmed demonstration of the character and
// scored against a capture of that same clip, so what is shown and what
// is marked are one thing by construction. Each clip is square, which is
// how they were made — the panel takes its shape from the mode rather
// than the clip being cropped to fit a panel.
const MODES = {
    rhythm:    { title: 'Rhythm Dance', seconds: 115.66, moves: 'rhythm',
                 guide: 'video', video: 'assets/rhythm-guide.mp4?v=20260921-0413', aspect: '1/1',
                 mocap: 'rhythm', labels: 'rhythmLabels', sound: 'video' },
    bollywood: { title: 'Bollywood',    seconds: 180.18, moves: 'bollywood',
                 guide: 'video', video: 'assets/bollywood-guide.mp4?v=20260921-0413', aspect: '1/1',
                 mocap: 'bollywood', labels: 'bollywoodLabels', sound: 'video' },
    taichi:    { title: 'Tai Chi',      seconds: 251.17, moves: 'taiChi',
                 guide: 'video', video: 'assets/taichi-guide.mp4?v=20260921-0413', aspect: '1/1',
                 mocap: 'taichi', labels: 'taiChiLabels', sound: 'video' }
};


const PRAISE = ['Ka pai!', 'Tino pai!', 'Beautiful', "That's it", 'Lovely', 'Ka rawe!', 'Perfect'];

// The summary title. It never grades: even the lowest band is warm and
// encouraging (F2 — praise only, never a failing grade). Several phrases
// per band so the same words do not come up every time, and a stronger
// word when the movement was closer.
const END_TITLES = {
    high: ['Kei runga noa atu! You were incredible',
           'Ka mau te wehi! Awesome',
           'Mīharo! You were marvellous',
           'Tau kē! You were brilliant',
           'Pai rawa atu! Superb'],
    mid:  ['Tino pai! Well done',
           'Ka rawe! Great effort',
           'Rawe! Nicely done',
           'Tino pai! Good moving',
           'Ka rawe! That was lovely'],
    low:  ['Ka pai! Great to see you moving',
           'Ka pai! Good on you for having a go',
           'Pai tō mahi! Every move counts',
           'Ka pai! Lovely effort',
           'Pai tō mahi! Well done for moving'],
};
const pickOne = a => a[Math.floor(Math.random() * a.length)];

let guideFigure = null;
let praiseTimer = null;

const mocapCache = {};
let guideEnded = false;

let stream = null, poseModel = null, poseBusy = false;
let lastSendAt = 0, pumpRunning = false, cameraFailed = false;

const S = {
    modeKey: null, cfg: null, seq: null, total: 0,
    running: false, paused: false, startedAt: 0,
    mana: 0, sampleSum: 0, sampleCount: 0, holds: 0, holdCounted: false,
    lastMoveIndex: -1, shownScore: 0, lastPraiseAt: 0, lastFrameAt: 0,
    movingSeconds: 0
};

// Smoothed camera framing, in element fractions.
const framing = { z: 1, tx: 0, ty: 0 };


// ------------------------------------------------------------
// Screens
// ------------------------------------------------------------
const SCREENS = ['homePage', 'howToPage', 'modePage', 'gamePage', 'endPage'];

function go(id) {
    SCREENS.forEach(s => { const el = $(s); if (el) el.style.display = (s === id) ? 'block' : 'none'; });
    if (id !== 'gamePage') stopSession();
    if (id === 'homePage') mountHome();
}

function mountHome() {
    KoriDecor.mount($('homeDecor'));
}


// ------------------------------------------------------------
// Camera and pose
// ------------------------------------------------------------
async function openCamera() {
    if (stream) { attachStream(); startPump(); return; }
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 960 }, facingMode: 'user' },
            audio: false
        });
        cameraFailed = false;
        attachStream();
        hideCameraError();
        await loadPose();
        startPump();
    } catch (err) {
        console.error(err);
        cameraFailed = true;
        showCameraError(err);
    }
}

function attachStream() {
    const v = $('camera');
    if (v && v.srcObject !== stream) {
        v.srcObject = stream;
        v.play().catch(() => {});
    }
}

async function loadPose() {
    if (poseModel) return;
    if (typeof Pose === 'undefined') {
        console.error('vendor/pose/pose.js did not load');
        showCameraError({ name: 'ModelMissing' });
        return;
    }
    poseModel = new Pose({ locateFile: f => 'vendor/pose/' + f });
    poseModel.setOptions({
        modelComplexity: 1, smoothLandmarks: true, enableSegmentation: false,
        minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
    });
    poseModel.onResults(res => KoriTracker.update(res.poseLandmarks || null, performance.now()));
}

// Own frame pump rather than MediaPipe's Camera helper: it can be
// throttled to something an older machine keeps up with, and skipped
// entirely when the camera is not on screen.
function startPump() {
    if (pumpRunning) return;
    pumpRunning = true;
    (async function pump() {
        const v = $('camera');
        const now = performance.now();
        const live = $('gamePage').style.display !== 'none';
        if (live && poseModel && v && v.readyState >= 2 && !poseBusy && now - lastSendAt > 45) {
            poseBusy = true; lastSendAt = now;
            try { await poseModel.send({ image: v }); } catch (e) { /* frame dropped */ }
            poseBusy = false;
        }
        requestAnimationFrame(pump);
    })();
}

// A blocked camera is normal inside embedded preview panels: browsers do
// not grant camera access to a sandboxed iframe, no prompt appears, and
// retrying cannot fix it from in there.
function showCameraError(err) {
    const name = err && err.name;
    const inIframe = window.self !== window.top;
    let msg = 'Camera not available — follow the guide anyway.';

    if (name === 'NotAllowedError' && inIframe) {
        msg = 'The camera is blocked inside this preview panel. Open the page in its own '
            + 'browser tab and it will ask properly. You can still follow along.';
    } else if (name === 'NotAllowedError') {
        msg = 'Camera access was declined. Allow it for this page, then press Try Again. '
            + 'You can still follow along without it.';
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        msg = 'No camera found. You can still follow along.';
    } else if (name === 'NotReadableError') {
        msg = 'Another app is using the camera. Close it, then press Try Again.';
    } else if (name === 'ModelMissing') {
        msg = 'The movement files did not load. The vendor folder has to sit '
            + 'beside index.html. You can still follow along without scoring.';
    }

    if ($('cameraOverlayText')) $('cameraOverlayText').innerText = msg;
    if ($('cameraOverlay')) $('cameraOverlay').style.display = 'flex';
    const retry = $('retryCameraBtn');
    if (retry) retry.style.display = (name === 'NotAllowedError' && inIframe) ? 'none' : 'inline-block';
}

function hideCameraError() { if ($('cameraOverlay')) $('cameraOverlay').style.display = 'none'; }

function retryCamera() { hideCameraError(); stream = null; openCamera(); }


// ------------------------------------------------------------
// Starting a session
// ------------------------------------------------------------
async function choose(key) {
    const cfg = MODES[key];
    if (!cfg) return;

    KoriSound.unlock();
    S.modeKey = key;
    S.cfg = cfg;

    // A captured guide is scored against the capture; without it the mode
    // still runs on its authored poses rather than failing outright.
    const capture = cfg.mocap ? loadMocap(cfg.mocap) : null;
    S.seq = capture
        ? KoriChoreo.buildMocap(cfg.seconds, KoriChoreo.raw[cfg.labels], capture,
                                { bounce: cfg.bounce, bounceHz: cfg.bounceHz })
        : KoriChoreo.build(cfg.seconds, KoriChoreo.raw[cfg.moves]);
    S.total = KoriChoreo.totalDuration(S.seq);

    go('gamePage');

    const video = $('guideVideo'), stage = $('avatarStage');
    // Both panels take the shape of whatever the guide is showing, and the
    // row gives them equal width — half the screen each. The camera crops
    // to fit; it is already framed on the player rather than the room, so
    // there is nothing at its edges worth keeping.
    const aspect = cfg.aspect || '4/3';
    const [aw, ah] = aspect.split('/').map(Number);
    $('stage').style.setProperty('--panel-aspect', (aw / ah).toFixed(4));

    if (cfg.guide === 'video') {
        stage.style.display = 'none';
        video.style.display = 'block';
        // load() matters: without it the element can still be settling on
        // the previous mode's clip when the count-in finishes, and the
        // play() three seconds later is rejected into a swallowed catch.
        if (video.getAttribute('src') !== cfg.video) {
            video.src = cfg.video;
            video.load();
        }
        video.loop = false;
        video.muted = KoriSound.isMuted();
        try { video.currentTime = 0; } catch (e) { /* not seekable yet */ }
    } else {
        video.pause();
        video.style.display = 'none';
        stage.style.display = 'flex';
        guideFigure = KoriAvatar.create().mount(stage);
    }


    // Show the first instruction and pose during the count-in, so nobody
    // is reading it for the first time on the beat it starts.
    showMove(S.seq[0]);
    $('clock').innerText = '0:00 / ' + fmt(S.total);
    $('progressFill').style.width = '0%';
    $('matchPill').innerText = '—';
    if (cfg.guide !== 'video') guideFigure.render(KoriChoreo.targetAt(S.seq, 0), performance.now());

    await openCamera();
    countIn(3, () => launch(cfg, video));
}

function loadMocap(key) {
    const track = (window.KoriMocap || {})[key];
    if (!track || !track.frames || !track.frames.length) {
        console.warn('capture "' + key + '" is not loaded; falling back to authored poses');
        return null;
    }
    return track;
}

function countIn(n, done) {
    const box = $('countdown'), num = $('countdownNum');
    box.style.display = 'flex';
    let i = n;
    num.innerText = i;
    KoriSound.countIn(i);
    const tick = setInterval(() => {
        i--;
        if (i <= 0) { clearInterval(tick); box.style.display = 'none'; done(); }
        else { num.innerText = i; KoriSound.countIn(i); }
    }, 1000);
}

function launch(cfg, video) {
    S.running = true;
    S.startedAt = performance.now();
    S.mana = 0; S.sampleSum = 0; S.sampleCount = 0; S.holds = 0;
    S.holdCounted = false; S.lastMoveIndex = -1; S.shownScore = 0;
    S.movingSeconds = 0; S.lastFrameAt = performance.now(); S.lastPraiseAt = 0;
    guideEnded = false;
    clearPauseUI();
    KoriScorer.reset();

    if (cfg.sound === 'beat')   KoriSound.startBeat(cfg.bpm);
    if (cfg.sound === 'breath') KoriSound.startBreath();
    if (cfg.guide === 'video')  playGuide(video);
}

// Start the clip, and if it was not ready yet, start it the moment it is.
// A guide that silently fails to play leaves the session frozen at 0:00
// with no clue why.
function playGuide(video) {
    const attempt = video.play();
    if (attempt && attempt.catch) {
        attempt.catch(() => {
            video.addEventListener('canplay',
                () => { video.play().catch(err => console.warn('guide will not play:', err)); },
                { once: true });
        });
    }
}

function stopSession() {
    if (!S.running) return;
    S.running = false;
    KoriSound.stopAll();
    const v = $('guideVideo');
    if (v) v.pause();
    clearPauseUI();
}

function quit()  { stopSession(); go('modePage'); }
function again() { if (S.modeKey) choose(S.modeKey); }

// Pause and resume. The frame loop keeps running and simply does nothing
// while S.running is false, so pausing is: stop the clock, stop the clip,
// put a cover over the stage. Because a filmed mode reads its time straight
// off video.currentTime, freezing the video freezes the session's clock too
// — no elapsed time has to be tracked and added back. The clip's own audio
// stops with it; the beat/breath engines are stopped for the authored modes
// that used them.
function togglePause() {
    if (S.paused) return resumeGame();
    if (!S.running) return;              // nothing to pause during the count-in or after the end
    S.paused = true;
    S.running = false;
    const v = $('guideVideo');
    if (v) v.pause();
    KoriSound.stopAll();
    $('pauseBtn').innerText = '▶ Resume';
    $('pauseOverlay').style.display = 'flex';
}

function resumeGame() {
    if (!S.paused) return;
    S.paused = false;
    S.running = true;
    // dt is clamped in the loop, so the gap while paused cannot produce one
    // giant step; resetting lastFrameAt keeps even that gap from being spent.
    S.lastFrameAt = performance.now();
    const v = $('guideVideo');
    if (v && S.cfg && S.cfg.guide === 'video') playGuide(v);
    if (S.cfg && S.cfg.sound === 'beat')   KoriSound.startBeat(S.cfg.bpm);
    if (S.cfg && S.cfg.sound === 'breath') KoriSound.startBreath();
    $('pauseBtn').innerText = '⏸ Pause';
    $('pauseOverlay').style.display = 'none';
}

// A fresh session, or leaving the game screen, clears any paused state so
// the button and the cover never carry over.
function clearPauseUI() {
    S.paused = false;
    const b = $('pauseBtn'), o = $('pauseOverlay');
    if (b) b.innerText = '⏸ Pause';
    if (o) o.style.display = 'none';
}


// When the filmed guide is leading, its own clock is the clock —
// anything else drifts against the music within a minute or two.
function sessionTime() {
    if (S.cfg && S.cfg.guide === 'video') {
        const v = $('guideVideo');
        if (v && !isNaN(v.currentTime)) return v.currentTime;
    }
    return (performance.now() - S.startedAt) / 1000;
}


// ------------------------------------------------------------
// Main loop
// ------------------------------------------------------------
function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();

    idleFigures(now);
    if (!S.running) return;

    const dt = Math.min(0.1, (now - S.lastFrameAt) / 1000);
    S.lastFrameAt = now;

    const t = sessionTime();
    // A clip is never exactly as long as the session fitted to it — this
    // one runs 15.29s against a 15.33s sequence, and `t >= S.total` was
    // therefore never true, so the session ran on for ever and the summary
    // never came. The clip ending is the authority; the clock is the
    // fallback for modes that have no clip.
    if (guideEnded || t >= S.total - 0.2) { finish(); return; }

    const target = KoriChoreo.targetAt(S.seq, t);
    // One discriminator everywhere: a mode is led by a clip or by the
    // figure. Checking for 'avatar' here while choose() checked for
    // 'video' left a mode with neither set mounting a figure that was
    // then never drawn — an empty panel with a shadow in it.
    if (S.cfg.guide !== 'video' && guideFigure) guideFigure.render(target, now);

    if (target.index !== S.lastMoveIndex) {
        S.lastMoveIndex = target.index;
        S.holdCounted = false;
        showMove(target.move);
        if (S.cfg.sound !== 'video') KoriSound.moveChime();
    }

    // "Next" promises a discrete move; a captured guide only promises
    // where the arms are heading, and should say so.
    const previewLabel = document.querySelector('.next-label');
    if (previewLabel) previewLabel.innerText = S.seq.mocap ? 'In a moment' : 'Next';

    let score = null;
    if (KoriTracker.ready && !KoriTracker.stale(now) && !target.move.rest) {
        // Most players follow slightly late, so they are also marked
        // against where the guide was a moment ago, and given whichever of
        // the two suits them better — being dead on the beat is not a fault.
        const lagged = KoriChoreo.targetAt(S.seq, Math.max(0, t - window.KoriLagSec));
        KoriScorer.push(KoriTracker.frame, target, now);
        score = Math.max(
            KoriScorer.score(KoriTracker.frame, target, now).total,
            KoriScorer.score(KoriTracker.frame, lagged, now).total
        );

        S.mana += score * dt * 7;
        S.sampleSum += score;
        S.sampleCount++;
        if (score > 0.35) S.movingSeconds += dt;

        if (target.move.hold && target.arrived && !S.holdCounted && score > 0.68) {
            S.holdCounted = true; S.holds++; S.mana += 25;
            KoriSound.holdChime();
        }
    }

    S.shownScore += ((score == null ? 0 : score) - S.shownScore) * 0.12;

    updateFraming();
    drawCamera(target, score);
    updateHud(t, score, now);
}

// The home and summary figures are stills of the character taken from the
// footage, so nothing is drawn per frame any more — the gentle breathing is
// a CSS animation. Only a mode that goes back to authored poses would need
// a figure rendered here.
function idleFigures(now) {
}

// A one-off pose for the decorative figures, shaped like the targets
// the choreography produces.
function pose(L, R, width, sink, lean) {
    return { L: L, R: R, stance: { width: width, shift: 0, front: 0 },
             sink: sink, lean: lean, bounce: 0, move: {}, arrived: true };
}


// ------------------------------------------------------------
// The instruction, above the guide, in the largest type on screen
// ------------------------------------------------------------
function showMove(m) {
    $('moveName').innerHTML = esc(m.n)
        + (m.cn ? ' <span class="cn">' + esc(m.cn) + '</span>' : '')
        + (m.hold ? ' <span class="hold-tag">hold</span>' : '');
    $('moveCue').innerText = m.cue || '';
}

function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function updateHud(t, score, now) {
    $('progressFill').style.width = (100 * t / S.total).toFixed(1) + '%';
    $('clock').innerText = fmt(t) + ' / ' + fmt(S.total);

    const pill = $('matchPill');
    const tracking = KoriTracker.ready && !KoriTracker.stale(now);
    pill.innerText = tracking ? Math.round(S.shownScore * 100) + '%' : '—';
    pill.classList.toggle('good', tracking && S.shownScore > 0.62);

    const hint = $('camHint');
    if (tracking) {
        hint.classList.add('hide');
    } else {
        hint.classList.remove('hide');
        hint.innerText = cameraFailed ? 'No camera — just follow the guide' : 'Step into view';
    }

    // Encouragement only when it is earned, and never a correction.
    if (score != null && score > 0.62 && now - S.lastPraiseAt > 4500) {
        S.lastPraiseAt = now;
        const el = $('praise');
        el.innerText = PRAISE[Math.floor(Math.random() * PRAISE.length)];
        el.classList.add('show');
        clearTimeout(praiseTimer);
        praiseTimer = setTimeout(() => el.classList.remove('show'), 1900);
    }
}


// ------------------------------------------------------------
// Framing the camera on the player rather than on their room
//
// The whole wrapper is scaled and shifted, video and skeleton overlay
// together, so the two never come apart. Smoothed hard: a jumpy crop is
// far worse to move in front of than a wide one.
// ------------------------------------------------------------
// The crop is deliberately loose. It exists so the player can see herself,
// not so she fills the picture, and a view tight enough to be flattering is
// tight enough to cut her hands off when she opens her arms.
const FRAME_MAX_ZOOM = 1.6;

function updateFraming() {
    const el = document.querySelector('.cam-frame');
    if (!el) return;

    // The panel is given the camera's own shape, so cover neither crops nor
    // letterboxes and these two are 1. They are kept because a mode whose
    // panel is some other shape would otherwise put the framing quietly in
    // the wrong units: landmarks are fractions of the CAMERA frame, and the
    // transform below is a percentage of the PANEL.
    const video = $('camera'), panel = el.parentElement;
    let ox = 1, oy = 1, va = 4 / 3;
    if (video && video.videoWidth && panel && panel.clientHeight) {
        va = video.videoWidth / video.videoHeight;
        const pa = panel.clientWidth / panel.clientHeight;
        if (va > pa) ox = va / pa; else oy = pa / va;
    }

    const b = KoriTracker.ready ? KoriTracker.reserve(va) : null;
    let z = 1, tx = 0, ty = 0;

    if (b) {
        const w = (b.x1 - b.x0) * ox;
        const h = (b.y1 - b.y0) * oy;
        z = clamp(1 / Math.max(w, h), 1, FRAME_MAX_ZOOM);
        // object-fit:cover means the picture already spans exactly one panel
        // before any zoom, so at z it spans z and the overhang each side is
        // (z - 1) / 2. Translating further than that shows the panel behind
        // it — which is what put a pale strip down both edges when this was
        // briefly computed against the camera's extent instead.
        const lim = (z - 1) / (2 * z);
        tx = clamp((0.5 - (b.x0 + b.x1) / 2) * ox, -lim, lim);
        ty = clamp((0.5 - (b.y0 + b.y1) / 2) * oy, -lim, lim);
    }

    framing.z  += (z  - framing.z)  * 0.04;
    framing.tx += (tx - framing.tx) * 0.04;
    framing.ty += (ty - framing.ty) * 0.04;

    el.style.transform = 'scaleX(-1) scale(' + framing.z.toFixed(4) + ') translate('
        + (framing.tx * 100).toFixed(2) + '%,' + (framing.ty * 100).toFixed(2) + '%)';
}


// ------------------------------------------------------------
// Camera overlay
//
// Drawn in raw landmark coordinates: the canvas sits inside the same
// wrapper as the video and inherits its mirror and its framing.
// ------------------------------------------------------------
const BONES = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [24, 26], [26, 28]
];

function drawCamera(target, score) {
    const canvas = $('skeleton'), video = $('camera');
    if (!canvas || !video) return;
    if (video.videoWidth && canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!KoriTracker.ready) return;

    const W = canvas.width, H = canvas.height;
    const lm = KoriTracker.raw;
    const scale = 1 / Math.max(1, framing.z);      // thinner lines as it zooms in
    const good = score != null && score > 0.6;
    const colour = target.move.rest ? '#9DB8DC' : (good ? '#2FCFD6' : '#F2A93B');

    if (lm) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = Math.max(3, W / 150) * scale;
        ctx.lineCap = 'round';
        BONES.forEach(([a, b]) => {
            const p = lm[a], q = lm[b];
            if (!p || !q) return;
            if ((p.visibility != null && p.visibility < 0.5) ||
                (q.visibility != null && q.visibility < 0.5)) return;
            ctx.beginPath();
            ctx.moveTo(p.x * W, p.y * H);
            ctx.lineTo(q.x * W, q.y * H);
            ctx.stroke();
        });
        [15, 16].forEach(i => {
            const p = lm[i];
            if (!p) return;
            ctx.fillStyle = colour;
            ctx.beginPath();
            ctx.arc(p.x * W, p.y * H, Math.max(7, W / 68) * scale, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    if (target.move.rest) return;

    // Where the hands are being asked to go, painted onto the player's own
    // picture. Chasing two circles is a much easier instruction than
    // mapping a figure onto your own body.
    [target.L, target.R].forEach(p => {
        const img = KoriTracker.toImage(p);
        const x = (1 - img.x) * W, y = img.y * H;
        const r = Math.max(16, W / 24) * scale;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(55,224,168,0.95)';
        ctx.lineWidth = Math.max(4, W / 130) * scale;
        ctx.setLineDash([r * 0.5, r * 0.35]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(55,224,168,0.16)';
        ctx.fill();
    });
}


// ------------------------------------------------------------
// Finishing
//
// Nothing here reports a failure. The worst the summary can say is
// "well done".
// ------------------------------------------------------------
function finish() {
    S.running = false;
    KoriSound.stopAll();
    const v = $('guideVideo');
    if (v) v.pause();

    const acc = S.sampleCount ? S.sampleSum / S.sampleCount : 0;
    const pct = Math.round(acc * 100);
    S.mana += 100;

    $('endTitle').innerText = pickOne(pct >= 60 ? END_TITLES.high
                                    : pct >= 30 ? END_TITLES.mid
                                    :             END_TITLES.low);

    // The best score is kept on this device, which is what a demo actually
    // needs: everyone taking a turn on the one machine sees the score to
    // beat. It is not a scoreboard across the world — there is no server
    // behind this page — and it is stored per activity, because four
    // minutes of tai chi and two of rhythm dance are not the same climb.
    const mana = Math.round(S.mana);
    const best = readBest(S.modeKey);
    // A first time through has nothing to beat, so it is told its score
    // rather than congratulated for passing zero.
    const beaten = best > 0 && mana > best;
    if (mana > best) writeBest(S.modeKey, mana);
    const bestEl = $('endBest');
    bestEl.classList.toggle('is-new', beaten);
    bestEl.innerText = beaten ? 'A new best on this device!'
                              : 'Best here: ' + Math.max(best, mana);

    KoriDecor.mount($('endDecor'));
    KoriConfetti.mount($('endConfetti'));
    go('endPage');

    KoriSound.finish();
    countUp($('endMana'), mana, 1800);
    // Fired as the number starts climbing rather than when it lands, so the
    // celebration and the score are one moment.
    KoriConfetti.fire();
}

// Private browsing, a locked-down browser or a page opened straight from a
// folder can all refuse storage. A best score is a nicety, so a refusal
// means the line reads 0 and nothing else changes.
function readBest(mode) {
    try { return parseInt(localStorage.getItem('kori.best.' + mode), 10) || 0; }
    catch (e) { return 0; }
}
function writeBest(mode, value) {
    try { localStorage.setItem('kori.best.' + mode, String(value)); }
    catch (e) { /* nothing to do, and nothing worth telling the player */ }
}


// The score climbs from zero rather than appearing, which gives the
// number a moment of its own instead of it being one more thing on a
// screen full of numbers.
function countUp(el, target, ms) {
    const t0 = performance.now();
    (function step() {
        const p = clamp((performance.now() - t0) / ms, 0, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.innerText = Math.round(target * eased);
        if (p < 1) requestAnimationFrame(step);
    })();
}


// ------------------------------------------------------------
// Sound and full screen
// ------------------------------------------------------------
function toggleMute() {
    const m = !KoriSound.isMuted();
    KoriSound.unlock();
    KoriSound.setMuted(m);
    const v = $('guideVideo');
    if (v) v.muted = m;
    $('muteBtn').innerText = m ? '🔇 Sound' : '🔊 Sound';
}

// Sandboxed preview panels refuse real fullscreen, sometimes silently,
// so a CSS stand-in takes over whenever the real thing is unavailable.
function toggleFullscreen() {
    if (document.body.classList.contains('pseudo-fullscreen')) { exitPseudo(); return; }
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().then(updateFsLabel).catch(() => enterPseudo());
    } else {
        enterPseudo();
    }
}
function enterPseudo() { document.body.classList.add('pseudo-fullscreen'); updateFsLabel(); }
function exitPseudo()  { document.body.classList.remove('pseudo-fullscreen'); updateFsLabel(); }
function updateFsLabel() {
    const btn = document.querySelector('.fullscreen-button');
    if (!btn) return;
    const full = !!document.fullscreenElement || document.body.classList.contains('pseudo-fullscreen');
    btn.innerText = full ? '⛶ Exit Full Screen' : '⛶ Full Screen';
}

document.addEventListener('fullscreenchange', updateFsLabel);
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('pseudo-fullscreen')) exitPseudo();
});


// ------------------------------------------------------------
// A clip is never exactly as long as the session fitted to it, so the
// media ending is the authority and the clock is only the fallback.
const guideEl = $('guideVideo');
if (guideEl) guideEl.addEventListener('ended', () => { guideEnded = true; });

// The lengths on the activity cards used to be typed into the markup and
// drifted the moment a clip changed — Tai Chi still advertised 15 seconds
// weeks after it became two minutes. Filled from MODES now, so the card
// cannot disagree with what the mode actually plays.
document.querySelectorAll('[data-mode]').forEach(card => {
    const cfg = MODES[card.dataset.mode];
    const slot = card.querySelector('.mode-time');
    if (cfg && slot) slot.textContent = fmt(cfg.seconds);
});

window.Kori = { go, choose, quit, again, togglePause, retryCamera, toggleMute, toggleFullscreen };

mountHome();
requestAnimationFrame(frame);

})();
