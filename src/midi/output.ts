/**
 * The note-safe MIDI output: every note PICTURESCUE plays goes through here.
 *
 * - Notes pass a NoteGate (two holders of one channel and note never cut each other short).
 * - Messages are sent ahead with timestamps (the scheduler's lookahead). The latest timestamp
 *   is remembered, so emergency note-offs (stop, panic, device switch) are stamped after
 *   everything already queued: a note-on waiting in the queue can never outlive its off.
 * - Switching device first ends every note on the old one.
 * - Panic: tracked offs, then Sustain Off, All Sound Off and All Notes Off on all 16 channels.
 */
import type { MidiOutputPort } from '@slopfactory/core/midi';
import { NoteGate } from '../engine/notegate';

export interface MidiActivity {
  kind: 'on' | 'off' | 'cc';
  channel: number;
  a: number;
  b: number;
  time: number;
}

export class MidiOut {
  private port: MidiOutputPort | null = null;
  private gate = new NoteGate();
  /** latest timestamp handed to the port */
  private lastStamp = 0;
  enabled = true;
  clockOut = false;
  /** messages sent (for the monitor / tests) */
  onSend: ((m: MidiActivity) => void) | null = null;

  get portName(): string {
    return this.port?.name ?? '';
  }

  get connected(): boolean {
    return !!this.port;
  }

  setPort(port: MidiOutputPort | null, now = performance.now()): void {
    if (this.port && this.port.id === port?.id) return;
    this.releaseAll(now);
    this.port = port;
    this.lastStamp = now;
  }

  private send(bytes: number[], time: number): void {
    if (!this.port) return;
    this.lastStamp = Math.max(this.lastStamp, time);
    this.port.send(bytes, time);
  }

  noteOn(id: number, channel: number, note: number, velocity: number, time: number): void {
    if (!this.enabled) return;
    for (const m of this.gate.on(id, channel, note, velocity)) {
      const st = (m.kind === 'on' ? 0x90 : 0x80) | ((m.channel - 1) & 15);
      this.send([st, m.note & 127, m.kind === 'on' ? Math.max(1, m.velocity) : 0], time);
      this.onSend?.({ kind: m.kind, channel: m.channel, a: m.note, b: m.velocity, time });
    }
  }

  noteOff(id: number, channel: number, note: number, time: number): void {
    for (const m of this.gate.off(id, channel, note)) {
      this.send([0x80 | ((m.channel - 1) & 15), m.note & 127, 0], time);
      this.onSend?.({ kind: 'off', channel: m.channel, a: m.note, b: 0, time });
    }
  }

  cc(channel: number, cc: number, value: number, time: number): void {
    if (!this.enabled) return;
    this.send([0xb0 | ((channel - 1) & 15), cc & 127, value & 127], time);
    this.onSend?.({ kind: 'cc', channel, a: cc, b: value, time });
  }

  /** MIDI clock and transport (only when clock output is on). */
  realtime(byte: 0xf8 | 0xfa | 0xfb | 0xfc, time: number): void {
    if (this.clockOut) this.send([byte], time);
  }

  /** Song Position Pointer (in sixteenths). */
  songPosition(sixteenths: number, time: number): void {
    if (this.clockOut) this.send([0xf2, sixteenths & 127, (sixteenths >> 7) & 127], time);
  }

  /** End every sounding note, after anything already queued. Returns the time used. */
  releaseAll(now = performance.now()): number {
    const t = Math.max(now, this.lastStamp + 1);
    for (const m of this.gate.releaseAll()) {
      this.send([0x80 | ((m.channel - 1) & 15), m.note & 127, 0], t);
      this.onSend?.({ kind: 'off', channel: m.channel, a: m.note, b: 0, time: t });
    }
    return t;
  }

  /** Panic: every note off, then the channel-mode messages on all 16 channels. */
  panic(now = performance.now()): void {
    const t = this.releaseAll(now);
    for (let ch = 0; ch < 16; ch++) {
      this.send([0xb0 | ch, 64, 0], t);
      this.send([0xb0 | ch, 120, 0], t);
      this.send([0xb0 | ch, 123, 0], t);
    }
  }

  get sounding(): number {
    return this.gate.sounding;
  }
}
