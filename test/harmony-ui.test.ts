// @vitest-environment happy-dom
/**
 * The interface has exactly one scale selector and one root selector (TRANSPORT), none in the
 * region panel, and changing them reaches all four regions.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { sourceFromDemo } from '../src/app/picture';
import { renderPerformance } from '../src/engine/performance';
import { inScale } from '../src/engine/scales';
import { PPQ } from '../src/engine/types';
import { RegionWindow } from '../src/ui/regionWindow';
import { TransportWindow } from '../src/ui/transportWindow';

let app: App;
let host: HTMLElement;
let region: RegionWindow;
let transport: TransportWindow;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
  app = new App();
  app.setSource(sourceFromDemo('st-lowres'));
  region = new RegionWindow(app, host);
  transport = new TransportWindow(app, host);
});

const labels = (root: HTMLElement) => [...root.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'));

describe('harmony controls', () => {
  it('has no SCALE, ROOT or GLOBAL control in the region panel', () => {
    const l = labels(region.win.el);
    expect(l).not.toContain('SCALE');
    expect(l).not.toContain('ROOT');
    expect(l.some((x) => /scale|root|global/i.test(x ?? ''))).toBe(false);
    const text = [...region.win.el.querySelectorAll('.btn, .label, .msel-text')].map((e) => e.textContent ?? '');
    expect(text.some((t) => /^(GLOBAL|SCALE|ROOT)$/.test(t.trim()))).toBe(false);
    // the controls a region keeps
    for (const keep of ['MODE', 'PITCH', 'LOW', 'HIGH', 'TRANSP', 'OCTAVE', 'VEL MIN', 'VEL MAX', 'DENSITY', 'REST', 'GATE', 'CH', 'SOUND']) expect(l, keep).toContain(keep);
  });

  it('has exactly one global SCALE and one global ROOT, in the transport', () => {
    const all = [...labels(region.win.el), ...labels(transport.win.el)];
    expect(all.filter((x) => x === 'Global scale')).toHaveLength(1);
    expect(all.filter((x) => x === 'Global root')).toHaveLength(1);
    expect(labels(transport.win.el)).toContain('Global scale');
    expect(labels(transport.win.el)).toContain('Global root');
  });

  it('defaults to C minor pentatonic', () => {
    expect([app.patch.scale, app.patch.root]).toEqual(['minorPentatonic', 0]);
    expect(transport.win.el.querySelector('[aria-label="Global scale"]')!.textContent).toBe('PENT MIN');
    expect(transport.win.el.querySelector('[aria-label="Global root"]')!.textContent).toBe('C');
  });

  it('shows the global scale in the region panel and follows changes to it', () => {
    const info = () => [...region.win.body.querySelectorAll('.label')].map((e) => e.textContent).find((t) => /NOTES? IN RANGE|NO SCALE NOTE/.test(t ?? ''));
    expect(info()).toMatch(/^C PENTATONIC MINOR: \d+ NOTES IN RANGE$/);
    app.patch.scale = 'dorian';
    app.patch.root = 2;
    app.changed('patch');
    expect(info()).toMatch(/^D DORIAN: \d+ NOTES IN RANGE$/);
    expect(transport.win.el.querySelector('[aria-label="Global scale"]')!.textContent).toBe('DORIAN');
    expect(transport.win.el.querySelector('[aria-label="Global root"]')!.textContent).toBe('D');
    // a range with no scale note says so
    app.patch.scale = 'major';
    app.patch.root = 0;
    Object.assign(app.patch.regions[0]!, { low: 61, high: 61 });
    app.select(0);
    expect(info()).toMatch(/NO SCALE NOTE IN RANGE, PLAYS C4/);
  });

  it('changing the global scale and root changes what all four regions play', () => {
    app.patch.regions.forEach((r) => Object.assign(r, { mode: 'melodic', trigger: 'every', density: 1, rest: 0 }));
    for (const [scale, root] of [['major', 0], ['harmonicMinor', 7], ['wholeTone', 1]] as const) {
      app.patch.scale = scale;
      app.patch.root = root;
      app.changed('patch');
      const ev = renderPerformance(app.patch, app.analysis, PPQ * 12).filter((e) => e.type === 'on');
      expect(new Set(ev.map((e) => (e as { region: number }).region)).size).toBe(4);
      for (const e of ev) expect(inScale(scale, root, (e as { note: number }).note)).toBe(true);
    }
  });

  it('a new patch and the factory presets also use the one global scale', async () => {
    await app.applyFactory('city-lights', false);
    expect(app.patch.regions.every((r) => !('scale' in r) && !('root' in r))).toBe(true);
    app.newPatch();
    expect([app.patch.scale, app.patch.root]).toEqual(['minorPentatonic', 0]);
  });
});
