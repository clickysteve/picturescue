/**
 * The pitch pipeline: ONE global scale and root, four independent regions. The invariant under
 * test: every note any region plays is a note of the global scale AND lies between the
 * region's LOW and HIGH, whatever the mapping, mode, transposition or octave.
 */
import { describe, expect, it } from 'vitest';
import { analyse, areaFeatures } from '../src/engine/analysis';
import { mapPitch, pitchSetup, resolvePitch, regionNotes } from '../src/engine/mapping';
import { Performance, renderPerformance, type PerfEvent } from '../src/engine/performance';
import { inScale, midiToHz, noteName, quantiseToScale, SCALES, scaleNotes, scaleNotesStrict } from '../src/engine/scales';
import { readSmf, tracksFromEvents, writeSmf } from '../src/engine/smf';
import { defaultPatch, MODES, PPQ, type Patch, type RegionSettings } from '../src/engine/types';
import { PreviewInstrument } from '../src/audio/synth';
import { demoAnalysis, paint, ramp, solid } from './helpers';

type On = Extract<PerfEvent, { type: 'on' }>;
const ons = (e: PerfEvent[]) => e.filter((x): x is On => x.type === 'on');

/** The global scales the brief names, by (scale id, root pitch class). */
const SCALES_UNDER_TEST: [string, string, number][] = [
  ['C Major', 'major', 0],
  ['A Minor', 'minor', 9],
  ['C Minor Pentatonic', 'minorPentatonic', 0],
  ['G Harmonic Minor', 'harmonicMinor', 7],
  ['D Dorian', 'dorian', 2],
  ['Chromatic', 'chromatic', 0],
];

/** The four regions of the brief's example: independent ranges, modes and behaviours. */
function exampleRegions(p: Patch): void {
  const set = (i: number, o: Partial<RegionSettings>) => Object.assign(p.regions[i]!, { trigger: 'every', density: 1, rest: 0, repeat: 'retrigger', transpose: 0, octave: 0 }, o);
  set(0, { low: 36, high: 60, mode: 'melodic', channel: 1 }); // C2..C4
  set(1, { low: 48, high: 72, mode: 'pointillist', channel: 2 }); // C3..C5
  set(2, { low: 24, high: 48, mode: 'drone', channel: 3 }); // C1..C3
  set(3, { low: 60, high: 84, mode: 'rhythmic', channel: 4, threshold: 0.1 }); // C4..C6
}

function checkNotes(p: Patch, events: PerfEvent[], label: string): void {
  for (const e of ons(events)) {
    const r = p.regions[e.region]!;
    const lo = Math.min(r.low, r.high);
    const hi = Math.max(r.low, r.high);
    expect(Number.isInteger(e.note) && e.note >= 0 && e.note <= 127, `${label}: invalid MIDI note ${e.note}`).toBe(true);
    expect(inScale(p.scale, p.root, e.note), `${label}: region ${e.region + 1} played ${noteName(e.note)} (${e.note}), outside ${p.scale} root ${p.root}`).toBe(true);
    expect(e.note >= lo && e.note <= hi, `${label}: region ${e.region + 1} played ${noteName(e.note)} outside ${noteName(lo)}..${noteName(hi)}`).toBe(true);
    expect(e.channel).toBe(r.channel);
  }
}

describe('one global scale: every region plays in it', () => {
  for (const [name, scale, root] of SCALES_UNDER_TEST) {
    it(`${name}: all four regions, on three pictures`, () => {
      for (const demo of ['st-lowres', 'city-lights', 'portrait']) {
        const p = defaultPatch();
        p.scale = scale;
        p.root = root;
        exampleRegions(p);
        const ev = renderPerformance(p, demoAnalysis(demo), PPQ * 16);
        checkNotes(p, ev, `${name} / ${demo}`);
        // every region really plays, so the check above is not vacuous
        for (let i = 0; i < 4; i++) expect(ons(ev).filter((e) => e.region === i).length, `${name} / ${demo} region ${i + 1}`).toBeGreaterThan(0);
      }
    });
  }

  it('the regions keep their own ranges, modes and channels', () => {
    const p = defaultPatch();
    exampleRegions(p);
    const ev = ons(renderPerformance(p, demoAnalysis('st-lowres'), PPQ * 16));
    for (let i = 0; i < 4; i++) {
      const notes = ev.filter((e) => e.region === i).map((e) => e.note);
      expect(Math.min(...notes)).toBeGreaterThanOrEqual(p.regions[i]!.low);
      expect(Math.max(...notes)).toBeLessThanOrEqual(p.regions[i]!.high);
    }
    // different ranges: region 4 plays higher than region 3 (C4..C6 against C1..C3)
    const mean = (i: number) => ev.filter((e) => e.region === i).reduce((a, e) => a + e.note, 0) / ev.filter((e) => e.region === i).length;
    expect(mean(3)).toBeGreaterThan(mean(2) + 12);
  });

  it('changing the global scale while playing changes all four regions at once', () => {
    const p = defaultPatch();
    p.scale = 'majorPentatonic';
    p.root = 0;
    exampleRegions(p);
    const perf = new Performance(p, demoAnalysis('st-lowres'));
    const before = perf.render(PPQ * 4);
    checkNotes(p, before, 'before');
    p.scale = 'dorian';
    p.root = 2;
    const after = ons(perf.render(PPQ * 12)).filter((e) => e.tick >= PPQ * 4);
    expect(after.length).toBeGreaterThan(20);
    for (const e of after) expect(inScale('dorian', 2, e.note), `region ${e.region + 1} still played ${noteName(e.note)}`).toBe(true);
    expect(new Set(after.map((e) => e.region)).size).toBe(4);
    // and some of the new scale's notes are outside the old one, so the change was heard
    expect(after.some((e) => !inScale('majorPentatonic', 0, e.note))).toBe(true);
  });

  it('holds for every scale, every mode, shifts, ranges and tie rules (fuzz)', () => {
    const an = demoAnalysis('st-lowres');
    let notes = 0;
    for (const sc of SCALES) {
      for (const mode of MODES) {
        for (const [transpose, octave, low, high, repeat] of [
          [0, 0, 48, 72, 'tie'],
          [5, 0, 36, 60, 'retrigger'],
          [-7, 1, 60, 62, 'skip'],
          [11, -2, 30, 100, 'tie'],
          [-24, 3, 65, 79, 'retrigger'],
          [3, 0, 0, 127, 'tie'],
        ] as const) {
          const p = defaultPatch();
          p.scale = sc.id;
          p.root = (sc.id.length * 5) % 12;
          p.regions.forEach((r, i) => Object.assign(r, { mode, transpose, octave, low, high, repeat, channel: i + 1, trigger: 'every', density: 1, rest: 0.1, gate: 2 }));
          const ev = renderPerformance(p, an, PPQ * 6);
          checkNotes(p, ev, `${sc.id} ${mode} ${transpose}/${octave} ${low}-${high}`);
          notes += ons(ev).length;
        }
      }
    }
    expect(notes).toBeGreaterThan(2000);
  });
});

describe('scale quantisation', () => {
  it('returns scale notes unchanged and is monotonic in every scale', () => {
    for (const sc of SCALES) {
      for (const root of [0, 5, 9]) {
        let last = -Infinity;
        for (let p = -12; p <= 140; p++) {
          const q = quantiseToScale(p, sc.id, root, 0);
          expect(inScale(sc.id, root, q)).toBe(true);
          if (inScale(sc.id, root, p)) expect(q).toBe(p);
          expect(q).toBeGreaterThanOrEqual(last);
          expect(Math.abs(q - p)).toBeLessThanOrEqual(3);
          last = q;
        }
      }
    }
  });

  it('breaks ties in the direction of travel, and toward middle C when there is none', () => {
    // C major pentatonic: D (2) and E (4) are 2 apart, so D# (3) is a tie
    expect(quantiseToScale(63, 'majorPentatonic', 0, +1)).toBe(64);
    expect(quantiseToScale(63, 'majorPentatonic', 0, -1)).toBe(62);
    expect(quantiseToScale(63, 'majorPentatonic', 0, 0)).toBe(62); // above middle C: down, toward it
    expect(quantiseToScale(51, 'majorPentatonic', 0, 0)).toBe(52); // below middle C: up, toward it
    // an unbiased rule: mirrored shifts give mirrored results
    for (let p = 36; p <= 84; p++) {
      const up = quantiseToScale(p, 'minorPentatonic', 0, +1) - p;
      const down = quantiseToScale(p, 'minorPentatonic', 0, -1) - p;
      expect(up).toBeGreaterThanOrEqual(down);
      if (up !== down) expect(up).toBe(-down); // only ties differ, by exactly the same distance either way
    }
  });

  it('never leaves a bounded range and never loops', () => {
    expect(quantiseToScale(200, 'major', 0, 1, 0, 127)).toBeLessThanOrEqual(127);
    expect(quantiseToScale(-20, 'major', 0, -1, 0, 127)).toBeGreaterThanOrEqual(0);
    expect(inScale('major', 0, quantiseToScale(1000.4, 'major', 0))).toBe(true);
  });
});

describe('the final pitch stage: transpose, octave, quantise, fold', () => {
  const setup = (over: Partial<RegionSettings>, scale = 'minorPentatonic', root = 0) => {
    const p = defaultPatch();
    p.scale = scale;
    p.root = root;
    return pitchSetup(p, { low: 48, high: 72, transpose: 0, octave: 0, ...over });
  };

  it('is the identity for a scale note with no shift', () => {
    const s = setup({});
    for (const n of s.notes) expect(resolvePitch(n, s)).toBe(n);
  });

  it('transposes the contour THEN snaps to the scale (specific values, C minor pentatonic)', () => {
    // scale notes: C Eb F G Bb. C4 = 60
    expect(resolvePitch(60, setup({ transpose: 1 }))).toBe(60); // C#: C is 1 away, Eb 2 away
    expect(resolvePitch(60, setup({ transpose: 2 }))).toBe(63); // D: Eb is 1 away
    expect(resolvePitch(60, setup({ transpose: 3 }))).toBe(63); // Eb exactly
    expect(resolvePitch(60, setup({ transpose: 7 }))).toBe(67); // G exactly
    expect(resolvePitch(60, setup({ transpose: 11 }))).toBe(72); // B: Bb and C tie, travelling up: C
    expect(resolvePitch(60, setup({ transpose: -1, low: 36 }))).toBe(58); // B: tie, travelling down: Bb
  });

  it('keeps every note in the scale and the range for every transposition and octave', () => {
    for (const [, scale, root] of SCALES_UNDER_TEST) {
      for (let transpose = -24; transpose <= 24; transpose++) {
        for (let octave = -3; octave <= 3; octave++) {
          const s = setup({ transpose, octave }, scale, root);
          for (const raw of s.notes) {
            const n = resolvePitch(raw, s);
            expect(inScale(scale, root, n)).toBe(true);
            expect(n >= 48 && n <= 72).toBe(true);
          }
        }
      }
    }
  });

  it('whole-octave shifts are folded, never clamped onto one boundary note', () => {
    const s = setup({ octave: 3, low: 36, high: 96 }, 'major', 0);
    const out = s.notes.map((n) => resolvePitch(n, s));
    // a +3 octave shift of a five-octave contour must fold its top octaves back down: the result
    // spreads over many notes (each kept in its pitch class) instead of landing on the boundary
    const share = new Map<number, number>();
    for (const n of out) share.set(n, (share.get(n) ?? 0) + 1);
    expect(new Set(out).size).toBeGreaterThanOrEqual(12);
    expect(Math.max(...share.values()) / out.length).toBeLessThan(0.2);
    expect(Math.max(...out)).toBeLessThanOrEqual(96);
    // an octave up inside the range is exactly an octave up
    const mid = setup({ octave: 1, low: 24, high: 108 }, 'major', 0);
    expect(resolvePitch(60, mid)).toBe(72);
    // past the top it comes back down by octaves: C4 + 3 octaves = C7 (96), top of 36..96
    expect(resolvePitch(60, setup({ octave: 3, low: 36, high: 96 }, 'major', 0))).toBe(96);
    expect(resolvePitch(62, setup({ octave: 3, low: 36, high: 90 }, 'major', 0))).toBe(86); // D7 (98) folds to D6
  });

  it('keeps the contour: the shifted notes stay in the same order wherever nothing folds', () => {
    const s = setup({ transpose: 4, low: 24, high: 108 }, 'dorian', 2);
    let last = -1;
    for (const raw of scaleNotes('dorian', 2, 40, 80)) {
      const n = resolvePitch(raw, s);
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });

  it('handles narrow ranges, one-note ranges, reversed ranges and the MIDI extremes', () => {
    // two scale notes only
    const narrow = setup({ low: 60, high: 62 }, 'major', 0);
    expect(narrow.notes).toEqual([60, 62]);
    for (const shift of [-5, 0, 3, 14]) expect([60, 62]).toContain(resolvePitch(61 + shift, { ...narrow, shift }));
    // exactly one scale note: always that note
    const one = setup({ low: 61, high: 63, transpose: 5, octave: 2 }, 'major', 0);
    expect(one.notes).toEqual([62]);
    expect(resolvePitch(60, one)).toBe(62);
    // a range crossing octaves
    const cross = setup({ low: 55, high: 70, transpose: -3 }, 'minor', 9);
    for (const raw of cross.notes) expect(inScale('minor', 9, resolvePitch(raw, cross))).toBe(true);
    // reversed
    const rev = pitchSetup({ scale: 'major', root: 0 }, { low: 72, high: 60, transpose: 0, octave: 0 });
    expect([rev.lo, rev.hi]).toEqual([60, 72]);
    expect(rev.notes).toEqual(scaleNotes('major', 0, 60, 72));
    // the MIDI extremes
    const ends = setup({ low: 0, high: 127, transpose: 24, octave: 3 }, 'chromatic', 0);
    for (const raw of [0, 1, 64, 126, 127]) {
      const n = resolvePitch(raw, ends);
      expect(Number.isInteger(n) && n >= 0 && n <= 127).toBe(true);
    }
  });

  it('copes with a range that holds no scale note: the nearest scale note, valid MIDI, flagged', () => {
    const s = setup({ low: 61, high: 61 }, 'major', 0); // C# in C major
    expect(s.inRange).toBe(false);
    expect(s.notes).toEqual([60]);
    for (const shift of [-30, 0, 7, 40]) {
      const n = resolvePitch(70, { ...s, shift });
      expect(n).toBe(60);
    }
    expect(scaleNotesStrict('major', 0, 61, 61)).toEqual([]);
    // never an invalid MIDI note, even at the very edge
    const edge = pitchSetup({ scale: 'majorPentatonic', root: 0 }, { low: 127, high: 127, transpose: 0, octave: 0 });
    expect(edge.notes[0]).toBeLessThanOrEqual(127);
    expect(inScale('majorPentatonic', 0, edge.notes[0]!)).toBe(true);
  });

  it('regions with a reversed or degenerate range play valid scale notes in the engine too', () => {
    const p = defaultPatch();
    p.scale = 'major';
    p.root = 0;
    exampleRegions(p);
    Object.assign(p.regions[0]!, { low: 72, high: 60 }); // reversed (not sanitised: set directly)
    Object.assign(p.regions[1]!, { low: 61, high: 61 }); // no scale note
    Object.assign(p.regions[2]!, { low: 62, high: 62 }); // one scale note
    const ev = ons(renderPerformance(p, demoAnalysis('st-lowres'), PPQ * 8));
    for (const e of ev) {
      expect(inScale('major', 0, e.note)).toBe(true);
      expect(e.note >= 0 && e.note <= 127).toBe(true);
    }
    expect(ev.filter((e) => e.region === 0).every((e) => e.note >= 60 && e.note <= 72)).toBe(true);
    expect(ev.filter((e) => e.region === 2).every((e) => e.note === 62)).toBe(true);
  });
});

describe('colour and brightness to pitch', () => {
  const cell = (rgba: [number, number, number, number], w = 4, h = 4) => areaFeatures(analyse(solid(w, h, rgba), w, h), 0, 0, 1, 1);
  const notes = scaleNotes('major', 0, 48, 72); // C D E F G A B per octave

  it('maps known colours to known pitches (hue chooses the degree, brightness the octave)', () => {
    // red 0°, green 120°, blue 240°: degrees 0, 2, 4 of C major = C, E, G
    const pc = (rgba: [number, number, number, number]) => mapPitch('hue', cell(rgba), notes, 'major', 0, 16) % 12;
    expect(pc([255, 0, 0, 255])).toBe(0);
    expect(pc([0, 255, 0, 255])).toBe(4);
    expect(pc([0, 0, 255, 255])).toBe(7);
    // yellow 60° (degree 1: D); lighter colours sit in higher octaves than darker ones of the same hue
    expect(pc([255, 255, 0, 255])).toBe(2);
    expect(mapPitch('hue', cell([255, 160, 160, 255]), notes, 'major', 0, 16)).toBeGreaterThan(mapPitch('hue', cell([120, 0, 0, 255]), notes, 'major', 0, 16));
    // and the same input always gives the same note
    for (let i = 0; i < 5; i++) expect(mapPitch('hue', cell([12, 200, 99, 255]), notes, 'major', 0, 16)).toBe(mapPitch('hue', cell([12, 200, 99, 255]), notes, 'major', 0, 16));
  });

  it('maps brightness from the lowest to the highest note', () => {
    expect(mapPitch('brightness', cell([0, 0, 0, 255]), notes, 'major', 0, 16)).toBe(48);
    expect(mapPitch('brightness', cell([255, 255, 255, 255]), notes, 'major', 0, 16)).toBe(72);
    expect(mapPitch('brightness', cell([128, 128, 128, 255]), notes, 'major', 0, 16)).toBe(notes[Math.floor((128 / 255) * notes.length)]);
  });

  it('greyscale: hue falls back to brightness, ST COLOUR climbs with the grey level', () => {
    const grey = analyse(paint(16, 1, (x) => [x * 17, x * 17, x * 17, 255]), 16, 1);
    let last = -1;
    for (let x = 0; x < 16; x++) {
      const f = areaFeatures(grey, x / 16, 0, 1 / 16, 1);
      const byHue = mapPitch('hue', f, notes, 'major', 0, grey.palette.length);
      expect(byHue).toBe(mapPitch('brightness', f, notes, 'major', 0, grey.palette.length));
      const byColour = mapPitch('colour', f, notes, 'major', 0, grey.palette.length);
      expect(byColour).toBeGreaterThanOrEqual(last);
      last = byColour;
    }
    expect(last).toBe(72);
    // a flat grey picture is one steady note under every source
    const flat = areaFeatures(analyse(solid(8, 8, [90, 90, 90, 255]), 8, 8), 0, 0, 1, 1);
    for (const src of ['brightness', 'hue', 'colour'] as const) expect(mapPitch(src, flat, notes, 'major', 0, 1)).toBe(mapPitch(src, flat, notes, 'major', 0, 1));
  });

  it('ST COLOUR: the palette is darkest first, so the pitch contour follows brightness', () => {
    const an = demoAnalysis('st-lowres');
    const lum = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    for (let i = 1; i < an.palette.length; i++) expect(lum(an.palette[i]!)).toBeGreaterThanOrEqual(lum(an.palette[i - 1]!));
    let last = -1;
    for (let i = 0; i < an.palette.length; i++) {
      const n = mapPitch('colour', { lum: 0, sat: 0, hue: 0, alpha: 1, edge: 0, r: 0, g: 0, b: 0, index: i }, notes, 'major', 0, an.palette.length);
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });

  it('ST COLOUR: a cell is the palette colour nearest its AVERAGE, not whichever pixel is central', () => {
    const board = (phase: number) =>
      analyse(
        paint(32, 32, (x, y) => ((x + y + phase) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255])),
        32,
        32,
        32,
      );
    const a = areaFeatures(board(0), 0, 0, 1, 1).index;
    const b = areaFeatures(board(1), 0, 0, 1, 1).index;
    expect(a).toBe(b);
    // one-pixel cells are literal: each pixel keeps its own palette colour
    const an = board(0);
    const px = [areaFeatures(an, 0, 0, 1 / 32, 1 / 32).index, areaFeatures(an, 1 / 32, 0, 1 / 32, 1 / 32).index];
    expect(new Set(px).size).toBe(2);
  });
});

describe('audio tuning', () => {
  it('uses equal temperament: 69 is 440 Hz, 60 is middle C', () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(60)).toBeCloseTo(261.6256, 3);
    expect(midiToHz(81)).toBeCloseTo(880, 9);
    expect(midiToHz(57)).toBeCloseTo(220, 9);
    expect(midiToHz(0)).toBeCloseTo(8.1758, 3);
    expect(midiToHz(127)).toBeCloseTo(12543.85, 1);
    for (let n = 1; n <= 127; n++) {
      expect(midiToHz(n) / midiToHz(n - 1)).toBeCloseTo(Math.pow(2, 1 / 12), 12);
      expect(Math.round(69 + 12 * Math.log2(midiToHz(n) / 440))).toBe(n);
    }
  });

  /** A recording stand-in for an AudioContext: what frequencies each voice asks for. */
  function fakeContext() {
    const oscs: { type: string; freq: number; detune: number }[] = [];
    const param = (v = 0) => {
      const p = { value: v, setValueAtTime(x: number) { p.value = x; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime(x: number) { p.value = x; }, cancelScheduledValues() {}, cancelAndHoldAtTime() {} };
      return p;
    };
    const node = () => {
      const n: Record<string, unknown> = { connect: (d: unknown) => d, disconnect() {}, start() {}, stop() {} };
      return n;
    };
    const ctx = {
      currentTime: 0,
      sampleRate: 44100,
      createGain: () => ({ ...node(), gain: param(1) }),
      createBiquadFilter: () => ({ ...node(), frequency: param(), Q: param(), type: 'lowpass' }),
      createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
      createBufferSource: () => ({ ...node(), buffer: null }),
      createOscillator: () => {
        const rec = { type: 'sine', freq: 0, detune: 0 };
        const o = { ...node(), frequency: param(), detune: param(), type: 'sine' };
        oscs.push(rec);
        Object.defineProperty(o, 'type', { set: (v: string) => (rec.type = v), get: () => rec.type });
        Object.defineProperty(rec, 'freq', { get: () => o.frequency.value });
        Object.defineProperty(rec, 'detune', { get: () => o.detune.value });
        return o;
      },
    };
    return { ctx: ctx as unknown as BaseAudioContext, oscs };
  }

  it('every preview sound starts on the exact frequency of its MIDI note', () => {
    for (const note of [0, 21, 60, 69, 81, 108, 127]) {
      const f = midiToHz(note);
      const play = (sound: 'sine' | 'pluck' | 'pad' | 'perc' | 'bell') => {
        const { ctx, oscs } = fakeContext();
        new PreviewInstrument(sound).start(ctx, ctx.destination, { time: 0, pitch: note, velocity: 100 });
        return oscs;
      };
      expect(play('sine').map((o) => [o.type, o.freq])).toEqual([['sine', f], ['triangle', f]]);
      const pluck = play('pluck');
      expect(pluck.map((o) => [o.type, o.freq, o.detune])).toEqual([['sawtooth', f, 0], ['square', f, 7]]);
      const pad = play('pad');
      expect(pad.map((o) => [o.freq, o.detune])).toEqual([[f, -8], [f, 8], [f / 2, 0]]); // the layers are intentional
      // the drum body settles ON the note (it used to fall to half the frequency)
      expect(play('perc')[0]!.freq).toBe(f);
      // the bell's carrier is the note; its modulator is the inharmonic partner
      const bell = play('bell');
      expect(bell[0]!.freq).toBe(f);
      expect(bell[1]!.freq).toBeCloseTo(f * 3.5, 9);
    }
  });
});

describe('MIDI export agrees with live generation', () => {
  it('writes the very pitches the performance plays, with transposition, octaves, ranges and channels', () => {
    const p = defaultPatch();
    p.scale = 'harmonicMinor';
    p.root = 7; // G harmonic minor
    exampleRegions(p);
    p.regions[0]!.transpose = 5;
    p.regions[1]!.octave = -1;
    p.regions[2]!.transpose = -3;
    p.regions[2]!.octave = 1;
    p.regions[3]!.transpose = 2;
    const an = demoAnalysis('city-lights');
    const ticks = PPQ * 4 * 8;
    const events = renderPerformance(p, an, ticks);
    checkNotes(p, events, 'export');
    const tracks = tracksFromEvents(events, p.regions.map((r, i) => ({ name: `r${i + 1}`, channel: r.channel, include: true })), ticks);
    const smf = readSmf(writeSmf({ ppq: PPQ, name: 'x', tempo: [{ tick: 0, bpm: p.bpm }], tracks, length: ticks }));
    for (let i = 0; i < 4; i++) {
      const live = ons(events).filter((e) => e.region === i).map((e) => [e.tick, e.note, e.velocity, e.channel]);
      const file = smf.tracks[i + 1]!.filter((e) => (e.status & 0xf0) === 0x90).map((e) => [e.tick, e.data[0], e.data[1], (e.status & 15) + 1]);
      expect(file.length).toBeGreaterThan(0);
      expect(file).toEqual(live);
      for (const [, note] of file) expect(inScale('harmonicMinor', 7, note as number)).toBe(true);
    }
    // the same file pitches are what the synth would be asked for
    expect(ons(events).every((e) => midiToHz(e.note) > 8 && midiToHz(e.note) < 13000)).toBe(true);
  });

  it('is the same code path as playback: live in slices equals the export render', () => {
    const p = defaultPatch();
    p.scale = 'dorian';
    p.root = 2;
    exampleRegions(p);
    Object.assign(p.regions[0]!, { transpose: 4, octave: 1 });
    const an = demoAnalysis('portrait');
    const whole = renderPerformance(p, an, PPQ * 8);
    const perf = new Performance(p, an);
    const sliced: PerfEvent[] = [];
    for (let t = 0; t < PPQ * 8; t += 113) sliced.push(...perf.render(Math.min(PPQ * 8, t + 113)));
    sliced.push(...perf.releaseAll(PPQ * 8));
    expect(sliced).toEqual(whole);
  });
});

describe('REPEAT: TIE', () => {
  it('holds a repeated note as one voice: no second note-on, no overlap, one note-off', () => {
    const flat = analyse(solid(16, 16, [180, 180, 180, 255]), 16, 16);
    const p = defaultPatch();
    exampleRegions(p);
    Object.assign(p.regions[0]!, { mode: 'melodic', repeat: 'tie', gate: 1, x: 0, y: 0, w: 1, h: 1, cols: 16, rows: 1 });
    p.regions.slice(1).forEach((r) => (r.enabled = false));
    const ev = renderPerformance(p, flat, PPQ * 4);
    const first = ons(ev);
    expect(first.length).toBe(1);
    const offs = ev.filter((e) => e.type === 'off');
    expect(offs.length).toBe(1);
    // the single voice sounded from the first step to the end of the last (3600 + 240 ticks)
    expect(offs[0]!.tick - first[0]!.tick).toBeGreaterThanOrEqual(PPQ * 4 - 240);
  });

  it('a tie never doubles a voice, whatever the shift folds notes onto', () => {
    const an = demoAnalysis('st-lowres');
    for (const mode of ['melodic', 'ambient', 'pointillist', 'drone', 'chaotic'] as const) {
      for (const [transpose, octave] of [[0, 0], [4, 0], [0, 2], [-5, -1]] as const) {
        const p = defaultPatch();
        exampleRegions(p);
        p.regions.forEach((r) => Object.assign(r, { mode, transpose, octave, repeat: 'tie', gate: 2 }));
        const ev = renderPerformance(p, an, PPQ * 8);
        const sounding = new Set<string>();
        for (const e of ev) {
          const k = `${e.type === 'step' ? '' : e.channel}:${'note' in e ? e.note : ''}`;
          if (e.type === 'on') {
            expect(sounding.has(k), `${mode} ${transpose}/${octave}: ${k} struck while sounding`).toBe(false);
            sounding.add(k);
          } else if (e.type === 'off') sounding.delete(k);
        }
        expect(sounding.size).toBe(0);
      }
    }
  });
});

describe('regionNotes', () => {
  it('lists only global-scale notes between LOW and HIGH', () => {
    const p = defaultPatch();
    p.scale = 'minorPentatonic';
    p.root = 0;
    expect(regionNotes(p, { low: 48, high: 60 })).toEqual([48, 51, 53, 55, 58, 60]);
    expect(ramp().w).toBe(64); // keep the helper import honest
  });
});
