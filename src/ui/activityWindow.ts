/**
 * The ACTIVITY window: one lane per region showing what it is doing now (its note, velocity,
 * channel and scan progress, a light for every note) and a scrolling roll of the notes it has
 * played, so the relationship between picture and music stays visible. Below: the status
 * line (messages, MIDI, audio).
 */
import { noteName } from '../engine/scales';
import { MODE_LABEL, SCAN_LABEL } from '../engine/types';
import type { PerfEvent } from '../engine/performance';
import type { App } from '../app/app';
import { attr, el, label, setTip, svgNode, text } from './dom';
import { REGION_DASH, REGION_VAR } from './pictureWindow';
import { MWindow } from './widgets';

interface Lane {
  led: HTMLDivElement;
  note: HTMLDivElement;
  vel: HTMLDivElement;
  velBar: HTMLDivElement;
  info: HTMLDivElement;
  prog: HTMLDivElement;
  progBar: HTMLDivElement;
  stepTxt: HTMLDivElement;
  ledUntil: number;
  lastNote: number;
  lastVel: number;
  step: number;
  total: number;
  dots: SVGGElement;
}

const ROLL_W = 470;
const ROLL_MS = 8000;

export class ActivityWindow {
  win: MWindow;
  private lanes: Lane[] = [];
  private status: HTMLDivElement;
  private midiTxt: HTMLDivElement;
  /** recent notes for the roll */
  private notes: { region: number; note: number; vel: number; t: number; el: SVGRectElement | null }[] = [];

  constructor(
    private app: App,
    parent: HTMLElement,
  ) {
    this.win = new MWindow(parent, { id: 'activity', title: 'ACTIVITY', x: 4, y: 464, w: 952, h: 132 });
    const b = this.win.body;
    const H = 22;
    for (let i = 0; i < 4; i++) {
      const y = 3 + i * (H + 2);
      const tag = el('div', 'box', b, [4, y, 26, H]);
      tag.appendChild(svgNode('svg', { width: 24, height: 20, viewBox: '0 0 24 20' }));
      tag.firstElementChild!.innerHTML = `<text x="3" y="10" font-size="9" font-weight="600" fill="${REGION_VAR[i]}">${i + 1}</text><line x1="2" y1="16" x2="22" y2="16" stroke="${REGION_VAR[i]}" stroke-width="2" stroke-dasharray="${REGION_DASH[i]}"/>`;
      tag.addEventListener('pointerdown', () => app.select(i));
      const led = el('div', 'lane-led', b, [34, y + 7]);
      const note = el('div', 'box', b, [46, y, 40, H]);
      Object.assign(note.style, { display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '600', fontSize: '11px' });
      const vel = el('div', 'meter', b, [90, y + 3, 50, 8]);
      const velBar = el('div', 'bar solid', vel);
      const prog = el('div', 'meter', b, [90, y + 13, 50, 6]);
      const progBar = el('div', 'bar', prog);
      const info = label(b, 146, y + 3, '', 'small');
      const stepTxt = label(b, 146, y + 13, '', 'tiny');
      this.lanes.push({ led, note, vel, velBar, info, prog, progBar, stepTxt, ledUntil: 0, lastNote: -1, lastVel: 0, step: 0, total: 1, dots: null as unknown as SVGGElement });
    }
    // the roll: the last few seconds of notes, pitch up, time moving left
    const rollBox = el('div', 'roll', b, [474, 3, ROLL_W, 4 * (H + 2) - 2]);
    const svg = svgNode('svg', { width: ROLL_W - 2, height: 4 * (H + 2) - 4, viewBox: `0 0 ${ROLL_W - 2} ${4 * (H + 2) - 4}` }, rollBox);
    for (let i = 0; i < 4; i++) {
      if (i) svgNode('line', { x1: 0, x2: ROLL_W, y1: i * (H + 2) - 1, y2: i * (H + 2) - 1, stroke: 'var(--ink)', 'stroke-dasharray': '1 2' }, svg);
      this.lanes[i]!.dots = svgNode('g', {}, svg);
    }
    setTip(rollBox, 'The last 8 seconds of notes, one lane per region: newest on the right, higher notes higher (within each region’s range)');
    this.status = label(b, 4, 102, '', 'small');
    this.status.style.width = '640px';
    this.status.style.overflow = 'hidden';
    this.status.style.textOverflow = 'ellipsis';
    this.midiTxt = label(b, 650, 102, '', 'small');
    this.midiTxt.style.width = '296px';
    this.midiTxt.style.textAlign = 'right';
    app.on((c) => {
      if (c === 'status') text(this.status, app.status);
      if (c === 'midi' || c === 'prefs' || c === 'transport') this.updateMidi();
      if (c === 'patch' || c === 'select') this.updateInfo();
    });
    this.updateMidi();
    this.updateInfo();
  }

  private updateInfo(): void {
    const sel = this.app.selected;
    this.app.patch.regions.forEach((r, i) => {
      const l = this.lanes[i]!;
      text(l.info, `${r.enabled ? '' : 'OFF  '}CH ${r.channel}  ${MODE_LABEL[r.mode]}  ${SCAN_LABEL[r.scan]}${r.mute ? '  MUTE' : ''}${r.solo ? '  SOLO' : ''}${i === sel ? '  ◂' : ''}`);
      l.info.style.color = r.enabled ? '' : 'var(--dim)';
    });
  }

  updateMidi(): void {
    const a = this.app;
    const m = a.midiAccess.status;
    const midi = !a.midiAccess.supported ? 'MIDI: not in this browser' : m === 'idle' ? 'MIDI: off (MIDI… to connect)' : m === 'denied' ? 'MIDI: access refused' : m === 'requesting' ? 'MIDI: asking…' : a.midi.connected ? `MIDI ▸ ${a.midi.portName}${a.prefs.midiEnabled ? '' : ' (muted)'}` : 'MIDI: no output chosen';
    const audio = a.prefs.audio ? (a.audio.running ? 'AUDIO ON' : 'AUDIO (starts on PLAY)') : 'AUDIO OFF';
    text(this.midiTxt, `${midi}   ${audio}`);
  }

  /** Events that are due now. */
  event(ev: PerfEvent, now: number): void {
    const l = this.lanes[ev.region];
    if (!l) return;
    if (ev.type === 'on') {
      l.ledUntil = now + 90;
      l.lastNote = ev.note;
      l.lastVel = ev.velocity;
      this.notes.push({ region: ev.region, note: ev.note, vel: ev.velocity, t: now, el: null });
    } else if (ev.type === 'step') {
      l.step = ev.step;
      l.total = Math.max(1, ev.cols * ev.rows);
    }
  }

  frame(now: number, playing: boolean): void {
    const regions = this.app.patch.regions;
    this.lanes.forEach((l, i) => {
      l.led.classList.toggle('lit', now < l.ledUntil);
      text(l.note, l.lastNote >= 0 ? noteName(l.lastNote) : '--');
      l.velBar.style.width = Math.round((l.lastVel / 127) * 48) + 'px';
      const r = regions[i]!;
      const len = r.length > 0 ? r.length : l.total;
      const p = playing ? ((l.step % len) + 1) / len : 0;
      l.progBar.style.width = Math.round(p * 48) + 'px';
      text(l.stepTxt, playing ? `STEP ${(l.step % len) + 1}/${len}` : '');
    });
    // roll
    const H = 22;
    while (this.notes.length && now - this.notes[0]!.t > ROLL_MS) this.notes.shift()!.el?.remove();
    for (const n of this.notes) {
      if (!n.el) n.el = svgNode('rect', { width: 3, height: 2, fill: REGION_VAR[n.region]! }, this.lanes[n.region]!.dots);
      const x = Math.round(ROLL_W - 6 - ((now - n.t) / ROLL_MS) * (ROLL_W - 6));
      const r = this.app.patch.regions[n.region]!;
      const shift = r.transpose + 12 * r.octave;
      const lo = r.low + shift;
      const span = Math.max(1, r.high - r.low);
      const y = n.region * (H + 2) + Math.round((1 - Math.max(0, Math.min(1, (n.note - lo) / span))) * (H - 4)) + 1;
      attr(n.el, 'x', x);
      attr(n.el, 'y', y);
      attr(n.el, 'opacity', n.vel > 90 ? 1 : 0.7);
    }
  }

  reset(): void {
    this.lanes.forEach((l) => {
      l.lastNote = -1;
      l.lastVel = 0;
      l.step = 0;
    });
  }
}
