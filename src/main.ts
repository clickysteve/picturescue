/**
 * PICTURESCUE: application entry. Builds the screen, its windows and menus, the keyboard
 * commands and the display loop. Musical timing never depends on the display loop: the
 * transport schedules ahead on its own clock, and the screen only shows what is due.
 */
import './ui/style.css';
import { applyPalette } from '@slopfactory/core/palette';
import { VIEWS } from './engine/analysis';
import { DEMOS } from './engine/demos';
import { FACTORY } from './engine/factory';
import { LAYOUT_LABEL, LAYOUTS, clampRect } from './engine/regions';
import { ANALYSIS_SIZES } from './engine/types';
import { App } from './app/app';
import { ACCEPT } from './app/picture';
import { PATCH_EXT, patchFileName } from './persistence/patchfile';
import { chooseFile, download, el, view } from './ui/dom';
import { commandFor, keyLabel } from './ui/keys';
import { paletteLibrary } from './ui/palette';
import { PictureWindow } from './ui/pictureWindow';
import { RegionWindow } from './ui/regionWindow';
import { TransportWindow } from './ui/transportWindow';
import { ActivityWindow } from './ui/activityWindow';
import { aboutWindow, ExportWindow, helpWindow, LocksWindow, MidiWindow, PaletteWindow, shortcutsWindow } from './ui/otherWindows';
import { alertDialog, closeSelectors, confirmDialog, dialogActive, installTooltips, typing, type MWindow } from './ui/widgets';

const W = 960;
const H = 600;

// ------------------------------------------------------------------ palette (before anything is drawn)
const palettes = paletteLibrary();
applyPalette(palettes.config, palettes.selected.colors);

// ------------------------------------------------------------------ screen
const stage = el('div', '', document.body);
stage.id = 'stage';
const screen = el('div', '', stage);
screen.id = 'screen';
screen.style.width = W + 'px';
screen.style.height = H + 'px';
view.screen = screen;

function fit(): void {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  view.scale = s;
  screen.style.transform = `scale(${s})`;
  screen.style.left = Math.max(0, Math.round((window.innerWidth - W * s) / 2)) + 'px';
  screen.style.top = Math.max(0, Math.round((window.innerHeight - H * s) / 2)) + 'px';
}
window.addEventListener('resize', fit);
fit();
installTooltips(screen);

// ------------------------------------------------------------------ the application
const app = new App();
(window as unknown as { picturescue: unknown }).picturescue = app; // for debugging and automation

const desk = el('div', '', screen, [0, 0, W, H]);
desk.style.position = 'absolute';
const picture = new PictureWindow(app, desk);
const transportWin = new TransportWindow(app, desk);
const regionWin = new RegionWindow(app, desk);
const activity = new ActivityWindow(app, desk);
const midiWin = new MidiWindow(app, desk);
const exportWin = new ExportWindow(app, desk);
const paletteWin = new PaletteWindow(palettes, desk);
const locksWin = new LocksWindow(app, desk);
const help = helpWindow(desk);
const about = aboutWindow(desk);
const shortcuts = shortcutsWindow(desk);
transportWin.openLocks = () => locksWin.win.show();
transportWin.openMidi = () => showMidi();

function showMidi(): void {
  midiWin.win.show();
  if (app.midiAccess.status === 'idle') void app.enableMidi();
}

// ------------------------------------------------------------------ file commands
async function openImage(): Promise<void> {
  const f = await chooseFile(ACCEPT);
  if (f) await app.loadImageFile(f);
}

async function openPatch(): Promise<void> {
  const f = await chooseFile(`${PATCH_EXT},.json,application/json`);
  if (!f) return;
  if (f.size > 32 * 1024 * 1024) return void alertDialog(screen, 'That file is too large to be a PICTURESCUE patch.');
  const ok = await app.openPatchText(await f.text(), f.name);
  if (!ok) void alertDialog(screen, app.status);
}

async function savePatch(): Promise<void> {
  const textOut = await app.patchText();
  download(patchFileName(app.patch), textOut, 'application/json');
  app.say(`Saved “${patchFileName(app.patch)}” (${Math.max(1, Math.round(textOut.length / 1024))} KB, picture included).`);
}

async function newPatch(): Promise<void> {
  if (await confirmDialog(screen, 'Start a new patch? The picture stays; every region goes back to its default settings.', 'New Patch')) app.newPatch();
}

// ------------------------------------------------------------------ commands (keys and menus)
function nudgeRegion(dx: number, dy: number, grow: boolean): void {
  const r = app.patch.regions[app.selected]!;
  const c = grow ? clampRect({ x: r.x, y: r.y, w: r.w + dx, h: r.h + dy }) : clampRect({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
  Object.assign(r, c);
  app.changed('patch');
}

const run: Record<string, (e?: KeyboardEvent) => void> = {
  stopPlay: () => app.togglePlay(),
  pause: () => void app.pauseResume(),
  restart: () => app.transport.restartScans(),
  record: () => app.toggleRecord(),
  panic: () => app.panic(),
  tempoUp: (e) => app.setBpm(app.patch.bpm + (e?.shiftKey ? 10 : 1)),
  tempoDown: (e) => app.setBpm(app.patch.bpm - (e?.shiftKey ? 10 : 1)),
  openImage: () => void openImage(),
  openPatch: () => void openPatch(),
  savePatch: () => void savePatch(),
  exportMidi: () => exportWin.win.show(),
  region1: () => app.select(0),
  region2: () => app.select(1),
  region3: () => app.select(2),
  region4: () => app.select(3),
  prevRegion: () => app.select((app.selected + 3) % 4),
  nextRegion: () => app.select((app.selected + 1) % 4),
  toggleRegion: () => {
    const r = app.patch.regions[app.selected]!;
    r.enabled = !r.enabled;
    app.changed('patch');
  },
  mute: () => {
    const r = app.patch.regions[app.selected]!;
    r.mute = !r.mute;
    app.changed('patch');
  },
  solo: () => {
    const r = app.patch.regions[app.selected]!;
    r.solo = !r.solo;
    app.changed('patch');
  },
  nudge: (e) => {
    const k = e?.shiftKey ? 0.05 : 0.01;
    nudgeRegion(e?.key === 'ArrowLeft' ? -k : e?.key === 'ArrowRight' ? k : 0, e?.key === 'ArrowUp' ? -k : e?.key === 'ArrowDown' ? k : 0, false);
  },
  grow: (e) => {
    const k = e?.shiftKey ? 0.05 : 0.01;
    nudgeRegion(e?.key === 'ArrowLeft' ? -k : e?.key === 'ArrowRight' ? k : 0, e?.key === 'ArrowUp' ? -k : e?.key === 'ArrowDown' ? k : 0, true);
  },
  variation: () => app.newVariation(),
  randomise: () => app.randomise(false),
  wildcard: () => app.randomise(true),
  view: () => {
    const i = VIEWS.indexOf(app.prefs.view);
    app.prefs.view = VIEWS[(i + 1) % VIEWS.length]!;
    app.changed('prefs');
    app.changed('image');
  },
  midiWindow: () => showMidi(),
  paletteWindow: () => paletteWin.win.toggle(),
  help: () => help.toggle(),
};

window.addEventListener('keydown', (e) => {
  if (dialogActive() || typing.active) return;
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const cmd = commandFor(e);
  if (!cmd) {
    if (e.key === 'Escape') closeMenu();
    return;
  }
  e.preventDefault();
  if (e.repeat && cmd.noRepeat) return;
  closeSelectors();
  run[cmd.id]?.(e);
});

// ------------------------------------------------------------------ menus
interface MenuItem {
  label: string;
  key?: string;
  action?: () => void;
  checked?: () => boolean;
  disabled?: () => boolean;
}
type Entry = MenuItem | 'sep';

const winItem = (label: string, w: MWindow): MenuItem => ({ label, action: () => w.show(), checked: () => w.open });

const MENUS: { title: string; cls?: string; items: () => Entry[] }[] = [
  {
    title: 'PICTURESCUE',
    cls: 'logo',
    items: () => [{ label: 'About PICTURESCUE…', action: () => about.show() }, { label: 'Quick Help…', key: keyLabel('help'), action: () => help.show() }, { label: 'Keyboard Shortcuts…', action: () => shortcuts.show() }],
  },
  {
    title: 'File',
    items: () => [
      { label: 'Open Picture…', key: keyLabel('openImage'), action: () => void openImage() },
      { label: 'Clear Picture', action: () => app.clearImage(), disabled: () => !app.source },
      'sep',
      ...DEMOS.map((d): MenuItem => ({ label: `Demo: ${d.name}`, action: () => app.loadDemo(d.id), checked: () => app.source?.demo === d.id })),
      'sep',
      { label: 'New Patch…', action: () => void newPatch() },
      { label: 'Open Patch…', key: keyLabel('openPatch'), action: () => void openPatch() },
      { label: 'Save Patch…', key: keyLabel('savePatch'), action: () => void savePatch() },
      'sep',
      { label: 'Export MIDI File…', key: keyLabel('exportMidi'), action: () => exportWin.win.show() },
      { label: 'Export Recording', action: () => exportWin.exportTake(), disabled: () => !app.take },
    ],
  },
  {
    title: 'Regions',
    items: () => [
      ...LAYOUTS.map((l): MenuItem => ({ label: LAYOUT_LABEL[l], action: () => app.setLayout(l) })),
      'sep',
      ...[0, 1, 2, 3].map((i): MenuItem => ({ label: `Region ${i + 1}`, key: String(i + 1), action: () => app.select(i), checked: () => app.selected === i })),
      'sep',
      { label: 'Selected Region On', key: keyLabel('toggleRegion'), action: () => run.toggleRegion!(), checked: () => app.patch.regions[app.selected]!.enabled },
      { label: 'Copy Settings to All Regions', action: () => app.copyRegionToAll() },
    ],
  },
  {
    title: 'Play',
    items: () => [
      { label: app.transport.state === 'playing' ? 'Stop' : 'Play', key: keyLabel('stopPlay'), action: () => app.togglePlay() },
      { label: app.transport.state === 'paused' ? 'Continue' : 'Pause', key: keyLabel('pause'), action: () => void app.pauseResume() },
      { label: 'Restart Scans', key: keyLabel('restart'), action: () => app.transport.restartScans() },
      { label: 'Loop', action: () => ((app.patch.loop = !app.patch.loop), app.changed('patch')), checked: () => app.patch.loop },
      { label: app.transport.recording ? 'Stop Recording' : 'Record', key: keyLabel('record'), action: () => app.toggleRecord() },
      'sep',
      { label: 'New Variation', key: keyLabel('variation'), action: () => app.newVariation() },
      { label: 'Randomise', key: keyLabel('randomise'), action: () => app.randomise(false) },
      { label: 'WILDCARD', key: keyLabel('wildcard'), action: () => app.randomise(true) },
      { label: 'Randomise Locks…', action: () => locksWin.win.show() },
      'sep',
      { label: 'Panic (All Notes Off)', key: keyLabel('panic'), action: () => app.panic() },
    ],
  },
  { title: 'Factory', items: () => FACTORY.map((f): MenuItem => ({ label: f.name, action: () => void app.applyFactory(f.id) })) },
  {
    title: 'Options',
    items: () => [
      { label: 'MIDI Settings…', key: keyLabel('midiWindow'), action: () => showMidi() },
      { label: 'Internal Sounds', action: () => transportWin.toggleAudio(), checked: () => app.prefs.audio },
      { label: 'Palette…', key: keyLabel('paletteWindow'), action: () => paletteWin.win.show() },
      'sep',
      ...ANALYSIS_SIZES.map((s): MenuItem => ({ label: `Analysis Size ${s} px${s === 320 ? ' (ST)' : ''}`, action: () => app.setAnalysisSize(s), checked: () => app.patch.analysisSize === s })),
    ],
  },
  {
    title: 'Windows',
    items: () => [winItem('Picture', picture.win), winItem('Transport', transportWin.win), winItem('Region', regionWin.win), winItem('Activity', activity.win), 'sep', winItem('MIDI Settings', midiWin.win), winItem('Export MIDI', exportWin.win), winItem('Palette', paletteWin.win), winItem('Randomise Locks', locksWin.win), winItem('Quick Help', help)],
  },
];

const menubar = el('div', '', screen);
menubar.id = 'menubar';
menubar.setAttribute('role', 'menubar');
let openMenu: { el: HTMLDivElement; drop: HTMLDivElement } | null = null;
function closeMenu(): void {
  if (!openMenu) return;
  openMenu.el.classList.remove('open');
  openMenu.drop.remove();
  openMenu = null;
}
for (const m of MENUS) {
  const me = el('div', 'menu ' + (m.cls ?? ''), menubar, undefined, m.title);
  me.setAttribute('role', 'menuitem');
  const show = () => {
    closeMenu();
    closeSelectors();
    const drop = el('div', 'dropdown', me);
    drop.setAttribute('role', 'menu');
    drop.addEventListener('pointerdown', (e) => e.stopPropagation());
    for (const it of m.items()) {
      if (it === 'sep') {
        el('div', 'sep', drop);
        continue;
      }
      const dis = it.disabled?.() ?? false;
      const d = el('div', 'item' + (dis ? ' disabled' : '') + (it.checked?.() ? ' checked' : ''), drop);
      d.setAttribute('role', it.checked ? 'menuitemcheckbox' : 'menuitem');
      el('span', '', d, undefined, it.label);
      if (it.key) el('span', 'key', d, undefined, it.key);
      d.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        closeMenu();
        if (!dis) it.action?.();
      });
    }
    me.classList.add('open');
    openMenu = { el: me, drop };
  };
  me.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (openMenu?.el === me) closeMenu();
    else show();
  });
  me.addEventListener('pointerenter', () => openMenu && openMenu.el !== me && show());
}
const statusEl = el('div', 'status', menubar);
window.addEventListener('pointerdown', () => closeMenu());

function updateMenubarStatus(): void {
  const s = app.transport.state;
  const txt = `${s === 'playing' ? '▶ PLAYING' : s === 'paused' ? '❚❚ PAUSED' : '■ STOPPED'}${app.transport.recording ? '  ● REC' : ''}   ${app.patch.bpm} BPM   SEED ${app.patch.seedText}   ${app.patch.name}`;
  if (statusEl.textContent !== txt) statusEl.textContent = txt;
}
app.on((c) => {
  if (c === 'patch' || c === 'transport' || c === 'take') updateMenubarStatus();
  if (c === 'transport' && app.transport.state === 'stopped') {
    picture.reset();
    activity.reset();
  }
});

// ------------------------------------------------------------------ display loop (never musical timing)
let lastFollow = '';
function frame(): void {
  const now = performance.now();
  for (const v of app.transport.drainVisual(now)) {
    if (v.ev.type === 'step') picture.step(v.ev, now);
    activity.event(v.ev, now);
  }
  const playing = app.transport.state === 'playing' || app.transport.state === 'paused';
  picture.frame(now, playing);
  activity.frame(now, app.transport.state === 'playing');
  transportWin.frame();
  midiWin.frame();
  app.follower.check(now);
  if (app.follower.status !== lastFollow) {
    lastFollow = app.follower.status;
    transportWin.update();
  }
  requestAnimationFrame(frame);
}

// a returning tab: the audio clock may have been suspended
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && app.transport.state === 'playing' && app.prefs.audio) void app.audio.unlock();
});
// leaving the page: no note may be left sounding on external instruments
window.addEventListener('pagehide', () => {
  app.transport.stop();
  app.midi.releaseAll();
});

void app.init().then(() => {
  updateMenubarStatus();
  activity.updateMidi();
  if (!app.status) app.say('Press Space to play. Choose a picture from DEMOS or OPEN… your own; click a region to edit it.');
  requestAnimationFrame(frame);
});
