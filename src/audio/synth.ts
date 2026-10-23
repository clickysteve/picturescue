/**
 * The preview sounds: five small Web Audio voices, so PICTURESCUE can be heard without a
 * synthesiser. Deliberately modest. Each implements Slop Factory Core's `Instrument`
 * interface, so Core's NotePlayer and Mixer handle polyphony, voice stealing and levels.
 *
 * Tuning: every voice's fundamental is the equal-tempered frequency of its MIDI note
 * (`midiToHz`: 440 Hz at 69, so 60 is middle C). The only deliberate departures are layers:
 * PLUCKED adds a square wave 7 cents sharp, SOFT PAD two sawtooths at ±8 cents plus a
 * triangle an octave below, BELL's carrier is frequency-modulated by an inharmonic partner
 * (its index decays to nothing, leaving the pure note), PERCUSSIVE's body starts a little
 * above the note.
 */
import { fadeOut, GainEnvelope, type Instrument, type NoteHandle, type NoteRequest } from '@slopfactory/core/audio';
import { midiToHz } from '../engine/scales';
import type { Sound } from '../engine/types';

interface Shape {
  attack: number;
  /** level after the attack, then decaying towards sustain */
  decay: number;
  sustain: number;
  release: number;
  /** peak level at full velocity */
  level: number;
  /** a note that ends by itself (seconds), however long it is held */
  maxLength?: number;
}

const SHAPES: Record<Sound, Shape> = {
  sine: { attack: 0.006, decay: 0.3, sustain: 0.7, release: 0.12, level: 0.32 },
  pluck: { attack: 0.002, decay: 0.45, sustain: 0.0, release: 0.08, level: 0.34, maxLength: 1.6 },
  pad: { attack: 0.35, decay: 0.8, sustain: 0.8, release: 1.1, level: 0.16 },
  perc: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.05, level: 0.5, maxLength: 0.4 },
  bell: { attack: 0.002, decay: 1.6, sustain: 0, release: 0.4, level: 0.22, maxLength: 3 },
};

class Voice implements NoteHandle {
  end = Infinity;
  private released = false;
  constructor(
    private amp: GainNode,
    private env: GainEnvelope,
    private sources: AudioScheduledSourceNode[],
    private shape: Shape,
    private start: number,
  ) {
    if (shape.maxLength !== undefined) this.end = start + shape.maxLength + 0.05;
    for (const s of sources) s.stop(this.end === Infinity ? start + 600 : this.end);
  }

  release(time: number): void {
    if (this.released) return;
    this.released = true;
    const t = Math.max(time, this.start + 0.002);
    if (t >= this.end) return;
    fadeOut(this.amp.gain, t, this.shape.release, this.env);
    this.finish(t + this.shape.release + 0.02);
  }

  stop(time: number, fade = 0.01): void {
    const t = Math.max(time, this.start);
    if (t >= this.end) return;
    fadeOut(this.amp.gain, t, fade, this.env);
    this.released = true;
    this.finish(t + fade + 0.01);
  }

  private finish(t: number): void {
    this.end = Math.min(this.end, t);
    for (const s of this.sources) {
      try {
        s.stop(t);
      } catch {
        /* already stopped */
      }
    }
  }
}

/** One preview sound. */
export class PreviewInstrument implements Instrument {
  constructor(public sound: Sound) {}

  start(ctx: BaseAudioContext, out: AudioNode, note: NoteRequest): NoteHandle | null {
    const sh = SHAPES[this.sound];
    const t = Math.max(note.time, ctx.currentTime);
    const f = midiToHz(note.pitch);
    const v = Math.pow(note.velocity / 127, 1.4) * sh.level;
    const amp = ctx.createGain();
    amp.gain.value = 0;
    const env = new GainEnvelope();
    amp.gain.setValueAtTime(0, t);
    env.set(t, 0);
    amp.gain.linearRampToValueAtTime(v, t + sh.attack);
    env.ramp(t + sh.attack, v);
    const sustainEnd = t + sh.attack + sh.decay;
    amp.gain.linearRampToValueAtTime(v * sh.sustain + 0.0001, sustainEnd);
    env.ramp(sustainEnd, v * sh.sustain + 0.0001);
    if (sh.maxLength !== undefined) {
      amp.gain.linearRampToValueAtTime(0, t + sh.maxLength);
      env.ramp(t + sh.maxLength, 0);
    }
    amp.connect(out);
    const sources: AudioScheduledSourceNode[] = [];
    const osc = (type: OscillatorType, freq: number, dest: AudioNode, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(dest);
      o.start(t);
      sources.push(o);
      return o;
    };
    switch (this.sound) {
      case 'sine': {
        const mix = ctx.createGain();
        mix.gain.value = 0.6;
        mix.connect(amp);
        osc('sine', f, amp);
        osc('triangle', f, mix);
        break;
      }
      case 'pluck': {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = 2;
        lp.frequency.setValueAtTime(Math.min(12000, f * 10), t);
        lp.frequency.exponentialRampToValueAtTime(Math.max(80, f * 1.2), t + 0.4);
        lp.connect(amp);
        osc('sawtooth', f, lp);
        osc('square', f, lp, 7);
        break;
      }
      case 'pad': {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.min(4000, 600 + f * 2);
        lp.connect(amp);
        osc('sawtooth', f, lp, -8);
        osc('sawtooth', f, lp, 8);
        osc('triangle', f / 2, lp);
        break;
      }
      case 'perc': {
        // a tuned drum: a sine body that starts above the note and settles ON it in 60 ms (it
        // used to keep falling to half the note's frequency, an octave flat), and a noise click
        const body = osc('sine', f, amp);
        body.frequency.setValueAtTime(f * 1.8, t);
        body.frequency.exponentialRampToValueAtTime(f, t + 0.06);
        const len = Math.floor(ctx.sampleRate * 0.03);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        let x = note.pitch * 9301 + 49297;
        for (let i = 0; i < len; i++) {
          x = (x * 9301 + 49297) % 233280;
          d[i] = (x / 233280 - 0.5) * (1 - i / len);
        }
        const n = ctx.createBufferSource();
        n.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2000;
        n.connect(hp).connect(amp);
        n.start(t);
        sources.push(n);
        break;
      }
      case 'bell': {
        // two-operator FM with a falling index
        const car = osc('sine', f, amp);
        const modGain = ctx.createGain();
        modGain.gain.setValueAtTime(f * 3, t);
        modGain.gain.exponentialRampToValueAtTime(f * 0.2, t + 1.2);
        modGain.connect(car.frequency);
        osc('sine', f * 3.5, modGain);
        break;
      }
    }
    return new Voice(amp, env, sources, sh, t);
  }
}
