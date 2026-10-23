# PICTURESCUE architecture

A static browser application (TypeScript, Vite, no framework, no server), built the way emmm and
The Breakery are: a fixed-coordinate 1-bit "screen" scaled to the window, plain DOM and SVG
widgets, Vitest for unit tests, a Playwright browser test, GitHub Pages for hosting.

```
            ┌───────────────── engine (pure, no browser) ─────────────────┐
 picture ──▶│ analysis ──▶ regions + scan ──▶ mapping ──▶ performance      │──▶ events (ticks)
 (RGBA)     │ (measure)    (where / when)     (what)      (modes, notes)   │
            └──────────────────────────────────────────────────────────────┘
                                   │                         │
                         live ◀────┘                         └────▶ export
        transport (lookahead scheduler, Worker ticker)       smf (format-1 writer)
            │            │              │
       MIDI out     audio preview    display queue ──▶ PICTURE / ACTIVITY windows
   (note gate, clock) (Core Mixer)      (animation frames only draw)
```

## Modules

| Area | Files | Notes |
|---|---|---|
| Image decoding | `src/app/picture.ts` | The browser decodes the file once; pictures over 640 px are drawn down once; those pixels are kept. GIF: first frame. |
| Pixel analysis | `src/engine/analysis.ts` | Pure. Box-filter downsampling (our own, so browsers' scaling never changes the music), brightness, HSV hue and saturation, alpha, Sobel edges, a 16-colour ST palette (median cut, 512-colour snapping), summed-area tables for O(1) rectangle averages, analysis views. |
| Region geometry | `src/engine/regions.ts` | Normalised coordinates, presets, move / resize / hit testing. |
| Scanning | `src/engine/scan.ts` | Pure path generators for each scan mode, pass length, offset, wrapping. |
| Mapping and pitch | `src/engine/mapping.ts`, `src/engine/scales.ts` | Measurement → value → note in the global scale's range, velocity, CC; mapping presets; **the one final pitch stage** (`resolvePitch`); scale tables, quantiser, `midiToHz`. |
| Performance | `src/engine/performance.ts` | The engine: a tick-based discrete-event simulation of four regions and six interpretation modes. |
| Note safety | `src/engine/notegate.ts` | Holder counting per channel and note; shared by MIDI output and file export. |
| MIDI files | `src/engine/smf.ts` | Format-1 writer (tempo map, one track per region), a small reader for tests. |
| MIDI scheduling | `src/app/transport.ts` | Lookahead scheduler, tempo anchor, pause / resume, catch-up after a frozen page, clock out, recording. |
| MIDI I/O | `src/midi/webmidi.ts`, `src/midi/output.ts`, `src/midi/clockIn.ts` | Web MIDI access, the note-safe output, an external tempo follower. |
| Audio preview | `src/audio/synth.ts`, `src/audio/preview.ts` | Five small voices as Core `Instrument`s, Core `Mixer` and `NotePlayer`, a limiter. |
| UI state | `src/app/app.ts`, `src/app/prefs.ts` | The application: patch, picture, analysis, commands, change notifications; preferences. |
| Persistence | `src/persistence/patchfile.ts`, `src/persistence/pixels.ts` | Patch JSON, lossless picture embedding. |
| Interface | `src/ui/*`, `src/main.ts` | Windows, widgets, menus, keys, palettes, the display loop. |
| Content | `src/engine/demos.ts`, `src/engine/factory.ts`, `src/engine/randomise.ts` | Procedural demo pictures, factory presets, seeded randomisation. |

Everything under `src/engine` is pure TypeScript with no browser globals: it runs in Node, which
is how the unit tests exercise the whole image-to-MIDI path.

## Determinism

The same picture, patch and seed always give the same events.

* **Analysis** is our own arithmetic on source pixels. The only browser-dependent step is the
  original decode (and, for pictures over 640 px, one downscale at load time). Patches embed the
  kept pixels losslessly, so a reopened patch analyses exactly the same pixels.
* **Random decisions** are stateless hashes of `(seed, region, step, purpose)` (`hashUnit`), so
  one decision never shifts another. Random-walk paths come from a seeded stream per region.
  Measurements are never seeded: a seed changes rests, walks, jumps and scattering only.
* **Live equals export**: the transport and the exporter call the same `Performance.render`;
  rendering in small slices gives exactly the same event list as rendering at once (tested).
* Randomisation draws from a seed too (shown in the status line) and respects locks.

## Timing

Musical time is integer ticks at 960 per quarter note. Each region steps every
`960 / (stepsPerBeat × rate)` ticks (all integers for the offered values), with swing delaying
odd steps.

The transport wakes every 25 ms from a Web Worker timer (not throttled like main-thread timers
in background tabs) and renders 120 ms ahead. An anchor maps ticks to `performance.now()`; a
tempo change re-anchors at the rendered position, so nothing already sent moves or repeats. If the
page was frozen for longer than 250 ms the anchor jumps forward instead of rushing through the
missed notes. Animation frames only read a queue of due events to draw cursors, flashes, lanes
and the roll.

A region switched on (or slowed down) while playing joins on its own step grid, in phase with the
transport. RESTART starts every scan on the next beat.

## Note safety

* Inside the engine every note-on has exactly one note-off with the channel and pitch it was
  played with. Ties extend a held note instead of re-striking it. Retriggers end the old note
  first. Delayed notes (ratchets) are queued as events, never sent out of order.
* The **NoteGate** (MIDI out and files) counts holders per channel and note, so two regions on one
  channel never cut each other's notes; a note struck at the same instant joins its holders.
* **Stop / pause / device switch** release every held note *after the latest queued timestamp*
  (notes are sent up to 120 ms ahead; an off stamped "now" could otherwise reach the synthesiser
  before its own note-on). A new start waits for those offs. Panic adds Sustain Off, All Sound Off
  and All Notes Off on all 16 channels. Leaving the page stops and releases everything.

## The interpretation modes

| Mode | Algorithm |
|---|---|
| MELODIC | trigger and density as set; the pitch source's note; leaps wider than a fifth fold an octave towards the last note; first cell of a line accented |
| RHYTHMIC | triggers only on visual transitions (max of edge and colour change) above the threshold; four pitches only; accents on the beat; at most half-step notes; always re-strikes |
| AMBIENT | an exponential moving average of the pitch value; a note only when it settles on a new degree (or after a long breath); long, soft notes |
| POINTILLIST | sparse probability weighted by saturation; octave chosen across the region and by seed; never the same pitch twice in a row; very short notes; wide velocities |
| DRONE | root and fifth on degrees I, IV, V or VI; held (extended step by step) until the cell's colour index or degree changes and at least 8 steps have passed |
| CHAOTIC | seeded jumps of the scan cursor; pitch from a mix of hue, brightness and edges; octave leaps; random gates; occasional ratchets |

## Pitch pipeline

There is **one** scale and root (`Patch.scale`, `Patch.root`), shared by all four regions; a region
has only its own LOW / HIGH, TRANSPOSE and OCTAVE. Every note passes through the same stages, in
`mapping.ts`, used by the live transport, the exporter and (by way of the events) the internal
sounds:

```
cell measurements ─▶ pitch source value (0..1) ─▶ mode picks a note from the in-range scale notes
   ─▶ shift: + TRANSPOSE + 12·OCTAVE ─▶ quantise to the nearest global-scale note
   ─▶ fold into LOW..HIGH by whole octaves ─▶ MIDI note ─▶ MIDI out / file / synth (440·2^((n−69)/12))
```

* **Quantise** (`quantiseToScale`): nearest scale note; an exact tie goes in the direction of the
  shift (up for a positive shift, down for a negative one), and toward middle C when there is no
  shift, so mirrored shifts give mirrored results and no rule favours one direction.
* **Fold** (`foldIntoRange`): whole octaves keep the note in the scale. A range under an octave
  without the note takes the in-range scale note of nearest pitch class (ties: nearer the middle).
  There is deliberately no clamp, which used to pile every out-of-range note onto one boundary
  note.
* A range with no scale note at all is the only case where a note lies outside it: the nearest
  scale note is played (and the REGION window says so). No invalid MIDI note is ever produced.
* The per-region setup (scale notes in range, shift) is cached per region and rebuilt only when the
  scale, root, range or shift changes, so the scheduler allocates nothing per step.

Tests assert the invariant (every note in the global scale and range, whatever the mode,
transposition, octave, range, tie rule or picture) for the six scales in the brief plus all twelve.

## Patch format

`*.picturescue.json`: `{ format: "picturescue-patch", version: 1, name, bpm, stepsPerBeat, swing,
loop, seed, seedText, scale, root, analysisSize, image, regions[4] }` (format version 2). `image` is
`{kind: "demo", id}`, `{kind: "embedded", encoding: "rgba-delta-deflate", width, height, data}`
(RGBA planes, each row delta-filtered, deflated with `CompressionStream`, base64) or
`{kind: "none"}`; `encoding: "dataurl"` also accepts an ordinary image data URL. Loading fills
missing fields with defaults and repairs invalid ones; a newer version number is refused with a
message. Version 1 patches (which could carry a `scale`, `root` and `globalScale` in each region)
open normally: the patch's global scale and root are kept, the region overrides are ignored and are
not written again. A patch without a global scale gets C minor pentatonic. Pictures are at most 640 px, so a patch is typically 10 KB to 1 MB.

Preferences (MIDI ports, clock, audio, volume, view, locks, export length) and palettes live in
`localStorage` and are never part of a patch. The working patch is autosaved there too (without
its picture if it does not fit).

## Slop Factory Core

PICTURESCUE depends on `@slopfactory/core` 0.5.0 (pinned by commit, as the other instruments do).

| Core module | Used for |
|---|---|
| `palette` | Everything about palettes: `PaletteLibrary` (preferences, custom palettes), `applyPalette`, the `paletteEditor` window, `SHARED_ROLES`, `SHARED_PRESETS` (Atari as CLASSIC, Dark, Amber, Green Screen, C64, Phosphor, Pink Noise, Rave, Paper), palette files importable from emmm, The Breakery, DOWNBEAT and ANVIL. PICTURESCUE adds four region roles and a COLOUR preset. |
| `audio` | `Instrument` / `NoteHandle` contracts, `GainEnvelope`, `fadeOut`, the `Mixer` (per-region strips, master gain) and `NotePlayer` (polyphony limits, voice stealing, stop all). |
| `events` | `TimeMap` for tick ↔ seconds. |
| `midi` | The port and clock contracts (`MidiOutputPort`, `MidiInputPort`, `MidiPortInfo`, `ClockFollower`), which PICTURESCUE's Web MIDI code implements. |

Core has **no shared MIDI implementation, scheduler, scales, seeds, SMF writer or UI widgets yet**
(its MIDI roadmap plans them, extracted from the existing instruments). PICTURESCUE therefore
keeps small versions of its own, written to Core's contracts so they can move into Core later.
No change to Core was needed.

## Testing

* `npm test`: Vitest, about 110 tests: analysis (brightness, hue, saturation, edges, alpha,
  scaling, region sampling, palette), mapping and scales, every scan mode and loop boundary, the
  engine (determinism, live = export, MIDI safety in every mode, timing, swing, rates, density,
  thresholds, spacing, repetition, mute / solo, CC, modes differing), note gate, MIDI output,
  MIDI files (round trip through a reader), the transport with a fake clock and port (lookahead,
  tempo changes, pause, frozen pages, clock out, recording, LOOP off), external clock following,
  patches, lossless pictures, preferences, palettes, randomisation and locks, demos and presets.
* `npm run test:browser`: builds, serves and drives the real app in headless Chromium with a fake
  MIDI device (load a picture, refuse a broken file, select / drag / resize regions, change mapping
  and mode, type a channel, connect MIDI, play with Space, watch cursors move, check notes and
  channels, stop with nothing hanging, render every preview sound, export a MIDI file, save and
  reopen a patch, switch and remember palettes, picture colours unchanged, views).
