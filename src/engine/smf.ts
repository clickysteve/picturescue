/**
 * Standard MIDI Files: a format-1 writer (one tempo track, one track per region) and a small
 * reader used by the tests to check what was written.
 *
 * Events are given in ticks at any resolution; the file is written at that resolution
 * (PICTURESCUE uses 960 per quarter note). Notes pass through a NoteGate per file, so a file
 * never contains overlapping notes of the same channel and number, and every note ends.
 */
import { NoteGate } from './notegate';
import type { PerfEvent } from './performance';

export interface SmfTrack {
  name: string;
  /** MIDI channel for the track's events (1..16), informational */
  channel: number;
  events: SmfEvent[];
}

export type SmfEvent = { tick: number; kind: 'on' | 'off'; channel: number; note: number; velocity: number } | { tick: number; kind: 'cc'; channel: number; cc: number; value: number };

export interface SmfSong {
  ppq: number;
  /** tempo changes (the first at tick 0) */
  tempo: { tick: number; bpm: number }[];
  name: string;
  /** time signature numerator (denominator 4) */
  beatsPerBar?: number;
  tracks: SmfTrack[];
  /** where the song ends (end-of-track markers), ticks */
  length: number;
}

function vlq(n: number): number[] {
  let v = Math.max(0, Math.round(n));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

const ascii = (s: string): number[] => Array.from(s.replace(/[^\x20-\x7e]/g, '?').slice(0, 120), (c) => c.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];

function chunk(type: string, data: number[]): number[] {
  return [...ascii(type), ...u32(data.length), ...data];
}

const ORDER = { off: 0, cc: 1, on: 2 } as const;

function trackBytes(events: { tick: number; bytes: number[]; order: number }[], end: number): number[] {
  const sorted = events.map((e, i) => ({ ...e, i })).sort((a, b) => a.tick - b.tick || a.order - b.order || a.i - b.i);
  const out: number[] = [];
  let last = 0;
  for (const e of sorted) {
    out.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  out.push(...vlq(Math.max(0, end - last)), 0xff, 0x2f, 0x00);
  return out;
}

export function writeSmf(song: SmfSong): Uint8Array {
  const tempoEvents: { tick: number; bytes: number[]; order: number }[] = [];
  tempoEvents.push({ tick: 0, bytes: [0xff, 0x03, ...vlq(ascii(song.name).length), ...ascii(song.name)], order: 0 });
  const num = song.beatsPerBar ?? 4;
  tempoEvents.push({ tick: 0, bytes: [0xff, 0x58, 0x04, num, 2, 24, 8], order: 0 });
  for (const t of song.tempo) {
    const us = Math.round(60_000_000 / Math.max(1, t.bpm));
    tempoEvents.push({ tick: Math.max(0, Math.round(t.tick)), bytes: [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255], order: 0 });
  }
  const end = Math.max(1, Math.round(song.length));
  const chunks: number[] = [...chunk('MThd', [...u16(1), ...u16(song.tracks.length + 1), ...u16(song.ppq)]), ...chunk('MTrk', trackBytes(tempoEvents, end))];
  for (const tr of song.tracks) {
    const evs: { tick: number; bytes: number[]; order: number }[] = [{ tick: 0, bytes: [0xff, 0x03, ...vlq(ascii(tr.name).length), ...ascii(tr.name)], order: -1 }];
    for (const e of tr.events) {
      const ch = (e.channel - 1) & 15;
      if (e.kind === 'cc') evs.push({ tick: e.tick, bytes: [0xb0 | ch, e.cc & 127, e.value & 127], order: ORDER.cc });
      else if (e.kind === 'on') evs.push({ tick: e.tick, bytes: [0x90 | ch, e.note & 127, Math.max(1, e.velocity & 127)], order: ORDER.on });
      else evs.push({ tick: e.tick, bytes: [0x80 | ch, e.note & 127, 0], order: ORDER.off });
    }
    chunks.push(...chunk('MTrk', trackBytes(evs, end)));
  }
  return new Uint8Array(chunks);
}

/**
 * Tracks from a performance's events: one per region, notes made safe by a NoteGate shared
 * across the file (two regions on one channel never cut each other's notes), all notes ended
 * by `end`.
 */
export function tracksFromEvents(events: PerfEvent[], regions: { name: string; channel: number; include: boolean }[], end: number): SmfTrack[] {
  const gate = new NoteGate();
  const tracks: SmfTrack[] = regions.map((r) => ({ name: r.name, channel: r.channel, events: [] }));
  const lastTrackOf = new Map<number, number>();
  for (const e of events) {
    if (e.type === 'step') continue;
    const tr = tracks[e.region];
    if (!tr || !regions[e.region]!.include) continue;
    const tick = Math.min(e.tick, end);
    if (e.type === 'cc') {
      if (e.tick < end) tr.events.push({ tick, kind: 'cc', channel: e.channel, cc: e.cc, value: e.value });
    } else if (e.type === 'on') {
      if (e.tick >= end) continue;
      for (const m of gate.on(e.id, e.channel, e.note, e.velocity, tick)) {
        const k = ((m.channel - 1) & 15) * 128 + m.note;
        const target = m.kind === 'off' ? (tracks[lastTrackOf.get(k) ?? e.region] ?? tr) : tr;
        target.events.push({ tick, kind: m.kind, channel: m.channel, note: m.note, velocity: m.velocity });
        if (m.kind === 'on') lastTrackOf.set(k, e.region);
      }
    } else {
      for (const m of gate.off(e.id, e.channel, e.note)) {
        const k = ((m.channel - 1) & 15) * 128 + m.note;
        (tracks[lastTrackOf.get(k) ?? e.region] ?? tr).events.push({ tick, kind: 'off', channel: m.channel, note: m.note, velocity: 0 });
      }
    }
  }
  for (const m of gate.releaseAll()) {
    const k = ((m.channel - 1) & 15) * 128 + m.note;
    tracks[lastTrackOf.get(k) ?? 0]!.events.push({ tick: end, kind: 'off', channel: m.channel, note: m.note, velocity: 0 });
  }
  return tracks;
}

// ---------------------------------------------------------------------------- reader (tests, round trips)

export interface ReadEvent {
  tick: number;
  status: number;
  data: number[];
  meta?: { type: number; data: number[] };
}

export interface ReadSmf {
  format: number;
  ppq: number;
  tracks: ReadEvent[][];
}

export function readSmf(bytes: Uint8Array): ReadSmf {
  let p = 0;
  const str = (n: number) => String.fromCharCode(...bytes.slice(p, p + n));
  const r32 = () => ((bytes[p++]! << 24) | (bytes[p++]! << 16) | (bytes[p++]! << 8) | bytes[p++]!) >>> 0;
  const r16 = () => (bytes[p++]! << 8) | bytes[p++]!;
  const rv = () => {
    let v = 0;
    for (;;) {
      const b = bytes[p++]!;
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
  };
  if (str(4) !== 'MThd') throw new Error('not a MIDI file');
  p += 4;
  const hlen = r32();
  const start = p;
  const format = r16();
  const ntr = r16();
  const ppq = r16();
  p = start + hlen;
  const tracks: ReadEvent[][] = [];
  for (let t = 0; t < ntr; t++) {
    if (str(4) !== 'MTrk') throw new Error('bad track');
    p += 4;
    const len = r32();
    const endP = p + len;
    let tick = 0;
    let running = 0;
    const evs: ReadEvent[] = [];
    while (p < endP) {
      tick += rv();
      let status = bytes[p]!;
      if (status & 0x80) p++;
      else status = running;
      if (status === 0xff) {
        const type = bytes[p++]!;
        const l = rv();
        evs.push({ tick, status, data: [], meta: { type, data: Array.from(bytes.slice(p, p + l)) } });
        p += l;
      } else if (status === 0xf0 || status === 0xf7) {
        const l = rv();
        p += l;
      } else {
        running = status;
        const n = (status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0 ? 1 : 2;
        evs.push({ tick, status, data: Array.from(bytes.slice(p, p + n)) });
        p += n;
      }
    }
    p = endP;
    tracks.push(evs);
  }
  return { format, ppq, tracks };
}
