/**
 * The transport: plays the performance in real time.
 *
 * A ticker (a Web Worker timer, so a background tab is not throttled to one tick a second;
 * a plain interval where Workers are unavailable) wakes the scheduler every 25 ms. Each wake
 * renders the performance up to 120 ms ahead and sends what it returns, timestamped, to the
 * MIDI output and the audio preview. Nothing musical depends on animation frames: the screen
 * reads a queue of what is due and draws it when it is.
 *
 * Musical time is ticks; an anchor (tick, time, tempo) maps it to performance.now(). A tempo
 * change re-anchors at the rendered position, so notes already sent keep their times and
 * nothing is played twice. If the page was frozen (tab suspended, laptop asleep) the anchor
 * jumps forward instead of rushing through the missed notes.
 */
import { TimeMap } from '@slopfactory/core/events';
import type { Analysis } from '../engine/analysis';
import { Performance, type PerfEvent } from '../engine/performance';
import { PPQ, type Patch } from '../engine/types';
import type { AudioPreview } from '../audio/preview';
import type { MidiOut } from '../midi/output';

export type TransportState = 'stopped' | 'playing' | 'paused';

export interface Ticker {
  start(f: () => void): void;
  stop(): void;
}

/** A Worker-based ticker, falling back to setInterval. */
export function workerTicker(ms = 25): Ticker {
  let w: Worker | null = null;
  let id: ReturnType<typeof setInterval> | null = null;
  return {
    start(f) {
      this.stop();
      try {
        const src = `let t=null;onmessage=(e)=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}`;
        w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        w.onmessage = () => f();
        w.postMessage(ms);
      } catch {
        w = null;
        id = setInterval(f, ms);
      }
    },
    stop() {
      if (w) {
        w.postMessage(0);
        w.terminate();
        w = null;
      }
      if (id !== null) clearInterval(id);
      id = null;
    },
  };
}

export interface Visual {
  time: number;
  ev: PerfEvent;
}

/** What a recording captured: the events as played (ticks from the start) and tempo changes. */
export interface Take {
  events: PerfEvent[];
  tempo: { tick: number; bpm: number }[];
  length: number;
}

export const LOOKAHEAD_MS = 120;
const PULSE = PPQ / 24;

export class Transport {
  state: TransportState = 'stopped';
  perf: Performance;
  private anchorTick = 0;
  private anchorTime = 0;
  /** queue for the display, in time order */
  private visual: Visual[] = [];
  private nextPulse = 0;
  private rec: { start: number; events: PerfEvent[]; tempo: { tick: number; bpm: number }[] } | null = null;
  onStateChange: (() => void) | null = null;
  /** the performance ended by itself (LOOP off) */
  onFinished: (() => void) | null = null;

  constructor(
    public patch: Patch,
    analysis: Analysis | null,
    private midi: MidiOut,
    private audio: AudioPreview | null,
    private now: () => number = () => performance.now(),
    private ticker: Ticker = workerTicker(),
  ) {
    this.perf = new Performance(patch, analysis);
  }

  setAnalysis(an: Analysis | null): void {
    this.perf.analysis = an;
  }

  setPatch(p: Patch): void {
    this.patch = p;
    this.perf.patch = p;
  }

  get bpm(): number {
    return this.patch.bpm;
  }

  private msPerTick(): number {
    return 60000 / (this.patch.bpm * PPQ);
  }

  timeOf(tick: number): number {
    return this.anchorTime + (tick - this.anchorTick) * this.msPerTick();
  }

  tickAt(time: number): number {
    return this.anchorTick + (time - this.anchorTime) / this.msPerTick();
  }

  /** The tick being heard now (for bar / beat display). */
  get position(): number {
    if (this.state === 'stopped') return 0;
    if (this.state === 'paused') return this.perf.now;
    return Math.max(0, Math.min(this.perf.now, this.tickAt(this.now())));
  }

  play(): void {
    if (this.state === 'playing') return;
    if (this.state === 'paused') return this.resume();
    this.perf.reset(0);
    this.visual = [];
    const t = this.now() + 30;
    this.anchorTick = 0;
    this.anchorTime = t;
    this.nextPulse = 0;
    this.state = 'playing';
    this.midi.songPosition(0, t - 1);
    this.midi.realtime(0xfa, t);
    this.ticker.start(() => this.tick());
    this.tick();
    this.onStateChange?.();
  }

  /** Stop: every note ends (after anything queued), back to the beginning. */
  stop(): void {
    if (this.state === 'stopped') return;
    this.ticker.stop();
    const at = this.now();
    this.send(this.perf.releaseAll(this.perf.now), at);
    const t = this.midi.releaseAll(at);
    this.midi.realtime(0xfc, t);
    this.audio?.stopAll();
    this.state = 'stopped';
    this.visual = [];
    this.perf.reset(0);
    this.onStateChange?.();
  }

  /** Pause: notes end, the place is kept. */
  pause(): void {
    if (this.state !== 'playing') return;
    this.ticker.stop();
    const at = this.now();
    // nothing after the pause point plays: end the held notes where we are
    this.send(this.perf.releaseAll(this.perf.now), at);
    const t = this.midi.releaseAll(at);
    this.midi.realtime(0xfc, t);
    this.audio?.stopAll();
    this.visual = [];
    this.state = 'paused';
    this.onStateChange?.();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    const t = this.now() + 30;
    this.anchorTick = this.perf.now;
    this.anchorTime = t;
    this.nextPulse = Math.ceil(this.perf.now / PULSE) * PULSE;
    this.state = 'playing';
    this.midi.realtime(0xfb, t);
    this.ticker.start(() => this.tick());
    this.tick();
    this.onStateChange?.();
  }

  toggle(): void {
    if (this.state === 'playing') this.stop();
    else this.play();
  }

  setBpm(bpm: number): void {
    const b = Math.max(20, Math.min(300, bpm));
    if (b === this.patch.bpm) return;
    if (this.state === 'playing') {
      // re-anchor where rendering has got to: what is already sent keeps its time
      const t = this.timeOf(this.perf.now);
      this.anchorTick = this.perf.now;
      this.anchorTime = t;
    }
    this.patch.bpm = b;
    if (this.rec) this.rec.tempo.push({ tick: Math.max(0, this.perf.now - this.rec.start), bpm: b });
  }

  /** Every scan starts again on the next beat. */
  restartScans(): void {
    if (this.state !== 'playing') {
      this.perf.reset(this.state === 'paused' ? this.perf.now : 0);
      return;
    }
    this.send(this.perf.restartScans(), this.now());
  }

  /** One scheduler wake. */
  tick(): void {
    if (this.state !== 'playing') return;
    const now = this.now();
    // frozen page: skip the time that was lost instead of rushing through it
    if (this.timeOf(this.perf.now) < now - 250) {
      this.anchorTick = this.perf.now;
      this.anchorTime = now;
    }
    const target = Math.floor(this.tickAt(now + LOOKAHEAD_MS));
    if (target <= this.perf.now) return;
    const from = this.perf.now;
    const events = this.perf.render(target);
    this.sendTimed(events);
    // MIDI clock out: 24 pulses per quarter note
    if (this.nextPulse < from) this.nextPulse = Math.ceil(from / PULSE) * PULSE;
    while (this.nextPulse < target) {
      this.midi.realtime(0xf8, this.timeOf(this.nextPulse));
      this.nextPulse += PULSE;
    }
    if (this.perf.finished) {
      const end = this.timeOf(this.perf.now);
      setTimeout(() => {
        if (this.state === 'playing' && this.perf.finished) {
          this.stop();
          this.onFinished?.();
        }
      }, Math.max(0, end - this.now()));
    }
  }

  private sendTimed(events: PerfEvent[]): void {
    for (const e of events) this.deliver(e, this.timeOf(e.tick));
  }

  /** Events that must go now (stop, restart). */
  private send(events: PerfEvent[], time: number): void {
    for (const e of events) this.deliver(e, time);
  }

  private deliver(e: PerfEvent, time: number): void {
    switch (e.type) {
      case 'on':
        this.midi.noteOn(e.id, e.channel, e.note, e.velocity, time);
        this.audio?.noteOn(e.id, e.region, e.note, e.velocity, time);
        break;
      case 'off':
        this.midi.noteOff(e.id, e.channel, e.note, time);
        this.audio?.noteOff(e.id, time);
        break;
      case 'cc':
        this.midi.cc(e.channel, e.cc, e.value, time);
        break;
      case 'step':
        break;
    }
    if (this.rec && e.type !== 'step') this.rec.events.push({ ...e, tick: Math.max(0, e.tick - this.rec.start) });
    this.visual.push({ time, ev: e });
  }

  /** Display events that are due by `now`, in order (removed from the queue). */
  drainVisual(now = this.now()): Visual[] {
    let k = 0;
    while (k < this.visual.length && this.visual[k]!.time <= now) k++;
    return k ? this.visual.splice(0, k) : [];
  }

  // ---------------------------------------------------------------- recording

  get recording(): boolean {
    return !!this.rec;
  }

  startRecording(): void {
    const start = this.state === 'playing' ? Math.ceil(this.perf.now) : 0;
    this.rec = { start, events: [], tempo: [{ tick: 0, bpm: this.patch.bpm }] };
  }

  /** Finish recording: what was played, from the start of the recording. */
  stopRecording(): Take | null {
    const r = this.rec;
    this.rec = null;
    if (!r) return null;
    const length = Math.max(1, (this.state === 'stopped' ? Math.max(...r.events.map((e) => e.tick), 0) : this.perf.now - r.start) || 1);
    return { events: r.events.sort((a, b) => a.tick - b.tick), tempo: r.tempo, length };
  }

  /** Seconds of a tick count at the current tempo (display). */
  seconds(ticks: number): number {
    return new TimeMap({ ppq: PPQ, changes: [{ tick: 0, bpm: this.patch.bpm }] }).seconds(ticks);
  }
}
