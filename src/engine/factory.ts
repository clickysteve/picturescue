/**
 * Factory presets: complete patches built on the demonstration pictures, each showing a
 * different way of hearing an image.
 */
import { layoutRects, type Layout } from './regions';
import { defaultPatch, type Patch, type RegionSettings } from './types';

export interface Factory {
  id: string;
  name: string;
  about: string;
  make(): Patch;
}

function base(name: string, image: string, layout: Layout, patch: Partial<Patch>, regions: Partial<RegionSettings>[]): Patch {
  const p = { ...defaultPatch(), ...patch, name, image: { kind: 'demo' as const, id: image } };
  const rects = layoutRects(layout);
  p.regions = p.regions.map((r, i) => ({ ...r, ...rects[i]!, ...regions[i] }));
  return p;
}

export const FACTORY: Factory[] = [
  {
    id: 'picture-music',
    name: 'PICTURE MUSIC',
    about: 'The original idea: four areas, each colour a note, scanned left to right',
    make: () =>
      base('PICTURE MUSIC', 'st-lowres', 'quadrants', { bpm: 120, stepsPerBeat: 4, scale: 'major', root: 0, seed: 1994, seedText: '1994' }, [0, 1, 2, 3].map((i) => ({ mode: 'melodic', pitchFrom: 'colour', velFrom: 'fixed', trigger: 'every', scan: 'horizontal', cols: 16, rows: 4, rate: 2, density: 1, rest: 0, gate: 0.9, repeat: 'tie', low: [60, 48, 55, 36][i], high: [84, 72, 79, 60][i], sound: (['pluck', 'sine', 'bell', 'pad'] as const)[i], channel: i + 1 }))),
  },
  {
    id: 'monochrome-melody',
    name: 'MONOCHROME MELODY',
    about: 'Brightness becomes a melody; the steps climb, the rings rise and fall',
    make: () =>
      base('MONOCHROME MELODY', 'monochrome', 'bands', { bpm: 96, stepsPerBeat: 4, scale: 'dorian', root: 2, seed: 7, seedText: '7' }, [
        { mode: 'melodic', pitchFrom: 'brightness', velFrom: 'brightness', trigger: 'every', scan: 'horizontal', cols: 16, rows: 2, rate: 2, low: 62, high: 86, density: 0.8, gate: 1, sound: 'pluck' },
        { mode: 'melodic', pitchFrom: 'brightness', velFrom: 'edges', trigger: 'edges', threshold: 0.15, scan: 'pingpong', cols: 16, rows: 2, rate: 1, low: 50, high: 74, density: 0.9, gate: 2, sound: 'sine' },
        { mode: 'rhythmic', pitchFrom: 'brightness', trigger: 'edges', threshold: 0.2, scan: 'horizontal', cols: 32, rows: 1, rate: 2, low: 36, high: 60, density: 0.9, sound: 'perc' },
        { mode: 'drone', pitchFrom: 'brightness', scan: 'vertical', cols: 8, rows: 4, rate: 1, low: 38, high: 62, gate: 8, sound: 'pad', density: 0.5 },
      ]),
  },
  {
    id: 'four-colours',
    name: 'FOUR COLOURS',
    about: 'Flat colour fields: hue chooses the degree, black lines are the beat',
    make: () =>
      base('FOUR COLOURS', 'four-colours', 'quadrants', { bpm: 128, stepsPerBeat: 4, scale: 'mixolydian', root: 7, seed: 4, seedText: '4' }, [
        { mode: 'melodic', pitchFrom: 'hue', trigger: 'change', threshold: 0.1, scan: 'serpentine', cols: 12, rows: 6, density: 1, gate: 2, repeat: 'tie', low: 55, high: 84, sound: 'pluck' },
        { mode: 'rhythmic', pitchFrom: 'colour', trigger: 'edges', threshold: 0.2, scan: 'horizontal', cols: 16, rows: 4, density: 1, low: 36, high: 60, sound: 'perc' },
        { mode: 'pointillist', pitchFrom: 'hue', scan: 'randomwalk', cols: 12, rows: 8, density: 0.8, low: 60, high: 96, sound: 'bell' },
        { mode: 'drone', pitchFrom: 'hue', scan: 'spiral', cols: 8, rows: 8, rate: 1, low: 36, high: 55, sound: 'pad' },
      ]),
  },
  {
    id: 'city-lights',
    name: 'CITY LIGHTS',
    about: 'Lit windows ring out against the dark; the skyline is a bass line',
    make: () =>
      base('CITY LIGHTS', 'city-lights', 'bands', { bpm: 104, stepsPerBeat: 4, swing: 0.18, scale: 'minorPentatonic', root: 4, seed: 2077, seedText: '2077' }, [
        { mode: 'pointillist', pitchFrom: 'brightness', velFrom: 'brightness', trigger: 'threshold', threshold: 0.4, scan: 'randomwalk', cols: 24, rows: 6, density: 0.9, low: 72, high: 100, sound: 'bell' },
        { mode: 'melodic', pitchFrom: 'brightness', trigger: 'threshold', threshold: 0.25, scan: 'horizontal', cols: 24, rows: 3, density: 0.9, low: 60, high: 84, gate: 0.5, sound: 'pluck' },
        { mode: 'rhythmic', pitchFrom: 'colour', trigger: 'edges', threshold: 0.18, scan: 'horizontal', cols: 32, rows: 2, density: 0.85, low: 36, high: 55, sound: 'perc' },
        { mode: 'ambient', pitchFrom: 'brightness', trigger: 'every', scan: 'horizontal', cols: 16, rows: 1, rate: 1, low: 28, high: 52, gate: 4, sound: 'pad', ccFrom: 'brightness', cc: 74 },
      ]),
  },
  {
    id: 'slow-landscape',
    name: 'SLOW LANDSCAPE',
    about: 'An evolving melody over long notes, the hills read from the sky down',
    make: () =>
      base('SLOW LANDSCAPE', 'landscape', 'strips', { bpm: 72, stepsPerBeat: 2, scale: 'lydian', root: 5, seed: 1111, seedText: '1111' }, [
        { mode: 'ambient', pitchFrom: 'brightness', scan: 'vertical', cols: 4, rows: 16, rate: 1, low: 53, high: 77, gate: 6, sound: 'pad', ccFrom: 'hue', cc: 1 },
        { mode: 'melodic', pitchFrom: 'hue', trigger: 'change', threshold: 0.05, scan: 'vertical', cols: 4, rows: 16, rate: 2, low: 65, high: 89, density: 0.7, gate: 2, sound: 'sine' },
        { mode: 'drone', pitchFrom: 'brightness', scan: 'vertical', cols: 2, rows: 16, rate: 0, low: 29, high: 48, sound: 'pad' },
        { mode: 'pointillist', pitchFrom: 'hue', scan: 'spiral', cols: 8, rows: 8, rate: 2, density: 0.5, low: 72, high: 96, sound: 'bell' },
      ]),
  },
  {
    id: 'fractured-portrait',
    name: 'FRACTURED PORTRAIT',
    about: 'Shards become accents; the face is read in a spiral',
    make: () =>
      base('FRACTURED PORTRAIT', 'portrait', 'centre', { bpm: 118, stepsPerBeat: 4, scale: 'phrygian', root: 4, seed: 360, seedText: '360' }, [
        { mode: 'melodic', pitchFrom: 'brightness', trigger: 'change', threshold: 0.08, scan: 'spiral', cols: 12, rows: 12, density: 0.9, low: 57, high: 81, gate: 1, sound: 'pluck' },
        { mode: 'rhythmic', pitchFrom: 'hue', trigger: 'edges', threshold: 0.2, scan: 'horizontal', cols: 32, rows: 2, density: 0.9, low: 36, high: 60, sound: 'perc' },
        { mode: 'chaotic', pitchFrom: 'hue', scan: 'randomwalk', cols: 6, rows: 16, density: 0.4, low: 64, high: 96, gate: 0.5, sound: 'bell' },
        { mode: 'pointillist', pitchFrom: 'saturation', scan: 'randomwalk', cols: 6, rows: 16, density: 0.6, low: 48, high: 84, sound: 'sine' },
      ]),
  },
  {
    id: 'colour-drift',
    name: 'COLOUR DRIFT',
    about: 'Hue wanders through the scale; saturation breathes in the controller',
    make: () =>
      base('COLOUR DRIFT', 'drift', 'overlap', { bpm: 90, stepsPerBeat: 4, scale: 'wholeTone', root: 0, seed: 88, seedText: '88' }, [
        { mode: 'ambient', pitchFrom: 'hue', scan: 'randomwalk', cols: 16, rows: 12, rate: 1, low: 48, high: 72, gate: 4, sound: 'pad', ccFrom: 'saturation', cc: 74 },
        { mode: 'melodic', pitchFrom: 'hue', trigger: 'every', scan: 'serpentine', cols: 16, rows: 8, rate: 2, density: 0.6, low: 60, high: 84, gate: 1, sound: 'sine' },
        { mode: 'pointillist', pitchFrom: 'hue', scan: 'spiral', reverse: true, cols: 12, rows: 12, rate: 3, density: 0.5, low: 72, high: 100, sound: 'bell' },
        { enabled: false, mode: 'drone', pitchFrom: 'hue', scan: 'spiral', cols: 8, rows: 8, rate: 0, low: 36, high: 55, sound: 'pad' },
      ]),
  },
  {
    id: 'geometric-rhythm',
    name: 'GEOMETRIC RHYTHM',
    about: 'A pattern of triangles becomes a groove',
    make: () =>
      base('GEOMETRIC RHYTHM', 'geometry', 'bands', { bpm: 124, stepsPerBeat: 4, scale: 'minor', root: 2, seed: 808, seedText: '808' }, [
        { mode: 'rhythmic', pitchFrom: 'hue', trigger: 'edges', threshold: 0.15, scan: 'horizontal', cols: 16, rows: 1, density: 1, low: 36, high: 48, sound: 'perc', channel: 10 },
        { mode: 'rhythmic', pitchFrom: 'brightness', trigger: 'change', threshold: 0.2, scan: 'horizontal', cols: 16, rows: 1, density: 1, low: 48, high: 60, sound: 'perc', channel: 10 },
        { mode: 'melodic', pitchFrom: 'colour', trigger: 'every', scan: 'horizontal', cols: 8, rows: 1, rate: 1, density: 1, low: 38, high: 50, gate: 1.5, sound: 'pluck' },
        { mode: 'melodic', pitchFrom: 'hue', trigger: 'change', threshold: 0.2, scan: 'pingpong', cols: 16, rows: 1, density: 0.8, low: 62, high: 86, gate: 0.5, sound: 'bell' },
      ]),
  },
];

export function factoryById(id: string): Factory | undefined {
  return FACTORY.find((f) => f.id === id);
}
