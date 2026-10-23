/**
 * PICTURESCUE's controls, in the Slop Factory's GEM vocabulary (as emmm draws it): the
 * window frame with its slanted title tab, number boxes (drag up/down, or click and type, or
 * ↑ ↓), pop-up selectors, buttons, text fields, tooltips and dialogs.
 *
 * Keyboard: a clicked number box takes digits and arrows; a text field takes everything.
 * Space is never taken by a control, so it always reaches the transport.
 */
import { clamp } from '../engine/mapping';
import { el, place, refuse, screenRect, setTip, svgEl, trackDrag, view } from './dom';

// ---------------------------------------------------------------------------- windows

let zTop = 10;

export interface WindowOpts {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  closable?: boolean;
  onClose?: () => void;
}

export class MWindow {
  el: HTMLDivElement;
  body: HTMLDivElement;
  titleEl: HTMLDivElement;
  infoEl: HTMLDivElement;
  constructor(
    parent: HTMLElement,
    public o: WindowOpts,
  ) {
    this.el = el('div', 'mwin', parent, [o.x, o.y, o.w, o.h]);
    this.el.dataset.win = o.id;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', o.title);
    const tb = el('div', 'titlebar', this.el);
    if (o.closable) {
      const c = el('div', 'close', tb);
      c.appendChild(svgEl(13, 15, `<rect x="3.5" y="3.5" width="8" height="8" fill="var(--paper)" stroke="var(--ink)"/>`));
      setTip(c, 'Close');
      c.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.close();
      });
    }
    this.titleEl = el('div', 'title', tb, undefined, o.title);
    const slant = el('div', 'slant', tb);
    slant.appendChild(svgEl(16, 16, `<polygon points="0,0 1,0 16,15.5 0,15.5" fill="var(--paper)"/><line x1="0.5" y1="0" x2="16" y2="15.5" stroke="var(--ink)"/>`));
    el('div', 'titlefill', tb);
    this.infoEl = el('div', 'titleinfo hidden', tb);
    this.body = el('div', 'body', this.el);
    this.body.style.height = o.h - 18 + 'px';
    tb.addEventListener('pointerdown', (ev) => this.dragStart(ev));
    this.el.addEventListener('pointerdown', () => this.front(), true);
  }

  front(): void {
    this.el.style.zIndex = String(++zTop);
  }

  setTitle(t: string): void {
    if (this.titleEl.textContent !== t) this.titleEl.textContent = t;
  }

  setInfo(t: string): void {
    this.infoEl.classList.toggle('hidden', !t);
    if (this.infoEl.textContent !== t) this.infoEl.textContent = t;
  }

  private dragStart(ev: PointerEvent): void {
    this.front();
    const x0 = this.o.x;
    const y0 = this.o.y;
    trackDrag(ev, ev.currentTarget as Element, ({ dx, dy }) => {
      this.o.x = Math.round(x0 + dx);
      this.o.y = Math.max(16, Math.round(y0 + dy));
      place(this.el, this.o.x, this.o.y);
    });
  }

  show(): void {
    this.el.classList.remove('hidden');
    this.front();
  }

  close(): void {
    this.el.classList.add('hidden');
    this.o.onClose?.();
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }
}

// ---------------------------------------------------------------------------- number box

export interface NumOpts {
  get: () => number;
  set: (v: number) => void;
  min: number;
  max: number;
  /** step for ↑ ↓ and dragging (default 1) */
  step?: number;
  /** step with Shift (default 10 steps) */
  big?: number;
  format?: (v: number) => string;
  /** typed text → value (default: a number) */
  parse?: (t: string) => number | null;
  /** logical px of drag per step (default 3) */
  pxPerStep?: number;
  tip?: string;
  disabled?: () => boolean;
}

/** Which control is being typed into (it owns the keyboard until Enter / Escape). */
export const typing = { active: null as { cancel(): void } | null };

export class Num {
  el: HTMLDivElement;
  private editing = false;
  private buf = '';
  constructor(parent: HTMLElement, x: number, y: number, w: number, h: number, private o: NumOpts) {
    this.el = el('div', 'num', parent, [x, y, w, h]);
    this.el.tabIndex = -1;
    this.el.setAttribute('role', 'spinbutton');
    this.el.setAttribute('aria-valuemin', String(o.min));
    this.el.setAttribute('aria-valuemax', String(o.max));
    if (o.tip) setTip(this.el, o.tip + ' (drag up/down, or click and type, ↑ ↓)');
    this.el.addEventListener('pointerdown', (ev) => this.down(ev));
    this.el.addEventListener('keydown', (e) => this.key(e));
    this.el.addEventListener('blur', () => this.editing && this.commit());
    this.el.addEventListener(
      'wheel',
      (e) => {
        if (document.activeElement !== this.el) return;
        e.preventDefault();
        this.nudge(e.deltaY < 0 ? 1 : -1, e.shiftKey);
      },
      { passive: false },
    );
    this.update();
  }

  private get step(): number {
    return this.o.step ?? 1;
  }

  private round(v: number): number {
    const s = this.step;
    const r = Math.round(v / s) * s;
    return clamp(Number(r.toFixed(6)), this.o.min, this.o.max);
  }

  private apply(v: number): void {
    const r = this.round(v);
    if (r !== this.o.get()) this.o.set(r);
    this.update();
  }

  nudge(dir: number, big = false): void {
    this.apply(this.o.get() + dir * (big ? (this.o.big ?? this.step * 10) : this.step));
  }

  private down(ev: PointerEvent): void {
    if (this.o.disabled?.()) return;
    ev.preventDefault();
    if (this.editing) return;
    this.el.focus();
    const v0 = this.o.get();
    const px = this.o.pxPerStep ?? 3;
    trackDrag(ev, this.el, ({ dy, ev: e }) => {
      const steps = Math.round(-dy / px);
      this.apply(v0 + steps * (e.shiftKey ? (this.o.big ?? this.step * 10) : this.step));
    });
  }

  private key(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey) return;
    const k = e.key;
    if (this.editing) {
      e.stopPropagation();
      e.preventDefault();
      if (k === 'Enter') this.commit();
      else if (k === 'Escape') this.cancel();
      else if (k === 'Backspace') this.buf = this.buf.slice(0, -1);
      else if (/^[0-9.\-#a-gA-G]$/.test(k) && this.buf.length < 8) this.buf += k;
      this.render();
      return;
    }
    if (/^[0-9.\-]$/.test(k)) {
      e.stopPropagation();
      e.preventDefault();
      this.begin(k);
    } else if (k === 'Enter') {
      e.stopPropagation();
      e.preventDefault();
      this.begin('');
    } else if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'PageUp' || k === 'PageDown') {
      e.stopPropagation();
      e.preventDefault();
      this.nudge(k === 'ArrowUp' || k === 'PageUp' ? 1 : -1, e.shiftKey || k.startsWith('Page'));
    } else if (k === 'Home' || k === 'End') {
      e.stopPropagation();
      e.preventDefault();
      this.apply(k === 'Home' ? this.o.min : this.o.max);
    } else if (k === 'Escape') this.el.blur();
  }

  begin(first: string): void {
    typing.active?.cancel();
    this.editing = true;
    this.buf = first;
    typing.active = { cancel: () => this.cancel() };
    this.el.classList.add('editing');
    this.render();
  }

  private commit(): void {
    const t = this.buf.trim();
    this.stopEdit();
    if (!t) return this.update();
    const v = this.o.parse ? this.o.parse(t) : /^-?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : null;
    if (v === null || !Number.isFinite(v)) {
      refuse(this.el);
      return this.update();
    }
    this.apply(v);
  }

  cancel(): void {
    this.stopEdit();
    this.update();
  }

  private stopEdit(): void {
    this.editing = false;
    this.el.classList.remove('editing');
    if (typing.active) typing.active = null;
  }

  private render(): void {
    this.el.textContent = this.buf + '▏';
  }

  update(): void {
    if (this.editing) return;
    const v = this.o.get();
    const t = this.o.format ? this.o.format(v) : String(v);
    if (this.el.textContent !== t) this.el.textContent = t;
    this.el.setAttribute('aria-valuenow', String(v));
    this.el.classList.toggle('disabled', !!this.o.disabled?.());
  }
}

// ---------------------------------------------------------------------------- selector

export interface SelItem<T> {
  value: T;
  label: string;
  tip?: string;
}

export interface SelOpts<T> {
  items: () => SelItem<T>[];
  get: () => T;
  set: (v: T) => void;
  tip?: string;
  /** a fixed caption instead of the current value (a menu button) */
  caption?: string;
  disabled?: () => boolean;
}

let openList: { close(): void } | null = null;
export function closeSelectors(): void {
  openList?.close();
}

export class Sel<T> {
  el: HTMLDivElement;
  private textEl: HTMLSpanElement;
  constructor(parent: HTMLElement, x: number, y: number, w: number, h: number, private o: SelOpts<T>) {
    this.el = el('div', 'msel', parent, [x, y, w, h]);
    this.el.tabIndex = -1;
    this.el.setAttribute('role', 'combobox');
    this.textEl = el('span', 'msel-text', this.el);
    el('span', 'msel-arrow', this.el);
    if (o.tip) setTip(this.el, o.tip);
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.o.disabled?.()) return;
      if (this.el.classList.contains('open')) closeSelectors();
      else this.openList();
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        const items = this.o.items();
        const i = items.findIndex((it) => it.value === this.o.get());
        const n = clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1);
        this.o.set(items[n]!.value);
        this.update();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.openList();
      }
    });
    this.update();
  }

  openList(): void {
    closeSelectors();
    const items = this.o.items();
    const r = screenRect(this.el);
    const list = el('div', 'msel-list', view.screen!);
    list.setAttribute('role', 'listbox');
    const cur = this.o.get();
    let hot = Math.max(0, items.findIndex((it) => it.value === cur));
    const rows: HTMLDivElement[] = [];
    const choose = (i: number) => {
      close();
      this.o.set(items[i]!.value);
      this.update();
      this.el.focus();
    };
    items.forEach((it, i) => {
      const d = el('div', 'msel-item' + (it.value === cur ? ' checked' : ''), list, undefined, it.label);
      d.setAttribute('role', 'option');
      if (it.tip) setTip(d, it.tip);
      d.addEventListener('pointerenter', () => setHot(i));
      d.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        choose(i);
      });
      d.addEventListener('pointerdown', (e) => e.stopPropagation());
      rows.push(d);
    });
    const setHot = (i: number) => {
      rows[hot]?.classList.remove('hot');
      hot = i;
      rows[hot]?.classList.add('hot');
      rows[hot]?.scrollIntoView({ block: 'nearest' });
    };
    setHot(hot);
    list.style.minWidth = r.w + 'px';
    // below the control, or above it when there is no room
    const H = view.screen!.offsetHeight;
    list.style.left = r.x + 'px';
    const below = r.y + r.h;
    list.style.top = below + 'px';
    requestAnimationFrame(() => {
      const lh = list.offsetHeight;
      if (below + lh > H - 2) list.style.top = Math.max(16, r.y - lh) + 'px';
      const W = view.screen!.offsetWidth;
      if (r.x + list.offsetWidth > W - 2) list.style.left = Math.max(0, W - 2 - list.offsetWidth) + 'px';
    });
    this.el.classList.add('open');
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.key === 'ArrowDown') setHot(Math.min(items.length - 1, hot + 1));
      else if (e.key === 'ArrowUp') setHot(Math.max(0, hot - 1));
      else if (e.key === 'Enter' || e.key === ' ') choose(hot);
      else if (e.key === 'Escape') close();
    };
    const onDown = () => close();
    const close = () => {
      list.remove();
      this.el.classList.remove('open');
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown);
      if (openList === handle) openList = null;
    };
    const handle = { close };
    openList = handle;
    window.addEventListener('keydown', onKey, true);
    setTimeout(() => window.addEventListener('pointerdown', onDown), 0);
  }

  update(): void {
    const v = this.o.get();
    const it = this.o.items().find((x) => x.value === v);
    const t = this.o.caption ?? it?.label ?? '—';
    if (this.textEl.textContent !== t) this.textEl.textContent = t;
    this.el.classList.toggle('disabled', !!this.o.disabled?.());
  }
}

// ---------------------------------------------------------------------------- buttons

export interface BtnOpts {
  onClick: (e: PointerEvent) => void;
  on?: () => boolean;
  disabled?: () => boolean;
  tip?: string;
  round?: boolean;
}

export class Btn {
  el: HTMLDivElement;
  constructor(parent: HTMLElement, x: number, y: number, w: number, h: number, label: string | SVGSVGElement, private o: BtnOpts) {
    this.el = el('div', 'btn' + (o.round ? ' round' : ''), parent, [x, y, w, h]);
    this.el.setAttribute('role', 'button');
    if (typeof label === 'string') this.el.textContent = label;
    else this.el.appendChild(label);
    if (o.tip) setTip(this.el, o.tip);
    this.el.addEventListener('pointerdown', (e) => {
      if (this.o.disabled?.()) return;
      e.preventDefault();
      this.el.classList.add('pressed');
      const up = () => {
        this.el.classList.remove('pressed');
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointerup', up);
    });
    this.el.addEventListener('click', (e) => {
      if (this.o.disabled?.()) return;
      this.o.onClick(e as PointerEvent);
      this.update();
    });
    this.update();
  }

  setLabel(t: string): void {
    if (this.el.textContent !== t) this.el.textContent = t;
  }

  update(): void {
    this.el.classList.toggle('on', !!this.o.on?.());
    this.el.classList.toggle('disabled', !!this.o.disabled?.());
    if (this.o.on) this.el.setAttribute('aria-pressed', String(!!this.o.on()));
  }
}

/** A text field; keys typed in it never reach the shortcuts. */
export function textField(parent: HTMLElement, x: number, y: number, w: number, h: number, o: { get: () => string; set: (t: string) => void; tip?: string; label?: string }): { el: HTMLInputElement; update(): void } {
  const input = el('input', 'mtext', parent, [x, y, w, h]);
  input.type = 'text';
  input.spellcheck = false;
  input.style.position = 'absolute';
  if (o.label) input.setAttribute('aria-label', o.label);
  if (o.tip) setTip(input, o.tip);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      o.set(input.value);
      input.blur();
    } else if (e.key === 'Escape') {
      input.value = o.get();
      input.blur();
    }
  });
  input.addEventListener('change', () => o.set(input.value));
  input.addEventListener('focus', () => input.select());
  const update = () => {
    if (document.activeElement !== input && input.value !== o.get()) input.value = o.get();
  };
  update();
  return { el: input, update };
}

// ---------------------------------------------------------------------------- tooltips

export function installTooltips(screen: HTMLElement): void {
  const tip = el('div', 'mtip hidden', screen);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let target: HTMLElement | null = null;
  const hide = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    tip.classList.add('hidden');
    target = null;
  };
  screen.addEventListener('pointerover', (e) => {
    const t = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
    if (t === target) return;
    hide();
    if (!t || !t.dataset.tip) return;
    target = t;
    timer = setTimeout(() => {
      if (!target?.isConnected) return;
      tip.textContent = target.dataset.tip ?? '';
      tip.classList.remove('hidden');
      const r = screenRect(target);
      const W = screen.offsetWidth;
      const H = screen.offsetHeight;
      let x = r.x;
      let y = r.y + r.h + 3;
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      if (x + tw > W - 2) x = W - 2 - tw;
      if (y + th > H - 2) y = r.y - th - 3;
      place(tip, Math.max(2, x), Math.max(16, y));
    }, 650);
  });
  screen.addEventListener('pointerdown', hide, true);
  screen.addEventListener('pointerleave', hide);
}

// ---------------------------------------------------------------------------- dialogs

let dialogOpen: (() => void) | null = null;

export function dialogActive(): boolean {
  return !!dialogOpen;
}

function dialog(screen: HTMLElement, message: string, buttons: { label: string; value: boolean; default?: boolean }[]): Promise<boolean> {
  dialogOpen?.();
  return new Promise((resolve) => {
    const d = el('div', 'mdialog', screen);
    d.setAttribute('role', 'alertdialog');
    d.style.width = '320px';
    const msg = el('div', '', d);
    msg.style.whiteSpace = 'pre-wrap';
    msg.textContent = message;
    const row = el('div', 'buttons', d);
    const done = (v: boolean) => {
      d.remove();
      window.removeEventListener('keydown', onKey, true);
      dialogOpen = null;
      resolve(v);
    };
    for (const b of buttons) {
      const btn = el('button', 'mbutton' + (b.default ? ' default' : ''), row, undefined, b.label);
      btn.addEventListener('click', () => done(b.value));
    }
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        done(buttons.find((b) => b.default)?.value ?? true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        done(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    dialogOpen = () => done(false);
    requestAnimationFrame(() => place(d, Math.round((screen.offsetWidth - d.offsetWidth) / 2), Math.round((screen.offsetHeight - d.offsetHeight) / 3)));
  });
}

export function alertDialog(screen: HTMLElement, message: string): Promise<boolean> {
  return dialog(screen, message, [{ label: 'OK', value: true, default: true }]);
}

export function confirmDialog(screen: HTMLElement, message: string, ok = 'OK'): Promise<boolean> {
  return dialog(screen, message, [
    { label: 'Cancel', value: false },
    { label: ok, value: true, default: true },
  ]);
}
