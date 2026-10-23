import { describe, expect, it } from 'vitest';
import { analyse } from '../src/engine/analysis';
import { demoPixels, DEMOS } from '../src/engine/demos';
import { FACTORY } from '../src/engine/factory';
import { renderPerformance } from '../src/engine/performance';
import { defaultPatch, PATCH_VERSION, PPQ, sanitisePatch, sanitiseRegion } from '../src/engine/types';
import { decodePixels, encodePixels, PixelError } from '../src/persistence/pixels';
import { parsePatch, PatchError, patchFileName, serialisePatch } from '../src/persistence/patchfile';
import { defaultPrefs, loadPrefs, savePrefs, type Store } from '../src/app/prefs';
import { PICTURESCUE_PALETTES, paletteLibrary } from '../src/ui/palette';
import { contrastWarnings, PaletteLibrary, completeColors, paletteCss } from '@slopfactory/core/palette';
import { paint } from './helpers';

class MemStore implements Store {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('patch files', () => {
  it('round-trips every setting', () => {
    const p = FACTORY[4]!.make();
    p.regions[2]!.mute = true;
    p.regions[1]!.manualX = 0.25;
    p.seedText = 'velvet harbour';
    const back = parsePatch(serialisePatch(p));
    expect(back.patch).toEqual(p);
    expect(back.warnings).toEqual([]);
  });

  it('reproduces the same performance after saving and opening', () => {
    const p = FACTORY[1]!.make();
    const px = demoPixels('monochrome')!;
    const an = analyse(px.data, px.w, px.h, p.analysisSize);
    const a = renderPerformance(p, an, PPQ * 16);
    const b = renderPerformance(parsePatch(serialisePatch(p)).patch, an, PPQ * 16);
    expect(b).toEqual(a);
  });

  it('fills missing fields with defaults (older or hand-made patches)', () => {
    const { patch, warnings } = parsePatch(JSON.stringify({ format: 'picturescue-patch', version: 1, bpm: 90, regions: [{ mode: 'drone' }] }));
    expect(patch.bpm).toBe(90);
    expect(patch.regions[0]!.mode).toBe('drone');
    expect(patch.regions[0]!.channel).toBe(1);
    expect(patch.regions.length).toBe(4);
    expect(warnings.length).toBe(1);
  });

  it('repairs invalid settings', () => {
    const r = sanitiseRegion({ channel: 99, low: 90, high: 30, velMin: 0, velMax: 500, cols: 0, x: 0.9, w: 0.5, mode: 'bogus', density: 7 }, 0);
    expect(r.channel).toBe(16);
    expect(r.low).toBe(30);
    expect(r.high).toBe(90);
    expect(r.velMin).toBe(1);
    expect(r.velMax).toBe(127);
    expect(r.cols).toBe(1);
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.mode).toBe('melodic');
    expect(r.density).toBe(1);
    const p = sanitisePatch({ bpm: 'fast', stepsPerBeat: 5, analysisSize: 300 });
    expect(p.bpm).toBe(defaultPatch().bpm);
    expect(p.stepsPerBeat).toBe(4);
    expect(p.analysisSize).toBe(320);
  });

  it('refuses what is not a patch, or is from a newer version', () => {
    expect(() => parsePatch('not json')).toThrow(PatchError);
    expect(() => parsePatch('[]')).toThrow(PatchError);
    expect(() => parsePatch(JSON.stringify({ format: 'emmm-document' }))).toThrow(/not a PICTURESCUE patch/);
    expect(() => parsePatch(JSON.stringify({ format: 'picturescue-patch', version: PATCH_VERSION + 1 }))).toThrow(/newer/);
  });

  it('keeps picture references: demo ids and embedded pixels', () => {
    const p = defaultPatch();
    p.image = { kind: 'demo', id: 'geometry' };
    expect(parsePatch(serialisePatch(p)).patch.image).toEqual({ kind: 'demo', id: 'geometry' });
    p.image = { kind: 'embedded', name: 'x.png', width: 2, height: 2, encoding: 'rgba-delta-deflate', data: 'AAAA', originalW: 4000, originalH: 4000 };
    expect(parsePatch(serialisePatch(p)).patch.image).toEqual(p.image);
    // a broken reference is dropped with a warning, never saved as nonsense
    const bad = JSON.parse(serialisePatch(p));
    bad.image = { kind: 'embedded', name: 'blob', data: 'blob:http://x/123', encoding: 'dataurl' };
    const r = parsePatch(JSON.stringify(bad));
    expect(r.patch.image).toEqual({ kind: 'none' });
    expect(r.warnings.join(' ')).toMatch(/picture/);
  });

  it('names files safely', () => {
    const p = defaultPatch();
    p.name = 'City / Lights: 2!';
    expect(patchFileName(p)).toBe('city-lights-2.picturescue.json');
  });
});

describe('embedded pictures', () => {
  it('encode and decode losslessly, transparency included', async () => {
    const data = paint(37, 23, (x, y) => [(x * 7) % 256, (y * 11) % 256, (x * y) % 256, (x + y) % 3 === 0 ? 128 : 255]);
    const enc = await encodePixels(data, 37, 23);
    expect(typeof enc).toBe('string');
    const dec = await decodePixels(enc, 37, 23);
    expect(Array.from(dec)).toEqual(Array.from(data));
  });

  it('compress a demo picture well', async () => {
    const px = demoPixels('st-lowres')!;
    const enc = await encodePixels(px.data, px.w, px.h);
    expect(enc.length).toBeLessThan(px.data.length / 4);
    const dec = await decodePixels(enc, px.w, px.h);
    expect(dec).toEqual(px.data);
  });

  it('refuse damaged data', async () => {
    await expect(decodePixels('AAAA', 2, 2)).rejects.toBeInstanceOf(PixelError);
    const enc = await encodePixels(new Uint8ClampedArray(16), 2, 2);
    await expect(decodePixels(enc, 3, 3)).rejects.toThrow(/size/);
  });
});

describe('preferences', () => {
  it('round-trip and repair', () => {
    const s = new MemStore();
    const p = defaultPrefs();
    p.midiOut = 'port-1';
    p.locks.positions = true;
    p.view = 'edges';
    p.volume = 0.5;
    savePrefs(p, s);
    expect(loadPrefs(s)).toEqual(p);
    s.setItem('picturescue.prefs', '{"volume": 9, "view": "nope", "exportBars": -3}');
    const q = loadPrefs(s);
    expect(q.volume).toBe(defaultPrefs().volume);
    expect(q.view).toBe('picture');
    expect(q.exportBars).toBe(16);
    s.setItem('picturescue.prefs', 'garbage');
    expect(loadPrefs(s)).toEqual(defaultPrefs());
    expect(loadPrefs(null)).toEqual(defaultPrefs());
  });
});

describe('palettes (Slop Factory Core)', () => {
  it('offer Classic, Dark and Colour, Classic first (the default)', () => {
    const names = PICTURESCUE_PALETTES.builtIns.map((p) => p.name);
    expect(names.slice(0, 3)).toEqual(['Classic', 'Dark', 'Colour']);
    expect(paletteLibrary).toBeTypeOf('function');
  });

  it('keep every built-in readable', () => {
    for (const p of PICTURESCUE_PALETTES.builtIns) {
      const c = completeColors(PICTURESCUE_PALETTES, p.colors);
      expect(contrastWarnings(PICTURESCUE_PALETTES, c), p.name).toEqual([]);
      expect(paletteCss(PICTURESCUE_PALETTES, c)).toContain('--r1');
    }
  });

  it('persist the chosen and custom palettes', () => {
    const s = new MemStore();
    const lib = new PaletteLibrary(PICTURESCUE_PALETTES, s);
    lib.select('colour');
    lib.setColor('r2', '#123456');
    const again = new PaletteLibrary(PICTURESCUE_PALETTES, s);
    expect(again.selected.builtIn).toBe(false);
    expect(again.selected.colors.r2).toBe('#123456');
    expect(again.find('colour')!.colors.r2).toBe('#1d6a86');
  });
});

describe('demos', () => {
  it('are drawn the same every time and have sensible sizes', () => {
    for (const d of DEMOS) {
      const a = d.make();
      const b = d.make();
      expect(a.data).toEqual(b.data);
      expect(a.w * a.h * 4).toBe(a.data.length);
      expect(Math.max(a.w, a.h)).toBeLessThanOrEqual(640);
    }
    const st = demoPixels('st-lowres')!;
    expect([st.w, st.h]).toEqual([320, 200]);
    const an = analyse(st.data, st.w, st.h, 320);
    expect(an.palette.length).toBeLessThanOrEqual(16);
    expect(analyse(demoPixels('cutout')!.data, 300, 300).hasAlpha).toBe(true);
  }, 30000);

  it('every factory preset refers to an existing demo and is valid', () => {
    for (const f of FACTORY) {
      const p = f.make();
      expect(p.image.kind).toBe('demo');
      expect(demoPixels((p.image as { id: string }).id), f.id).not.toBeNull();
      expect(sanitisePatch(p)).toEqual(p);
    }
  });
});
