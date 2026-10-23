# Picture Music (Atari ST): research notes

What is known about **Picture Music**, the Atari ST program PICTURESCUE takes its idea from, how
reliable each piece of knowledge is, and what that means for PICTURESCUE.

PICTURESCUE is an independent, clean-room instrument. No code, disassembly, binaries, graphics,
pictures or data from Picture Music were used or consulted. Only its documented behaviour (as
described by the sources below) informed the design.

## How this research was done, and its limits

The research was done in October 2026 from an automated environment whose network policy
**blocked direct access** to the primary pages (atariuptodate.de, soundonsound.com,
exxosforum.co.uk and web.archive.org all refused connections). The findings below therefore come
from **search-engine extracts of those pages**, cross-checked between several independent queries
and sources. Where only one extract supports a claim, it is marked as such. No copy of the
program, its manual or a screenshot could be obtained, so none is reproduced here.

**Before relying on any detail below for historical claims, open the sources and check them by
hand.** Anyone with ordinary web access can do so in a few minutes.

Confidence levels used below:

* **Verified**: stated by a source about Picture Music specifically, and consistent across
  independent extracts or sources.
* **Single source**: stated once, not contradicted, not confirmed elsewhere.
* **Interpretation**: a reasonable reading of incomplete documentation (not a historical fact).
* **New**: PICTURESCUE's own invention.

## Sources

| Source | What it is | Used for |
|---|---|---|
| [AtariUpToDate: Picture Music](https://www.atariuptodate.de/en/13600/picture-music) ([German page](https://www.atariuptodate.de/de/13600/picture-music)) | Catalogue entry for the program, the starting point named in the brief | Purpose, four areas, per-area channel / transposition / scale, horizontal pixel scanning, version |
| [AtariUpToDate: Floppyshop MIDI disk series](https://www.atariuptodate.de/en/atari-pd-serie/floppyshop-midi) | Contents of the Floppyshop MIDI public-domain disk series | "Picture Music 1.2" on a PD MIDI disk; the same purpose and area description |
| [AtariUpToDate: Gareth Jones (author page)](https://atariuptodate.de/de/authors/gareth-jones-7894) | The author's catalogue | Attribution; the author's other programs (Schoenberg, ST-Muse, MIDI Mouse Music, MIDI Spectra) |
| [Sound On Sound: "Schoenberg v3; Finding Software On The Internet"](https://www.soundonsound.com/techniques/schoenberg-v3-finding-software-internet) | Contemporary magazine column (Atari Notes era) | "Creates music from low-resolution colour pictures", "four areas", "each colour into a different MIDI note" |
| [Tim's Atari MIDI World: Megastar Synthesizer Collective / Gareth Jones](https://www.exxosforum.co.uk/atari/mirror/tamw/msc.htm) (mirror) | Fan archive page about Gareth Jones's programs | Download listing: "Picture Music: Create Midi music from Pictures, 100 KB"; later freeware / PD release |
| [Tim's Atari MIDI World: downloads](https://www.exxosforum.co.uk/atari/mirror/tamw/dwnloads.htm) (mirror) | Download page | Context: Jones's Music Mouse among alternative MIDI controllers |
| [MyAtari: "The 12 Rows of Schoenberg"](https://exxosforum.co.uk/atari/mirror/myatari/issues/sep2001/tone_row.htm) (mirror) | 2001 magazine article on Jones's Schoenberg | Context on the author's algorithmic programs |

General Atari ST facts used below (low resolution is 320 × 200 pixels in 16 colours chosen from
a palette of 512, i.e. 3 bits per red, green and blue channel on the original ST) are standard
hardware specifications, consistent with the search extracts; they are not claims about Picture
Music itself.

## What Picture Music did

### Verified

1. **It existed, as "Picture Music", attributed to Gareth Jones**, and was catalogued as version
   **1.2** (AtariUpToDate; the Floppyshop MIDI disk series lists "Picture Music 1.2").
2. **Purpose**: a *compositional aid* that converts **16-colour low-resolution pictures directly
   into MIDI music data** (AtariUpToDate; Floppyshop listing). Sound On Sound: it "creates music
   from low-resolution colour pictures".
3. **Four areas**: the user **selects four areas** of the picture (AtariUpToDate; Sound On Sound).
4. **Per-area settings**: each area, called a **track**, has its own **MIDI channel**, its own
   **transposition** and an assigned **scale** (AtariUpToDate, in both the English and German
   extracts).
5. **Colour to note**: the program turns **each colour into a different MIDI note**
   (Sound On Sound).
6. **Scanning**: on playback the program **scans the areas horizontally, pixel by pixel**
   (AtariUpToDate; one extract quoted it directly, a second paraphrased it as reading each area
   "left to right, pixel by pixel").
7. **Distribution**: distributed through public-domain / shareware channels (Floppyshop MIDI PD
   series; Tim's Atari MIDI World lists it at about 100 KB). Gareth Jones later re-released these
   Atari programs as freeware / PD (Tim's Atari MIDI World; Sound On Sound mentions the author's
   shareware).

### Single source (treat with care)

* **Release date 30 May 1994** and a **"shareware and public domain"** status: from one extract of
  the AtariUpToDate entry.
* **Compatibility with ST, STE, TT and Falcon**: from the same single extract.
* A summary once attributed "MIDI file saving and General MIDI support in v3" to Picture Music;
  a second, more careful extract shows that sentence belongs to **Schoenberg v3**, the subject of
  the same Sound On Sound column. **It is not evidence about Picture Music.**

### Not established

* **Which picture file formats** it loaded. "16-colour low resolution" points to the ST's native
  formats of the time (for example DEGAS `.PI1` or NEOchrome `.NEO`), but no source names them.
* **How colours became notes** exactly: whether by palette index (the 16 colour registers), by
  colour value, or by a table the user edits.
* **Timing**: tempo, scan speed, note lengths, rests, velocity, and whether all four areas
  played in parallel or in turn.
* **Interface**: no screenshot, manual or description of the screen was found.
* **Exports**: whether it played live only, saved MIDI files, or both.
* **Identity**: no source links this Gareth Jones to the British record producer of the same
  name. They should not be assumed to be the same person.
* **Contemporary reviews** of Picture Music itself beyond the short Sound On Sound mention.

## Reasonable interpretations used in PICTURESCUE

* **"Each colour a different note" at 16 colours** is read as **palette index → note**: the ST
  displayed a picture through 16 colour registers, so the natural reading is that each of the 16
  indices played its own pitch. PICTURESCUE's **ST COLOUR** measurement rebuilds this for any
  picture: a 16-colour palette is made by median cut, snapped to the ST's 512-colour space
  (3 bits per channel), sorted darkest first, and each index gets its own step up the scale (darkest lowest).
  *(Interpretation.)*
* **"Scale" per track** is read as the area's notes being chosen from a musical scale; a
  **transposition** shifts them. PICTURESCUE picks from the scale's notes within a range, shifts
  them, then snaps the result back to the scale. *(Interpretation.)* PICTURESCUE departs from the
  original here on purpose: the four regions share **one global scale and root** (the original
  gave each track its own scale), so independent voices cannot clash harmonically.
* **"Pixel by pixel, horizontally"** is kept as the **HORIZONTAL** scan (left to right, then the
  next row). A region's grid can be made as fine as the picture allows. *(Interpretation.)*
* **Four areas playing together** on four channels, as four tracks of one piece.
  *(Interpretation; it fits "four tracks, each with its own channel".)*

The factory preset **PICTURE MUSIC** puts these together: the 320 × 200, 16-colour demo picture,
four quadrant regions on channels 1 to 4, HORIZONTAL scans, ST COLOUR pitch, every step played.
It is an homage built from the documented behaviour, not a reconstruction of the original's
output.

## Design implications

* The **four-region model** is the original's and stays at the centre (with the engine and data
  model free to grow beyond four later).
* Per-region **channel and transposition** are original features and stay per region. The original's per-track **scale** was replaced by one global scale and root shared by all four regions (a deliberate departure, for coherence).
* The **ST's 16-colour, 320-pixel world** survives as options: the 320 px analysis size is the
  default ("ST"), the ST COLOUR measurement and the ST LOW-RES demo picture.
* Pixel-by-pixel horizontal scanning **alone** tends to produce note spam on photographs, which
  modern pictures (millions of colours) make much worse than 16-colour art did. Hence the new
  musical controls: cell grids, density, thresholds, spacing, repetition handling, modes.

## Features worth preserving

* Four independently configured areas (regions) of one picture.
* Per-area MIDI channel and transposition (the per-area scale became a single global scale).
* Colour → note (ST COLOUR), with 16 colours.
* Horizontal, pixel-by-pixel scanning (HORIZONTAL).
* Being a *compositional aid*: the user decides the areas and rules; the picture supplies the
  material.

## Features expanded or new in PICTURESCUE (not historical)

* Any picture format the browser decodes, any size (kept at up to 640 px, analysed at 80–640 px).
* Measurements beyond colour index: brightness, hue, saturation, edge strength, colour change,
  transparency.
* Seven scan modes (horizontal, vertical, ping-pong, serpentine, seeded random walk, spiral,
  manual), reverse, scan grids, rates, lengths and offsets.
* Six interpretation modes (melodic, rhythmic, ambient, pointillist, drone, chaotic).
* Velocity and MIDI controller mappings; density, thresholds, rests, spacing, gate, repetition.
* Seeds and reproducibility, randomisation with locks, WILDCARD.
* Internal preview sounds, MIDI clock in and out, Standard MIDI File export and performance
  recording, portable patches with the picture embedded, colour palettes, region overlays and
  live visual feedback.

## Open questions for a future pass

1. Read the AtariUpToDate entry and its download in full (by hand), and record the exact text.
2. Find the program's own documentation (a README on the PD disk) for the colour mapping,
   timing and file formats.
3. Search scanned magazines (ST Format, ST User, Atari ST Review, Sound On Sound "Atari Notes")
   for a review of Picture Music itself.
4. Confirm the date, the licence and the machine compatibility.
