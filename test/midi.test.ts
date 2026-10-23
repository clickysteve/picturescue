import { describe, expect, it } from 'vitest';
import type { MidiOutputPort } from '@slopfactory/core/midi';
import { analyse } from '../src/engine/analysis';
import { demoPixels } from '../src/engine/demos';
import { NoteGate } from '../src/engine/notegate';
import { renderPerformance, type PerfEvent } from '../src/engine/performance';
import { readSmf, tracksFromEvents, writeSmf } from '../src/engine/smf';
import { defaultPatch, PPQ } from '../src/engine/types';
import { MidiOut } from '../src/midi/output';
import { TempoFollower } from '../src/midi/clockIn';
import { Transport, type Ticker } from '../src/app/transport';
import { stripes } from './helpers';

/** A MIDI port that records what it is sent. */
export class FakePort implements MidiOutputPort {
  id = 'fake';
  name = 'Fake Synth';
  sent: { bytes: number[]; t: number }[] = [];
  cleared = 0;
  send(bytes: number[], t = 0): void {
    this.sent.push({ bytes, t });
  }
  clear(): void {
    this.cleared++;
  }
}

/** Check a stream of MIDI messages: no note struck while it sounds, every note ended. */
function checkStream(sent: { bytes: number[]; t: number }[]): { ons: number; offs: number } {
  const sounding = new Set<string>();
  let ons = 0;
  let offs = 0;
  for (const m of [...sent].sort((a, b) => a.t - b.t)) {
    const st = m.bytes[0]! & 0xf0;
    const k = `${m.bytes[0]! & 15}:${m.bytes[1]}`;
    if (st === 0x90 && m.bytes[2]! > 0) {
      expect(sounding.has(k), `note ${k} struck while sounding`).toBe(false);
      sounding.add(k);
      ons++;
    } else if (st === 0x80 || (st === 0x90 && m.bytes[2] === 0)) {
      sounding.delete(k);
      offs++;
    }
  }
  expect([...sounding], 'stuck notes').toEqual([]);
  return { ons, offs };
}

describe('NoteGate', () => {
  it('re-strikes a sounding note and sends the off only when the last holder lets go', () => {
    const g = new NoteGate();
    expect(g.on(1, 1, 60, 100)).toEqual([{ kind: 'on', channel: 1, note: 60, velocity: 100 }]);
    expect(g.on(2, 1, 60, 90)).toEqual([
      { kind: 'off', channel: 1, note: 60, velocity: 0 },
      { kind: 'on', channel: 1, note: 60, velocity: 90 },
    ]);
    expect(g.off(1, 1, 60)).toEqual([]);
    expect(g.off(2, 1, 60)).toEqual([{ kind: 'off', channel: 1, note: 60, velocity: 0 }]);
    expect(g.off(2, 1, 60)).toEqual([]);
    // channels are separate
    g.on(3, 1, 60, 1);
    g.on(4, 2, 60, 1);
    expect(g.releaseAll()).toEqual([
      { kind: 'off', channel: 1, note: 60, velocity: 0 },
      { kind: 'off', channel: 2, note: 60, velocity: 0 },
    ]);
    expect(g.sounding).toBe(0);
    // struck again at the very same moment: it joins the holders without a zero-length note
    expect(g.on(5, 1, 62, 100, 10)).toHaveLength(1);
    expect(g.on(6, 1, 62, 100, 10)).toEqual([]);
    expect(g.off(5, 1, 62)).toEqual([]);
    expect(g.off(6, 1, 62)).toHaveLength(1);
  });
});

describe('MidiOut', () => {
  it('stamps emergency offs after everything already queued', () => {
    const port = new FakePort();
    const out = new MidiOut();
    out.setPort(port, 0);
    out.noteOn(1, 3, 64, 100, 500); // queued for later
    const t = out.releaseAll(100);
    expect(t).toBeGreaterThan(500);
    const off = port.sent.find((m) => m.bytes[0] === 0x82)!;
    expect(off.t).toBeGreaterThan(500);
    checkStream(port.sent);
  });

  it('ends every note on the old device when switching', () => {
    const a = new FakePort();
    const b = new FakePort();
    b.id = 'other';
    const out = new MidiOut();
    out.setPort(a, 0);
    out.noteOn(1, 1, 60, 100, 10);
    out.setPort(b, 20);
    expect(a.sent.some((m) => m.bytes[0] === 0x80 && m.bytes[1] === 60)).toBe(true);
    expect(b.sent.length).toBe(0);
  });

  it('panic sends All Notes Off, All Sound Off and Sustain Off on 16 channels', () => {
    const port = new FakePort();
    const out = new MidiOut();
    out.setPort(port, 0);
    out.panic(0);
    for (let ch = 0; ch < 16; ch++) {
      for (const cc of [64, 120, 123]) expect(port.sent.some((m) => m.bytes[0] === (0xb0 | ch) && m.bytes[1] === cc)).toBe(true);
    }
  });

  it('sends clock only when clock out is on', () => {
    const port = new FakePort();
    const out = new MidiOut();
    out.setPort(port, 0);
    out.realtime(0xf8, 1);
    expect(port.sent.length).toBe(0);
    out.clockOut = true;
    out.realtime(0xf8, 1);
    expect(port.sent).toEqual([{ bytes: [0xf8], t: 1 }]);
  });
});

describe('Standard MIDI File export', () => {
  const patch = defaultPatch();
  const px = demoPixels('st-lowres')!;
  const an = analyse(px.data, px.w, px.h, 320);
  const ticks = 8 * 4 * PPQ;
  const events = renderPerformance(patch, an, ticks);
  const tracks = tracksFromEvents(
    events,
    patch.regions.map((r, i) => ({ name: `Region ${i + 1}`, channel: r.channel, include: true })),
    ticks,
  );
  const bytes = writeSmf({ ppq: PPQ, name: 'test', tempo: [{ tick: 0, bpm: 112 }], tracks, length: ticks });
  const smf = readSmf(bytes);

  it('writes format 1 with a tempo track and one track per region at 960 PPQ', () => {
    expect(smf.format).toBe(1);
    expect(smf.ppq).toBe(960);
    expect(smf.tracks.length).toBe(5);
    const tempo = smf.tracks[0]!.find((e) => e.meta?.type === 0x51)!;
    const us = (tempo.meta!.data[0]! << 16) | (tempo.meta!.data[1]! << 8) | tempo.meta!.data[2]!;
    expect(Math.round(60_000_000 / us)).toBe(112);
    // track names
    expect(String.fromCharCode(...smf.tracks[1]!.find((e) => e.meta?.type === 0x03)!.meta!.data)).toBe('Region 1');
  });

  it('keeps note timings, channels, velocities and pairs every note', () => {
    for (let t = 1; t <= 4; t++) {
      const tr = smf.tracks[t]!;
      const notes = tr.filter((e) => (e.status & 0xf0) === 0x90 || (e.status & 0xf0) === 0x80);
      expect(notes.length).toBeGreaterThan(0);
      for (const e of notes) expect(e.status & 15).toBe(patch.regions[t - 1]!.channel - 1);
      const open = new Map<number, number>();
      for (const e of notes) {
        if ((e.status & 0xf0) === 0x90) {
          expect(open.has(e.data[0]!)).toBe(false);
          expect(e.data[1]).toBeGreaterThan(0);
          open.set(e.data[0]!, e.tick);
        } else {
          expect(open.has(e.data[0]!)).toBe(true);
          open.delete(e.data[0]!);
        }
      }
      expect(open.size).toBe(0);
      expect(notes.every((e) => e.tick <= ticks)).toBe(true);
    }
    // the file's note-ons are the performance's, at the same ticks
    const perfOns = events.filter((e): e is Extract<PerfEvent, { type: 'on' }> => e.type === 'on' && e.region === 0).map((e) => [e.tick, e.note, e.velocity]);
    const fileOns = smf.tracks[1]!.filter((e) => (e.status & 0xf0) === 0x90).map((e) => [e.tick, e.data[0], e.data[1]]);
    expect(fileOns).toEqual(perfOns);
  });

  it('writes controller events', () => {
    const p = defaultPatch();
    p.regions[0]!.ccFrom = 'brightness';
    p.regions[0]!.cc = 74;
    const ev = renderPerformance(p, stripes(), PPQ * 4);
    const tr = tracksFromEvents(ev, p.regions.map((r) => ({ name: 'r', channel: r.channel, include: true })), PPQ * 4);
    const f = readSmf(writeSmf({ ppq: PPQ, name: 'cc', tempo: [{ tick: 0, bpm: 120 }], tracks: tr, length: PPQ * 4 }));
    expect(f.tracks[1]!.some((e) => (e.status & 0xf0) === 0xb0 && e.data[0] === 74)).toBe(true);
  });

  it('never lets two regions on one channel cut each other short', () => {
    const p = defaultPatch();
    p.regions.forEach((r) => {
      r.channel = 1;
      r.low = 60;
      r.high = 62;
      r.gate = 3;
      r.repeat = 'retrigger';
    });
    const ev = renderPerformance(p, stripes(), PPQ * 8);
    const tr = tracksFromEvents(ev, p.regions.map((r) => ({ name: 'r', channel: 1, include: true })), PPQ * 8);
    // merged as a sequencer would: by time, offs first at the same time
    const all = tr.flatMap((t) => t.events).sort((a, b) => a.tick - b.tick || (a.kind === 'off' ? 0 : 1) - (b.kind === 'off' ? 0 : 1));
    const sounding = new Set<number>();
    for (const e of all) {
      if (e.kind === 'on') {
        expect(sounding.has(e.note)).toBe(false);
        sounding.add(e.note);
      } else if (e.kind === 'off') sounding.delete(e.note);
    }
    expect(sounding.size).toBe(0);
  });
});

/** A clock and ticker the test drives by hand. */
function rig() {
  const port = new FakePort();
  const midi = new MidiOut();
  midi.setPort(port, 0);
  let t = 1000;
  let tickFn: (() => void) | null = null;
  const ticker: Ticker = { start: (f) => (tickFn = f), stop: () => (tickFn = null) };
  const px = demoPixels('city-lights')!;
  const an = analyse(px.data, px.w, px.h, 320);
  const patch = defaultPatch();
  patch.bpm = 120;
  const tr = new Transport(patch, an, midi, null, () => t, ticker);
  const advance = (ms: number, step = 25) => {
    for (let k = 0; k < ms; k += step) {
      t += step;
      tickFn?.();
    }
  };
  return { port, midi, tr, advance, patch, now: () => t, setNow: (v: number) => (t = v) };
}

describe('Transport', () => {
  it('stops mid-lookahead without leaving a queued note hanging', () => {
    for (const stopAfter of [37, 100, 333, 1010, 2222]) {
      const { port, tr, advance } = rig();
      tr.play();
      advance(stopAfter, 25);
      tr.stop();
      checkStream(port.sent);
      tr.play();
      advance(400);
      tr.pause();
      checkStream(port.sent);
      tr.resume();
      advance(300);
      tr.restartScans();
      advance(300);
      tr.stop();
      checkStream(port.sent);
    }
  });

  it('plays notes on time and leaves no note sounding after stop', () => {
    const { port, tr, advance } = rig();
    tr.play();
    advance(4000);
    expect(tr.state).toBe('playing');
    tr.stop();
    const { ons, offs } = checkStream(port.sent);
    expect(ons).toBeGreaterThan(10);
    expect(offs).toBeGreaterThanOrEqual(ons);
    expect(tr.state).toBe('stopped');
  });

  it('schedules ahead by at most the lookahead, never behind', () => {
    const { port, tr, advance, now } = rig();
    tr.play();
    for (let i = 0; i < 40; i++) {
      const before = port.sent.length;
      advance(25);
      for (const m of port.sent.slice(before)) {
        expect(m.t).toBeGreaterThanOrEqual(now() - 1);
        expect(m.t).toBeLessThanOrEqual(now() + 160);
      }
    }
    tr.stop();
  });

  it('matches the export: live notes are the rendered performance', () => {
    const { port, tr, advance, patch } = rig();
    tr.play();
    advance(4000);
    tr.stop();
    const sentOns = port.sent.filter((m) => (m.bytes[0]! & 0xf0) === 0x90).length;
    const px = demoPixels('city-lights')!;
    const an = analyse(px.data, px.w, px.h, 320);
    const rendered = renderPerformance(patch, an, Math.round(4.1 * 2 * PPQ)).filter((e) => e.type === 'on').length;
    // the live run covers about four seconds (8 beats); allow the lookahead and re-strikes
    expect(Math.abs(sentOns - rendered)).toBeLessThan(rendered * 0.25 + 4);
  });

  it('changes tempo without repeating or losing events', () => {
    const { port, tr, advance } = rig();
    tr.play();
    advance(1000);
    tr.setBpm(180);
    advance(1000);
    tr.setBpm(60);
    advance(1000);
    tr.stop();
    checkStream(port.sent);
    // message times only move forward (per note-on order)
    const ons = port.sent.filter((m) => (m.bytes[0]! & 0xf0) === 0x90);
    for (let i = 1; i < ons.length; i++) expect(ons[i]!.t).toBeGreaterThanOrEqual(ons[i - 1]!.t);
  });

  it('pauses and continues from the same place', () => {
    const { port, tr, advance } = rig();
    tr.play();
    advance(1000);
    tr.pause();
    const at = tr.perf.now;
    expect(tr.state).toBe('paused');
    advance(2000);
    expect(tr.perf.now).toBe(at);
    tr.resume();
    advance(500);
    expect(tr.perf.now).toBeGreaterThan(at);
    tr.stop();
    checkStream(port.sent);
  });

  it('skips the time a frozen page lost instead of rushing through it', () => {
    const { port, tr, advance, now, setNow } = rig();
    tr.play();
    advance(500);
    const before = port.sent.length;
    setNow(now() + 10_000); // ten seconds frozen
    advance(25);
    const burst = port.sent.length - before;
    expect(burst).toBeLessThan(40);
    tr.stop();
    checkStream(port.sent);
  });

  it('sends MIDI clock: Start, 24 pulses per beat, Stop', () => {
    const { port, tr, advance, midi } = rig();
    midi.clockOut = true;
    tr.play();
    advance(2000); // 4 beats at 120 BPM (+ lookahead)
    tr.stop();
    expect(port.sent.some((m) => m.bytes[0] === 0xfa)).toBe(true);
    expect(port.sent.some((m) => m.bytes[0] === 0xfc)).toBe(true);
    const pulses = port.sent.filter((m) => m.bytes[0] === 0xf8);
    expect(pulses.length).toBeGreaterThanOrEqual(4 * 24);
    expect(pulses.length).toBeLessThanOrEqual(4 * 24 + 12);
    for (let i = 1; i < pulses.length; i++) expect(pulses[i]!.t - pulses[i - 1]!.t).toBeCloseTo(500 / 24, 5);
  });

  it('records what plays and exports it', () => {
    const { tr, advance } = rig();
    tr.play();
    advance(500);
    tr.startRecording();
    advance(1500);
    tr.setBpm(100);
    advance(500);
    const take = tr.stopRecording()!;
    tr.stop();
    expect(take.events.filter((e) => e.type === 'on').length).toBeGreaterThan(3);
    expect(take.tempo).toEqual([
      { tick: 0, bpm: 120 },
      expect.objectContaining({ bpm: 100 }),
    ]);
    expect(take.events.every((e) => e.tick >= 0)).toBe(true);
    const tracks = tracksFromEvents(take.events, [0, 1, 2, 3].map((i) => ({ name: `r${i}`, channel: i + 1, include: true })), take.length);
    const f = readSmf(writeSmf({ ppq: PPQ, name: 'take', tempo: take.tempo, tracks, length: take.length }));
    expect(f.tracks[0]!.filter((e) => e.meta?.type === 0x51).length).toBe(2);
  });

  it('stops by itself when LOOP is off and the scans are done', async () => {
    const { tr, advance, patch } = rig();
    patch.loop = false;
    patch.regions.forEach((r) => {
      r.cols = 2;
      r.rows = 1;
      r.rate = 2;
    });
    let finished = false;
    tr.onFinished = () => (finished = true);
    tr.play();
    advance(2000);
    await new Promise((r) => setTimeout(r, 400));
    expect(finished).toBe(true);
    expect(tr.state).toBe('stopped');
  });
});

describe('external clock (tempo following)', () => {
  it('estimates the tempo from clock pulses and follows Start / Stop', () => {
    const f = new TempoFollower();
    const seen: string[] = [];
    f.onStart = () => seen.push('start');
    f.onStop = () => seen.push('stop');
    f.enable(true);
    f.receive(0xfa, 0);
    for (let i = 0; i < 48; i++) f.receive(0xf8, i * (500 / 24) + (i % 3) * 0.3); // 120 BPM with jitter
    expect(f.bpm).toBeCloseTo(120, 0);
    f.receive(0xfc, 2000);
    expect(seen).toEqual(['start', 'stop']);
    f.check(5000);
    expect(f.status).toBe('stopped');
  });

  it('notices a lost clock', () => {
    const f = new TempoFollower();
    f.enable(true);
    for (let i = 0; i < 24; i++) f.receive(0xf8, i * 20);
    expect(f.status).toBe('detected');
    f.check(24 * 20 + 1000);
    expect(f.status).toBe('lost');
  });
});
