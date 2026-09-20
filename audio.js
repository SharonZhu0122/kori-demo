// ============================================================
// KORI — Sound
//
// Everything is synthesised in the browser, so the game ships with no
// audio files and nothing to license. Rhythm Dance is the exception:
// it uses the soundtrack of its own guide video, so the synth beat
// stays out of the way there.
//
// Nothing here starts until the player has pressed something, because
// browsers will not let audio begin before a real gesture.
// ============================================================

(function () {

let ctx = null;
let master = null;
let muted = false;

let beatTimer = null;
let nextBeatAt = 0;
let beatPeriod = 0.5;
let beatCount = 0;

let breath = null;    // { osc, lfo, gain } while the tai chi pad is running

function ensure() {
    if (ctx) {
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    return ctx;
}

// A short percussive blip. Used for the dance beat.
function blip(at, freq, dur, gain, type) {
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, at);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(master);
    o.start(at); o.stop(at + dur + 0.02);
}

// A struck bowl: a couple of detuned partials with a long tail. This is
// the tai chi move marker, and it needs to be soft enough that it never
// startles anyone.
function bowl(at, freq, gain) {
    if (!ctx) return;
    [[1, 1], [2.02, 0.4], [2.98, 0.18]].forEach(([mult, amp]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq * mult;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(gain * amp, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 2.6);
        o.connect(g); g.connect(master);
        o.start(at); o.stop(at + 2.7);
    });
}

// Lookahead scheduler. setInterval alone is far too jittery to keep a
// beat; this queues each beat slightly ahead of time against the audio
// clock instead.
function beatLoop() {
    if (!ctx) return;
    while (nextBeatAt < ctx.currentTime + 0.12) {
        const strong = (beatCount % 4) === 0;
        blip(nextBeatAt, strong ? 210 : 340, strong ? 0.16 : 0.10, strong ? 0.32 : 0.16,
             strong ? 'sine' : 'triangle');
        nextBeatAt += beatPeriod;
        beatCount++;
    }
}

const Sound = {
    unlock() { ensure(); },

    setMuted(m) {
        muted = m;
        if (master) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.05);
    },
    isMuted() { return muted; },

    // Steady beat for the dance modes.
    startBeat(bpm) {
        if (!ensure()) return;
        this.stopBeat();
        beatPeriod = 60 / bpm;
        beatCount = 0;
        nextBeatAt = ctx.currentTime + 0.15;
        beatTimer = setInterval(beatLoop, 25);
    },
    stopBeat() {
        if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
    },

    // A slow swelling pad for tai chi — roughly the pace of easy breathing.
    startBreath() {
        if (!ensure() || breath) return;
        const o = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        const g = ctx.createGain();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();

        o.type = 'sine';  o.frequency.value = 110;
        o2.type = 'sine'; o2.frequency.value = 164.8;      // a fifth above
        g.gain.value = 0.02;
        lfo.frequency.value = 1 / 9;                        // one swell per 9s
        lfoGain.gain.value = 0.026;

        lfo.connect(lfoGain); lfoGain.connect(g.gain);
        o.connect(g); o2.connect(g); g.connect(master);
        o.start(); o2.start(); lfo.start();
        breath = { o: o, o2: o2, lfo: lfo, g: g };
    },
    stopBreath() {
        if (!breath) return;
        const b = breath; breath = null;
        b.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
        setTimeout(() => { try { b.o.stop(); b.o2.stop(); b.lfo.stop(); } catch (e) {} }, 1200);
    },

    moveChime() { if (ensure()) bowl(ctx.currentTime + 0.01, 432, 0.16); },

    // Sounded once, a few seconds before a move changes. Deliberately
    // quieter than the move chime: it is a nudge to glance at the preview,
    // not an instruction to do anything yet.
    nextCue() { if (ensure()) blip(ctx.currentTime + 0.01, 880, 0.07, 0.10, 'sine'); },
    holdChime() { if (ensure()) bowl(ctx.currentTime + 0.01, 648, 0.13); },

    countIn(n) {
        if (!ensure()) return;
        blip(ctx.currentTime + 0.01, n > 1 ? 440 : 660, 0.18, 0.30, 'sine');
    },

    finish() {
        if (!ensure()) return;
        const t = ctx.currentTime;
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bowl(t + i * 0.16, f, 0.14));
    },

    stopAll() { this.stopBeat(); this.stopBreath(); }
};

window.KoriSound = Sound;

})();
