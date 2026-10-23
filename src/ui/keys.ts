/**
 * Keyboard commands: one table for the dispatcher, the menus' key labels and the Keyboard
 * Shortcuts window. Following the Slop Factory conventions (emmm): Space is Stop / Play,
 * Return is Pause / Continue, ⌘ (Ctrl elsewhere) for document commands, ⌥ (Alt) + a letter for
 * windows and performance helpers. Letters are matched by physical key, so ⌥X works although
 * the Mac types "≈" for it. Keys typed into text fields or a number box being edited never
 * reach these commands.
 */

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

export interface Chord {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface KeyDef {
  id: string;
  label: string;
  group: string;
  keys: Chord[];
  noRepeat?: boolean;
}

const c = (key: string, m: Partial<Chord> = {}): Chord => ({ key, ...m });
const mod = (key: string, m: Partial<Chord> = {}) => c(key, { mod: true, ...m });
const alt = (key: string, m: Partial<Chord> = {}) => c(key, { alt: true, ...m });

export const KEYS: KeyDef[] = [
  { id: 'stopPlay', label: 'Stop / Play', group: 'Transport', keys: [c('Space')], noRepeat: true },
  { id: 'pause', label: 'Pause / Continue', group: 'Transport', keys: [c('Enter')], noRepeat: true },
  { id: 'restart', label: 'Restart the scans', group: 'Transport', keys: [c('KeyR')], noRepeat: true },
  { id: 'record', label: 'Record on / off', group: 'Transport', keys: [c('KeyR', { shift: true })], noRepeat: true },
  { id: 'panic', label: 'Panic: all notes off', group: 'Transport', keys: [mod('Period'), c('Escape', { shift: true })] },
  { id: 'tempoUp', label: 'Tempo +1 (Shift: +10)', group: 'Transport', keys: [c('Equal'), c('Equal', { shift: true })] },
  { id: 'tempoDown', label: 'Tempo −1 (Shift: −10)', group: 'Transport', keys: [c('Minus'), c('Minus', { shift: true })] },
  { id: 'openImage', label: 'Open a picture…', group: 'File', keys: [mod('KeyO')] },
  { id: 'openPatch', label: 'Open a patch…', group: 'File', keys: [mod('KeyO', { shift: true })] },
  { id: 'savePatch', label: 'Save the patch…', group: 'File', keys: [mod('KeyS')] },
  { id: 'exportMidi', label: 'Export a MIDI file…', group: 'File', keys: [mod('KeyE')] },
  { id: 'region1', label: 'Select region 1', group: 'Regions', keys: [c('Digit1')] },
  { id: 'region2', label: 'Select region 2', group: 'Regions', keys: [c('Digit2')] },
  { id: 'region3', label: 'Select region 3', group: 'Regions', keys: [c('Digit3')] },
  { id: 'region4', label: 'Select region 4', group: 'Regions', keys: [c('Digit4')] },
  { id: 'prevRegion', label: 'Previous region', group: 'Regions', keys: [c('BracketLeft')] },
  { id: 'nextRegion', label: 'Next region', group: 'Regions', keys: [c('BracketRight')] },
  { id: 'toggleRegion', label: 'Selected region on / off', group: 'Regions', keys: [c('KeyE')] },
  { id: 'mute', label: 'Mute the selected region', group: 'Regions', keys: [c('KeyM')] },
  { id: 'solo', label: 'Solo the selected region', group: 'Regions', keys: [c('KeyS')] },
  { id: 'nudge', label: 'Move the selected region (Shift: further)', group: 'Regions', keys: [c('ArrowLeft'), c('ArrowRight'), c('ArrowUp'), c('ArrowDown')] },
  { id: 'grow', label: 'Resize the selected region', group: 'Regions', keys: [alt('ArrowLeft'), alt('ArrowRight'), alt('ArrowUp'), alt('ArrowDown')] },
  { id: 'variation', label: 'New variation (new seed)', group: 'Generate', keys: [c('KeyV')] },
  { id: 'randomise', label: 'Randomise', group: 'Generate', keys: [alt('KeyX')] },
  { id: 'wildcard', label: 'WILDCARD', group: 'Generate', keys: [alt('KeyW')] },
  { id: 'view', label: 'Next VIEW (picture, brightness, hue …)', group: 'Windows', keys: [c('Tab')] },
  { id: 'midiWindow', label: 'MIDI settings', group: 'Windows', keys: [alt('KeyM')] },
  { id: 'paletteWindow', label: 'Palette', group: 'Windows', keys: [alt('KeyP')] },
  { id: 'help', label: 'Quick help', group: 'Windows', keys: [c('Slash', { shift: true }), c('F1')] },
];

export function chordMatches(ch: Chord, e: KeyboardEvent): boolean {
  const k = ch.key;
  const keyOk = k.startsWith('Key') || k.startsWith('Digit') || ['Period', 'Slash', 'BracketLeft', 'BracketRight', 'Minus', 'Equal', 'Space'].includes(k) ? e.code === k : e.key === k;
  const modOn = IS_MAC ? e.metaKey : e.ctrlKey;
  // arrows and tempo keys accept Shift as a modifier of their own
  const shiftFree = k.startsWith('Arrow') || k === 'Equal' || k === 'Minus';
  return keyOk && !!ch.mod === modOn && !!ch.alt === e.altKey && (shiftFree ? true : !!ch.shift === e.shiftKey) && !(IS_MAC ? e.ctrlKey : e.metaKey);
}

/** The command a key event stands for. */
export function commandFor(e: KeyboardEvent): KeyDef | null {
  for (const d of KEYS) for (const ch of d.keys) if (chordMatches(ch, e)) return d;
  return null;
}

const NAMES: Record<string, string> = { Space: 'Space', Enter: 'Return', Escape: 'Esc', Period: '.', Slash: '/', BracketLeft: '[', BracketRight: ']', Minus: '−', Equal: '+', Tab: 'Tab', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', F1: 'F1' };

export function chordLabel(ch: Chord): string {
  const k = NAMES[ch.key] ?? ch.key.replace(/^Key|^Digit/, '');
  return `${ch.mod ? (IS_MAC ? '⌘' : 'Ctrl+') : ''}${ch.alt ? (IS_MAC ? '⌥' : 'Alt+') : ''}${ch.shift ? '⇧' : ''}${k}`;
}

export function keyLabel(id: string): string {
  const d = KEYS.find((k) => k.id === id);
  return d ? chordLabel(d.keys[0]!) : '';
}
