# PICTURESCUE

**Pictures make music.**

An experimental image-driven MIDI instrument inspired by the Atari ST's *Picture Music*. Load an
image, explore its colours and shapes, and transform it into evolving musical performances.

<https://picturescue.allmyfriendsaresynths.com>

PICTURESCUE is part of the Slop Factory family of browser instruments (emmm, FEELERS, ANVIL,
DOWNBEAT, SQUARED, FRAK.MC, The Breakery, The Good Bits) and is built on
[Slop Factory Core](https://github.com/clickysteve/slopfactory-core).

It is **not** an AI image generator and **not** an AI music generator. It is an algorithmic
instrument: every note comes from transparent rules you can see and change, applied to the
picture. The same picture, settings and seed always give the same music.

## The idea, and where it comes from

*Picture Music* (Gareth Jones, version 1.2) was a public-domain Atari ST program that converted
16-colour low-resolution pictures into MIDI. You chose **four areas** of the picture; each area
was a track with its own **MIDI channel, transposition and scale**; on playback the program
**scanned the areas horizontally, pixel by pixel**, turning **each colour into a different
note**. That is about all the surviving documentation says. See
[docs/ORIGINAL_RESEARCH.md](docs/ORIGINAL_RESEARCH.md) for sources, what is verified and what is
not.

PICTURESCUE keeps that idea at its centre (four regions, per-region channel / transposition /
scale, colour-to-note, horizontal scanning, a 16-colour "ST COLOUR" reading of any picture) and
asks what it could become: more ways to read a picture, more ways to move through it, musical
behaviours that find structure instead of playing every pixel, and a modern MIDI and browser
toolset. It is a new instrument, not a recreation: it is a clean-room implementation that uses
none of the original's code, graphics or data.

### How it differs from the original

| Picture Music (as documented) | PICTURESCUE |
|---|---|
| 16-colour ST low-resolution pictures | Any PNG, JPEG, WebP, GIF (first frame) or BMP; kept at up to 640 px; analysed at 80–640 px (320 = ST) |
| Each colour a note | Colour index (ST COLOUR) **or** brightness, hue, saturation; velocity and MIDI CC from measurements |
| Four areas, scanned horizontally pixel by pixel | Four regions with scan grids and seven scan modes, reverse, rates, lengths, offsets |
| Per-area channel, transposition, scale | The same, plus root, range, octave, velocity range and a global scale |
| (not documented) | Six interpretation modes, density, thresholds, rests, spacing, gate, repetition handling |
| (not documented) | Seeds, randomisation with locks, WILDCARD, factory presets, patches, MIDI file export and recording, internal sounds, MIDI clock |

## Quick start

1. Open the app and press **Space**. The ST LOW-RES demo picture plays straight away through the
   internal sounds.
2. Watch the four **scan cursors** move through their regions; a cell flashes when it plays a
   note. The ACTIVITY window shows each region's note, velocity, scan progress and a roll of
   recent notes.
3. Try another picture: **DEMOS**, **OPEN…**, or drop a file onto the picture. Or pick a preset
   from the **Factory** menu.
4. Click a region (or press **1**–**4**) and change its **MODE** or **PRESET** in the REGION
   window. Each change is heard on the next step.

## Loading pictures

* **OPEN…** (⌘O / Ctrl+O), drag and drop onto the picture, or **DEMOS** (nine pictures drawn by
  PICTURESCUE itself, so they are free to use and tiny in patches).
* Formats: whatever the browser decodes: PNG, JPEG, WebP, GIF, BMP (BMP where supported). SVG is
  refused (export it as PNG). Files up to 60 MB.
* **GIF policy**: animated GIFs play their **first frame** only.
* Pictures larger than **640 px** on their longest side are drawn down to 640 px once, when
  loaded. Those pixels are kept, shown, analysed and saved; proportions are never changed.
* **ANALYSIS** sets the size (longest side) at which the picture is measured: 80, 160,
  **320** (the default, the ST's low resolution) or 640 px. Smaller reads broad shapes, larger
  reads fine edges. Resizing the window never changes the music.
* **VIEW** (or **Tab**) shows what the regions measure: PICTURE, BRIGHTNESS, HUE, SATURATION,
  EDGES or ST COLOUR (the 16-colour palette).
* Transparency counts: colour is averaged by alpha, and mostly transparent cells are silent.
  Greyscale pictures work (hue falls back to brightness); a flat, single-colour picture is
  reported as such.
* **CLEAR** removes the picture; the scans carry on silently.

## Regions

Four regions, each with its own outline (pattern and number in the Classic palette, colours in
others), all editable directly on the picture:

* **Click** a region to select it (or keys 1–4, `[` `]`). Overlapping regions are fine: the
  selected one is on top.
* **Drag** inside it to move it; drag a **handle** to resize it. Arrow keys move the selected
  region (Shift: further), ⌥ / Alt + arrows resize it. The **PLACE** fields set position and size
  numerically.
* **PLACE ALL…** applies a layout: Four Quadrants, Four Horizontal Bands, Four Vertical Strips,
  Full-Image Overlap, Foreground / Background.
* **ON**, **MUTE**, **SOLO**, MIDI **CH**, preview **SOUND** and **LVL** per region.
  **COPY→ALL** copies the selected region's settings to the others (their places, channels and
  switches stay).

## Scanning

Each region is a grid of **COLS × ROWS** cells. Its cursor visits one cell per step, and the cell's
average measurements decide what happens.

| SCAN | Movement |
|---|---|
| HORIZONTAL | left to right, then the next row (the original's scan) |
| VERTICAL | top to bottom, then the next column |
| PING-PONG | left to right and back again |
| SERPENTINE | rows alternate direction |
| RANDOM WALK | a seeded walk to neighbouring cells, preferring to keep its direction |
| SPIRAL | from the outside in (REVERSE: from the centre out) |
| MANUAL | you move the cursor: drag inside the region (Shift-drag moves the region) |

**REVERSE** plays any path backwards. **RATE** multiplies the transport's steps (×1/4 to ×2).
**LENGTH** limits a pass to part of the path; **OFFSET** starts later in it. **LOOP** (Transport)
repeats the scans; off, each region plays one pass and the transport stops. **RESTART** (R) starts
every scan again on the next beat. Steps are scheduled musically (BPM, **STEPS/BEAT**, **SWING**),
never by animation frames.

## Mapping

| Control | Choices |
|---|---|
| PITCH | BRIGHTNESS (light high, dark low), HUE (the colour wheel goes round the scale; brightness picks the octave), SATURATION, ST COLOUR (each of the 16 colours its own note) |
| VELOCITY | SATURATION, BRIGHTNESS, EDGES, FIXED, within VEL MIN … VEL MAX |
| TRIGGER | EVERY STEP, BRIGHT > THR, EDGES, COLOUR CHANGE, DETAIL (more often where the picture is busy), with THRESH |
| CC FROM | OFF, HUE, BRIGHTNESS, SATURATION, EDGES on CC NO. (sent on change only) |
| PRESET | Brightness → Pitch, Hue → Pitch, Each Colour a Note, Edges → Rhythm, Colour Changes → Notes, Detail → Density, Brightness → Velocity, Hue → CC |

Notes always come from the region's scale between **LOW** and **HIGH**, then **TRANSP** (semitones)
and **OCTAVE** apply. Each region uses the **global** scale and root (Transport window) or its own
(turn **GLOBAL** off). Scales: Chromatic, Major, Natural Minor, Pentatonic Major, Pentatonic Minor,
Dorian, Phrygian, Lydian, Mixolydian, Harmonic Minor, Whole Tone, Diminished.

Behaviour: **DENSITY** keeps the busiest steps first; **REST** adds seeded silences; **SPACING** is
a minimum number of steps between notes; **GATE** is the note length in steps; **REPEAT** decides
what happens to the same note twice in a row (TIE holds it, RETRIGGER strikes it again, SKIP leaves
it out).

### Interpretation modes

| MODE | What it does with the picture |
|---|---|
| MELODIC | a recognisable melody: pitch follows the picture, wide leaps fold back, lines are phrased |
| RHYTHMIC | edges and colour changes are the beat; four pitches; accents on the beat |
| AMBIENT | a slowly following value; a note only when it settles somewhere new; long soft notes |
| POINTILLIST | sparse, short points scattered over the octaves; saturated colours sparkle |
| DRONE | a sustained root and fifth that move only when the colour moves on |
| CHAOTIC | busy, with jumps across the region, octave leaps and ratchets |

## Seeds, variations and randomising

The **SEED** (a number or any words, Slop Factory style) decides every random choice: rests, random
walks, chaotic jumps, pointillist scattering. Measurements are never random. The same picture,
patch and seed always play the same.

* **VARIATION** (V): a new seed, same settings.
* **RANDOMISE** (⌥X / Alt+X) and **WILDCARD** (⌥W / Alt+W, bolder: also the global scale, swing
  and regions' own scales) draw musically sensible settings (modes with scans and triggers that
  suit them, playable ranges, sensible densities). **LOCKS** keep categories as they are: region
  positions, mappings, scan directions, density, note ranges, scan rates, modes, scale / root.
  MIDI settings and the picture are never randomised.

## MIDI

* **MIDI…** (⌥M / Alt+M) connects Web MIDI and chooses the **output**. Each region sends on its
  own channel. **SEND NOTES** turns MIDI notes off without touching the internal sounds.
* **CLOCK OUT** sends MIDI clock (24 per beat) with Start, Stop, Continue and Song Position.
  **FOLLOW EXTERNAL CLOCK** follows another device's clock tempo and its Start / Stop / Continue.
* Notes are tracked: stop, pause, panic, switching device and closing the page never leave a note
  hanging. **PANIC** (⌘. / Ctrl+.) also sends All Notes Off, All Sound Off and Sustain Off on all
  16 channels.
* Without Web MIDI (Safari) PICTURESCUE plays through its internal sounds and says so.

### Exporting MIDI

**File ▸ Export MIDI File…** (⌘E / Ctrl+E) writes a Standard MIDI File (format 1, 960 PPQ) of
**4, 8, 16, 32 or any number of bars** of the current patch from the start: tempo, one named
track per enabled region on its channel, notes with their lengths and velocities, and controllers.
It is exactly what PLAY performs.

**Recording** (● or Shift+R) captures what actually plays, live changes included (tempo changes
are written as a tempo map). **File ▸ Export Recording** saves it.

## Internal sounds

Five small preview sounds (SINE/TRI, PLUCKED, SOFT PAD, PERCUSSIVE, BELL), chosen per region, with
a per-region level and a master **VOL**. **AUDIO** turns them on or off independently of MIDI. They
start with the first PLAY (browsers require a click or key first) and pass through a gentle
limiter.

## Patches

**File ▸ Save Patch…** (⌘S / Ctrl+S) writes a portable `.picturescue.json` file with every
setting, the seed and **the picture itself** (demo pictures by name; loaded pictures embedded
losslessly, typically 10 KB to 1 MB). **Open Patch…** (⇧⌘O / Ctrl+Shift+O, or drop the file on the
picture) restores it exactly. Older or hand-edited patches open with defaults for anything missing.
The working patch is kept between visits automatically.

**Factory** presets: PICTURE MUSIC (the original idea), MONOCHROME MELODY, FOUR COLOURS, CITY
LIGHTS, SLOW LANDSCAPE, FRACTURED PORTRAIT, COLOUR DRIFT, GEOMETRIC RHYTHM.

## Palettes

**Options ▸ Palette…** (⌥P / Alt+P): CLASSIC (black and white), DARK, COLOUR (a colour per
region) and the other Slop Factory presets, plus your own (Duplicate, edit, Import, Export:
palette files from emmm, The Breakery, DOWNBEAT and ANVIL import too). The choice is remembered.
Palettes colour the interface only: the picture is always shown and analysed with its own colours.

## Keyboard shortcuts

| Key | Command |
|---|---|
| Space | Stop / Play |
| Return | Pause / Continue |
| R | Restart the scans |
| Shift+R | Record on / off |
| + / − | Tempo ±1 (Shift: ±10) |
| 1–4, [ ] | Select a region |
| E / M / S | Selected region on / mute / solo |
| Arrows (Alt+arrows) | Move (resize) the selected region |
| Tab | Next VIEW |
| V | New variation |
| ⌥X / Alt+X, ⌥W / Alt+W | Randomise, WILDCARD |
| ⌘O, ⇧⌘O, ⌘S, ⌘E (Ctrl on Windows / Linux) | Open picture, open patch, save patch, export MIDI |
| ⌘. / Ctrl+. | Panic |
| ⌥M, ⌥P / Alt+M, Alt+P | MIDI settings, palette |
| ? or F1 | Quick help |

Keys typed into text fields or a number box being edited never trigger commands. The full list is
in **PICTURESCUE ▸ Keyboard Shortcuts**.

## Browser compatibility

| | Chrome / Edge / Opera | Firefox | Safari |
|---|---|---|---|
| Pictures, analysis, internal sounds, export, patches | yes | yes | yes |
| Web MIDI out / clock | yes | yes (asks for permission; may need the site-permission add-on) | no (internal sounds only) |

Tested automatically in Chromium (Playwright). Firefox and Safari support the same APIs but are not
tested automatically. Patches need `CompressionStream` (all current browsers).

## Development

```bash
npm ci
npm run dev            # http://localhost:5207
npm test               # unit tests (Vitest)
npm run typecheck
npm run build          # dist/
npm run test:browser   # build, serve and drive the app in headless Chromium
```

Architecture, determinism, timing and note safety are described in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Deployment

Pushing to `main` runs `.github/workflows/pages.yml`: type check, unit tests and build, then deploy
to GitHub Pages with the `CNAME` for **picturescue.allmyfriendsaresynths.com** (assets use relative
paths, so the same build also works under `/picturescue/`). The browser test runs as a separate
job. Requirements outside the repository: GitHub Pages set to deploy from **GitHub Actions** in the
repository settings, and a DNS `CNAME` record for `picturescue.allmyfriendsaresynths.com` pointing
at `clickysteve.github.io`.

## Limitations

* The history of Picture Music is thinly documented; see the research notes for what is and is not
  known. PICTURESCUE makes no claim to reproduce the original's output.
* Decoding is the browser's: a JPEG may decode very slightly differently in different browsers,
  so a loaded (not demo) picture's music can differ across browsers until it is saved in a patch
  (patches embed the decoded pixels and play identically everywhere).
* External clock following is tempo-following (the tempo and transport follow; individual pulses do
  not drive each step), as in emmm.
* Only the internal preview sounds are rendered; there is no audio (WAV) export.
* Four regions; the data model and engine are written for more, the interface for four.

## Licence

MIT. Slop Factory Core is MIT. The fonts are Tiny5 and Silkscreen (SIL Open Font Licence) via
Fontsource.
