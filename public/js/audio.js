// ============================================================
// audio.js — procedural WebAudio SFX + generative ambient music.
//
// Zero audio files, zero dependencies: every sound is synthesized
// in code (oscillators + filtered noise), so there is no
// copyrighted material and nothing to download.
//
// Rules:
//  - The AudioContext is created lazily on the first user gesture
//    (browsers block audio before that) and resumed on later ones.
//  - Preferences live in the game state (s.audio = { sfx, music }):
//    SFX default ON, music default OFF (opt-in). app.js syncs them
//    here via Audio.sync() whenever state loads or a toggle flips.
//  - Everything is wrapped in try/catch: if WebAudio is unavailable
//    or fails, all calls silently no-op and the game keeps running.
// ============================================================

const THROTTLE_MS = {
  hit: 80, crit: 100, hurt: 150, dodge: 180, parry: 180,
  coin: 200, click: 70, tab: 150, levelup: 800, raidboss: 1500,
  claim: 400, guild: 400, skill: 250,
};

const SFX_VOLUME = 0.22;   // master SFX gain
const MUSIC_VOLUME = 0.10; // master music gain (subtle)

// Generative music tracks. Each track is a slow pad progression + sparse
// plucks; the scheduler reads the active track so switching is seamless.
// 'shadow-requiem' is the original dark-fantasy loop (Am — F — Dm — E).
// 'void-hymn' is new: deeper, slower, written for the Void Abyss and the
// Throne of Shadows (Dm — Bb — Gm — A, sub-bass weight).
const TRACKS = {
  'shadow-requiem': {
    name: 'Shadow Requiem',
    chords: [
      [110.0, 130.81, 164.81],  // Am:  A2 C3 E3
      [87.31, 110.0, 130.81],   // F:   F2 A2 C3
      [73.42, 87.31, 110.0],    // Dm:  D2 F2 A2
      [82.41, 103.83, 123.47],  // E:   E2 G#2 B2
    ],
    chordSecs: 8,
    pluckScale: [220.0, 261.63, 293.66, 329.63, 392.0, 440.0], // A minor pentatonic
    pluckGap: [2.5, 6.0],
  },
  'void-hymn': {
    name: 'Void Hymn',
    chords: [
      [73.42, 87.31, 110.0],    // Dm:  D2 F2 A2
      [58.27, 73.42, 87.31],    // Bb:  Bb1 D2 F2
      [49.0, 58.27, 73.42],     // Gm:  G1 Bb1 D2 (deep)
      [55.0, 65.41, 82.41],     // A:   A1 C2 E2
    ],
    chordSecs: 11,
    pluckScale: [146.83, 174.61, 196.0, 220.0, 261.63], // D minor pentatonic, low
    pluckGap: [4.0, 9.0],
  },
};
export const MUSIC_TRACKS = Object.keys(TRACKS);
export const MUSIC_TRACK_NAMES = Object.fromEntries(
  Object.entries(TRACKS).map(([id, t]) => [id, t.name])
);
const DEFAULT_TRACK = 'shadow-requiem';

export const Audio = {
  _ctx: null,
  _sfxGain: null,
  _musicGain: null,
  _noiseBuf: null,
  _last: Object.create(null),
  _musicTimer: null,
  _musicNext: 0,
  _musicChord: 0,
  _musicPluckAt: 0,
  _musicTrackId: DEFAULT_TRACK,
  _inited: false,
  prefs: { sfx: true, music: false, track: DEFAULT_TRACK },

  // ---- lifecycle -------------------------------------------------

  init() {
    if (this._inited) return;
    this._inited = true;
    try {
      const unlock = () => this.unlock();
      window.addEventListener('pointerdown', unlock, { once: true, capture: true });
      window.addEventListener('keydown', unlock, { once: true, capture: true });
      // Generic button click tick. Tabs, the tap button and the skill
      // button play their own sounds — skip them here to avoid doubles.
      document.addEventListener('click', (e) => {
        try {
          const b = e.target && e.target.closest ? e.target.closest('button') : null;
          if (!b) return;
          if (b.classList.contains('tab-btn')) return;
          if (b.id === 'tap-btn' || b.id === 'skill-btn') return;
          this.play('click');
        } catch { /* ignore */ }
      });
      // Be polite: suspend audio when the tab is hidden.
      document.addEventListener('visibilitychange', () => {
        try {
          if (!this._ctx) return;
          if (document.hidden) this._ctx.suspend();
          else if (this.prefs.sfx || this.prefs.music) this._ctx.resume();
        } catch { /* ignore */ }
      });
    } catch { /* never break the game over audio */ }
  },

  unlock() {
    try {
      if (!this._ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this._ctx = new AC();
        this._sfxGain = this._ctx.createGain();
        this._sfxGain.gain.value = SFX_VOLUME;
        this._sfxGain.connect(this._ctx.destination);
        this._musicGain = this._ctx.createGain();
        this._musicGain.gain.value = MUSIC_VOLUME;
        this._musicGain.connect(this._ctx.destination);
      }
      if (this._ctx.state === 'suspended') this._ctx.resume();
      if (this.prefs.music) this._startMusic();
      return true;
    } catch {
      return false;
    }
  },

  // Called by app.js whenever the player state loads or audio prefs change.
  sync(p) {
    try {
      const track = TRACKS[p && p.track] ? p.track : DEFAULT_TRACK;
      this.prefs = {
        sfx: !p || p.sfx !== false,
        music: !!(p && p.music),
        track,
      };
      if (track !== this._musicTrackId) this._switchTrack(track);
      if (this._ctx) {
        if (this.prefs.music) this._startMusic();
        else this._stopMusic();
      }
      // SFX off kills the inn ambience too.
      if (!this.prefs.sfx) this.stopInnAmbience();
    } catch { /* ignore */ }
  },

  // Switch the generative track (restarts the progression; keeps playing if
  // music is on). Unknown ids fall back to the default track.
  setTrack(id) {
    const track = TRACKS[id] ? id : DEFAULT_TRACK;
    this.prefs.track = track;
    this._switchTrack(track);
  },

  _switchTrack(track) {
    this._musicTrackId = track;
    this._musicChord = 0;
    if (this._ctx) this._musicPluckAt = this._ctx.currentTime + 2.5;
  },

  get state() {
    return {
      unlocked: !!this._ctx,
      running: !!(this._ctx && this._ctx.state === 'running'),
      sfx: this.prefs.sfx,
      music: this.prefs.music,
      track: this.prefs.track,
      trackName: (TRACKS[this.prefs.track] || TRACKS[DEFAULT_TRACK]).name,
      musicPlaying: !!this._musicTimer,
      innAmbience: !!this._inn,
    };
  },

  // ---- one-shot SFX ----------------------------------------------

  play(name) {
    try {
      if (!this.prefs.sfx) return;
      const ctx = this._ctx;
      if (!ctx || ctx.state !== 'running') return;
      const nowMs = Date.now();
      const cool = THROTTLE_MS[name] || 120;
      if (nowMs - (this._last[name] || 0) < cool) return;
      this._last[name] = nowMs;
      const t = ctx.currentTime;
      switch (name) {
        case 'hit': this._hit(t); break;
        case 'crit': this._crit(t); break;
        case 'hurt': this._hurt(t); break;
        case 'dodge': this._dodge(t); break;
        case 'parry': this._parry(t); break;
        case 'coin': this._coin(t); break;
        case 'click': this._click(t); break;
        case 'tab': this._tab(t); break;
        case 'levelup': this._levelup(t); break;
        case 'raidboss': this._raidboss(t); break;
        case 'claim': this._claim(t); break;
        case 'guild': this._guild(t); break;
        case 'skill': this._skill(t); break;
        default: break;
      }
    } catch { /* ignore */ }
  },

  // ---- synth helpers ----------------------------------------------

  _tone({ f, f2 = null, at = 0, dur = 0.15, type = 'sine', vol = 0.5, dest = null }) {
    const ctx = this._ctx;
    const t0 = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f), t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest || this._sfxGain);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  },

  _getNoiseBuffer() {
    if (this._noiseBuf) return this._noiseBuf;
    const ctx = this._ctx;
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
    return buf;
  },

  _noise({ at = 0, dur = 0.15, vol = 0.4, type = 'lowpass', f = 1000, f2 = null, q = 1 }) {
    const ctx = this._ctx;
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this._getNoiseBuffer();
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f, t0);
    if (f2) flt.frequency.exponentialRampToValueAtTime(Math.max(40, f2), t0 + dur);
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt).connect(g).connect(this._sfxGain);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  },

  // ---- SFX recipes (dark fantasy, kept subtle) --------------------

  _hit(t) {
    this._noise({ dur: 0.09, vol: 0.5, f: 900 });
    this._tone({ f: 170, f2: 85, dur: 0.09, type: 'triangle', vol: 0.5 });
  },
  _crit(t) {
    this._hit(t);
    this._tone({ f: 1250, dur: 0.12, type: 'square', vol: 0.16 });
    this._tone({ f: 1870, dur: 0.16, type: 'sine', vol: 0.28, at: 0.02 });
  },
  _hurt(t) {
    this._tone({ f: 115, f2: 52, dur: 0.2, type: 'sine', vol: 0.6 });
  },
  _dodge(t) {
    this._noise({ dur: 0.13, vol: 0.3, type: 'bandpass', f: 500, f2: 2600, q: 1.5 });
  },
  _parry(t) {
    this._tone({ f: 2300, dur: 0.05, type: 'square', vol: 0.14 });
    this._tone({ f: 3450, dur: 0.07, type: 'sine', vol: 0.2, at: 0.015 });
  },
  _coin(t) {
    this._tone({ f: 880, dur: 0.07, type: 'sine', vol: 0.32 });
    this._tone({ f: 1318.5, dur: 0.11, type: 'sine', vol: 0.32, at: 0.06 });
  },
  _click(t) {
    this._tone({ f: 2100, dur: 0.035, type: 'triangle', vol: 0.16 });
  },
  _tab(t) {
    this._tone({ f: 520, f2: 660, dur: 0.08, type: 'sine', vol: 0.2 });
  },
  _levelup(t) {
    const seq = [220, 261.63, 329.63, 440];
    seq.forEach((f, i) => this._tone({ f, dur: 0.16, type: 'triangle', vol: 0.4, at: i * 0.09 }));
    this._tone({ f: 554.37, dur: 0.3, type: 'sine', vol: 0.3, at: seq.length * 0.09 });
  },
  _raidboss(t) {
    // Ominous low horn: detuned saws with a slow swell.
    const ctx = this._ctx;
    const t0 = ctx.currentTime;
    [65.41, 98.0].forEach((f) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const flt = ctx.createBiquadFilter();
      o.type = 'sawtooth';
      o.frequency.value = f;
      flt.type = 'lowpass';
      flt.frequency.value = 320;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.85);
      o.connect(flt).connect(g).connect(this._sfxGain);
      o.start(t0);
      o.stop(t0 + 0.95);
    });
  },
  _claim(t) {
    this._tone({ f: 1046.5, dur: 0.22, type: 'sine', vol: 0.3 });
    this._tone({ f: 1568, dur: 0.3, type: 'sine', vol: 0.22, at: 0.08 });
  },
  _guild(t) {
    [110, 164.81, 220].forEach((f) => this._tone({ f, dur: 0.4, type: 'triangle', vol: 0.22 }));
  },
  _skill(t) {
    this._noise({ dur: 0.22, vol: 0.35, type: 'highpass', f: 900, f2: 5200 });
  },

  // ---- inn ambience (rain + tavern chatter + distant thunder) --------

  _inn: null, // { gain, nodes:[], timers:[] } while resting at the inn

  // Procedural tavern-at-night: steady filtered rain, abstract indistinct
  // chatter (no intelligible speech), and occasional distant thunder.
  // Plays only while inside the inn; obeys the SFX on/off setting.
  startInnAmbience() {
    try {
      if (!this.prefs.sfx) return;
      if (!this.unlock()) return;
      const ctx = this._ctx;
      if (!ctx || ctx.state !== 'running') return;
      this.stopInnAmbience();
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(this._sfxGain);
      // Rain: looped noise through a soft lowpass, gently swelling.
      const rain = ctx.createBufferSource();
      rain.buffer = this._getNoiseBuffer();
      rain.loop = true;
      const rf = ctx.createBiquadFilter();
      rf.type = 'lowpass';
      rf.frequency.value = 850;
      const rg = ctx.createGain();
      rg.gain.value = 0.09;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.025;
      lfo.connect(lfoG);
      lfoG.connect(rg.gain);
      rain.connect(rf);
      rf.connect(rg);
      rg.connect(master);
      rain.start();
      lfo.start();
      master.gain.setTargetAtTime(1, ctx.currentTime, 1.5); // fade in
      const timers = [];
      // Chatter: abstract babble bursts — bandpassed noise with a wandering
      // formant, kept quiet and unintelligible.
      const chatter = () => {
        try {
          if (this.prefs.sfx && this._inn) {
            const n = 2 + Math.floor(Math.random() * 2);
            for (let i = 0; i < n; i++) this._babble(ctx, master);
          }
        } catch { /* ignore */ }
        if (this._inn) timers.push(setTimeout(chatter, 3000 + Math.random() * 5000));
      };
      timers.push(setTimeout(chatter, 1200));
      // Thunder: distant low rumble every 20–60s.
      const thunder = () => {
        try {
          if (this.prefs.sfx && this._inn) this._thunder(ctx, master);
        } catch { /* ignore */ }
        if (this._inn) timers.push(setTimeout(thunder, 20000 + Math.random() * 40000));
      };
      timers.push(setTimeout(thunder, 8000 + Math.random() * 12000));
      this._inn = { gain: master, nodes: [rain, lfo], timers };
    } catch { /* never break the game over ambience */ }
  },

  stopInnAmbience() {
    try {
      const inn = this._inn;
      this._inn = null;
      if (!inn) return;
      inn.timers.forEach((t) => clearTimeout(t));
      if (this._ctx) {
        const t = this._ctx.currentTime;
        try { inn.gain.gain.setTargetAtTime(0.0001, t, 0.4); } catch { /* ignore */ }
        inn.nodes.forEach((n) => { try { n.stop(t + 1.5); } catch { /* ignore */ } });
      }
    } catch { /* ignore */ }
  },

  _babble(ctx, dest) {
    const t0 = ctx.currentTime + Math.random() * 0.4;
    const dur = 0.35 + Math.random() * 0.5;
    const src = ctx.createBufferSource();
    src.buffer = this._getNoiseBuffer();
    src.loop = true;
    src.playbackRate.value = 0.5 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2.5;
    f.frequency.setValueAtTime(280 + Math.random() * 420, t0);
    f.frequency.linearRampToValueAtTime(280 + Math.random() * 420, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.03, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t0);
    src.stop(t0 + dur + 0.1);
  },

  _thunder(ctx, dest) {
    const t0 = ctx.currentTime;
    const dur = 2.2 + Math.random() * 1.6;
    const src = ctx.createBufferSource();
    src.buffer = this._getNoiseBuffer();
    src.loop = true;
    src.playbackRate.value = 0.25;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(160, t0);
    f.frequency.exponentialRampToValueAtTime(60, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t0);
    src.stop(t0 + dur + 0.1);
  },

  _startMusic() {
    if (this._musicTimer || !this._ctx) return;
    try {
      const now = this._ctx.currentTime;
      this._musicNext = now + 0.1;
      this._musicChord = 0;
      this._musicPluckAt = now + 2.5;
      this._padNodes = [];
      this._musicTimer = setInterval(() => this._scheduleMusic(), 400);
      this._scheduleMusic();
    } catch { /* ignore */ }
  },

  _stopMusic() {
    if (this._musicTimer) {
      clearInterval(this._musicTimer);
      this._musicTimer = null;
    }
    try {
      (this._padNodes || []).forEach((n) => {
        try { n.gain.gain.cancelScheduledValues(this._ctx.currentTime); } catch { /* ignore */ }
        try { n.gain.gain.setTargetAtTime(0.0001, this._ctx.currentTime, 0.4); } catch { /* ignore */ }
        try { n.oscs.forEach((o) => o.stop(this._ctx.currentTime + 1.5)); } catch { /* ignore */ }
      });
    } catch { /* ignore */ }
    this._padNodes = [];
  },

  _scheduleMusic() {
    try {
      const ctx = this._ctx;
      if (!ctx || !this.prefs.music) return;
      const track = TRACKS[this._musicTrackId] || TRACKS[DEFAULT_TRACK];
      const ahead = ctx.currentTime + 1.4;
      while (this._musicNext < ahead) {
        this._playPad(this._musicChord % track.chords.length, this._musicNext, track);
        this._musicChord++;
        this._musicNext += track.chordSecs;
      }
      if (this._musicPluckAt < ahead) {
        const scale = track.pluckScale;
        const f = scale[Math.floor(Math.random() * scale.length)];
        this._pluck(f, this._musicPluckAt);
        const [g0, g1] = track.pluckGap;
        this._musicPluckAt += g0 + Math.random() * (g1 - g0);
      }
    } catch { /* ignore */ }
  },

  _playPad(chordIdx, t0, track) {
    const ctx = this._ctx;
    const freqs = track.chords[chordIdx];
    const dur = track.chordSecs + 2; // overlap for crossfade
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(420, t0);
    // Slow filter swell gives the pad its breathing motion.
    flt.frequency.linearRampToValueAtTime(720, t0 + dur / 2);
    flt.frequency.linearRampToValueAtTime(420, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.5, t0 + 2.2);
    g.gain.setValueAtTime(0.5, t0 + dur - 2.2);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    flt.connect(g).connect(this._musicGain);
    const oscs = freqs.map((f) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.0015); // slight detune
      o.connect(flt);
      o.start(t0);
      o.stop(t0 + dur + 0.1);
      return o;
    });
    this._padNodes.push({ oscs, gain: g });
    // Prune finished pads so the array can't grow.
    if (this._padNodes.length > 4) this._padNodes.splice(0, this._padNodes.length - 4);
  },

  _pluck(f, t0) {
    const ctx = this._ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
    o.connect(g).connect(this._musicGain);
    o.start(t0);
    o.stop(t0 + 1.6);
  },

  // Track catalog, exposed on the Audio object so app.js/ui.js can read
  // Audio.MUSIC_TRACKS / Audio.MUSIC_TRACK_NAMES without importing the
  // named exports.
  MUSIC_TRACKS,
  MUSIC_TRACK_NAMES,
};

// Test hook (read-only-ish): lets headless validation confirm the audio
// engine unlocks, prefs sync, and toggles persist. Exposes no game,
// account, or staff data.
try {
  window.__kopAudio = Audio;
} catch { /* ignore */ }
