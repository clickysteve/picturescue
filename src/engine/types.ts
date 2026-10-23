/**
 * The PICTURESCUE patch: everything that decides the music, and nothing that does not
 * (palettes, MIDI ports and window positions are preferences, never part of a patch).
 *
 * Region geometry is stored in normalised image coordinates (0..1), so the music never
 * depends on how large the picture is drawn on screen.
 */
import { SCALES } from './scales';

/** Ticks per quarter note for all musical time (integers, so nothing drifts). */
export const PPQ = 960;

export const REGION_COUNT = 4;

export const SCAN_MODES = ['horizontal', 'vertical', 'pingpong', 'serpentine', 'randomwalk', 'spiral', 'manual'] as const;
export type ScanMode = (typeof SCAN_MODES)[number];
export const SCAN_LABEL: Record<ScanMode, string> = {
  horizontal: 'HORIZONTAL',
  vertical: 'VERTICAL',
  pingpong: 'PING-PONG',
  serpentine: 'SERPENTINE',
  randomwalk: 'RANDOM WALK',
  spiral: 'SPIRAL',
  manual: 'MANUAL',
};

export const MODES = ['melodic', 'rhythmic', 'ambient', 'pointillist', 'drone', 'chaotic'] as const;
export type InterpMode = (typeof MODES)[number];
export const MODE_LABEL: Record<InterpMode, string> = {
  melodic: 'MELODIC',
  rhythmic: 'RHYTHMIC',
  ambient: 'AMBIENT',
  pointillist: 'POINTILLIST',
  drone: 'DRONE',
  chaotic: 'CHAOTIC',
};

export const PITCH_SOURCES = ['brightness', 'hue', 'colour', 'saturation'] as const;
export type PitchSource = (typeof PITCH_SOURCES)[number];
export const PITCH_LABEL: Record<PitchSource, string> = { brightness: 'BRIGHTNESS', hue: 'HUE', colour: 'ST COLOUR', saturation: 'SATURATION' };

export const VEL_SOURCES = ['saturation', 'brightness', 'edges', 'fixed'] as const;
export type VelSource = (typeof VEL_SOURCES)[number];
export const VEL_LABEL: Record<VelSource, string> = { saturation: 'SATURATION', brightness: 'BRIGHTNESS', edges: 'EDGES', fixed: 'FIXED' };

export const TRIGGERS = ['every', 'threshold', 'edges', 'change', 'detail'] as const;
export type Trigger = (typeof TRIGGERS)[number];
export const TRIGGER_LABEL: Record<Trigger, string> = { every: 'EVERY STEP', threshold: 'BRIGHT > THR', edges: 'EDGES', change: 'COLOUR CHANGE', detail: 'DETAIL' };

export const CC_SOURCES = ['off', 'hue', 'brightness', 'saturation', 'edges'] as const;
export type CcSource = (typeof CC_SOURCES)[number];
export const CC_LABEL: Record<CcSource, string> = { off: 'OFF', hue: 'HUE', brightness: 'BRIGHTNESS', saturation: 'SATURATION', edges: 'EDGES' };

export const REPEATS = ['tie', 'retrigger', 'skip'] as const;
export type Repeat = (typeof REPEATS)[number];

/** Region scan rate: multiples of the transport's step. */
export const RATES = [0.25, 0.5, 1, 2] as const;
export const RATE_LABEL = ['×1/4', '×1/2', '×1', '×2'];

export const STEPS_PER_BEAT = [1, 2, 3, 4, 6, 8] as const;

export const SOUNDS = ['sine', 'pluck', 'pad', 'perc', 'bell'] as const;
export type Sound = (typeof SOUNDS)[number];
export const SOUND_LABEL: Record<Sound, string> = { sine: 'SINE/TRI', pluck: 'PLUCKED', pad: 'SOFT PAD', perc: 'PERCUSSIVE', bell: 'BELL' };

export const ANALYSIS_SIZES = [80, 160, 320, 640] as const;

export interface RegionSettings {
  enabled: boolean;
  mute: boolean;
  solo: boolean;
  /** geometry, normalised to the image (0..1) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** MIDI channel 1..16 */
  channel: number;
  mode: InterpMode;
  pitchFrom: PitchSource;
  velFrom: VelSource;
  trigger: Trigger;
  ccFrom: CcSource;
  /** controller number for ccFrom */
  cc: number;
  scan: ScanMode;
  /** play the scan path backwards (spiral: centre outwards) */
  reverse: boolean;
  /** scan grid: cells across and down */
  cols: number;
  rows: number;
  /** index into RATES */
  rate: number;
  /** steps per pass; 0 = the whole path */
  length: number;
  /** first step of the path */
  offset: number;
  /** use the global scale and root instead of this region's own */
  globalScale: boolean;
  scale: string;
  root: number;
  /** note range (MIDI) before transposition */
  low: number;
  high: number;
  /** semitones */
  transpose: number;
  /** octaves */
  octave: number;
  velMin: number;
  velMax: number;
  /** 0..1: how many candidate steps play (busiest picture detail first) */
  density: number;
  /** 0..1: trigger threshold */
  threshold: number;
  /** 0..1: probability of a seeded rest */
  rest: number;
  /** minimum steps between notes */
  spacing: number;
  /** note length in steps */
  gate: number;
  repeat: Repeat;
  /** internal audio preview sound */
  sound: Sound;
  /** preview level 0..1 */
  level: number;
  /** MANUAL scan cursor in region coordinates (0..1) */
  manualX: number;
  manualY: number;
}

export type ImageRef = { kind: 'demo'; id: string } | { kind: 'embedded'; name: string; dataUrl: string; width: number; height: number } | { kind: 'none' };

export interface Patch {
  format: 'picturescue-patch';
  version: number;
  name: string;
  bpm: number;
  stepsPerBeat: number;
  /** 0..0.5: delay of every second step, as a fraction of a step */
  swing: number;
  /** scans repeat; off = each region plays one pass, then the transport stops */
  loop: boolean;
  seed: number;
  /** the text the seed was typed as (display only) */
  seedText: string;
  scale: string;
  root: number;
  analysisSize: number;
  image: ImageRef;
  regions: RegionSettings[];
}

export const PATCH_FORMAT = 'picturescue-patch';
export const PATCH_VERSION = 1;

export function defaultRegion(i: number): RegionSettings {
  const q = [
    [0, 0],
    [0.5, 0],
    [0, 0.5],
    [0.5, 0.5],
  ][i % 4]!;
  return {
    enabled: true,
    mute: false,
    solo: false,
    x: q[0]!,
    y: q[1]!,
    w: 0.5,
    h: 0.5,
    channel: (i % 16) + 1,
    mode: (['melodic', 'rhythmic', 'ambient', 'pointillist'] as const)[i % 4]!,
    pitchFrom: (['brightness', 'colour', 'hue', 'brightness'] as const)[i % 4]!,
    velFrom: 'saturation',
    trigger: (['every', 'edges', 'change', 'detail'] as const)[i % 4]!,
    ccFrom: 'off',
    cc: 74,
    scan: (['horizontal', 'serpentine', 'vertical', 'randomwalk'] as const)[i % 4]!,
    reverse: false,
    cols: 16,
    rows: 8,
    rate: [2, 2, 1, 2][i % 4]!,
    length: 0,
    offset: 0,
    globalScale: true,
    scale: 'minorPentatonic',
    root: 9,
    low: [60, 36, 48, 72][i % 4]!,
    high: [84, 55, 72, 96][i % 4]!,
    transpose: 0,
    octave: 0,
    velMin: 50,
    velMax: 110,
    density: [0.7, 0.6, 0.5, 0.35][i % 4]!,
    threshold: [0.5, 0.3, 0.2, 0.4][i % 4]!,
    rest: 0.1,
    spacing: 0,
    gate: [1, 0.5, 4, 0.25][i % 4]!,
    repeat: 'tie',
    sound: (['pluck', 'perc', 'pad', 'bell'] as const)[i % 4]!,
    level: 0.8,
    manualX: 0.5,
    manualY: 0.5,
  };
}

export function defaultPatch(): Patch {
  return {
    format: PATCH_FORMAT,
    version: PATCH_VERSION,
    name: 'Untitled',
    bpm: 112,
    stepsPerBeat: 4,
    swing: 0,
    loop: true,
    seed: 1984,
    seedText: '1984',
    scale: 'minorPentatonic',
    root: 9,
    analysisSize: 320,
    image: { kind: 'demo', id: 'st-lowres' },
    regions: Array.from({ length: REGION_COUNT }, (_, i) => defaultRegion(i)),
  };
}

// ---------------------------------------------------------------------------- sanitising

const num = (v: unknown, d: number, lo: number, hi: number, int = false): number => {
  let n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) n = d;
  if (int) n = Math.round(n);
  return Math.max(lo, Math.min(hi, n));
};
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const scaleId = (v: unknown, d: string): string => (SCALES.some((s) => s.id === v) ? (v as string) : d);

/** A complete, valid region from anything (missing or invalid fields take the defaults). */
export function sanitiseRegion(v: unknown, i: number): RegionSettings {
  const d = defaultRegion(i);
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const w = num(o.w, d.w, 0.02, 1);
  const h = num(o.h, d.h, 0.02, 1);
  const low = num(o.low, d.low, 0, 127, true);
  const high = num(o.high, d.high, 0, 127, true);
  const velMin = num(o.velMin, d.velMin, 1, 127, true);
  const velMax = num(o.velMax, d.velMax, 1, 127, true);
  return {
    enabled: bool(o.enabled, d.enabled),
    mute: bool(o.mute, d.mute),
    solo: bool(o.solo, d.solo),
    x: num(o.x, d.x, 0, 1 - w),
    y: num(o.y, d.y, 0, 1 - h),
    w,
    h,
    channel: num(o.channel, d.channel, 1, 16, true),
    mode: oneOf(o.mode, MODES, d.mode),
    pitchFrom: oneOf(o.pitchFrom, PITCH_SOURCES, d.pitchFrom),
    velFrom: oneOf(o.velFrom, VEL_SOURCES, d.velFrom),
    trigger: oneOf(o.trigger, TRIGGERS, d.trigger),
    ccFrom: oneOf(o.ccFrom, CC_SOURCES, d.ccFrom),
    cc: num(o.cc, d.cc, 0, 127, true),
    scan: oneOf(o.scan, SCAN_MODES, d.scan),
    reverse: bool(o.reverse, d.reverse),
    cols: num(o.cols, d.cols, 1, 64, true),
    rows: num(o.rows, d.rows, 1, 64, true),
    rate: num(o.rate, d.rate, 0, RATES.length - 1, true),
    length: num(o.length, d.length, 0, 4096, true),
    offset: num(o.offset, d.offset, 0, 4095, true),
    globalScale: bool(o.globalScale, d.globalScale),
    scale: scaleId(o.scale, d.scale),
    root: num(o.root, d.root, 0, 11, true),
    low: Math.min(low, high),
    high: Math.max(low, high),
    transpose: num(o.transpose, d.transpose, -24, 24, true),
    octave: num(o.octave, d.octave, -3, 3, true),
    velMin: Math.min(velMin, velMax),
    velMax: Math.max(velMin, velMax),
    density: num(o.density, d.density, 0, 1),
    threshold: num(o.threshold, d.threshold, 0, 1),
    rest: num(o.rest, d.rest, 0, 1),
    spacing: num(o.spacing, d.spacing, 0, 32, true),
    gate: num(o.gate, d.gate, 0.05, 16),
    repeat: oneOf(o.repeat, REPEATS, d.repeat),
    sound: oneOf(o.sound, SOUNDS, d.sound),
    level: num(o.level, d.level, 0, 1),
    manualX: num(o.manualX, d.manualX, 0, 1),
    manualY: num(o.manualY, d.manualY, 0, 1),
  };
}

function sanitiseImage(v: unknown): ImageRef {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  if (o.kind === 'demo' && typeof o.id === 'string') return { kind: 'demo', id: o.id };
  if (o.kind === 'embedded' && typeof o.dataUrl === 'string' && /^data:image\/(png|jpeg|webp|gif|bmp);base64,/.test(o.dataUrl)) {
    return { kind: 'embedded', name: typeof o.name === 'string' ? o.name.slice(0, 120) : 'image', dataUrl: o.dataUrl, width: num(o.width, 0, 0, 100000, true), height: num(o.height, 0, 0, 100000, true) };
  }
  return { kind: 'none' };
}

/** A complete, valid patch from anything. Unknown fields are dropped; missing ones take the
 * defaults (so older patches load into newer versions). */
export function sanitisePatch(v: unknown): Patch {
  const d = defaultPatch();
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const regions = Array.isArray(o.regions) ? o.regions : [];
  const size = num(o.analysisSize, d.analysisSize, 80, 640, true);
  return {
    format: PATCH_FORMAT,
    version: PATCH_VERSION,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 60) : d.name,
    bpm: num(o.bpm, d.bpm, 20, 300),
    stepsPerBeat: (STEPS_PER_BEAT as readonly number[]).includes(o.stepsPerBeat as number) ? (o.stepsPerBeat as number) : d.stepsPerBeat,
    swing: num(o.swing, d.swing, 0, 0.5),
    loop: bool(o.loop, d.loop),
    seed: num(o.seed, d.seed, 0, 0xffffffff, true),
    seedText: typeof o.seedText === 'string' ? o.seedText.slice(0, 60) : String(num(o.seed, d.seed, 0, 0xffffffff, true)),
    scale: scaleId(o.scale, d.scale),
    root: num(o.root, d.root, 0, 11, true),
    analysisSize: ANALYSIS_SIZES.reduce((a, b) => (Math.abs(b - size) < Math.abs(a - size) ? b : a)),
    image: sanitiseImage(o.image),
    regions: Array.from({ length: REGION_COUNT }, (_, i) => sanitiseRegion(regions[i], i)),
  };
}

export function clonePatch(p: Patch): Patch {
  return JSON.parse(JSON.stringify(p)) as Patch;
}

/** Ticks per step of a region. */
export function stepTicks(p: Patch, r: RegionSettings): number {
  return Math.max(1, Math.round(PPQ / (p.stepsPerBeat * RATES[r.rate]!)));
}
