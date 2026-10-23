/**
 * Following an external MIDI clock, tempo-following (as emmm does): the tempo is estimated
 * from the spacing of incoming clock pulses (F8, 24 per quarter note) with a trimmed mean, and
 * Start / Continue / Stop (FA / FB / FC) drive the transport. PICTURESCUE's own scheduler keeps
 * running on that tempo, so a missing pulse or jitter never stalls the music. Implements
 * Core's `ClockFollower` contract.
 */
import type { ClockFollower } from '@slopfactory/core/midi';

export class TempoFollower implements ClockFollower {
  status: ClockFollower['status'] = 'off';
  bpm = 0;
  private times: number[] = [];
  private lastPulse = -Infinity;
  /** called for Start, Continue and Stop, and when a new tempo estimate is ready */
  onStart: (() => void) | null = null;
  onContinue: (() => void) | null = null;
  onStop: (() => void) | null = null;
  onTempo: ((bpm: number) => void) | null = null;

  /** No pulse for this long: the clock is lost. */
  static LOSS_MS = 600;

  enable(on: boolean): void {
    this.status = on ? 'waiting' : 'off';
    this.times = [];
    this.bpm = 0;
  }

  receive(status: number, time: number): void {
    if (this.status === 'off') return;
    if (status === 0xf8) {
      if (time - this.lastPulse > TempoFollower.LOSS_MS) this.times = [];
      this.lastPulse = time;
      this.times.push(time);
      if (this.times.length > 49) this.times.shift();
      if (this.times.length >= 7) {
        const gaps: number[] = [];
        for (let i = 1; i < this.times.length; i++) gaps.push(this.times[i]! - this.times[i - 1]!);
        gaps.sort((a, b) => a - b);
        const k = Math.floor(gaps.length / 5);
        const mid = gaps.slice(k, gaps.length - k);
        const mean = mid.reduce((a, b) => a + b, 0) / mid.length;
        const bpm = Math.round((60000 / (mean * 24)) * 10) / 10;
        if (bpm >= 20 && bpm <= 300 && Math.abs(bpm - this.bpm) >= 0.2) {
          this.bpm = bpm;
          this.onTempo?.(bpm);
        }
        if (this.status === 'waiting' || this.status === 'lost') this.status = 'detected';
      }
    } else if (status === 0xfa) {
      this.status = 'running';
      this.onStart?.();
    } else if (status === 0xfb) {
      this.status = 'running';
      this.onContinue?.();
    } else if (status === 0xfc) {
      this.status = 'stopped';
      this.onStop?.();
    }
  }

  /** Call regularly: notices a clock that has gone away. */
  check(now: number): void {
    if ((this.status === 'detected' || this.status === 'running') && now - this.lastPulse > TempoFollower.LOSS_MS) this.status = 'lost';
  }
}
