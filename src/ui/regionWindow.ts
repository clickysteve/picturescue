/**
 * The REGION window: everything about one region, chosen with the tabs 1-4 (or the keys
 * 1-4, or by clicking the region on the picture). Grouped as the instrument's ideas are:
 * how it INTERPRETS what it sees, how it SCANS, which NOTES it may play, how it BEHAVES,
 * and where it is (PLACE).
 */
import { MAPPING_PRESETS, matchingPreset } from '../engine/mapping';
import { LAYOUT_LABEL, LAYOUTS, clampRect, type Layout } from '../engine/regions';
import { NOTE_NAMES, noteName, SCALES } from '../engine/scales';
import { CC_LABEL, CC_SOURCES, MODE_LABEL, MODES, PITCH_LABEL, PITCH_SOURCES, RATE_LABEL, RATES, REPEATS, SCAN_LABEL, SCAN_MODES, SOUND_LABEL, SOUNDS, TRIGGER_LABEL, TRIGGERS, VEL_LABEL, VEL_SOURCES, type RegionSettings } from '../engine/types';
import type { App } from '../app/app';
import { el, label, setTip, svgEl } from './dom';
import { REGION_DASH, REGION_VAR } from './pictureWindow';
import { Btn, MWindow, Num, Sel, type SelItem } from './widgets';

const MODE_TIP: Record<string, string> = {
  melodic: 'MELODIC: a recognisable melody. Pitch follows the picture; leaps wider than a fifth fold back by an octave; each new line is accented.',
  rhythmic: 'RHYTHMIC: edges and colour changes are the beat. Pitch is secondary (four notes); accents on the beat; short notes.',
  ambient: 'AMBIENT: a slowly following value; a note only when it settles on a new degree; long, soft notes.',
  pointillist: 'POINTILLIST: sparse, short, separated points scattered over the octaves; saturated colours sparkle.',
  drone: 'DRONE: a sustained root and fifth that move only when the picture’s colour moves on.',
  chaotic: 'CHAOTIC: busy, with jumps across the region, octave leaps and occasional ratchets.',
};

/** Parse "C4", "F#3", "60". */
export function parseNote(t: string): number | null {
  const s = t.trim().toUpperCase();
  if (/^-?\d+$/.test(s)) return Number(s);
  const m = /^([A-G])(#|B)?(-?\d)$/.exec(s);
  if (!m) return null;
  const base = NOTE_NAMES.indexOf(m[1]!);
  const acc = m[2] === '#' ? 1 : m[2] === 'B' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + base + acc;
}

const items = <T extends string>(list: readonly T[], labels: Record<T, string>, tips?: Record<string, string>): SelItem<T>[] => list.map((v) => ({ value: v, label: labels[v], tip: tips?.[v] }));

export class RegionWindow {
  win: MWindow;
  private ctrls: { update(): void }[] = [];
  private tabs: HTMLDivElement[] = [];

  constructor(
    private app: App,
    parent: HTMLElement,
  ) {
    this.win = new MWindow(parent, { id: 'region', title: 'REGION', x: 598, y: 132, w: 358, h: 326 });
    const b = this.win.body;
    const R = (): RegionSettings => app.patch.regions[app.selected]!;
    const changed = () => {
      app.changed('patch');
      this.update();
    };
    // ------------------------------------------------ tabs
    for (let i = 0; i < 4; i++) {
      const t = el('div', 'rtab', b, [4 + i * 87, 3, 84, 15]);
      const sw = svgEl(16, 9, `<line x1="1" y1="4.5" x2="15" y2="4.5" stroke="${REGION_VAR[i]}" stroke-width="2" stroke-dasharray="${REGION_DASH[i]}"/>`);
      t.appendChild(sw);
      el('span', '', t, undefined, `REGION ${i + 1}`);
      t.addEventListener('pointerdown', () => app.select(i));
      setTip(t, `Region ${i + 1} (key ${i + 1})`);
      this.tabs.push(t);
    }
    el('div', 'rule', b, [4, 18, 348, 1]).style.background = 'var(--ink)';

    // ------------------------------------------------ switches, channel, sound
    const y0 = 23;
    this.ctrls.push(new Btn(b, 4, y0, 26, 15, 'ON', { tip: 'Region on / off', on: () => R().enabled, onClick: () => ((R().enabled = !R().enabled), changed()) }));
    this.ctrls.push(new Btn(b, 32, y0, 30, 15, 'MUTE', { tip: 'Mute this region (M)', on: () => R().mute, onClick: () => ((R().mute = !R().mute), changed()) }));
    this.ctrls.push(new Btn(b, 64, y0, 30, 15, 'SOLO', { tip: 'Hear only the soloed regions (S)', on: () => R().solo, onClick: () => ((R().solo = !R().solo), changed()) }));
    label(b, 100, y0 + 4, 'CH', 'tiny');
    this.ctrls.push(new Num(b, 112, y0, 24, 15, { label: 'CH', tip: 'MIDI channel of this region', min: 1, max: 16, get: () => R().channel, set: (v) => ((R().channel = v), changed()) }));
    label(b, 141, y0 + 4, 'SOUND', 'tiny');
    this.ctrls.push(new Sel(b, 168, y0, 70, 15, { label: 'SOUND', tip: 'Internal preview sound of this region', items: () => items(SOUNDS, SOUND_LABEL), get: () => R().sound, set: (v) => ((R().sound = v), changed()) }));
    label(b, 242, y0 + 4, 'LVL', 'tiny');
    this.ctrls.push(new Num(b, 258, y0, 30, 15, { tip: 'Preview level of this region', min: 0, max: 100, step: 5, get: () => Math.round(R().level * 100), set: (v) => ((R().level = v / 100), changed()) }));
    this.ctrls.push(new Btn(b, 292, y0, 60, 15, 'COPY→ALL', { tip: 'Copy this region’s settings to the other three (their places, channels and switches stay)', onClick: () => app.copyRegionToAll() }));

    // ------------------------------------------------ layout helpers: three columns
    const COLS = [4, 122, 240];
    const LW = 38;
    const CW = 76;
    const head = (y: number, t: string) => {
      label(b, 4, y, t, 'head');
      el('div', 'rule', b, [4 + t.length * 6 + 12, y + 4, 348 - t.length * 6 - 12, 1]);
    };
    const at = (col: number, y: number, name: string) => {
      label(b, COLS[col]!, y + 4, name, 'tiny');
      return [COLS[col]! + LW, y] as const;
    };
    const sel = <T>(col: number, y: number, name: string, o: ConstructorParameters<typeof Sel<T>>[5], w = CW) => {
      const [x, yy] = at(col, y, name);
      this.ctrls.push(new Sel<T>(b, x, yy, w, 15, { label: name, ...o }));
    };
    const num = (col: number, y: number, name: string, o: ConstructorParameters<typeof Num>[5], w = 40) => {
      const [x, yy] = at(col, y, name);
      this.ctrls.push(new Num(b, x, yy, w, 15, { label: name, ...o }));
    };

    // ------------------------------------------------ INTERPRETATION
    head(42, 'INTERPRETATION');
    sel(0, 52, 'MODE', { tip: 'How this region turns what it sees into music', items: () => items(MODES, MODE_LABEL, MODE_TIP), get: () => R().mode, set: (v) => ((R().mode = v), changed()) });
    sel(1, 52, 'PITCH', { tip: 'Which measurement chooses the note', items: () => items(PITCH_SOURCES, PITCH_LABEL), get: () => R().pitchFrom, set: (v) => ((R().pitchFrom = v), changed()) });
    sel(2, 52, 'VELOCITY', { tip: 'Which measurement sets how hard notes are played', items: () => items(VEL_SOURCES, VEL_LABEL), get: () => R().velFrom, set: (v) => ((R().velFrom = v), changed()) });
    sel(0, 70, 'TRIGGER', {
      tip: 'When a step plays: EVERY STEP; BRIGHT > THR (brighter than the threshold); EDGES (edge stronger than the threshold); COLOUR CHANGE (from the last cell, more than the threshold); DETAIL (more often where the picture is busy). RHYTHMIC always uses edges and changes.',
      items: () => items(TRIGGERS, TRIGGER_LABEL),
      get: () => R().trigger,
      set: (v) => ((R().trigger = v), changed()),
    });
    num(1, 70, 'THRESH', { tip: 'Threshold for the trigger (%)', min: 0, max: 100, get: () => Math.round(R().threshold * 100), set: (v) => ((R().threshold = v / 100), changed()), format: (v) => v + '%' });
    sel(2, 70, 'CC FROM', { tip: 'Send a MIDI controller from a measurement (on change only)', items: () => items(CC_SOURCES, CC_LABEL), get: () => R().ccFrom, set: (v) => ((R().ccFrom = v), changed()) });
    sel(0, 88, 'PRESET', {
      tip: 'Mapping presets: ready-made choices of PITCH, VELOCITY, TRIGGER and CC FROM',
      items: () => [{ value: '', label: '(custom)' }, ...MAPPING_PRESETS.map((m) => ({ value: m.id, label: m.label, tip: m.tip }))],
      get: () => matchingPreset(R()),
      set: (id) => {
        const m = MAPPING_PRESETS.find((x) => x.id === id);
        if (m) Object.assign(R(), m.set);
        changed();
      },
    });
    num(1, 88, 'CC NO.', { tip: 'Controller number (74 = brightness / cutoff, 1 = modulation)', min: 0, max: 127, get: () => R().cc, set: (v) => ((R().cc = v), changed()), disabled: () => R().ccFrom === 'off' });
    sel(2, 88, 'REPEAT', {
      tip: 'The same note twice in a row: TIE holds it on; RETRIGGER strikes it again; SKIP leaves it out',
      items: () => REPEATS.map((r) => ({ value: r, label: r.toUpperCase() })),
      get: () => R().repeat,
      set: (v) => ((R().repeat = v), changed()),
    });

    // ------------------------------------------------ SCAN
    head(108, 'SCAN');
    this.ctrls.push(new Btn(b, 300, 106, 52, 13, 'REVERSE', { tip: 'Play the scan path backwards (SPIRAL: from the centre outwards)', on: () => R().reverse, onClick: () => ((R().reverse = !R().reverse), changed()) }));
    sel(0, 120, 'SCAN', {
      tip: 'How the scan cursor moves through the region’s cells',
      items: () =>
        SCAN_MODES.map((m) => ({
          value: m,
          label: SCAN_LABEL[m],
          tip: {
            horizontal: 'Left to right, then the next row (the original’s scan)',
            vertical: 'Top to bottom, then the next column',
            pingpong: 'Left to right and back again',
            serpentine: 'Rows alternate direction',
            randomwalk: 'A seeded walk to neighbouring cells',
            spiral: 'From the outside in (REVERSE: from the centre out)',
            manual: 'You move the cursor: drag inside the region on the picture',
          }[m],
        })),
      get: () => R().scan,
      set: (v) => ((R().scan = v), changed()),
    });
    sel(1, 120, 'RATE', { tip: 'Scan rate: steps of this region per transport step', items: () => RATES.map((_, i) => ({ value: i, label: RATE_LABEL[i]! })), get: () => R().rate, set: (v) => ((R().rate = v), changed()) });
    num(2, 120, 'OFFSET', { tip: 'Start offset: the first step of the path', min: 0, max: 4095, get: () => R().offset, set: (v) => ((R().offset = v), changed()) });
    num(0, 138, 'COLS', { tip: 'Cells across the region', min: 1, max: 64, get: () => R().cols, set: (v) => ((R().cols = v), changed()) });
    num(1, 138, 'ROWS', { tip: 'Cells down the region', min: 1, max: 64, get: () => R().rows, set: (v) => ((R().rows = v), changed()) });
    num(2, 138, 'LENGTH', { tip: 'Scan length: steps before the scan starts again (0 = the whole path)', min: 0, max: 4096, get: () => R().length, set: (v) => ((R().length = v), changed()), format: (v) => (v ? String(v) : 'FULL') });

    // ------------------------------------------------ NOTES
    head(158, 'NOTES');
    this.ctrls.push(new Btn(b, 300, 156, 52, 13, 'GLOBAL', { tip: 'Use the global scale and root (Transport window) instead of this region’s own', on: () => R().globalScale, onClick: () => ((R().globalScale = !R().globalScale), changed()) }));
    sel(0, 170, 'SCALE', { tip: 'This region’s own scale (when GLOBAL is off)', items: () => SCALES.map((s) => ({ value: s.id, label: s.short, tip: s.name })), get: () => (R().globalScale ? app.patch.scale : R().scale), set: (v) => ((R().scale = v), (R().globalScale = false), changed()) });
    sel(1, 170, 'ROOT', { tip: 'This region’s own root (when GLOBAL is off)', items: () => NOTE_NAMES.map((n, i) => ({ value: i, label: n })), get: () => (R().globalScale ? app.patch.root : R().root), set: (v) => ((R().root = v), (R().globalScale = false), changed()) });
    num(2, 170, 'TRANSP', { tip: 'Transposition in semitones (after scale mapping)', min: -24, max: 24, get: () => R().transpose, set: (v) => ((R().transpose = v), changed()), format: (v) => (v > 0 ? '+' + v : String(v)) });
    num(0, 188, 'LOW', { tip: 'Lowest note (type a number or a name such as C3)', min: 0, max: 127, get: () => R().low, set: (v) => ((R().low = Math.min(v, R().high)), changed()), format: noteName, parse: parseNote });
    num(1, 188, 'HIGH', { tip: 'Highest note (type a number or a name such as C5)', min: 0, max: 127, get: () => R().high, set: (v) => ((R().high = Math.max(v, R().low)), changed()), format: noteName, parse: parseNote });
    num(2, 188, 'OCTAVE', { tip: 'Octave transposition', min: -3, max: 3, get: () => R().octave, set: (v) => ((R().octave = v), changed()), format: (v) => (v > 0 ? '+' + v : String(v)) });
    num(0, 206, 'VEL MIN', { tip: 'Softest velocity', min: 1, max: 127, get: () => R().velMin, set: (v) => ((R().velMin = Math.min(v, R().velMax)), changed()) });
    num(1, 206, 'VEL MAX', { tip: 'Loudest velocity', min: 1, max: 127, get: () => R().velMax, set: (v) => ((R().velMax = Math.max(v, R().velMin)), changed()) });

    // ------------------------------------------------ BEHAVIOUR
    head(226, 'BEHAVIOUR');
    num(0, 238, 'DENSITY', { tip: 'How many steps that could play do play: the busiest parts of the picture first', min: 0, max: 100, step: 5, big: 25, get: () => Math.round(R().density * 100), set: (v) => ((R().density = v / 100), changed()), format: (v) => v + '%' });
    num(1, 238, 'REST', { tip: 'Rest probability: seeded silences (the seed decides which)', min: 0, max: 100, step: 5, big: 25, get: () => Math.round(R().rest * 100), set: (v) => ((R().rest = v / 100), changed()), format: (v) => v + '%' });
    num(2, 238, 'SPACING', { tip: 'Minimum steps between notes', min: 0, max: 32, get: () => R().spacing, set: (v) => ((R().spacing = v), changed()) });
    num(0, 256, 'GATE', { tip: 'Note length in steps (AMBIENT and DRONE hold longer)', min: 0.05, max: 16, step: 0.05, big: 1, pxPerStep: 1, get: () => R().gate, set: (v) => ((R().gate = v), changed()), format: (v) => v.toFixed(2) });
    sel(1, 256, 'LAYOUT', {
      tip: 'Place all four regions at once',
      caption: 'PLACE ALL…',
      items: () => LAYOUTS.map((l) => ({ value: l, label: LAYOUT_LABEL[l] })),
      get: () => '' as Layout,
      set: (l) => app.setLayout(l),
    }, 114);

    // ------------------------------------------------ PLACE
    head(276, 'PLACE');
    const geo = (i: number, name: 'x' | 'y' | 'w' | 'h') => {
      const x = 4 + i * 87;
      label(b, x, 292, name.toUpperCase(), 'tiny');
      this.ctrls.push(
        new Num(b, x + 12, 288, 46, 15, {
          tip: `Region ${name === 'x' ? 'left edge' : name === 'y' ? 'top edge' : name === 'w' ? 'width' : 'height'}, % of the picture`,
          min: name === 'w' || name === 'h' ? 2 : 0,
          max: 100,
          step: 0.5,
          big: 5,
          pxPerStep: 1,
          get: () => Math.round(R()[name] * 1000) / 10,
          set: (v) => {
            const r = R();
            Object.assign(r, clampRect({ x: r.x, y: r.y, w: r.w, h: r.h, [name]: v / 100 }));
            changed();
          },
          format: (v) => v.toFixed(1) + '%',
        }),
      );
    };
    (['x', 'y', 'w', 'h'] as const).forEach((n, i) => geo(i, n));

    app.on((c) => {
      if (c === 'patch' || c === 'select') this.update();
    });
    this.update();
  }

  update(): void {
    const sel = this.app.selected;
    this.tabs.forEach((t, i) => {
      const r = this.app.patch.regions[i]!;
      t.classList.toggle('sel', i === sel);
      t.classList.toggle('off', !r.enabled);
      const extra = r.mute ? ' M' : r.solo ? ' S' : '';
      const span = t.querySelector('span')!;
      const txt = `REGION ${i + 1}${extra}`;
      if (span.textContent !== txt) span.textContent = txt;
    });
    this.win.setInfo(`CH ${this.app.patch.regions[sel]!.channel} · ${MODE_LABEL[this.app.patch.regions[sel]!.mode]}`);
    for (const c of this.ctrls) c.update();
  }
}

