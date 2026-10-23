/** Tiny DOM helpers for the fixed-coordinate "screen" (after emmm's). */

/** Current screen scale (logical px → CSS px) and the screen element. Set by main.ts. */
export const view = { scale: 1, screen: null as HTMLElement | null };

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement | null, rect?: [number, number, number?, number?], text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (rect) place(e, ...rect);
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export function place(e: HTMLElement, x: number, y: number, w?: number, h?: number): HTMLElement {
  e.style.left = x + 'px';
  e.style.top = y + 'px';
  if (w !== undefined) e.style.width = w + 'px';
  if (h !== undefined) e.style.height = h + 'px';
  return e;
}

export function label(parent: HTMLElement, x: number, y: number, text: string, cls = ''): HTMLDivElement {
  return el('div', 'label ' + cls, parent, [x, y], text);
}

const SVG = 'http://www.w3.org/2000/svg';

export function svgEl(w: number, h: number, inner = '', cls = ''): SVGSVGElement {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('width', String(w));
  s.setAttribute('height', String(h));
  s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  s.setAttribute('shape-rendering', 'crispEdges');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = inner;
  return s;
}

export function svgNode<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  parent?.appendChild(n);
  return n;
}

/** Set an attribute only when it changes (cheap per-frame updates). */
export function attr(e: Element, k: string, v: string | number): void {
  const s = String(v);
  if (e.getAttribute(k) !== s) e.setAttribute(k, s);
}

export function text(e: HTMLElement, t: string): void {
  if (e.textContent !== t) e.textContent = t;
}

/** Pointer position in the element's logical coordinates. */
export function localPoint(e: Element, ev: { clientX: number; clientY: number }): { x: number; y: number; w: number; h: number } {
  const r = e.getBoundingClientRect();
  const s = view.scale;
  return { x: (ev.clientX - r.left) / s, y: (ev.clientY - r.top) / s, w: r.width / s, h: r.height / s };
}

/** An element's rectangle in screen (logical) coordinates. */
export function screenRect(e: Element): { x: number; y: number; w: number; h: number } {
  const r = e.getBoundingClientRect();
  const sr = view.screen!.getBoundingClientRect();
  const s = view.scale;
  return { x: (r.left - sr.left) / s, y: (r.top - sr.top) / s, w: r.width / s, h: r.height / s };
}

export interface DragInfo {
  dx: number;
  dy: number;
  ev: PointerEvent;
}

/** Track a pointer drag after pointerdown, in logical pixels. */
export function trackDrag(start: PointerEvent, target: Element, move: (d: DragInfo) => void, up?: (d: DragInfo & { moved: boolean }) => void): void {
  const sx = start.clientX;
  const sy = start.clientY;
  let moved = false;
  try {
    (target as HTMLElement).setPointerCapture(start.pointerId);
  } catch {
    /* ignore */
  }
  const onMove = (ev: PointerEvent) => {
    const dx = (ev.clientX - sx) / view.scale;
    const dy = (ev.clientY - sy) / view.scale;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    move({ dx, dy, ev });
  };
  const onUp = (ev: PointerEvent) => {
    target.removeEventListener('pointermove', onMove as EventListener);
    target.removeEventListener('pointerup', onUp as EventListener);
    target.removeEventListener('pointercancel', onUp as EventListener);
    up?.({ dx: (ev.clientX - sx) / view.scale, dy: (ev.clientY - sy) / view.scale, ev, moved });
  };
  target.addEventListener('pointermove', onMove as EventListener);
  target.addEventListener('pointerup', onUp as EventListener);
  target.addEventListener('pointercancel', onUp as EventListener);
}

/** Tooltip text (shown by the tooltip layer). */
export function setTip(e: Element, t: string): void {
  const h = e as HTMLElement;
  if (h.dataset.tip !== t) h.dataset.tip = t;
}

/** Briefly invert an element (refused input). */
export function refuse(e: HTMLElement): void {
  e.classList.remove('refused');
  void e.offsetWidth;
  e.classList.add('refused');
  setTimeout(() => e.classList.remove('refused'), 300);
}

export function download(fileName: string, data: string | Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function chooseFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}
