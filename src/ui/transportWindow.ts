/**
 * The TRANSPORT window: play / stop / pause / record, tempo, steps per beat, swing, LOOP,
 * RESTART, the global scale, and the seed with its variations and randomisation.
 */
import { NOTE_NAMES, SCALES } from '../engine/scales';
import { PPQ, STEPS_PER_BEAT } from '../engine/types';
import { BEATS_PER_BAR, type App } from '../app/app';
import { el, label, setTip, svgEl, text } from './dom';
import { Btn, MWindow, Num, Sel, textField } from './widgets';

const ICON = {
  stop: '<rect x="4" y="3" width="8" height="8"/>',
  play: '<polygon points="4,2 12,7 4,12"/>',
  pause: '<rect x="4" y="3" width="3" height="8"/><rect x="9" y="3" width="3" height="8"/>',
  rec: '<circle cx="8" cy="7" r="4"/>',
};
const icon = (k: keyof typeof ICON) => svgEl(16, 14, ICON[k]);

export class TransportWindow {
  win: MWindow;
  private ctrls: { update(): void }[] = [];
  private pos: HTMLDivElement;
  private clock: HTMLDivElement;
  private seed: { el: HTMLInputElement; update(): void };
  openLocks: () => void = () => {};

  constructor(
    private app: App,
    parent: HTMLElement,
  ) {
    this.win = new MWindow(parent, { id: 'transport', title: 'TRANSPORT', x: 598, y: 20, w: 358, h: 108 });
    const b = this.win.body;
    const t = app.transport;
    const y1 = 4;
    this.ctrls.push(new Btn(b, 4, y1, 26, 18, icon('stop'), { tip: 'Stop: all notes off, back to the start (Space)', on: () => t.state === 'stopped', onClick: () => app.stop() }));
    this.ctrls.push(new Btn(b, 31, y1, 26, 18, icon('play'), { tip: 'Play (Space)', on: () => t.state === 'playing', onClick: () => void app.play() }));
    this.ctrls.push(new Btn(b, 58, y1, 26, 18, icon('pause'), { tip: 'Pause / continue: keeps the place (Return)', on: () => t.state === 'paused', onClick: () => void app.pauseResume() }));
    this.ctrls.push(new Btn(b, 85, y1, 26, 18, icon('rec'), { tip: 'Record what plays (live changes included), then export it as a MIDI file (Shift R)', on: () => t.recording, onClick: () => app.toggleRecord() }));
    this.pos = el('div', 'box', b, [116, y1, 76, 18]);
    Object.assign(this.pos.style, { display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '600', fontSize: '10px' });
    setTip(this.pos, 'Bar . beat being heard');
    label(b, 198, y1 + 2, 'BPM', 'tiny');
    this.ctrls.push(new Num(b, 214, y1, 40, 18, { tip: 'Tempo (beats per minute)', min: 20, max: 300, step: 1, big: 10, get: () => app.patch.bpm, set: (v) => app.setBpm(v), disabled: () => app.follower.status === 'running' || app.follower.status === 'detected' }));
    label(b, 258, y1 + 2, 'STEPS', 'tiny');
    label(b, 258, y1 + 10, '/BEAT', 'tiny');
    this.ctrls.push(new Sel<number>(b, 284, y1, 30, 18, { tip: 'Transport steps per beat (each region’s RATE multiplies it)', items: () => STEPS_PER_BEAT.map((s) => ({ value: s, label: String(s) })), get: () => app.patch.stepsPerBeat, set: (v) => ((app.patch.stepsPerBeat = v), app.changed('patch')) }));
    this.clock = el('div', 'box', b, [318, y1, 34, 18]);
    Object.assign(this.clock.style, { display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontFamily: 'var(--font-tiny)' });

    const y2 = 27;
    this.ctrls.push(new Btn(b, 4, y2, 38, 15, 'LOOP', { tip: 'Scans repeat. Off: each region plays its scan once, then the transport stops.', on: () => app.patch.loop, onClick: () => ((app.patch.loop = !app.patch.loop), app.changed('patch')) }));
    this.ctrls.push(new Btn(b, 44, y2, 50, 15, 'RESTART', { tip: 'Every scan starts again (on the next beat when playing) (R)', onClick: () => app.transport.restartScans() }));
    label(b, 100, y2 + 4, 'SWING', 'tiny');
    this.ctrls.push(new Num(b, 126, y2, 34, 15, { tip: 'Swing: every second step is delayed', min: 0, max: 50, step: 1, big: 10, get: () => Math.round(app.patch.swing * 100), set: (v) => ((app.patch.swing = v / 100), app.changed('patch')), format: (v) => v + '%' }));
    label(b, 166, y2 + 4, 'SCALE', 'tiny');
    this.ctrls.push(new Sel<string>(b, 192, y2, 76, 15, { tip: 'Global scale (regions with GLOBAL on)', items: () => SCALES.map((s) => ({ value: s.id, label: s.name.toUpperCase() })), get: () => app.patch.scale, set: (v) => ((app.patch.scale = v), app.changed('patch')) }));
    label(b, 272, y2 + 4, 'ROOT', 'tiny');
    this.ctrls.push(new Sel<number>(b, 294, y2, 38, 15, { tip: 'Global root note', items: () => NOTE_NAMES.map((n, i) => ({ value: i, label: n })), get: () => app.patch.root, set: (v) => ((app.patch.root = v), app.changed('patch')) }));
    this.ctrls.push(new Btn(b, 334, y2, 18, 15, '!', { tip: 'PANIC: every note off on all 16 channels (⌘. / Ctrl .)', onClick: () => app.panic() }));

    const y3 = 47;
    label(b, 4, y3 + 4, 'SEED', 'tiny');
    this.seed = textField(b, 26, y3, 104, 15, { label: 'Seed', tip: 'The seed: a number or any words. It decides every random choice (rests, walks, jumps), so the same picture, patch and seed always play the same.', get: () => app.patch.seedText, set: (v) => app.setSeedText(v) });
    this.ctrls.push(new Btn(b, 133, y3, 54, 15, 'VARIATION', { tip: 'New variation: a new seed (V)', onClick: () => app.newVariation() }));
    this.ctrls.push(new Btn(b, 190, y3, 58, 15, 'RANDOMISE', { tip: 'Randomise the regions (not the locked categories, never the MIDI settings or the picture) (⌥X)', onClick: () => app.randomise(false) }));
    this.ctrls.push(new Btn(b, 251, y3, 58, 15, 'WILDCARD', { tip: 'Randomise more boldly: also the global scale, swing and regions’ own scales (⌥W)', onClick: () => app.randomise(true) }));
    this.ctrls.push(new Btn(b, 312, y3, 40, 15, 'LOCKS', { tip: 'Which categories randomising leaves alone', on: () => Object.values(app.prefs.locks).some(Boolean), onClick: () => this.openLocks() }));

    const y4 = 67;
    label(b, 4, y4 + 4, 'PATCH', 'tiny');
    const name = textField(b, 32, y4, 120, 15, { label: 'Patch name', tip: 'The patch name (used for its file name)', get: () => app.patch.name, set: (v) => ((app.patch.name = v.trim().slice(0, 60) || 'Untitled'), app.changed('patch')) });
    this.ctrls.push(name);
    this.ctrls.push(new Btn(b, 156, y4, 64, 15, 'AUDIO', { tip: 'Internal preview sounds on / off (independent of MIDI)', on: () => app.prefs.audio, onClick: () => this.toggleAudio() }));
    label(b, 224, y4 + 4, 'VOL', 'tiny');
    this.ctrls.push(new Num(b, 240, y4, 34, 15, { tip: 'Preview master volume', min: 0, max: 100, step: 5, get: () => Math.round(app.prefs.volume * 100), set: (v) => this.setVolume(v / 100) }));
    this.ctrls.push(new Btn(b, 278, y4, 74, 15, 'MIDI…', { tip: 'MIDI settings: output, clock, panic (⌥M)', on: () => app.midi.connected, onClick: () => this.openMidi() }));

    app.on((c) => {
      if (c === 'patch' || c === 'transport' || c === 'midi' || c === 'take' || c === 'prefs') this.update();
    });
    this.update();
  }

  openMidi: () => void = () => {};

  toggleAudio(): void {
    this.app.prefs.audio = !this.app.prefs.audio;
    this.app.audio.enabled = this.app.prefs.audio;
    if (!this.app.prefs.audio) this.app.audio.stopAll();
    else void this.app.audio.unlock();
    this.app.changed('prefs');
  }

  private setVolume(v: number): void {
    this.app.prefs.volume = v;
    this.app.audio.setVolume(v);
    this.app.changed('prefs');
  }

  update(): void {
    for (const c of this.ctrls) c.update();
    this.seed.update();
    const f = this.app.follower.status;
    text(this.clock, f === 'off' ? 'INT' : f === 'running' || f === 'detected' ? 'EXT' : f === 'lost' ? 'LOST' : 'WAIT');
    setTip(this.clock, f === 'off' ? 'Internal clock (MIDI settings: follow an external clock)' : `External clock: ${f}${this.app.follower.bpm ? `, ${this.app.follower.bpm} BPM` : ''}`);
  }

  /** Bar . beat display (every frame). */
  frame(): void {
    const tick = this.app.transport.position;
    const beat = Math.floor(tick / PPQ);
    const bar = Math.floor(beat / BEATS_PER_BAR) + 1;
    text(this.pos, this.app.transport.state === 'stopped' ? '---- . -' : `${String(bar).padStart(4, '0')} . ${(beat % BEATS_PER_BAR) + 1}`);
  }
}
