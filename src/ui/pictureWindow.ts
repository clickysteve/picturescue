/**
 * The PICTURE window: the image at the centre of the instrument, its four regions drawn over
 * it (drag to move, handles to resize, click to select), and each region's scan cursor
 * moving through its cells in time with the music, flashing where a note is played.
 *
 * The picture is drawn from its kept source pixels (or, with VIEW, from the analysis: what the
 * regions actually measure). Display size never affects the music: regions live in
 * normalised picture coordinates.
 */
import { renderView, VIEW_LABEL, VIEWS, type View } from '../engine/analysis';
import { DEMOS } from '../engine/demos';
import { HANDLES, regionAt, resizeRect, moveRect, type Handle, type Rect, applyRect } from '../engine/regions';
import { ANALYSIS_SIZES, MODE_LABEL, SCAN_LABEL } from '../engine/types';
import type { PerfEvent } from '../engine/performance';
import type { App } from '../app/app';
import { ACCEPT } from '../app/picture';
import { attr, chooseFile, el, label, localPoint, setTip, svgNode, trackDrag } from './dom';
import { Btn, MWindow, Sel } from './widgets';

export const REGION_DASH = ['', '5 2', '1.5 2', '7 2 1.5 2'];
export const REGION_VAR = ['var(--r1)', 'var(--r2)', 'var(--r3)', 'var(--r4)'];

interface Cursor {
  g: SVGGElement;
  halo: SVGRectElement;
  box: SVGRectElement;
  flash: SVGRectElement;
  cell: number;
  cols: number;
  rows: number;
  flashUntil: number;
  visible: boolean;
}

export class PictureWindow {
  win: MWindow;
  private area: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private svg: SVGSVGElement;
  private regionLayer: SVGGElement;
  private cursorLayer: SVGGElement;
  private empty: HTMLDivElement;
  private cursors: Cursor[] = [];
  private disp = { x: 0, y: 0, w: 1, h: 1 };
  private dims: HTMLDivElement;
  private ctrls: { update(): void }[] = [];
  private drawnKey = '';
  readonly AW = 580;
  readonly AH = 392;

  constructor(
    private app: App,
    parent: HTMLElement,
  ) {
    this.win = new MWindow(parent, { id: 'picture', title: 'PICTURE', x: 4, y: 20, w: 590, h: 440 });
    const b = this.win.body;
    this.ctrls.push(new Btn(b, 4, 4, 46, 15, 'OPEN…', { tip: 'Load a picture from your computer (PNG, JPEG, WebP, GIF, BMP). You can also drop one on the picture.', onClick: () => void this.open() }));
    this.ctrls.push(
      new Sel<string>(b, 54, 4, 62, 15, {
        caption: 'DEMOS',
        tip: 'Demonstration pictures (drawn by PICTURESCUE itself)',
        items: () => DEMOS.map((d) => ({ value: d.id, label: d.name, tip: d.about })),
        get: () => (this.app.source?.demo ?? ''),
        set: (id) => this.app.loadDemo(id),
      }),
    );
    this.ctrls.push(new Btn(b, 120, 4, 42, 15, 'CLEAR', { tip: 'Remove the picture (the regions keep their settings)', onClick: () => this.app.clearImage(), disabled: () => !this.app.source }));
    label(b, 172, 8, 'VIEW', 'tiny');
    this.ctrls.push(
      new Sel<View>(b, 194, 4, 82, 15, {
        tip: 'What to show: the picture, or one of the measurements the regions read (at the analysis size)',
        items: () => VIEWS.map((v) => ({ value: v, label: VIEW_LABEL[v] })),
        get: () => this.app.prefs.view,
        set: (v) => {
          this.app.prefs.view = v;
          this.app.changed('prefs');
          this.drawImage(true);
        },
      }),
    );
    label(b, 284, 8, 'ANALYSIS', 'tiny');
    this.ctrls.push(
      new Sel<number>(b, 324, 4, 54, 15, {
        tip: 'Analysis size: the longest side, in pixels, at which the picture is measured. 320 is the Atari ST’s low resolution. Smaller is coarser and smoother; larger sees finer edges.',
        items: () => ANALYSIS_SIZES.map((s) => ({ value: s, label: `${s} px` })),
        get: () => this.app.patch.analysisSize,
        set: (s) => this.app.setAnalysisSize(s),
      }),
    );
    this.dims = label(b, 386, 8, '', 'tiny');
    this.area = el('div', 'picture-area', b, [4, 24, this.AW, this.AH]);
    this.canvas = el('canvas', '', this.area);
    this.canvas.setAttribute('aria-label', 'The picture');
    this.svg = svgNode('svg', { class: 'overlay', width: this.AW - 2, height: this.AH - 2, viewBox: `0 0 ${this.AW - 2} ${this.AH - 2}` }) as SVGSVGElement;
    this.svg.setAttribute('shape-rendering', 'crispEdges');
    this.area.appendChild(this.svg);
    this.regionLayer = svgNode('g', {}, this.svg);
    this.cursorLayer = svgNode('g', {}, this.svg);
    this.empty = el('div', 'picture-empty', this.area);
    const panel = el('div', 'panel', this.empty);
    panel.innerHTML = '<b>NO PICTURE</b><br>Drop a picture here, or use OPEN…<br>or choose one of the DEMOS.';
    for (let i = 0; i < 4; i++) this.cursors.push(this.makeCursor(i));
    this.area.addEventListener('pointerdown', (e) => this.down(e));
    this.area.addEventListener('pointermove', (e) => this.hover(e));
    // drag and drop a picture (or a patch)
    const dropTarget = this.win.el;
    dropTarget.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.area.classList.add('dragover');
    });
    dropTarget.addEventListener('dragleave', () => this.area.classList.remove('dragover'));
    dropTarget.addEventListener('drop', (e) => {
      e.preventDefault();
      this.area.classList.remove('dragover');
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      if (/\.json$/i.test(f.name)) void f.text().then((t) => this.app.openPatchText(t, f.name));
      else void this.app.loadImageFile(f);
    });
    app.on((c) => {
      if (c === 'image') this.drawImage(true);
      if (c === 'image' || c === 'patch' || c === 'select') this.drawRegions();
      if (c === 'patch' || c === 'image') this.ctrls.forEach((x) => x.update());
    });
    this.drawImage(true);
    this.drawRegions();
  }

  async open(): Promise<void> {
    const f = await chooseFile(ACCEPT);
    if (f) await this.app.loadImageFile(f);
  }

  // ---------------------------------------------------------------- the picture

  private drawImage(force = false): void {
    const src = this.app.source;
    const an = this.app.analysis;
    const v = this.app.prefs.view;
    const key = `${src?.name}|${src?.w}|${an?.w}|${an?.h}|${v}|${this.app.patch.analysisSize}`;
    if (!force && key === this.drawnKey) return;
    this.drawnKey = key;
    this.empty.classList.toggle('hidden', !!src);
    this.canvas.classList.toggle('hidden', !src);
    if (!src) {
      this.disp = { x: 0, y: 0, w: this.AW - 2, h: this.AH - 2 };
      this.win.setInfo('');
      this.dims.textContent = '';
      return;
    }
    const W = this.AW - 2;
    const H = this.AH - 2;
    const k = Math.min(W / src.w, H / src.h);
    const dw = Math.max(1, Math.round(src.w * k));
    const dh = Math.max(1, Math.round(src.h * k));
    this.disp = { x: Math.floor((W - dw) / 2), y: Math.floor((H - dh) / 2), w: dw, h: dh };
    const g = this.canvas.getContext('2d')!;
    if (v === 'picture' || !an) {
      this.canvas.width = src.w;
      this.canvas.height = src.h;
      g.putImageData(new ImageData(Uint8ClampedArray.from(src.data), src.w, src.h), 0, 0);
    } else {
      this.canvas.width = an.w;
      this.canvas.height = an.h;
      g.putImageData(new ImageData(Uint8ClampedArray.from(renderView(an, v)), an.w, an.h), 0, 0);
    }
    Object.assign(this.canvas.style, { left: this.disp.x + 'px', top: this.disp.y + 'px', width: dw + 'px', height: dh + 'px' });
    this.win.setInfo(src.name.length > 28 ? src.name.slice(0, 26) + '…' : src.name);
    const orig = src.originalW !== src.w ? `${src.originalW}×${src.originalH} → ` : '';
    this.dims.textContent = `${orig}${src.w}×${src.h}  ANALYSED ${an?.w ?? 0}×${an?.h ?? 0}  ${an?.palette.length ?? 0} ST COLOURS${an?.hasAlpha ? '  ALPHA' : ''}${an?.greyscale ? '  GREY' : ''}`;
  }

  // ---------------------------------------------------------------- regions

  private toDisp(r: Rect): Rect {
    return { x: this.disp.x + r.x * this.disp.w, y: this.disp.y + r.y * this.disp.h, w: r.w * this.disp.w, h: r.h * this.disp.h };
  }

  drawRegions(): void {
    const g = this.regionLayer;
    g.replaceChildren();
    if (!this.app.source) return;
    const regions = this.app.patch.regions;
    const sel = this.app.selected;
    // draw the selected region last (on top)
    const order = [0, 1, 2, 3].filter((i) => i !== sel).concat(sel);
    for (const i of order) {
      const r = regions[i]!;
      const d = this.toDisp(r);
      const grp = svgNode('g', { 'data-region': i, opacity: r.enabled ? 1 : 0.45 }, g);
      const x = Math.round(d.x) + 0.5;
      const y = Math.round(d.y) + 0.5;
      const w = Math.max(2, Math.round(d.w) - 1);
      const h = Math.max(2, Math.round(d.h) - 1);
      svgNode('rect', { x, y, width: w, height: h, class: 'rgn-outline', stroke: 'var(--paper)', 'stroke-width': i === sel ? 4 : 3 }, grp);
      svgNode('rect', { x, y, width: w, height: h, class: 'rgn-outline', stroke: REGION_VAR[i]!, 'stroke-width': i === sel ? 2 : 1, 'stroke-dasharray': r.enabled ? REGION_DASH[i]! : '1 3' }, grp);
      // the selected region shows its scan grid
      if (i === sel && r.cols * r.rows <= 1024 && r.enabled) {
        let path = '';
        for (let c = 1; c < r.cols; c++) {
          const gx = Math.round(d.x + (c * d.w) / r.cols) + 0.5;
          path += `M${gx} ${y}V${y + h}`;
        }
        for (let rr = 1; rr < r.rows; rr++) {
          const gy = Math.round(d.y + (rr * d.h) / r.rows) + 0.5;
          path += `M${x} ${gy}H${x + w}`;
        }
        if (path) {
          svgNode('path', { d: path, stroke: 'var(--paper)', 'stroke-width': 1, opacity: 0.35, fill: 'none' }, grp);
          svgNode('path', { d: path, stroke: REGION_VAR[i]!, 'stroke-width': 1, 'stroke-dasharray': '1 3', opacity: 0.6, fill: 'none' }, grp);
        }
      }
      // tag: number and mode
      const tag = svgNode('g', { class: 'rgn-tag', 'data-tag': i }, grp);
      const tw = i === sel ? 64 : 12;
      const tx = Math.round(Math.min(d.x, this.disp.x + this.disp.w - tw));
      const ty = Math.round(d.y);
      svgNode('rect', { x: tx, y: ty, width: tw, height: 11, fill: i === sel ? REGION_VAR[i]! : 'var(--paper)', stroke: REGION_VAR[i]!, 'stroke-width': 1 }, tag);
      const t = svgNode('text', { x: tx + 3, y: ty + 9, fill: i === sel ? 'var(--paper)' : REGION_VAR[i]! }, tag);
      t.textContent = i === sel ? `${i + 1} ${MODE_LABEL[r.mode]}` : String(i + 1);
      if (i === sel && r.enabled) {
        for (const hd of HANDLES) {
          const [hx, hy] = this.handlePos(d, hd);
          svgNode('rect', { x: Math.round(hx) - 2.5, y: Math.round(hy) - 2.5, width: 5, height: 5, fill: 'var(--paper)', stroke: 'var(--ink)', 'stroke-width': 1, 'data-handle': hd }, grp);
        }
      }
    }
    setTip(this.area, `Region ${sel + 1}: ${SCAN_LABEL[regions[sel]!.scan]} scan, ${MODE_LABEL[regions[sel]!.mode]}. Click a region to select it, drag to move it, drag a handle to resize.${regions[sel]!.scan === 'manual' ? ' MANUAL: drag inside it to move the scan cursor (Shift-drag moves the region).' : ''}`);
  }

  private handlePos(d: Rect, h: Handle): [number, number] {
    const x = h.includes('w') ? d.x : h.includes('e') ? d.x + d.w : d.x + d.w / 2;
    const y = h.includes('n') ? d.y : h.includes('s') ? d.y + d.h : d.y + d.h / 2;
    return [x, y];
  }

  private hitHandle(px: number, py: number): Handle | null {
    const r = this.app.patch.regions[this.app.selected]!;
    if (!r.enabled) return null;
    const d = this.toDisp(r);
    for (const h of HANDLES) {
      const [hx, hy] = this.handlePos(d, h);
      if (Math.abs(px - hx) <= 5 && Math.abs(py - hy) <= 5) return h;
    }
    return null;
  }

  private norm(px: number, py: number): { x: number; y: number } {
    return { x: (px - this.disp.x) / this.disp.w, y: (py - this.disp.y) / this.disp.h };
  }

  private hover(e: PointerEvent): void {
    if (e.buttons) return;
    const p = localPoint(this.area, e);
    const h = this.app.source ? this.hitHandle(p.x, p.y) : null;
    const cursors: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
    this.area.style.cursor = h ? cursors[h]! : 'default';
  }

  private down(e: PointerEvent): void {
    if (!this.app.source || e.button !== 0) return;
    e.preventDefault();
    const p = localPoint(this.area, e);
    const regions = this.app.patch.regions;
    const handle = this.hitHandle(p.x, p.y);
    const dw = this.disp.w;
    const dh = this.disp.h;
    if (handle) {
      const r = regions[this.app.selected]!;
      const start: Rect = { x: r.x, y: r.y, w: r.w, h: r.h };
      trackDrag(e, this.area, ({ dx, dy }) => {
        applyRect(r, resizeRect(start, handle, dx / dw, dy / dh));
        this.app.changed('patch');
      });
      return;
    }
    const n = this.norm(p.x, p.y);
    const i = regionAt(regions, n.x, n.y, this.app.selected);
    if (i < 0) return;
    if (i !== this.app.selected) this.app.select(i);
    const r = regions[i]!;
    const onTag = (e.target as Element).closest?.('[data-tag]');
    if (r.scan === 'manual' && !e.shiftKey && !onTag) {
      // MANUAL: the pointer is the scan cursor
      const setManual = (ev: PointerEvent) => {
        const q = this.norm(localPoint(this.area, ev).x, localPoint(this.area, ev).y);
        r.manualX = Math.max(0, Math.min(1, (q.x - r.x) / r.w));
        r.manualY = Math.max(0, Math.min(1, (q.y - r.y) / r.h));
      };
      setManual(e);
      trackDrag(e, this.area, ({ ev }) => setManual(ev), () => this.app.changed('patch'));
      return;
    }
    const start: Rect = { x: r.x, y: r.y, w: r.w, h: r.h };
    trackDrag(e, this.area, ({ dx, dy }) => {
      applyRect(r, moveRect(start, dx / dw, dy / dh));
      this.app.changed('patch');
    });
  }

  // ---------------------------------------------------------------- scan cursors

  private makeCursor(i: number): Cursor {
    const g = svgNode('g', { 'data-cursor': i, visibility: 'hidden' }, this.cursorLayer);
    const flash = svgNode('rect', { fill: REGION_VAR[i]!, opacity: 0 }, g);
    const halo = svgNode('rect', { fill: 'none', stroke: 'var(--paper)', 'stroke-width': 3 }, g);
    const box = svgNode('rect', { fill: 'none', stroke: REGION_VAR[i]!, 'stroke-width': 1.5 }, g);
    return { g, halo, box, flash, cell: -1, cols: 1, rows: 1, flashUntil: 0, visible: false };
  }

  /** Steps that are due: move the cursors (called every frame by the display loop). */
  step(ev: Extract<PerfEvent, { type: 'step' }>, now: number): void {
    const c = this.cursors[ev.region];
    if (!c) return;
    c.cell = ev.cell;
    c.cols = ev.cols;
    c.rows = ev.rows;
    if (ev.played) c.flashUntil = now + 160;
  }

  /** Redraw the cursors (cheap: attributes change only when they must). */
  frame(now: number, playing: boolean): void {
    const regions = this.app.patch.regions;
    this.cursors.forEach((c, i) => {
      const r = regions[i]!;
      const show = playing && !!this.app.source && r.enabled && c.cell >= 0;
      if (show !== c.visible) {
        c.visible = show;
        attr(c.g, 'visibility', show ? 'visible' : 'hidden');
      }
      if (!show) return;
      const col = c.cell % c.cols;
      const row = Math.floor(c.cell / c.cols);
      const d = this.toDisp(r);
      const cw = d.w / c.cols;
      const ch = d.h / c.rows;
      const x = Math.round(d.x + col * cw);
      const y = Math.round(d.y + row * ch);
      const w = Math.max(3, Math.round(cw));
      const h = Math.max(3, Math.round(ch));
      for (const rect of [c.halo, c.box, c.flash]) {
        attr(rect, 'x', x);
        attr(rect, 'y', y);
        attr(rect, 'width', w);
        attr(rect, 'height', h);
      }
      attr(c.flash, 'opacity', now < c.flashUntil ? 0.55 : 0);
    });
  }

  /** Stopped: hide the cursors. */
  reset(): void {
    this.cursors.forEach((c) => {
      c.cell = -1;
      c.flashUntil = 0;
    });
  }
}
