/**
 * Web MIDI access: ports, hot-plugging and the chosen output and clock input.
 *
 * Slop Factory Core defines the MIDI port contracts (`MidiOutputPort`, `MidiInputPort`,
 * `MidiPortInfo` in @slopfactory/core/midi) but ships no implementation yet (see its MIDI
 * roadmap); this is PICTURESCUE's implementation of those contracts. Browsers without Web
 * MIDI (or where the user refuses access) simply report it: the instrument then plays
 * through its internal sounds only.
 */
import type { MidiInputPort, MidiOutputPort, MidiPortInfo } from '@slopfactory/core/midi';

export type MidiStatus = 'unsupported' | 'idle' | 'requesting' | 'ready' | 'denied';

/** A Web MIDI output as Core's MidiOutputPort. */
class WebOutput implements MidiOutputPort {
  constructor(private port: MIDIOutput) {}
  get id(): string {
    return this.port.id;
  }
  get name(): string {
    return this.port.name ?? 'MIDI output';
  }
  send(bytes: number[], timestamp?: number): void {
    try {
      this.port.send(bytes, timestamp);
    } catch {
      /* a port that just disappeared: nothing to do */
    }
  }
  clear(): void {
    const p = this.port as MIDIOutput & { clear?: () => void };
    try {
      p.clear?.();
    } catch {
      /* not supported */
    }
  }
}

class WebInput implements MidiInputPort {
  constructor(private port: MIDIInput) {}
  get id(): string {
    return this.port.id;
  }
  get name(): string {
    return this.port.name ?? 'MIDI input';
  }
  listen(handler: (bytes: Uint8Array, timestamp: number) => void): () => void {
    const f = (e: Event) => {
      const m = e as MIDIMessageEvent;
      if (m.data) handler(m.data, m.timeStamp);
    };
    this.port.addEventListener('midimessage', f);
    return () => this.port.removeEventListener('midimessage', f);
  }
}

export class MidiAccess {
  status: MidiStatus = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator ? 'idle' : 'unsupported';
  private access: MIDIAccess | null = null;
  private listeners = new Set<() => void>();
  error = '';

  get supported(): boolean {
    return this.status !== 'unsupported';
  }

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private changed(): void {
    for (const f of this.listeners) f();
  }

  async request(): Promise<boolean> {
    if (this.access) return true;
    if (!this.supported) return false;
    this.status = 'requesting';
    this.changed();
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.addEventListener('statechange', () => this.changed());
      this.status = 'ready';
      this.changed();
      return true;
    } catch (e) {
      this.status = 'denied';
      this.error = e instanceof Error ? e.message : String(e);
      this.changed();
      return false;
    }
  }

  outputs(): MidiPortInfo[] {
    if (!this.access) return [];
    return [...this.access.outputs.values()].map((p) => ({ id: p.id, name: p.name ?? p.id, manufacturer: p.manufacturer ?? undefined, connected: p.state === 'connected' }));
  }

  inputs(): MidiPortInfo[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((p) => ({ id: p.id, name: p.name ?? p.id, manufacturer: p.manufacturer ?? undefined, connected: p.state === 'connected' }));
  }

  output(id: string): MidiOutputPort | null {
    const p = this.access?.outputs.get(id);
    return p && p.state === 'connected' ? new WebOutput(p) : null;
  }

  input(id: string): MidiInputPort | null {
    const p = this.access?.inputs.get(id);
    return p && p.state === 'connected' ? new WebInput(p) : null;
  }
}
