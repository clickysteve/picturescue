/**
 * Note safety on a MIDI channel shared by several notes (two regions on one channel, a
 * ratchet over a held note). MIDI knows only "channel + note number", so a note-off for one
 * note would silence another note of the same number. The gate counts holders per channel
 * and note:
 *
 *   - a note-on while the note already sounds: re-struck (off then on), and both are holders;
 *     struck at the very same moment as the sounding note, it only joins the holders (an off
 *     and on at one instant would be a zero-length note, in an order no file can keep)
 *   - a note-off: sent only when its last holder lets go
 *   - `releaseAll`: an off for every sounding note (stop, panic, device switch)
 *
 * Used by the live MIDI output and by the MIDI file writer, so both behave the same.
 * Pure: it returns the messages to send and never touches a device.
 */

export interface GateMsg {
  kind: 'on' | 'off';
  channel: number;
  note: number;
  velocity: number;
}

export class NoteGate {
  private holders = new Map<number, Set<number>>();
  private struck = new Map<number, number>();

  private key(channel: number, note: number): number {
    return ((channel - 1) & 15) * 128 + (note & 127);
  }

  on(id: number, channel: number, note: number, velocity: number, time = NaN): GateMsg[] {
    const k = this.key(channel, note);
    const set = this.holders.get(k);
    const out: GateMsg[] = [];
    if (set && set.size) {
      if (this.struck.get(k) === time) {
        set.add(id);
        return out;
      }
      out.push({ kind: 'off', channel, note, velocity: 0 });
    }
    if (set) set.add(id);
    else this.holders.set(k, new Set([id]));
    this.struck.set(k, time);
    out.push({ kind: 'on', channel, note, velocity });
    return out;
  }

  off(id: number, channel: number, note: number): GateMsg[] {
    const k = this.key(channel, note);
    const set = this.holders.get(k);
    if (!set || !set.has(id)) return [];
    set.delete(id);
    if (set.size) return [];
    this.holders.delete(k);
    this.struck.delete(k);
    return [{ kind: 'off', channel, note, velocity: 0 }];
  }

  releaseAll(): GateMsg[] {
    const out: GateMsg[] = [];
    for (const k of [...this.holders.keys()].sort((a, b) => a - b)) out.push({ kind: 'off', channel: Math.floor(k / 128) + 1, note: k % 128, velocity: 0 });
    this.holders.clear();
    this.struck.clear();
    return out;
  }

  get sounding(): number {
    return this.holders.size;
  }
}
