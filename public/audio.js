'use strict';
// Procedural audio (Web Audio) - no asset files. SFX.init() must be called from a user gesture.
const SFX = (() => {
  let SFX_vis = 0, ctx = null, master = null, nbuf = null, muted = false, vol = .8, amb = null;
  try { muted = localStorage.getItem('mute') === '1'; } catch (e) { }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), rnd = (a, b) => a + Math.random() * (b - a);

  function init() {
    if (ctx) { resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { ctx = new AC(); } catch (e) { return; }
    master = ctx.createGain(); master.gain.value = muted ? 0 : vol;
    const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
    nbuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = nbuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    buildAmbient(); resume(); ctx.onstatechange = () => { if (ctx && ctx.state !== 'running' && !document.hidden) ctx.resume().catch(() => { }); };
    if (!SFX_vis) { SFX_vis = 1; document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else resume(); }); }
  }
  function resume() { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => { }); }
  function setMuted(m) { muted = m; try { localStorage.setItem('mute', m ? '1' : '0'); } catch (e) { } if (master) master.gain.setTargetAtTime(m ? 0 : vol, ctx.currentTime, .05); }
  const isMuted = () => muted;

  // spatial helper: returns output node (gain+pan) connected to master
  function out(g, pan, when) {
    const G = ctx.createGain(); G.gain.value = g; let last = G;
    if (ctx.createStereoPanner && pan) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); G.connect(p); last = p; }
    last.connect(master); return G;
  }
  // Too many sounds at once (dawn: every alien dies together) can overload the browser's audio and silence everything. So: a cap on live voices, and the busy
  // effects are rate-limited; a watchdog also revives (or rebuilds) the audio context if the browser suspends or stalls it.
  let voices = [];
  const MAXV = 34;
  function claim(t, dur) { const now = ctx.currentTime; if (voices.length) voices = voices.filter(v => v > now); if (voices.length >= MAXV) return false; voices.push(t + dur + .06); return true; }
  const att = (dist) => 1 / (1 + (dist || 0) / 220);
  const pan = (dx) => clamp((dx || 0) / 450, -.8, .8);

  function noise(o) {
    if (!ctx || muted) return; const t = ctx.currentTime + (o.when || 0), dur = o.dur || .1; if (!claim(t, dur)) return;
    const s = ctx.createBufferSource(); s.buffer = nbuf; s.loop = true; s.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f || 1000, t); if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + dur); f.Q.value = o.q || 1;
    const e = ctx.createGain(), pk = (o.gain || .3) * att(o.dist);
    e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(Math.max(.0002, pk), t + (o.attack || .005)); e.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(f); f.connect(e); e.connect(out(1, pan(o.dx))); s.start(t, Math.random()); s.stop(t + dur + .05);
  }
  function tone(o) {
    if (!ctx || muted) return; const t = ctx.currentTime + (o.when || 0), dur = o.dur || .2; if (!claim(t, dur)) return;
    const os = ctx.createOscillator(); os.type = o.type || 'sine'; os.frequency.setValueAtTime(o.f, t); if (o.f2) os.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    let node = os; if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; os.connect(f); node = f; }
    const e = ctx.createGain(), pk = (o.gain || .2) * att(o.dist);
    e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(Math.max(.0002, pk), t + (o.attack || .01)); e.gain.exponentialRampToValueAtTime(.0001, t + dur);
    node.connect(e); e.connect(out(1, pan(o.dx))); os.start(t); os.stop(t + dur + .05);
  }

  // ---- one-shot effects (d = distance, dx = horizontal offset from listener) ----
  const fx = {
    chop(d, dx) { noise({ f: 900, q: .8, dur: .09, gain: .5, dist: d, dx }); tone({ f: 170, f2: 90, dur: .12, type: 'triangle', gain: .45, dist: d, dx }); },
    mine(d, dx) { noise({ type: 'highpass', f: 2500, dur: .06, gain: .35, dist: d, dx }); tone({ f: 1100, f2: 900, dur: .16, gain: .22, dist: d, dx }); tone({ f: 1650, dur: .1, gain: .12, when: .02, dist: d, dx }); },
    pick(d, dx) { noise({ f: 2800, f2: 1800, q: 1.2, dur: .2, gain: .22, attack: .03, dist: d, dx }); tone({ f: 500, f2: 700, dur: .08, gain: .1, dist: d, dx }); },
    rustle(d, dx) {   // very light: a soft airy "shff" of leaves, quiet and low-passed so nothing sounds sharp
      noise({ type: 'bandpass', f: 1300, f2: 2100, q: .45, dur: .28, gain: .07, attack: .07, dist: d, dx });
      noise({ type: 'lowpass', f: 2400, q: .3, dur: .16, gain: .035, attack: .05, when: .08, dist: d, dx });
      noise({ type: 'lowpass', f: 1800, q: .3, dur: .12, gain: .025, attack: .04, when: .19, dist: d, dx });
    },
    feed(d, dx) { noise({ f: 300, f2: 1800, q: .7, dur: .55, gain: .35, attack: .08, dist: d, dx }); noise({ type: 'highpass', f: 2500, dur: .3, gain: .12, when: .1, dist: d, dx }); tone({ f: 110, f2: 70, dur: .4, gain: .25, type: 'triangle', dist: d, dx }); },
    levelup(d, dx) { [440, 554, 659, 880].forEach((f, i) => tone({ f, dur: .35, type: 'triangle', gain: .22, when: i * .09, dist: d, dx })); noise({ f: 3000, q: .6, dur: .5, gain: .08, when: .25, dist: d, dx }); },
    hit(d, dx) { noise({ f: 700, q: .7, dur: .1, gain: .4, dist: d, dx }); tone({ f: 220, f2: 70, dur: .14, type: 'square', gain: .2, lp: 900, dist: d, dx }); },
    alienDie(d, dx) { tone({ f: 380, f2: 55, dur: .4, type: 'sawtooth', gain: .3, lp: 1200, dist: d, dx }); noise({ f: 1200, f2: 200, q: .8, dur: .35, gain: .25, dist: d, dx }); },
    growl(d, dx) { const t = rnd(.5, .9); tone({ f: rnd(60, 95), f2: rnd(45, 70), dur: t, type: 'sawtooth', gain: .28, lp: 380, attack: .12, dist: d, dx }); tone({ f: rnd(150, 210), f2: 90, dur: t * .6, type: 'square', gain: .05, lp: 600, dist: d, dx }); },
    hurt() { tone({ f: 260, f2: 90, dur: .28, type: 'sawtooth', gain: .32, lp: 1000 }); noise({ type: 'lowpass', f: 700, dur: .2, gain: .35 }); },
    down() { [330, 247, 185, 123].forEach((f, i) => tone({ f, dur: .35, type: 'triangle', gain: .25, when: i * .16 })); },
    revive() { [392, 523, 784].forEach((f, i) => tone({ f, dur: .45, type: 'sine', gain: .22, when: i * .1 })); noise({ f: 4000, q: .5, dur: .6, gain: .06, when: .1 }); },
    horn() { [0, .02].forEach(w => { tone({ f: 196, f2: 185, dur: 2.2, type: 'sawtooth', gain: .16, lp: 700, attack: .35, when: w }); tone({ f: 294, f2: 277, dur: 2.2, type: 'sawtooth', gain: .1, lp: 800, attack: .4, when: w }); }); },
    night() { tone({ f: 48, f2: 38, dur: 3.2, type: 'sine', gain: .4, attack: .9 }); noise({ type: 'lowpass', f: 220, dur: 3, gain: .3, attack: 1 }); tone({ f: 233, dur: 2.5, type: 'triangle', gain: .06, attack: 1, when: .4 }); },
    dawn() { for (let i = 0; i < 5; i++) { const b = rnd(2200, 3400); tone({ f: b, f2: b * 1.3, dur: .09, gain: .09, when: i * .13 + rnd(0, .05) }); } [523, 659, 784].forEach((f, i) => tone({ f, dur: 1.4, type: 'sine', gain: .12, attack: .3, when: .2 + i * .05 })); },
    fireOut(d, dx) { noise({ f: 2500, f2: 300, q: .6, dur: 1.2, gain: .35, attack: .02, dist: d, dx }); tone({ f: 90, f2: 40, dur: 1, gain: .25, type: 'triangle', dist: d, dx }); },
    step(d, dx) { noise({ type: 'lowpass', f: rnd(350, 600), dur: .07, gain: .16, dist: d, dx }); },
    coin() { tone({ f: 1318, dur: .08, type: 'square', gain: .09 }); tone({ f: 1976, dur: .28, type: 'square', gain: .09, when: .07 }); },
    treefall(d, dx) { noise({ type: 'lowpass', f: 500, f2: 120, q: .7, dur: .75, gain: .55, attack: .02, dist: d, dx }); tone({ f: 70, f2: 38, dur: .6, type: 'sine', gain: .6, dist: d, dx }); noise({ f: 2600, q: .6, dur: .35, gain: .22, when: .02, dist: d, dx }); },
    rockbreak(d, dx) { noise({ type: 'highpass', f: 1800, dur: .22, gain: .45, dist: d, dx }); noise({ f: 700, f2: 200, q: .8, dur: .4, gain: .4, dist: d, dx }); tone({ f: 120, f2: 50, dur: .3, type: 'triangle', gain: .4, dist: d, dx }); },
    reloadStart(d, dx) { noise({ f: 2400, q: 2, dur: .05, gain: .22, dist: d, dx }); tone({ f: 320, f2: 170, dur: .07, type: 'square', gain: .07, dist: d, dx }); },   // the magazine drops out
    reloadEnd(d, dx) { tone({ f: 520, f2: 260, dur: .06, type: 'square', gain: .09, dist: d, dx }); noise({ f: 1800, q: 1.5, dur: .06, gain: .26, when: .08, dist: d, dx }); tone({ f: 900, f2: 560, dur: .05, type: 'square', gain: .07, when: .08, dist: d, dx }); },   // slapped back in and cocked
    clang(d, dx) { noise({ type: 'highpass', f: 2600, dur: .12, gain: .3, dist: d, dx }); tone({ f: 1250, f2: 800, dur: .16, type: 'square', gain: .09, dist: d, dx }); tone({ f: 1900, f2: 1500, dur: .1, type: 'triangle', gain: .08, dist: d, dx }); },   // a shot bouncing off a shield
    pickup() { tone({ f: 700, f2: 1100, dur: .09, type: 'triangle', gain: .12 }); tone({ f: 1400, dur: .1, type: 'sine', gain: .08, when: .05 }); },
    build(d, dx) { [0, .13, .27].forEach(w => { noise({ f: 1500, q: 1, dur: .07, gain: .45, when: w, dist: d, dx }); tone({ f: 210, f2: 120, dur: .09, type: 'triangle', gain: .4, when: w, dist: d, dx }); }); },
    chest() { tone({ f: 180, f2: 300, dur: .18, type: 'triangle', gain: .22 }); noise({ f: 900, q: 1, dur: .12, gain: .2, when: .05 }); },
    cook() { for (let i = 0; i < 4; i++) noise({ f: 500 + i * 220, f2: 900 + i * 260, q: 1.4, dur: .14, gain: .22, when: i * .08 }); tone({ f: 523, dur: .25, type: 'triangle', gain: .12, when: .3 }); tone({ f: 784, dur: .3, type: 'triangle', gain: .12, when: .38 }); },
    smelterStart(d, dx) { tone({ f: 90, f2: 60, dur: .25, type: 'triangle', gain: .5, dist: d, dx }); noise({ f: 300, f2: 1400, q: .8, dur: .5, gain: .3, attack: .1, dist: d, dx }); noise({ type: 'highpass', f: 3000, dur: .2, gain: .12, when: .15, dist: d, dx }); },
    smeltDone(d, dx) { tone({ f: 880, dur: .35, type: 'square', gain: .12, dist: d, dx }); tone({ f: 1318, dur: .45, type: 'triangle', gain: .14, when: .02, dist: d, dx }); noise({ type: 'highpass', f: 4000, dur: .25, gain: .25, dist: d, dx }); tone({ f: 160, f2: 90, dur: .2, type: 'triangle', gain: .3, dist: d, dx }); },
    roar() { tone({ f: 70, f2: 38, dur: 1.4, type: 'sawtooth', gain: .5, lp: 500, attack: .15 }); tone({ f: 150, f2: 80, dur: 1.1, type: 'square', gain: .16, lp: 700, attack: .1 }); noise({ type: 'lowpass', f: 900, f2: 200, q: .7, dur: 1.3, gain: .4, attack: .1 }); },
    slam() { tone({ f: 95, f2: 35, dur: .45, type: 'sine', gain: .7 }); noise({ type: 'lowpass', f: 700, dur: .4, gain: .5 }); noise({ f: 2500, q: .6, dur: .15, gain: .25 }); },
    splash(d, dx, big) {   // a shark breaking the surface / crashing back in: a wet crash, a low thump and a few bubbly drips
      const g = big ? 1 : .7; noise({ type: 'lowpass', f: 2800, f2: 450, q: .6, dur: .6, gain: .5 * g, attack: .01, dist: d, dx }); noise({ type: 'highpass', f: 3200, dur: .22, gain: .18 * g, when: .02, dist: d, dx }); tone({ f: 150, f2: 55, dur: .32, type: 'sine', gain: .4 * g, dist: d, dx });
      for (let i = 0; i < 4; i++) tone({ f: rnd(480, 850), f2: rnd(900, 1500), dur: .06, type: 'sine', gain: .06 * g, when: .28 + i * .08 + rnd(0, .03), dist: d, dx });
    },
    whoosh(d, dx) { noise({ f: 500, f2: 2400, q: .8, dur: .17, gain: .14, attack: .04, dist: d, dx }); },
    pop(d, dx, g) { noise({ type: 'highpass', f: rnd(1800, 4500), q: .6, dur: rnd(.02, .06), gain: (g || .2), dist: d, dx }); },
  };

  // ---- ambience: waves, wind, crickets, music pad ----
  function loopNoise(type, f, q) {
    const s = ctx.createBufferSource(); s.buffer = nbuf; s.loop = true; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q || .7;
    const g = ctx.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(master); s.start(); return { g, fl, s };
  }
  function lfo(freq, depth, target) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = freq; g.gain.value = depth; o.connect(g); g.connect(target); o.start(); return o; }
  function buildAmbient() {
    const waves = loopNoise('lowpass', 520, .5); lfo(.11, 220, waves.fl.frequency); const wg = ctx.createGain(); lfo(.13, .35, waves.g.gain);
    const wind = loopNoise('bandpass', 420, 1.2); lfo(.07, 160, wind.fl.frequency);
    // crickets: high sine gated by fast square-ish LFO
    const cr = ctx.createOscillator(); cr.frequency.value = 4300; const cg = ctx.createGain(); cg.gain.value = 0; const gate = ctx.createGain(); gate.gain.value = 0;
    cr.connect(gate); gate.connect(cg); cg.connect(master); cr.start(); lfo(13, .5, gate.gain); const crk = ctx.createOscillator(); crk.frequency.value = .6; const crg = ctx.createGain(); crg.gain.value = .5; crk.connect(crg); crg.connect(gate.gain); crk.start();
    // music pads: day (major) and night (minor), triads of detuned triangles through a lowpass
    const pad = (notes, lp) => { const g = ctx.createGain(); g.gain.value = 0; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.connect(g); g.connect(master); notes.forEach((n, i) => { [-4, 4].forEach(dt => { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = n; o.detune.value = dt; const og = ctx.createGain(); og.gain.value = .35; o.connect(og); og.connect(f); o.start(); lfo(.05 + i * .02, .12, og.gain); }); }); return g; };
    const day = pad([130.8, 164.8, 196, 261.6], 900), night = pad([110, 130.8, 164.8, 82.4], 500);
    amb = { waves: waves.g, wind: wind.g, crick: cg, day, night, last: 0 };
  }
  // st: {night:0..1, shore:0..1, fire:0..1 (proximity), alive:bool, moving:bool}
  function update(st) {
    if (!ctx || !amb) return; const t = ctx.currentTime, k = .4;
    amb.waves.gain.setTargetAtTime(.003 + .15 * st.shore, t, k);   // st.shore = how much of the screen is ocean (0 = none visible)
    amb.wind.gain.setTargetAtTime(.01 + .07 * st.night, t, k);
    amb.crick.gain.setTargetAtTime(.012 * st.night * (1 - .8 * st.fire), t, k);
    amb.day.gain.setTargetAtTime(.04 * (1 - st.night), t, 1.2);
    amb.night.gain.setTargetAtTime(.05 * st.night, t, 1.2);
  }
  // rate limits (ms between plays of the same effect; alienDie also allows only 3 per 400 ms)
  const GAP = { alienDie: 40, hit: 45, chop: 40, mine: 40, pick: 50, growl: 250, step: 90, whoosh: 40, build: 60, rockbreak: 60 }, lastAt = {}, burst = [];
  for (const k of Object.keys(fx)) {
    const f = fx[k], gap = GAP[k] || 25;
    fx[k] = (...a) => { const n = performance.now(); if (n - (lastAt[k] || 0) < gap) return; if (k === 'alienDie') { while (burst.length && n - burst[0] > 400) burst.shift(); if (burst.length >= 3) return; burst.push(n); } lastAt[k] = n; return f(...a); };
  }
  // watchdog: bring the audio back if the browser suspended it, or rebuild it if its clock stopped
  let lastT = -1, stall = 0;
  function rebuild() { try { if (ctx) ctx.close(); } catch (e) { } ctx = null; master = null; amb = null; voices = []; init(); }
  setInterval(() => {
    if (!ctx || document.hidden) return;
    if (ctx.state === 'closed') { rebuild(); return; }
    if (ctx.state !== 'running') { ctx.resume().catch(() => { }); lastT = -1; return; }
    if (ctx.currentTime === lastT) { if (++stall >= 3) { stall = 0; rebuild(); } } else stall = 0; lastT = ctx.currentTime;
  }, 1500);
  return { init, resume, setMuted, isMuted, update, ...fx, ready: () => !!ctx };
})();
