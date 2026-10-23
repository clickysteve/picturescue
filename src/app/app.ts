/**
 * The application: the patch being played, its picture and analysis, the transport, MIDI and
 * the audio preview, and every command the interface offers. The interface reads from here
 * and listens for changes; nothing here draws.
 */
import { analyse, type Analysis } from '../engine/analysis';
import { demoById } from '../engine/demos';
import { factoryById } from '../engine/factory';
import { renderPerformance } from '../engine/performance';
import { randomisePatch } from '../engine/randomise';
import { applyRect, layoutRects, type Layout } from '../engine/regions';
import { diceName, freshSeed, seedFromText } from '../engine/rng';
import { tracksFromEvents, writeSmf } from '../engine/smf';
import { clonePatch, defaultPatch, MODE_LABEL, PPQ, type Patch } from '../engine/types';
import { AudioPreview } from '../audio/preview';
import { TempoFollower } from '../midi/clockIn';
import { MidiOut } from '../midi/output';
import { MidiAccess } from '../midi/webmidi';
import { LARGE_PATCH, parsePatch, serialisePatch } from '../persistence/patchfile';
import { loadAutosave, loadPrefs, saveAutosave, savePrefs, type Prefs } from './prefs';
import { PictureError, refFromSource, sourceFromDemo, sourceFromFile, sourceFromRef, type Source } from './picture';
import { Transport, type Take } from './transport';

export type Change = 'patch' | 'image' | 'transport' | 'midi' | 'select' | 'status' | 'take' | 'prefs';

export const BEATS_PER_BAR = 4;

export class App {
  patch: Patch;
  source: Source | null = null;
  analysis: Analysis | null = null;
  selected = 0;
  prefs: Prefs;
  midiAccess = new MidiAccess();
  midi = new MidiOut();
  audio = new AudioPreview();
  transport: Transport;
  follower = new TempoFollower();
  take: Take | null = null;
  status = '';
  private unlistenIn: (() => void) | null = null;
  private listeners = new Set<(c: Change) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.prefs = loadPrefs();
    this.patch = defaultPatch();
    this.audio.enabled = this.prefs.audio;
    this.audio.volume = this.prefs.volume;
    this.midi.enabled = this.prefs.midiEnabled;
    this.midi.clockOut = this.prefs.clockOut;
    this.transport = new Transport(this.patch, null, this.midi, this.audio);
    this.transport.onStateChange = () => this.changed('transport');
    this.transport.onFinished = () => this.say('End of the scans (LOOP is off).');
    this.follower.onTempo = (bpm) => {
      this.transport.setBpm(bpm);
      this.changed('patch');
    };
    this.follower.onStart = () => void this.play();
    this.follower.onContinue = () => void this.play();
    this.follower.onStop = () => this.stop();
    this.midiAccess.onChange(() => this.reconnectMidi());
  }

  on(f: (c: Change) => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  changed(c: Change): void {
    if (c === 'patch') {
      this.audio.sounds = this.patch.regions.map((r) => r.sound);
      this.audio.levels = this.patch.regions.map((r) => r.level);
      this.audio.applyLevels();
    }
    for (const f of this.listeners) f(c);
    if (c === 'patch' || c === 'image') this.scheduleAutosave();
    if (c === 'prefs' || c === 'midi') savePrefs(this.prefs);
  }

  say(msg: string): void {
    this.status = msg;
    this.changed('status');
  }

  // ---------------------------------------------------------------- start-up

  async init(): Promise<void> {
    const saved = loadAutosave();
    let ok = false;
    if (saved) {
      try {
        const { patch } = parsePatch(saved);
        await this.usePatch(patch);
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (!ok) await this.applyFactory('picture-music', false);
    this.audio.sounds = this.patch.regions.map((r) => r.sound);
    if (this.prefs.midiOut || this.prefs.clockIn) void this.enableMidi();
  }

  // ---------------------------------------------------------------- picture

  setSource(src: Source | null): void {
    this.source = src;
    this.reanalyse();
    this.changed('image');
  }

  reanalyse(): void {
    const s = this.source;
    this.analysis = s ? analyse(s.data, s.w, s.h, this.patch.analysisSize) : null;
    this.transport.setAnalysis(this.analysis);
    if (this.analysis && this.analysis.palette.length === 1 && this.analysis.edge.every((e) => e === 0)) this.say('This picture is one flat colour: every region will hear the same thing.');
  }

  setAnalysisSize(size: number): void {
    this.patch.analysisSize = size;
    this.reanalyse();
    this.changed('image');
    this.changed('patch');
  }

  async loadImageFile(file: File): Promise<boolean> {
    try {
      this.say(`Reading “${file.name}”…`);
      const src = await sourceFromFile(file);
      this.setSource(src);
      this.patch.image = { kind: 'none' }; // set when saving (embedded)
      const scaled = src.originalW !== src.w ? ` (kept at ${src.w}×${src.h})` : '';
      const gif = /\.gif$/i.test(file.name) || file.type === 'image/gif' ? ' GIF: the first frame plays.' : '';
      this.say(`Loaded “${file.name}”, ${src.originalW}×${src.originalH}${scaled}.${gif}`);
      this.changed('patch');
      return true;
    } catch (e) {
      this.say(e instanceof PictureError ? e.message : `Could not load “${file.name}”.`);
      return false;
    }
  }

  loadDemo(id: string): void {
    const src = sourceFromDemo(id);
    if (!src) return;
    this.patch.image = { kind: 'demo', id };
    this.setSource(src);
    this.say(`Demo picture: ${demoById(id)?.name} (${demoById(id)?.about}).`);
    this.changed('patch');
  }

  clearImage(): void {
    this.patch.image = { kind: 'none' };
    this.setSource(null);
    this.say('Picture cleared: the scans run silently until a picture is loaded.');
    this.changed('patch');
  }

  // ---------------------------------------------------------------- patches

  /** Use a patch (from a file, the autosave or the factory) with its picture. */
  async usePatch(p: Patch): Promise<string[]> {
    const warnings: string[] = [];
    const wasPlaying = this.transport.state === 'playing';
    if (wasPlaying) this.transport.stop();
    this.patch = p;
    this.transport.setPatch(p);
    let src: Source | null = null;
    try {
      src = await sourceFromRef(p.image);
      if (!src && p.image.kind === 'demo') warnings.push(`The demo picture “${p.image.id}” does not exist in this version.`);
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : 'The picture could not be read.');
    }
    this.selected = 0;
    this.setSource(src);
    this.audio.sounds = p.regions.map((r) => r.sound);
    this.audio.levels = p.regions.map((r) => r.level);
    this.audio.applyLevels();
    this.changed('patch');
    this.changed('select');
    if (wasPlaying) void this.play();
    return warnings;
  }

  async openPatchText(text: string, name = 'patch'): Promise<boolean> {
    try {
      const { patch, warnings } = parsePatch(text);
      const w2 = await this.usePatch(patch);
      const all = [...warnings, ...w2];
      this.say(all.length ? `Opened “${patch.name}”. ${all.join(' ')}` : `Opened “${patch.name}”.`);
      return true;
    } catch (e) {
      this.say(`Could not open “${name}”: ${e instanceof Error ? e.message : 'unknown error'}`);
      return false;
    }
  }

  /** The patch as a file, picture included. */
  async patchText(): Promise<string> {
    const p = clonePatch(this.patch);
    p.image = await refFromSource(this.source);
    const text = serialisePatch(p);
    if (text.length > LARGE_PATCH) this.say(`The patch is large (${(text.length / 1048576).toFixed(1)} MB) because it carries its picture.`);
    return text;
  }

  newPatch(): void {
    const p = defaultPatch();
    p.image = this.patch.image;
    p.analysisSize = this.patch.analysisSize;
    this.patch = p;
    this.transport.setPatch(p);
    this.reanalyse();
    this.audio.sounds = p.regions.map((r) => r.sound);
    this.say('New patch (the picture is kept).');
    this.changed('patch');
  }

  async applyFactory(id: string, announce = true): Promise<void> {
    const f = factoryById(id);
    if (!f) return;
    await this.usePatch(f.make());
    if (announce) this.say(`${f.name}: ${f.about}.`);
  }

  private scheduleAutosave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.patchText().then((t) => {
        if (!saveAutosave(t)) {
          // too big for local storage: keep the settings without the picture
          const p = clonePatch(this.patch);
          if (this.source?.demo) p.image = { kind: 'demo', id: this.source.demo };
          else p.image = { kind: 'none' };
          saveAutosave(serialisePatch(p));
        }
      });
    }, 800);
  }

  // ---------------------------------------------------------------- regions

  setLayout(l: Layout): void {
    const rects = layoutRects(l);
    this.patch.regions.forEach((r, i) => applyRect(r, rects[i]!));
    this.changed('patch');
  }

  select(i: number): void {
    this.selected = Math.max(0, Math.min(this.patch.regions.length - 1, i));
    this.changed('select');
  }

  /** Copy the selected region's settings (not its place, channel or switches) to the others. */
  copyRegionToAll(): void {
    const src = this.patch.regions[this.selected]!;
    this.patch.regions.forEach((r, i) => {
      if (i === this.selected) return;
      const keep = { x: r.x, y: r.y, w: r.w, h: r.h, channel: r.channel, enabled: r.enabled, mute: r.mute, solo: r.solo };
      Object.assign(r, JSON.parse(JSON.stringify(src)), keep);
    });
    this.audio.sounds = this.patch.regions.map((r) => r.sound);
    this.changed('patch');
  }

  // ---------------------------------------------------------------- seeds and randomness

  setSeedText(text: string): void {
    const t = text.trim() || String(this.patch.seed);
    this.patch.seed = seedFromText(t);
    this.patch.seedText = t;
    this.changed('patch');
  }

  /** A new variation: a new seed (a dice name), same settings. */
  newVariation(): void {
    this.setSeedText(diceName());
    this.say(`New variation: seed “${this.patch.seedText}”.`);
  }

  randomise(wild = false): void {
    const seed = freshSeed();
    randomisePatch(this.patch, seed, this.prefs.locks, wild);
    this.audio.sounds = this.patch.regions.map((r) => r.sound);
    const locked = Object.entries(this.prefs.locks).filter(([, v]) => v).length;
    this.say(`${wild ? 'WILDCARD' : 'Randomised'} (${seed})${locked ? `, ${locked} locked` : ''}.`);
    this.changed('patch');
  }

  // ---------------------------------------------------------------- transport

  async play(): Promise<void> {
    if (this.prefs.audio) await this.audio.unlock();
    this.transport.play();
  }

  stop(): void {
    this.transport.stop();
  }

  togglePlay(): void {
    if (this.transport.state === 'playing') this.stop();
    else void this.play();
  }

  async pauseResume(): Promise<void> {
    if (this.transport.state === 'playing') this.transport.pause();
    else if (this.transport.state === 'paused') {
      if (this.prefs.audio) await this.audio.unlock();
      this.transport.resume();
    } else await this.play();
  }

  setBpm(bpm: number): void {
    this.transport.setBpm(bpm);
    this.changed('patch');
  }

  panic(): void {
    this.midi.panic();
    this.audio.stopAll();
    this.say('Panic: every note off on all 16 channels.');
  }

  toggleRecord(): void {
    if (this.transport.recording) {
      this.take = this.transport.stopRecording();
      const notes = this.take?.events.filter((e) => e.type === 'on').length ?? 0;
      this.say(`Recording stopped: ${notes} notes captured. Export it from File ▸ Export Recording.`);
    } else {
      this.transport.startRecording();
      this.say('Recording what plays (live changes included)…');
    }
    this.changed('take');
  }

  // ---------------------------------------------------------------- export

  /** A Standard MIDI File of `bars` bars of the current configuration, from the start. */
  exportMidi(bars: number): Uint8Array {
    const p = clonePatch(this.patch);
    const ticks = Math.max(1, Math.round(bars)) * BEATS_PER_BAR * PPQ;
    const events = renderPerformance(p, this.analysis, ticks);
    const tracks = tracksFromEvents(
      events,
      p.regions.map((r, i) => ({ name: `Region ${i + 1} ${MODE_LABEL[r.mode]}`, channel: r.channel, include: r.enabled })),
      ticks,
    );
    return writeSmf({ ppq: PPQ, name: `PICTURESCUE ${p.name} (seed ${p.seedText})`, tempo: [{ tick: 0, bpm: p.bpm }], beatsPerBar: BEATS_PER_BAR, tracks: tracks.filter((_, i) => p.regions[i]!.enabled), length: ticks });
  }

  exportTake(): Uint8Array | null {
    const t = this.take;
    if (!t) return null;
    const tracks = tracksFromEvents(
      t.events,
      this.patch.regions.map((r, i) => ({ name: `Region ${i + 1}`, channel: r.channel, include: true })),
      t.length,
    );
    return writeSmf({ ppq: PPQ, name: `PICTURESCUE recording`, tempo: t.tempo, beatsPerBar: BEATS_PER_BAR, tracks: tracks.filter((tr) => tr.events.length), length: t.length });
  }

  // ---------------------------------------------------------------- MIDI

  async enableMidi(): Promise<boolean> {
    const ok = await this.midiAccess.request();
    if (!ok) {
      this.say(this.midiAccess.supported ? 'MIDI access was refused: the internal sounds still play.' : 'This browser has no Web MIDI: the internal sounds still play. (Chrome, Edge, Opera and Firefox support MIDI.)');
      this.changed('midi');
      return false;
    }
    this.reconnectMidi();
    return true;
  }

  /** (Re)connect the chosen ports, after a choice or a device appearing or leaving. */
  reconnectMidi(): void {
    const out = this.prefs.midiOut ? this.midiAccess.output(this.prefs.midiOut) : null;
    const before = this.midi.portName;
    this.midi.setPort(out);
    if (this.prefs.midiOut && !out && before) this.say(`MIDI output “${before}” disconnected.`);
    this.unlistenIn?.();
    this.unlistenIn = null;
    const input = this.prefs.clockIn && this.prefs.midiIn ? this.midiAccess.input(this.prefs.midiIn) : null;
    this.follower.enable(!!input);
    if (input) this.unlistenIn = input.listen((bytes, t) => this.follower.receive(bytes[0]!, t));
    this.changed('midi');
  }

  selectOutput(id: string): void {
    this.prefs.midiOut = id;
    this.reconnectMidi();
    this.changed('prefs');
  }

  selectInput(id: string): void {
    this.prefs.midiIn = id;
    this.reconnectMidi();
    this.changed('prefs');
  }
}
