/**
 * The performance: PICTURESCUE's engine. It runs the four regions' scans in musical time and
 * turns what each scan sees into note-ons, note-offs and controller changes.
 *
 * It is a discrete-event simulation in integer ticks (PPQ per quarter note), independent of
 * the clock, the screen and the browser: `render(toTick)` advances it and returns every event
 * before `toTick`, in order. Live playback calls it with a short lookahead; MIDI file export
 * calls it once for the whole length. Both therefore produce exactly the same music.
 *
 * Determinism: given the same analysis, patch and seed, the event list is always the same.
 * Random decisions are stateless hashes of (seed, region, step, purpose).
 *
 * Note safety inside the engine: every note-on has exactly one note-off, carrying the channel
 * and pitch it was played with (changing a region's channel or scale never strands a note);
 * `releaseAll` ends whatever is held.
 */
import { areaFeatures, colourDistance, type Analysis, type Features } from './analysis';
import { clamp, clamp01, edgeAmount, mapPitch, mapVelocity, nearestNote, pickIndex, regionNotes, regionScale, sourceValue, transposed, velocitySource, ccSource } from './mapping';
import { hashUnit } from './rng';
import { inScale, nearestInScale, scaleById } from './scales';
import { cellAt, jumpCell, manualCell, passLength, scanPath } from './scan';
import { PPQ, stepTicks, type Patch, type RegionSettings } from './types';

export type PerfEvent =
  | { type: 'on'; tick: number; region: number; channel: number; note: number; velocity: number; id: number }
  | { type: 'off'; tick: number; region: number; channel: number; note: number; id: number }
  | { type: 'cc'; tick: number; region: number; channel: number; cc: number; value: number }
  | { type: 'step'; tick: number; region: number; step: number; cell: number; col: number; row: number; cols: number; rows: number; played: boolean; note: number; velocity: number };

interface Held {
  id: number;
  note: number;
  channel: number;
  end: number;
}

interface RegionState {
  /** base tick of the next step (before swing) */
  next: number;
  step: number;
  done: boolean;
  path: number[];
  pathKey: string;
  prev: Features | null;
  lastPitch: number;
  lastStep: number;
  smooth: number;
  lastCc: number;
  droneKey: number;
  held: Held[];
  /** delayed notes (ratchets), absolute ticks */
  pending: Pending[];
}

interface Pending {
  at: number;
  dur: number;
  note: number;
  channel: number;
  velocity: number;
}

/** One planned note of a step. */
interface Planned {
  pitch: number;
  velocity: number;
  /** length in ticks */
  dur: number;
  /** delay after the step in ticks (ratchets) */
  at: number;
}

const SALT = { density: 1, rest: 2, jump: 3, prob: 4, octave: 5, ratchet: 6, gate: 7, vel: 8, every: 9 } as const;

const freshState = (): RegionState => ({ next: 0, step: 0, done: false, path: [], pathKey: '', prev: null, lastPitch: -1, lastStep: -1e9, smooth: -1, lastCc: -1, droneKey: -1, held: [], pending: [] });

export class Performance {
  /** ticks rendered so far: everything before this has been returned */
  now = 0;
  private st: RegionState[] = [];
  private nextId = 1;

  constructor(
    public patch: Patch,
    public analysis: Analysis | null,
  ) {
    this.reset(0);
  }

  /** Back to the start of every scan at `tick` (no events; call releaseAll first when playing). */
  reset(tick = 0): void {
    this.now = tick;
    this.st = this.patch.regions.map(() => ({ ...freshState(), next: tick }));
  }

  /** Every region starts its scan again on the next beat (playing on). */
  restartScans(): PerfEvent[] {
    const beat = Math.ceil(this.now / PPQ) * PPQ;
    const out = this.releaseAll(this.now);
    this.st = this.patch.regions.map(() => ({ ...freshState(), next: beat }));
    return out;
  }

  /** Note-offs for everything held, at `tick`. */
  releaseAll(tick = this.now): PerfEvent[] {
    const out: PerfEvent[] = [];
    this.st.forEach((s, i) => {
      for (const h of s.held) out.push({ type: 'off', tick, region: i, channel: h.channel, note: h.note, id: h.id });
      s.held = [];
      s.pending = [];
    });
    return out;
  }

  /** Not looping and every enabled region has finished its pass (with nothing held). */
  get finished(): boolean {
    if (this.patch.loop) return false;
    return this.patch.regions.every((r, i) => !r.enabled || (this.st[i]!.done && !this.st[i]!.held.length && !this.st[i]!.pending.length));
  }

  /** Which regions can be heard (enabled, not muted, not silenced by another's solo). */
  audible(i: number): boolean {
    const rs = this.patch.regions;
    const r = rs[i]!;
    const solo = rs.some((x) => x.enabled && x.solo);
    return r.enabled && !r.mute && (!solo || r.solo);
  }

  /** The cell (and grid) a region is on: its last step's cell, for display. */
  position(i: number): { step: number; done: boolean } {
    const s = this.st[i]!;
    return { step: s.step, done: s.done };
  }

  private swingTime(i: number): number {
    const s = this.st[i]!;
    const r = this.patch.regions[i]!;
    const len = stepTicks(this.patch, r);
    return s.next + (s.step % 2 === 1 ? Math.round(this.patch.swing * len) : 0);
  }

  /** Advance to `to` (exclusive) and return the events, in time order. */
  render(to: number): PerfEvent[] {
    const out: PerfEvent[] = [];
    this.patch.regions.forEach((r, i) => {
      const s = this.st[i]!;
      if (!r.enabled && (s.held.length || s.pending.length)) {
        out.push(...this.endHeld(i, this.now));
        s.pending = [];
      }
      // a region switched on (or slowed down) while playing joins on its own grid, in phase
      // with the transport, rather than catching up on the steps it missed
      if (r.enabled && !s.done && this.swingTime(i) < this.now) {
        const len = stepTicks(this.patch, r);
        s.next = Math.ceil(this.now / len) * len;
        s.step += s.step % 2; // keep the swing on the odd steps
      }
    });
    for (let guard = 0; guard < 5_000_000; guard++) {
      let t = Infinity;
      this.patch.regions.forEach((r, i) => {
        const s = this.st[i]!;
        if (r.enabled && !s.done) t = Math.min(t, this.swingTime(i));
        for (const h of s.held) t = Math.min(t, h.end);
        for (const n of s.pending) t = Math.min(t, n.at);
      });
      if (!(t < to)) break;
      t = Math.max(t, this.now);
      const steps: PerfEvent[] = [];
      this.patch.regions.forEach((r, i) => {
        const s = this.st[i]!;
        // delayed notes of earlier steps (ratchets) first, then this step
        const due = s.pending.filter((n) => n.at <= t);
        if (due.length) {
          s.pending = s.pending.filter((n) => n.at > t);
          for (const n of due) steps.push(...this.strike(i, n, t, null));
        }
        if (r.enabled && !s.done && this.swingTime(i) <= t) {
          steps.push(...this.step(i, t));
          s.step++;
          s.next += stepTicks(this.patch, r);
        }
      });
      // notes that end now (after the steps, which may have tied them over)
      this.st.forEach((s, i) => {
        const ending = s.held.filter((h) => h.end <= t);
        if (!ending.length) return;
        s.held = s.held.filter((h) => h.end > t);
        for (const h of ending) out.push({ type: 'off', tick: t, region: i, channel: h.channel, note: h.note, id: h.id });
      });
      out.push(...steps);
      this.now = t;
    }
    this.now = Math.max(this.now, to);
    return out;
  }

  private endHeld(i: number, tick: number): PerfEvent[] {
    const s = this.st[i]!;
    const out: PerfEvent[] = s.held.map((h) => ({ type: 'off' as const, tick, region: i, channel: h.channel, note: h.note, id: h.id }));
    s.held = [];
    return out;
  }

  private path(i: number, r: RegionSettings): number[] {
    const s = this.st[i]!;
    const key = `${r.scan}|${r.cols}|${r.rows}|${r.reverse}|${this.patch.seed}|${i}`;
    if (s.pathKey !== key) {
      s.path = scanPath(r.scan, r.cols, r.rows, r.reverse, this.patch.seed + i * 7919);
      s.pathKey = key;
    }
    return s.path;
  }

  /** The cell a region's step visits. */
  cellFor(i: number, step: number): number {
    const r = this.patch.regions[i]!;
    if (r.scan === 'manual') return manualCell(r.cols, r.rows, r.manualX, r.manualY);
    const path = this.path(i, r);
    const len = passLength(path.length, r.length);
    let cell = cellAt(path, step, len, r.offset);
    if (r.mode === 'chaotic' && hashUnit(this.patch.seed, i, step, SALT.jump) < 0.12 + 0.2 * r.density) cell = jumpCell(r.cols, r.rows, this.patch.seed, i, step);
    return cell;
  }

  /** One step of one region at tick t. */
  private step(i: number, t: number): PerfEvent[] {
    const p = this.patch;
    const r = p.regions[i]!;
    const s = this.st[i]!;
    const out: PerfEvent[] = [];
    if (r.scan !== 'manual') {
      const len = passLength(this.path(i, r).length, r.length);
      if (s.step >= len && !p.loop) {
        s.done = true;
        return out;
      }
    }
    const cell = this.cellFor(i, s.step);
    const col = cell % r.cols;
    const row = Math.floor(cell / r.cols);
    const stepEv: PerfEvent & { type: 'step' } = { type: 'step', tick: t, region: i, step: s.step, cell, col, row, cols: r.cols, rows: r.rows, played: false, note: -1, velocity: 0 };
    const an = this.analysis;
    if (!an) {
      out.push(stepEv);
      return out;
    }
    const f = areaFeatures(an, r.x + (col * r.w) / r.cols, r.y + (row * r.h) / r.rows, r.w / r.cols, r.h / r.rows);
    const len = stepTicks(p, r);
    const planned = this.audible(i) && f.alpha >= 0.5 ? this.interpret(i, r, f, len, col) : [];
    s.prev = f;
    // controller: on change only, at the step
    const ccv = ccSource(r.ccFrom, f);
    if (ccv !== null && this.audible(i)) {
      const v = Math.round(ccv * 127);
      if (v !== s.lastCc) {
        s.lastCc = v;
        out.push({ type: 'cc', tick: t, region: i, channel: r.channel, cc: r.cc, value: v });
      }
    }
    for (const n of planned) {
      if (n.at > 0) s.pending.push({ ...n, at: t + n.at, channel: r.channel, note: transposed(r, n.pitch) });
      else out.push(...this.strike(i, { ...n, at: t, channel: r.channel, note: transposed(r, n.pitch) }, t, stepEv));
    }
    if (planned.length) {
      s.lastPitch = planned[planned.length - 1]!.pitch;
      s.lastStep = s.step;
    }
    out.unshift(stepEv);
    return out;
  }

  /** Start a note (or tie it to the same sounding note). */
  private strike(i: number, n: Pending, t: number, stepEv: (PerfEvent & { type: 'step' }) | null): PerfEvent[] {
    const r = this.patch.regions[i]!;
    const s = this.st[i]!;
    const out: PerfEvent[] = [];
    const end = t + Math.max(1, Math.round(n.dur));
    const same = s.held.find((h) => h.note === n.note && h.channel === n.channel);
    const mark = () => {
      if (!stepEv) return;
      stepEv.played = true;
      stepEv.note = n.note;
      stepEv.velocity = n.velocity;
    };
    if (same && stepEv && r.repeat === 'tie' && r.mode !== 'rhythmic') {
      // the same note again: hold it on rather than strike it again
      same.end = Math.max(same.end, end);
      mark();
      return out;
    }
    if (same) {
      // retrigger: end the sounding one first, so its note-off cannot cut the new note
      s.held = s.held.filter((h) => h !== same);
      out.push({ type: 'off', tick: t, region: i, channel: same.channel, note: same.note, id: same.id });
    }
    const id = this.nextId++;
    s.held.push({ id, note: n.note, channel: n.channel, end });
    out.push({ type: 'on', tick: t, region: i, channel: n.channel, note: n.note, velocity: n.velocity, id });
    mark();
    return out;
  }

  /** The interpretation modes: how a region turns one cell into notes. */
  private interpret(i: number, r: RegionSettings, f: Features, len: number, col: number): Planned[] {
    const p = this.patch;
    const s = this.st[i]!;
    const rand = (salt: number) => hashUnit(p.seed, i, s.step, salt);
    const notes = regionNotes(p, r);
    const { scale, root } = regionScale(p, r);
    const pal = this.analysis!.palette.length;
    const value = sourceValue(r.pitchFrom, f, pal);
    const edge = edgeAmount(f);
    const change = s.prev ? clamp01(colourDistance(f, s.prev) * 2.5) : 0;
    const salience = Math.max(edge, change, Math.abs(f.lum - (s.prev?.lum ?? f.lum)) * 2);
    const vel = (v: number) => mapVelocity(r, v);
    const velIn = velocitySource(r.velFrom, f);
    const since = s.step - s.lastStep;
    const spaced = since > r.spacing;
    const resting = rand(SALT.rest) < r.rest;
    /** density keeps the busiest steps first; a little seeded jitter keeps flat areas alive */
    const dense = (sal: number) => r.density >= 1 || sal * 0.6 + 0.4 * rand(SALT.density) >= 1 - r.density;
    const triggered = (): boolean => {
      switch (r.trigger) {
        case 'every':
          return true;
        case 'threshold':
          return f.lum > r.threshold;
        case 'edges':
          return edge > r.threshold;
        case 'change':
          return change > r.threshold;
        case 'detail':
          return rand(SALT.prob) < edge * (0.5 + r.density);
      }
    };
    const pitch = () => mapPitch(r.pitchFrom, f, notes, scale, root, pal);
    const gateTicks = r.gate * len;

    switch (r.mode) {
      case 'melodic': {
        if (!spaced || resting || !triggered() || !dense(salience)) return [];
        let n = pitch();
        if (r.repeat === 'skip' && n === s.lastPitch) return [];
        // contour: a leap wider than a fifth folds by an octave towards the last note
        if (s.lastPitch >= 0 && Math.abs(n - s.lastPitch) > 7) {
          const options = [n - 12, n, n + 12].filter((x) => notes.includes(x));
          n = options.reduce((a, b) => (Math.abs(b - s.lastPitch) < Math.abs(a - s.lastPitch) ? b : a), n);
        }
        // phrasing: the first cell of each line is accented
        const accent = col === 0 ? 0.15 : 0;
        return [{ pitch: n, velocity: vel(velIn + accent), dur: gateTicks, at: 0 }];
      }
      case 'rhythmic': {
        // visual transitions are the rhythm; pitch is a choice of four
        const strength = Math.max(edge, change);
        if (!spaced || resting || strength < r.threshold * 0.8 || !dense(strength)) return [];
        const four = [0, Math.floor(notes.length / 3), Math.floor((2 * notes.length) / 3), notes.length - 1].map((k) => notes[Math.min(notes.length - 1, k)]!);
        const n = four[pickIndex(value, 4)]!;
        const onBeat = s.step % 4 === 0 ? 0.2 : 0;
        return [{ pitch: n, velocity: vel(strength * 0.8 + onBeat), dur: Math.min(gateTicks, len * 0.5), at: 0 }];
      }
      case 'ambient': {
        // a slowly following value: notes only when it settles on a new degree
        s.smooth = s.smooth < 0 ? value : s.smooth + 0.2 * (value - s.smooth);
        const n = notes[pickIndex(s.smooth, notes.length)]!;
        const fresh = n !== s.lastPitch && since >= Math.max(3, r.spacing + 1);
        const breathe = since >= 12 && rand(SALT.prob) < r.density;
        if (resting || !(fresh || breathe) || !dense(0.5 + salience)) return [];
        return [{ pitch: n, velocity: vel(velIn * 0.7), dur: Math.max(gateTicks, 4 * len), at: 0 }];
      }
      case 'pointillist': {
        // sparse, short, scattered across octaves: saturated points sparkle
        if (since < Math.max(2, r.spacing + 1) || resting) return [];
        if (rand(SALT.prob) >= r.density * (0.25 + 0.75 * f.sat)) return [];
        const base = pitch();
        const octs = notes.filter((x) => (x - base) % 12 === 0);
        const spread = clamp01(col / Math.max(1, r.cols - 1) * 0.6 + rand(SALT.octave) * 0.4);
        let n = octs.length ? octs[pickIndex(spread, octs.length)]! : base;
        if (n === s.lastPitch) n = octs.find((x) => x !== n) ?? nearestNote(notes, n + 7);
        const v = clamp01(velIn * 0.5 + rand(SALT.vel) * 0.5);
        return [{ pitch: n, velocity: vel(v), dur: Math.min(gateTicks, len * 0.25), at: 0 }];
      }
      case 'drone': {
        // a sustained root and fifth that move only when the picture's colour moves on
        const degrees = [0, 3, 4, 5].filter((d) => d < scaleById(scale).steps.length);
        const deg = degrees[pickIndex(value, degrees.length)] ?? 0;
        const key = f.index * 16 + deg;
        const held = s.held.length > 0;
        const settle = Math.max(8, r.spacing + 1);
        if (held && (key === s.droneKey || since < settle)) {
          // keep sounding: extend the held notes past the next step
          for (const h of s.held) h.end = Math.max(h.end, this.st[i]!.next + 2 * len);
          return [];
        }
        if (resting && !held) return [];
        s.droneKey = key;
        const steps = scaleById(scale).steps;
        const low = notes[0]!;
        const rootPc = (root + steps[deg]!) % 12;
        let n = low;
        while (n % 12 !== rootPc && n < 127) n++;
        const fifth = inScale(scale, root, n + 7) ? n + 7 : nearestInScale(scale, root, n + 7);
        const v = vel(0.3 + velIn * 0.4);
        // the previous chord ends as this one starts
        for (const h of s.held) h.end = Math.min(h.end, this.st[i]!.next);
        const dur = Math.max(gateTicks, 8 * len);
        return [
          { pitch: n, velocity: v, dur, at: 0 },
          { pitch: clamp(fifth, 0, 127), velocity: Math.max(1, v - 10), dur, at: 0 },
        ];
      }
      case 'chaotic': {
        if (resting || rand(SALT.prob) >= 0.35 + 0.6 * r.density) return [];
        const v = (f.hue / 360 + f.lum * 1.618 + edge) % 1;
        let n = notes[pickIndex(v, notes.length)]!;
        const jump = rand(SALT.octave);
        if (jump < 0.15) n -= 12;
        else if (jump > 0.85) n += 12;
        const g = gateTicks * (0.15 + 0.85 * rand(SALT.gate));
        const out: Planned[] = [{ pitch: n, velocity: vel(rand(SALT.vel)), dur: g, at: 0 }];
        if (rand(SALT.ratchet) < 0.25) out.push({ pitch: nearestNote(notes, n + (jump < 0.5 ? 2 : -2)), velocity: vel(rand(SALT.vel) * 0.7), dur: len * 0.4, at: Math.round(len / 2) });
        return out;
      }
    }
  }
}

/** Render a whole performance (MIDI file export, tests): `ticks` long, every note closed. */
export function renderPerformance(patch: Patch, analysis: Analysis | null, ticks: number): PerfEvent[] {
  const perf = new Performance(patch, analysis);
  const ev = perf.render(ticks);
  ev.push(...perf.releaseAll(ticks));
  return ev;
}
