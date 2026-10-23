/**
 * The internal audio preview: an AudioContext (created on the first user gesture, as browsers
 * require), Slop Factory Core's Mixer (one strip per region, master level) and NotePlayer
 * (at most 8 notes per region, oldest stolen), playing the preview sounds through a gentle
 * limiter.
 *
 * Times arrive as performance.now() milliseconds from the scheduler and are mapped onto the
 * AudioContext clock. MIDI output and the preview are independent: either can be off.
 */
import { Mixer, NotePlayer } from '@slopfactory/core/audio';
import { REGION_COUNT, type Sound } from '../engine/types';
import { PreviewInstrument } from './synth';

const VOICES = Array.from({ length: REGION_COUNT }, (_, i) => `r${i}`);

export class AudioPreview {
  ctx: AudioContext | null = null;
  private mixer: Mixer | null = null;
  private player: NotePlayer | null = null;
  private instruments = new Map<Sound, PreviewInstrument>();
  enabled = true;
  volume = 0.8;
  sounds: Sound[] = ['pluck', 'perc', 'pad', 'bell'];
  levels: number[] = [0.8, 0.8, 0.8, 0.8];
  error = '';

  get supported(): boolean {
    return typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window);
  }

  /** Create or resume the context (call from a user gesture). */
  async unlock(): Promise<boolean> {
    if (!this.supported) return false;
    try {
      if (!this.ctx) {
        const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new C({ latencyHint: 'interactive' });
        this.mixer = new Mixer(this.ctx, { voices: VOICES, fxAvailable: false, masterGain: this.volume });
        // a gentle limiter: four regions of chords never clip harshly
        const limit = this.ctx.createDynamicsCompressor();
        limit.threshold.value = -8;
        limit.knee.value = 6;
        limit.ratio.value = 12;
        limit.attack.value = 0.003;
        limit.release.value = 0.25;
        this.mixer.output.connect(limit).connect(this.ctx.destination);
        this.player = new NotePlayer(this.ctx, this.mixer, (voice) => this.instrument(this.sounds[Number(voice.slice(1))] ?? 'sine'), { maxPerVoice: 8 });
        this.applyLevels();
      }
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return this.ctx.state === 'running';
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  private instrument(s: Sound): PreviewInstrument {
    let i = this.instruments.get(s);
    if (!i) {
      i = new PreviewInstrument(s);
      this.instruments.set(s, i);
    }
    return i;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.mixer?.setMasterGain(this.volume);
  }

  applyLevels(): void {
    if (!this.mixer) return;
    VOICES.forEach((v, i) => this.mixer!.setStrip(v, { gain: this.levels[i] ?? 0.8 }));
  }

  /** performance.now() ms → context seconds (never in the past). */
  private at(ms: number): number {
    const ctx = this.ctx!;
    return Math.max(ctx.currentTime, ctx.currentTime + (ms - performance.now()) / 1000);
  }

  noteOn(id: number, region: number, note: number, velocity: number, ms: number): void {
    if (!this.enabled || !this.player || !this.running) return;
    this.player.noteOn(`n${id}`, `r${region}`, { time: this.at(ms), pitch: note, velocity });
  }

  noteOff(id: number, ms: number): void {
    if (!this.player || !this.ctx) return;
    this.player.noteOff(`n${id}`, this.at(ms));
  }

  /** Silence everything quickly (stop, panic). */
  stopAll(): void {
    if (!this.player || !this.ctx) return;
    this.player.stopAll(this.ctx.currentTime);
  }
}
