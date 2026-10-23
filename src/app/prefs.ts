/**
 * Application preferences (localStorage): hardware and display choices that never belong to
 * a patch. Palettes are kept by Slop Factory Core's PaletteLibrary under their own keys.
 * Every read and write is guarded: blocked storage just means nothing is remembered.
 */
import { noLocks, RANDOM_CATEGORIES, type Locks } from '../engine/randomise';
import { VIEWS, type View } from '../engine/analysis';

export interface Prefs {
  midiOut: string;
  midiIn: string;
  midiEnabled: boolean;
  clockOut: boolean;
  clockIn: boolean;
  audio: boolean;
  volume: number;
  view: View;
  locks: Locks;
  wildcard: boolean;
  exportBars: number;
}

export const defaultPrefs = (): Prefs => ({ midiOut: '', midiIn: '', midiEnabled: true, clockOut: false, clockIn: false, audio: true, volume: 0.8, view: 'picture', locks: noLocks(), wildcard: false, exportBars: 16 });

const KEY = 'picturescue.prefs';
const AUTOSAVE = 'picturescue.autosave';

export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function store(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadPrefs(s: Store | null = store()): Prefs {
  const d = defaultPrefs();
  try {
    const o = JSON.parse(s?.getItem(KEY) ?? '{}') as Partial<Prefs>;
    const locks = noLocks();
    for (const c of RANDOM_CATEGORIES) locks[c] = !!o.locks?.[c];
    return {
      midiOut: typeof o.midiOut === 'string' ? o.midiOut : d.midiOut,
      midiIn: typeof o.midiIn === 'string' ? o.midiIn : d.midiIn,
      midiEnabled: typeof o.midiEnabled === 'boolean' ? o.midiEnabled : d.midiEnabled,
      clockOut: !!o.clockOut,
      clockIn: !!o.clockIn,
      audio: typeof o.audio === 'boolean' ? o.audio : d.audio,
      volume: typeof o.volume === 'number' && o.volume >= 0 && o.volume <= 1 ? o.volume : d.volume,
      view: VIEWS.includes(o.view as View) ? (o.view as View) : d.view,
      locks,
      wildcard: !!o.wildcard,
      exportBars: typeof o.exportBars === 'number' && o.exportBars >= 1 && o.exportBars <= 999 ? Math.round(o.exportBars) : d.exportBars,
    };
  } catch {
    return d;
  }
}

export function savePrefs(p: Prefs, s: Store | null = store()): void {
  try {
    s?.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked or full */
  }
}

/** The working patch, kept between visits. Returns false if it did not fit. */
export function saveAutosave(text: string, s: Store | null = store()): boolean {
  try {
    s?.setItem(AUTOSAVE, text);
    return true;
  } catch {
    return false;
  }
}

export function loadAutosave(s: Store | null = store()): string | null {
  try {
    return s?.getItem(AUTOSAVE) ?? null;
  } catch {
    return null;
  }
}

export function clearAutosave(s: Store | null = store()): void {
  try {
    s?.removeItem(AUTOSAVE);
  } catch {
    /* ignore */
  }
}
