import { describe, expect, it } from 'vitest';
import { analyse } from '../src/engine/analysis';
import { demoPixels, DEMOS } from '../src/engine/demos';
import { FACTORY } from '../src/engine/factory';
import { Performance, renderPerformance, type PerfEvent } from '../src/engine/performance';
import { inScale } from '../src/engine/scales';
import { defaultPatch, PPQ, stepTicks, type Patch, type RegionSettings } from '../src/engine/types';
import { paint, ramp, stripes } from './helpers';

type On = Extract<PerfEvent, { type: 'on' }>;
type Off = Extract<PerfEvent, { type: 'off' }>;

const ons = (e: PerfEvent[]) => e.filter((x): x is On => x.type === 'on');
const offs = (e: PerfEvent[]) => e.filter((x): x is Off => x.type === 'off');

/** A patch with only region 0 enabled, configured by `r`. */
function solo(r: Partial<RegionSettings>, p: Partial<Patch> = {}): Patch {
  const patch = { ...defaultPatch(), ...p };
  patch.regions = patch.regions.map((x, i) => (i === 0 ? { ...x, x: 0, y: 0, w: 1, h: 1, ...r } : { ...x, enabled: false }));
  return patch;
}

/** Every on has exactly one off, later or equal, on the same channel and note. */
function checkPairs(ev: PerfEvent[]): void {
  const open = new Map<number, On>();
  for (const e of ev) {
    if (e.type === 'on') {
      expect(open.has(e.id)).toBe(false);
      open.set(e.id, e);
    } else if (e.type === 'off') {
      const on = open.get(e.id);
      expect(on, `off without on: ${JSON.stringify(e)}`).toBeTruthy();
      expect(e.channel).toBe(on!.channel);
      expect(e.note).toBe(on!.note);
      expect(e.tick).toBeGreaterThanOrEqual(on!.tick);
      open.delete(e.id);
    }
  }
  expect(open.size, 'notes left hanging').toBe(0);
}

/** On one channel, a note number is never struck while it is already sounding (MIDI-safe). */
function checkNoOverlap(ev: PerfEvent[]): void {
  const sounding = new Map<string, number>();
  for (const e of ev) {
    if (e.type === 'on') {
      const k = `${e.channel}:${e.note}`;
      expect(sounding.has(k), `overlap at ${e.tick} ${k}`).toBe(false);
      sounding.set(k, e.id);
    } else if (e.type === 'off') {
      const k = `${e.channel}:${e.note}`;
      if (sounding.get(k) === e.id) sounding.delete(k);
    }
  }
}

const sorted = (ev: PerfEvent[]) => ev.every((e, i) => i === 0 || e.tick >= ev[i - 1]!.tick);

describe('performance: determinism', () => {
  it('the same image, patch and seed give the same events', () => {
    for (const f of FACTORY) {
      const p = f.make();
      const px = demoPixels((p.image as { id: string }).id)!;
      const an = analyse(px.data, px.w, px.h, p.analysisSize);
      const a = renderPerformance(p, an, PPQ * 4 * 4);
      const an2 = analyse(px.data, px.w, px.h, p.analysisSize);
      const b = renderPerformance(f.make(), an2, PPQ * 4 * 4);
      expect(b).toEqual(a);
      expect(ons(a).length, f.name).toBeGreaterThan(0);
    }
  });

  it('a different seed changes the random decisions, not the measurements', () => {
    const an = stripes(64, 32, 3);
    const p1 = solo({ mode: 'chaotic' }, { seed: 1 });
    const p2 = solo({ mode: 'chaotic' }, { seed: 2 });
    expect(renderPerformance(p1, an, PPQ * 8)).not.toEqual(renderPerformance(p2, an, PPQ * 8));
    // a fully deterministic mapping (every step, no rests) ignores the seed
    const d1 = solo({ mode: 'melodic', trigger: 'every', density: 1, rest: 0, scan: 'horizontal' }, { seed: 1 });
    const d2 = solo({ mode: 'melodic', trigger: 'every', density: 1, rest: 0, scan: 'horizontal' }, { seed: 99 });
    expect(renderPerformance(d1, an, PPQ * 8)).toEqual(renderPerformance(d2, an, PPQ * 8));
  });

  it('rendering in small slices gives the same events as rendering at once (live = export)', () => {
    const p = FACTORY[3]!.make();
    const px = demoPixels('city-lights')!;
    const an = analyse(px.data, px.w, px.h, 320);
    const whole = renderPerformance(p, an, PPQ * 16);
    const perf = new Performance(p, an);
    const sliced: PerfEvent[] = [];
    for (let t = 0; t < PPQ * 16; t += 97) sliced.push(...perf.render(Math.min(PPQ * 16, t + 97)));
    sliced.push(...perf.releaseAll(PPQ * 16));
    expect(sliced).toEqual(whole);
  });
});

describe('performance: MIDI safety', () => {
  it('pairs every note-on with a note-off and leaves nothing hanging, in every mode', () => {
    const an = stripes(64, 32, 2);
    for (const mode of ['melodic', 'rhythmic', 'ambient', 'pointillist', 'drone', 'chaotic'] as const) {
      for (const repeat of ['tie', 'retrigger', 'skip'] as const) {
        const p = defaultPatch();
        p.regions.forEach((r) => {
          r.mode = mode;
          r.repeat = repeat;
          r.channel = 1; // all on one channel: the hardest case
        });
        const ev = renderPerformance(p, an, PPQ * 8);
        expect(sorted(ev), mode).toBe(true);
        checkPairs(ev);
      }
    }
  });

  it('never re-strikes a sounding note of one region on its channel', () => {
    const an = ramp(64, 16);
    for (const mode of ['melodic', 'chaotic', 'drone', 'pointillist'] as const) {
      const ev = renderPerformance(solo({ mode, gate: 3, repeat: 'retrigger', density: 1 }), an, PPQ * 8);
      checkNoOverlap(ev);
    }
  });

  it('a channel change mid-note ends the note on the channel it started on', () => {
    const an = ramp();
    const p = solo({ channel: 3, gate: 8, trigger: 'every', density: 1, rest: 0 });
    const perf = new Performance(p, an);
    const first = perf.render(PPQ);
    p.regions[0]!.channel = 9;
    const rest = [...perf.render(PPQ * 4), ...perf.releaseAll(PPQ * 4)];
    const all = [...first, ...rest];
    checkPairs(all);
    expect(ons(first).every((e) => e.channel === 3)).toBe(true);
    expect(ons(rest).some((e) => e.channel === 9)).toBe(true);
  });

  it('releaseAll (stop) ends every held note at that moment', () => {
    const p = solo({ mode: 'drone' });
    const perf = new Performance(p, ramp());
    const ev = perf.render(PPQ * 2);
    expect(ons(ev).length).toBeGreaterThan(0);
    const end = perf.releaseAll(PPQ * 2);
    expect(end.length).toBeGreaterThan(0);
    expect(end.every((e) => e.type === 'off' && e.tick === PPQ * 2)).toBe(true);
    checkPairs([...ev, ...end]);
    expect(perf.releaseAll(PPQ * 2)).toEqual([]);
  });

  it('uses the region channel', () => {
    const p = defaultPatch();
    p.regions.forEach((r, i) => (r.channel = [2, 5, 11, 16][i]!));
    const ev = renderPerformance(p, stripes(), PPQ * 8);
    for (const e of ons(ev)) expect(e.channel).toBe([2, 5, 11, 16][e.region]);
  });
});

describe('performance: timing', () => {
  it('steps fall on the step grid', () => {
    const p = solo({ rate: 2 }, { stepsPerBeat: 4 });
    const len = stepTicks(p, p.regions[0]!);
    expect(len).toBe(PPQ / 4);
    const steps = renderPerformance(p, ramp(), PPQ * 4).filter((e) => e.type === 'step');
    expect(steps.length).toBe(16);
    steps.forEach((s, i) => expect(s.tick).toBe(i * len));
  });

  it('region rates are multiples of the transport step', () => {
    const p = defaultPatch();
    p.stepsPerBeat = 4;
    p.regions.forEach((r, i) => (r.rate = i));
    const ev = renderPerformance(p, ramp(), PPQ * 4);
    const count = (i: number) => ev.filter((e) => e.type === 'step' && e.region === i).length;
    expect([count(0), count(1), count(2), count(3)]).toEqual([4, 8, 16, 32]);
  });

  it('swing delays every second step', () => {
    const p = solo({}, { swing: 0.5, stepsPerBeat: 2 });
    const steps = renderPerformance(p, ramp(), PPQ * 2).filter((e) => e.type === 'step');
    expect(steps.map((s) => s.tick)).toEqual([0, 720, 960, 1680]);
  });

  it('note length follows GATE (in steps)', () => {
    const p = solo({ gate: 2, trigger: 'every', density: 1, rest: 0, repeat: 'retrigger', mode: 'melodic' }, { stepsPerBeat: 4 });
    const an = stripes(64, 32, 4);
    const ev = renderPerformance(p, an, PPQ * 8);
    const first = ons(ev)[0]!;
    const off = offs(ev).find((o) => o.id === first.id)!;
    expect(off.tick - first.tick).toBeLessThanOrEqual(2 * (PPQ / 4));
  });

  it('scans with LOOP off play one pass and finish', () => {
    const p = solo({ cols: 4, rows: 2, rate: 2 }, { loop: false });
    const perf = new Performance(p, ramp());
    const ev = perf.render(PPQ * 8);
    expect(ev.filter((e) => e.type === 'step').length).toBe(8);
    expect(perf.finished).toBe(true);
    const looping = solo({ cols: 4, rows: 2 }, { loop: true });
    const pl = new Performance(looping, ramp());
    expect(pl.render(PPQ * 8).filter((e) => e.type === 'step').length).toBe(32);
    expect(pl.finished).toBe(false);
  });

  it('a region switched on mid-play joins on its grid', () => {
    const p = solo({});
    p.regions[1]!.enabled = false;
    const perf = new Performance(p, ramp());
    perf.render(PPQ + 10);
    p.regions[1]!.enabled = true;
    const ev = perf.render(PPQ * 3);
    const first = ev.find((e) => e.type === 'step' && e.region === 1)!;
    expect(first.tick % stepTicks(p, p.regions[1]!)).toBe(0);
    expect(first.tick).toBeGreaterThanOrEqual(PPQ + 10);
  });

  it('restarting the scans starts every region again on the next beat', () => {
    const p = solo({ cols: 8, rows: 1 });
    const perf = new Performance(p, ramp());
    perf.render(PPQ + 100);
    perf.restartScans();
    const ev = perf.render(PPQ * 3).filter((e): e is Extract<PerfEvent, { type: 'step' }> => e.type === 'step');
    expect(ev[0]!.tick).toBe(PPQ * 2);
    expect(ev[0]!.step).toBe(0);
    expect(ev[0]!.cell).toBe(0);
  });
});

describe('performance: musical controls', () => {
  const an = stripes(64, 32, 2);
  const count = (r: Partial<RegionSettings>) => ons(renderPerformance(solo({ mode: 'melodic', trigger: 'every', rest: 0, repeat: 'retrigger', ...r }), an, PPQ * 16)).length;

  it('density thins the notes, busiest steps first', () => {
    // left half flat, right half finely striped
    const half = analyse(paint(64, 16, (x) => (x < 32 ? [128, 128, 128, 255] : x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255])), 64, 16);
    const played = (density: number) =>
      renderPerformance(solo({ mode: 'melodic', trigger: 'every', rest: 0, repeat: 'retrigger', density, cols: 16, rows: 1, scan: 'horizontal' }), half, PPQ * 4).filter(
        (e): e is Extract<PerfEvent, { type: 'step' }> => e.type === 'step' && e.played,
      );
    expect(played(1).length).toBe(16);
    expect(played(0).length).toBe(0);
    const some = played(0.5);
    expect(some.length).toBeGreaterThan(0);
    expect(some.length).toBeLessThan(16);
    // the busy half keeps more of its notes than the flat half
    expect(some.filter((s) => s.col >= 8).length).toBeGreaterThan(some.filter((s) => s.col < 8).length);
    expect(count({ density: 0 })).toBe(0);
  });

  it('rest probability rests', () => {
    expect(count({ density: 1, rest: 0.5 })).toBeLessThan(count({ density: 1, rest: 0 }));
    expect(count({ density: 1, rest: 1 })).toBe(0);
  });

  it('minimum spacing keeps notes apart', () => {
    const ev = ons(renderPerformance(solo({ mode: 'melodic', trigger: 'every', density: 1, rest: 0, spacing: 3, repeat: 'retrigger' }), an, PPQ * 8));
    for (let i = 1; i < ev.length; i++) expect(ev[i]!.tick - ev[i - 1]!.tick).toBeGreaterThanOrEqual(4 * (PPQ / 4));
  });

  it('the brightness threshold trigger plays only bright cells', () => {
    const p = solo({ mode: 'melodic', trigger: 'threshold', threshold: 0.5, density: 1, rest: 0, cols: 16, rows: 1, repeat: 'retrigger', scan: 'horizontal' });
    const ev = renderPerformance(p, ramp(64, 8), PPQ * 4);
    const played = ev.filter((e): e is Extract<PerfEvent, { type: 'step' }> => e.type === 'step' && e.played);
    expect(played.length).toBe(8);
    expect(played.every((s) => s.col >= 8)).toBe(true);
  });

  it('edge triggers play where the picture changes and not in flat areas', () => {
    const flat = analyse(new Uint8ClampedArray(32 * 32 * 4).fill(200), 32, 32);
    expect(ons(renderPerformance(solo({ mode: 'melodic', trigger: 'edges', threshold: 0.1, density: 1, rest: 0 }), flat, PPQ * 8)).length).toBe(0);
    expect(ons(renderPerformance(solo({ mode: 'melodic', trigger: 'edges', threshold: 0.1, density: 1, rest: 0 }), an, PPQ * 8)).length).toBeGreaterThan(0);
  });

  it('notes stay in the scale and the velocity range', () => {
    const p = solo({ mode: 'melodic', trigger: 'every', density: 1, velMin: 30, velMax: 60, low: 40, high: 90, transpose: 0, octave: 0 }, { scale: 'phrygian', root: 4 });
    for (const e of ons(renderPerformance(p, ramp(), PPQ * 8))) {
      expect(inScale('phrygian', 4, e.note)).toBe(true);
      expect(e.note).toBeGreaterThanOrEqual(40);
      expect(e.note).toBeLessThanOrEqual(90);
      expect(e.velocity).toBeGreaterThanOrEqual(30);
      expect(e.velocity).toBeLessThanOrEqual(76); // the line-start accent may add a little
    }
  });

  it('TIE holds a repeated note instead of striking it again; SKIP leaves it out', () => {
    const flat = analyse(new Uint8ClampedArray(16 * 16 * 4).fill(180), 16, 16);
    const tie = ons(renderPerformance(solo({ mode: 'melodic', trigger: 'every', density: 1, rest: 0, repeat: 'tie', gate: 1 }), flat, PPQ * 4));
    const re = ons(renderPerformance(solo({ mode: 'melodic', trigger: 'every', density: 1, rest: 0, repeat: 'retrigger', gate: 1 }), flat, PPQ * 4));
    const skip = ons(renderPerformance(solo({ mode: 'melodic', trigger: 'every', density: 1, rest: 0, repeat: 'skip', gate: 1 }), flat, PPQ * 4));
    expect(tie.length).toBe(1);
    expect(re.length).toBe(16);
    expect(skip.length).toBe(1);
  });

  it('transparent cells are silent', () => {
    const clear = analyse(new Uint8ClampedArray(16 * 16 * 4), 16, 16);
    expect(ons(renderPerformance(solo({ mode: 'melodic', trigger: 'every', density: 1, rest: 0 }), clear, PPQ * 4)).length).toBe(0);
  });

  it('mute and solo silence regions', () => {
    const p = defaultPatch();
    p.regions.forEach((r) => Object.assign(r, { mode: 'melodic', trigger: 'every', density: 1, rest: 0 }));
    p.regions[1]!.mute = true;
    let ev = ons(renderPerformance(p, an, PPQ * 4));
    expect(ev.some((e) => e.region === 1)).toBe(false);
    expect(ev.some((e) => e.region === 0)).toBe(true);
    p.regions[2]!.solo = true;
    ev = ons(renderPerformance(p, an, PPQ * 4));
    expect(new Set(ev.map((e) => e.region))).toEqual(new Set([2]));
  });

  it('CC follows the picture and is sent only on change', () => {
    const p = solo({ ccFrom: 'brightness', cc: 74, cols: 16, rows: 1 });
    const cc = renderPerformance(p, ramp(64, 4), PPQ * 4).filter((e): e is Extract<PerfEvent, { type: 'cc' }> => e.type === 'cc');
    expect(cc.length).toBeGreaterThan(8);
    expect(cc.every((e) => e.cc === 74 && e.value >= 0 && e.value <= 127)).toBe(true);
    for (let i = 1; i < cc.length; i++) expect(cc[i]!.value).not.toBe(cc[i - 1]!.value);
  });
});

describe('performance: interpretation modes are different algorithms', () => {
  it('each mode gives a distinct performance of the same picture', () => {
    const px = demoPixels('st-lowres')!;
    const an = analyse(px.data, px.w, px.h, 320);
    const results = (['melodic', 'rhythmic', 'ambient', 'pointillist', 'drone', 'chaotic'] as const).map((mode) => {
      const ev = renderPerformance(solo({ mode }), an, PPQ * 16);
      const n = ons(ev);
      const lens = n.map((o) => offs(ev).find((f) => f.id === o.id)!.tick - o.tick);
      return { mode, count: n.length, meanLen: lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length), key: JSON.stringify(n.map((o) => [o.tick, o.note])) };
    });
    expect(new Set(results.map((r) => r.key)).size).toBe(6);
    const by = Object.fromEntries(results.map((r) => [r.mode, r]));
    // ambient and drone sustain; pointillist is short
    expect(by.ambient!.meanLen).toBeGreaterThan(by.melodic!.meanLen);
    expect(by.drone!.meanLen).toBeGreaterThan(by.melodic!.meanLen);
    expect(by.pointillist!.meanLen).toBeLessThan(by.melodic!.meanLen);
    // ambient is sparser than melodic, chaotic busier than ambient
    expect(by.ambient!.count).toBeLessThan(by.melodic!.count);
    expect(by.chaotic!.count).toBeGreaterThan(by.ambient!.count);
  });

  it('every demo picture plays under the default patch', () => {
    for (const d of DEMOS) {
      const px = demoPixels(d.id)!;
      const an = analyse(px.data, px.w, px.h, 320);
      const ev = renderPerformance(defaultPatch(), an, PPQ * 8);
      expect(ons(ev).length, d.id).toBeGreaterThan(0);
      checkPairs(ev);
    }
  });

  it('without a picture it steps silently', () => {
    const ev = renderPerformance(defaultPatch(), null, PPQ * 2);
    expect(ons(ev).length).toBe(0);
    expect(ev.some((e) => e.type === 'step')).toBe(true);
  });
});
