/**
 * The floating windows: MIDI settings, MIDI export, palettes (Slop Factory Core's palette
 * editor), randomise locks, quick help, about, and keyboard shortcuts.
 */
import { paletteEditor, type PaletteLibrary } from '@slopfactory/core/palette';
import { RANDOM_CATEGORIES, RANDOM_LABEL } from '../engine/randomise';
import { PPQ } from '../engine/types';
import { BEATS_PER_BAR, type App } from '../app/app';
import { download, el, label, text } from './dom';
import { KEYS, chordLabel } from './keys';
import { Btn, MWindow, Num, Sel } from './widgets';

export class MidiWindow {
  win: MWindow;
  private ctrls: { update(): void }[] = [];
  private stateTxt: HTMLDivElement;
  private log: HTMLDivElement;
  private lines: string[] = [];

  constructor(
    private app: App,
    parent: HTMLElement,
  ) {
    this.win = new MWindow(parent, { id: 'midi', title: 'MIDI SETTINGS', x: 300, y: 90, w: 340, h: 250, closable: true });
    this.win.close();
    const b = this.win.body;
    this.stateTxt = label(b, 8, 8, '', 'small');
    this.ctrls.push(new Btn(b, 250, 4, 82, 15, 'CONNECT', { tip: 'Ask the browser for MIDI access', disabled: () => !app.midiAccess.supported || app.midiAccess.status === 'ready', onClick: () => void app.enableMidi() }));
    label(b, 8, 30, 'OUTPUT', 'tiny');
    this.ctrls.push(
      new Sel<string>(b, 60, 26, 272, 15, {
        label: 'MIDI output',
        tip: 'Where PICTURESCUE sends its notes. Switching ends every sounding note first.',
        items: () => [{ value: '', label: '(none)' }, ...app.midiAccess.outputs().map((p) => ({ value: p.id, label: p.name + (p.connected ? '' : ' (gone)') }))],
        get: () => app.prefs.midiOut,
        set: (id) => app.selectOutput(id),
        disabled: () => app.midiAccess.status !== 'ready',
      }),
    );
    this.ctrls.push(new Btn(b, 60, 46, 90, 15, 'SEND NOTES', { tip: 'MIDI notes out on / off (the internal sounds are separate)', on: () => app.prefs.midiEnabled, onClick: () => ((app.prefs.midiEnabled = !app.prefs.midiEnabled), (app.midi.enabled = app.prefs.midiEnabled), app.midi.enabled || app.midi.releaseAll(), app.changed('prefs')) }));
    this.ctrls.push(new Btn(b, 154, 46, 90, 15, 'CLOCK OUT', { tip: 'Send MIDI clock (24 per beat) with Start, Stop, Continue and Song Position', on: () => app.prefs.clockOut, onClick: () => ((app.prefs.clockOut = !app.prefs.clockOut), (app.midi.clockOut = app.prefs.clockOut), app.changed('prefs')) }));
    this.ctrls.push(new Btn(b, 248, 46, 84, 15, 'PANIC', { tip: 'Every note off on all 16 channels', onClick: () => app.panic() }));
    label(b, 8, 74, 'CLOCK IN', 'tiny');
    this.ctrls.push(
      new Sel<string>(b, 60, 70, 272, 15, {
        label: 'Clock input',
        tip: 'An input to follow: its MIDI clock sets the tempo and its Start / Stop / Continue drive the transport',
        items: () => [{ value: '', label: '(none)' }, ...app.midiAccess.inputs().map((p) => ({ value: p.id, label: p.name }))],
        get: () => app.prefs.midiIn,
        set: (id) => app.selectInput(id),
        disabled: () => app.midiAccess.status !== 'ready',
      }),
    );
    this.ctrls.push(new Btn(b, 60, 90, 150, 15, 'FOLLOW EXTERNAL CLOCK', { tip: 'Follow the clock input’s tempo and transport', on: () => app.prefs.clockIn, onClick: () => ((app.prefs.clockIn = !app.prefs.clockIn), app.reconnectMidi(), app.changed('prefs')) }));
    label(b, 8, 116, 'Each region sends on its own channel (REGION window, CH).', 'small');
    label(b, 8, 128, 'Notes are tracked: stop, panic and device changes never leave notes hanging.', 'small');
    label(b, 8, 146, 'OUT MONITOR', 'tiny');
    this.log = el('div', 'monitor-log box', b, [8, 156, 324, 72]);
    this.log.style.padding = '2px 4px';
    app.midi.onSend = (m) => {
      if (!this.win.open) return;
      this.lines.push(`${m.kind.toUpperCase().padEnd(3)} CH${String(m.channel).padStart(2)} ${m.kind === 'cc' ? `CC${m.a}=${m.b}` : `${m.a} ${m.b}`}`);
      if (this.lines.length > 8) this.lines.shift();
    };
    app.on((c) => {
      if (c === 'midi' || c === 'prefs') this.update();
    });
    this.update();
  }

  update(): void {
    const a = this.app.midiAccess;
    text(this.stateTxt, !a.supported ? 'This browser has no Web MIDI. The internal sounds still play.' : a.status === 'ready' ? `MIDI ready: ${a.outputs().length} outputs, ${a.inputs().length} inputs.` : a.status === 'denied' ? 'MIDI access was refused.' : 'MIDI is not connected yet.');
    for (const c of this.ctrls) c.update();
  }

  frame(): void {
    if (this.win.open) text(this.log, this.lines.join('\n'));
  }
}

export class ExportWindow {
  win: MWindow;
  private ctrls: { update(): void }[] = [];
  private info: HTMLDivElement;

  constructor(
    private app: App,
    parent: HTMLElement,
  ) {
    this.win = new MWindow(parent, { id: 'export', title: 'EXPORT MIDI', x: 240, y: 120, w: 330, h: 176, closable: true });
    this.win.close();
    const b = this.win.body;
    label(b, 8, 8, 'A Standard MIDI File (format 1) of the current patch from the start:', 'small');
    label(b, 8, 20, 'tempo, one track per enabled region on its own channel, notes,', 'small');
    label(b, 8, 32, 'velocities and controllers, exactly as PLAY performs it.', 'small');
    label(b, 8, 54, 'LENGTH', 'tiny');
    const bars = [4, 8, 16, 32];
    bars.forEach((n, i) => this.ctrls.push(new Btn(b, 50 + i * 40, 50, 36, 15, `${n}`, { tip: `${n} bars`, on: () => app.prefs.exportBars === n, onClick: () => ((app.prefs.exportBars = n), app.changed('prefs'), this.update()) })));
    label(b, 214, 54, 'BARS', 'tiny');
    this.ctrls.push(new Num(b, 240, 50, 40, 15, { tip: 'Custom length in bars', min: 1, max: 999, get: () => app.prefs.exportBars, set: (v) => ((app.prefs.exportBars = v), app.changed('prefs'), this.update()) }));
    this.info = label(b, 8, 74, '', 'small');
    this.ctrls.push(new Btn(b, 8, 94, 150, 18, 'EXPORT MIDI FILE', { round: true, tip: 'Save the MIDI file', onClick: () => this.exportNow() }));
    label(b, 8, 122, 'RECORDING: what actually played, live changes included.', 'small');
    this.ctrls.push(new Btn(b, 8, 134, 100, 15, 'RECORD', { tip: 'Start / stop recording (Shift R)', on: () => app.transport.recording, onClick: () => app.toggleRecord() }));
    this.ctrls.push(new Btn(b, 112, 134, 150, 15, 'EXPORT RECORDING', { tip: 'Save the last recording as a MIDI file', disabled: () => !app.take, onClick: () => this.exportTake() }));
    app.on((c) => {
      if (c === 'take' || c === 'prefs' || c === 'patch') this.update();
    });
    this.update();
  }

  exportNow(): void {
    const bytes = this.app.exportMidi(this.app.prefs.exportBars);
    const name = `${this.app.patch.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'picturescue'}-${this.app.prefs.exportBars}bars.mid`;
    download(name, bytes, 'audio/midi');
    this.app.say(`Exported ${this.app.prefs.exportBars} bars as “${name}”.`);
  }

  exportTake(): void {
    const bytes = this.app.exportTake();
    if (!bytes) return;
    download('picturescue-recording.mid', bytes, 'audio/midi');
    this.app.say('Exported the recording as “picturescue-recording.mid”.');
  }

  update(): void {
    const bars = this.app.prefs.exportBars;
    const secs = (bars * BEATS_PER_BAR * PPQ * 60) / (PPQ * this.app.patch.bpm);
    text(this.info, `${bars} bars at ${this.app.patch.bpm} BPM = ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}. Seed “${this.app.patch.seedText}”.`);
    for (const c of this.ctrls) c.update();
  }
}

export class PaletteWindow {
  win: MWindow;
  constructor(lib: PaletteLibrary, parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'palette', title: 'PALETTE', x: 330, y: 60, w: 312, h: 330, closable: true });
    this.win.close();
    const host = el('div', '', this.win.body, [4, 2]);
    host.style.position = 'absolute';
    const ed = paletteEditor(host, lib);
    this.win.el.style.height = ed.height + 26 + 'px';
    this.win.body.style.height = ed.height + 8 + 'px';
  }
}

export class LocksWindow {
  win: MWindow;
  private ctrls: Btn[] = [];
  constructor(app: App, parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'locks', title: 'RANDOMISE LOCKS', x: 620, y: 140, w: 220, h: 200, closable: true });
    this.win.close();
    const b = this.win.body;
    label(b, 8, 6, 'Locked categories stay as they are when you', 'small');
    label(b, 8, 16, 'RANDOMISE or WILDCARD. MIDI and the picture', 'small');
    label(b, 8, 26, 'are never randomised.', 'small');
    RANDOM_CATEGORIES.forEach((cat, i) => {
      const x = 8 + (i % 2) * 104;
      const y = 42 + Math.floor(i / 2) * 20;
      this.ctrls.push(new Btn(b, x, y, 98, 16, RANDOM_LABEL[cat], { tip: `Lock ${RANDOM_LABEL[cat].toLowerCase()}`, on: () => app.prefs.locks[cat], onClick: () => ((app.prefs.locks[cat] = !app.prefs.locks[cat]), app.changed('prefs')) }));
    });
    this.ctrls.push(new Btn(b, 8, 128, 98, 16, 'UNLOCK ALL', { onClick: () => (RANDOM_CATEGORIES.forEach((c) => (app.prefs.locks[c] = false)), app.changed('prefs'), this.ctrls.forEach((x) => x.update())) }));
    app.on((c) => c === 'prefs' && this.ctrls.forEach((x) => x.update()));
  }
}

function proseWindow(parent: HTMLElement, id: string, title: string, x: number, y: number, w: number, h: number, html: string): MWindow {
  const win = new MWindow(parent, { id, title, x, y, w, h, closable: true });
  win.close();
  const p = el('div', 'prose', win.body, [10, 6, w - 20, h - 30]);
  p.innerHTML = html;
  return win;
}

export const HELP_HTML = `
<p><b>PICTURESCUE: pictures make music.</b> Load a picture, and four regions read it, cell by cell, in time with the music.</p>
<h3>In a minute</h3>
<p>1. Press <b>Space</b> (or ▶). The ST LOW-RES demo plays straight away.<br>2. Try another picture: <b>DEMOS</b>, <b>OPEN…</b>, or drop a file on the picture.<br>3. Click a region on the picture (or keys <b>1–4</b>), and change its <b>MODE</b> or <b>PRESET</b> in the REGION window.</p>
<h3>The five ideas</h3>
<p><b>IMAGE</b>: the source. It is kept at up to 640 pixels and measured at the ANALYSIS size (320 = the ST's low resolution). VIEW shows what the regions measure: brightness, hue, saturation, edges, or the 16 ST COLOURS.</p>
<p><b>REGIONS</b>: four rectangles, each with its own channel, sound, range, mapping and behaviour (all in the one global scale). Drag to move, handles to resize, PLACE ALL… for layouts.</p>
<p><b>SCANNING</b>: each region is a grid (COLS × ROWS). Its cursor visits one cell per step: HORIZONTAL, VERTICAL, PING-PONG, SERPENTINE, RANDOM WALK, SPIRAL or MANUAL (drag the cursor yourself). RATE multiplies the transport's steps; LENGTH and OFFSET choose part of the path; REVERSE plays it backwards.</p>
<p><b>MAPPING</b>: PITCH from brightness, hue, saturation or ST colour (the 16-colour palette climbs the scale, darkest lowest); VELOCITY from saturation, brightness or edges; TRIGGER on every step, brightness above a threshold, edges, colour changes, or detail; a CC from a measurement.</p>
<p><b>ONE SCALE</b>: the TRANSPORT's SCALE and ROOT are the only harmony: all four regions play in them, so they always fit together. Each region keeps its own range, channel, sound, mapping, rhythm and mode. Every note is made the same way: the mapping picks a pitch in the region's range; <b>TRANSP</b> (semitones) and <b>OCTAVE</b> shift it; the result is snapped to the nearest note of the scale (never off it) and folded back by octaves into <b>LOW</b>..<b>HIGH</b>.</p>
<p><b>PERFORMANCE</b>: the MODE decides how a region plays: MELODIC, RHYTHMIC, AMBIENT, POINTILLIST, DRONE or CHAOTIC. DENSITY keeps the busiest steps; REST adds seeded silences; SPACING keeps notes apart; GATE is the note length; REPEAT ties, re-strikes or skips a repeated note.</p>
<h3>Seeds</h3>
<p>Everything random (rests, walks, jumps, scattering) comes from the SEED: a number or any words. The same picture, patch and seed always play the same. VARIATION picks a new seed; RANDOMISE and WILDCARD change the settings (not the LOCKS, never MIDI or the picture).</p>
<h3>MIDI</h3>
<p>MIDI… connects an output (Chrome, Edge, Opera, Firefox). Each region plays on its own channel. CLOCK OUT sends MIDI clock; FOLLOW EXTERNAL CLOCK follows another device. PANIC (⌘. / Ctrl .) ends everything. File ▸ Export MIDI saves 4–999 bars; ● records what actually plays.</p>
<h3>Patches</h3>
<p>File ▸ Save Patch writes a .picturescue.json file with every setting and the picture itself (lossless), so it plays the same anywhere.</p>`;

export const ABOUT_HTML = `
<p><b>PICTURESCUE</b> · Pictures make music.</p>
<p>An experimental image-driven MIDI instrument inspired by <b>Picture Music</b>, Gareth Jones's Atari ST program (version 1.2), which turned 16-colour low-resolution pictures into MIDI by scanning four chosen areas horizontally, pixel by pixel, each with its own MIDI channel, transposition and scale.</p>
<p>PICTURESCUE is a new, independent instrument (a clean-room implementation: none of the original's code, graphics or data is used). It keeps the four regions and the colour-to-note idea (but gives them one shared scale, so they always sound together), and adds seven scan modes, six interpretation modes, image measurements, seeds, internal sounds, MIDI file export and recording.</p>
<p>It is not an AI image or music generator: every note comes from transparent, controllable rules applied to the picture.</p>
<p>Part of the Slop Factory family (emmm, FEELERS, ANVIL, DOWNBEAT, SQUARED, FRAK.MC, The Breakery, The Good Bits). Built on Slop Factory Core.</p>`;

export function helpWindow(parent: HTMLElement): MWindow {
  return proseWindow(parent, 'help', 'QUICK HELP', 180, 40, 520, 410, HELP_HTML);
}

export function aboutWindow(parent: HTMLElement): MWindow {
  return proseWindow(parent, 'about', 'ABOUT PICTURESCUE', 260, 100, 400, 250, ABOUT_HTML);
}

export function shortcutsWindow(parent: HTMLElement): MWindow {
  const groups = [...new Set(KEYS.map((k) => k.group))];
  const html = `<div class="shortcuts">${groups
    .map((g) => `<b>${g.toUpperCase()}</b><table>${KEYS.filter((k) => k.group === g)
      .map((k) => `<tr><td class="k">${k.keys.map(chordLabel).join('  ')}</td><td>${k.label}</td></tr>`)
      .join('')}</table>`)
    .join('')}</div>`;
  return proseWindow(parent, 'shortcuts', 'KEYBOARD SHORTCUTS', 240, 30, 420, 420, html);
}
