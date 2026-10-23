/**
 * Loading pictures in the browser.
 *
 * The browser decodes the file (PNG, JPEG, WebP, GIF, BMP: whatever it supports). A picture
 * larger than SOURCE_MAX on its longest side is drawn down to that size once, on loading
 * (the only time the browser's own scaling is used); those source pixels are then kept,
 * displayed, analysed and embedded in patches, so the music never depends on the window size
 * or on scaling again.
 *
 * GIF policy: animated GIFs play their FIRST FRAME only (a still picture).
 */
import { demoById, demoPixels } from '../engine/demos';
import { SOURCE_MAX, type ImageRef } from '../engine/types';
import { decodePixels, encodePixels } from '../persistence/pixels';

export interface Source {
  name: string;
  /** kept pixels */
  w: number;
  h: number;
  data: Uint8ClampedArray;
  /** the file's own size */
  originalW: number;
  originalH: number;
  /** set for demo pictures */
  demo?: string;
}

export const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,.png,.jpg,.jpeg,.webp,.gif,.bmp';
export const MAX_FILE_BYTES = 60 * 1024 * 1024;
const KNOWN = /\.(png|jpe?g|webp|gif|bmp)$/i;

export class PictureError extends Error {}

export function capDims(w: number, h: number, max = SOURCE_MAX): { w: number; h: number } {
  const l = Math.max(w, h);
  if (l <= max) return { w, h };
  return { w: Math.max(1, Math.round((w * max) / l)), h: Math.max(1, Math.round((h * max) / l)) };
}

function canvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new PictureError('This browser cannot read pictures (no canvas).');
  return g;
}

async function decode(blob: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; close(): void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const b = await createImageBitmap(blob);
      return { img: b, w: b.width, h: b.height, close: () => b.close() };
    } catch {
      /* fall back to an <img> */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { img, w: img.naturalWidth, h: img.naturalHeight, close: () => {} };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Decode any image blob into source pixels. */
export async function sourceFromBlob(blob: Blob, name: string): Promise<Source> {
  let d: Awaited<ReturnType<typeof decode>>;
  try {
    d = await decode(blob);
  } catch {
    throw new PictureError(`“${name}” could not be read as a picture. PNG, JPEG, WebP, GIF and BMP files work (BMP where the browser supports it).`);
  }
  try {
    if (!d.w || !d.h) throw new PictureError(`“${name}” has no pixels.`);
    const { w, h } = capDims(d.w, d.h);
    const g = canvas(w, h);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.clearRect(0, 0, w, h);
    g.drawImage(d.img, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h).data;
    return { name, w, h, data, originalW: d.w, originalH: d.h };
  } finally {
    d.close();
  }
}

export async function sourceFromFile(file: File): Promise<Source> {
  if (file.size > MAX_FILE_BYTES) throw new PictureError(`“${file.name}” is too large (${Math.round(file.size / 1048576)} MB; the limit is ${MAX_FILE_BYTES / 1048576} MB).`);
  if (!file.type.startsWith('image/') && !KNOWN.test(file.name)) throw new PictureError(`“${file.name}” is not a picture. Use a PNG, JPEG, WebP, GIF or BMP file.`);
  if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) throw new PictureError('SVG drawings are not supported: export the drawing as PNG first.');
  return sourceFromBlob(file, file.name);
}

export function sourceFromDemo(id: string): Source | null {
  const px = demoPixels(id);
  const d = demoById(id);
  if (!px || !d) return null;
  return { name: d.name, w: px.w, h: px.h, data: px.data, originalW: px.w, originalH: px.h, demo: id };
}

/** The picture a patch refers to. Throws PictureError if an embedded picture is damaged. */
export async function sourceFromRef(ref: ImageRef): Promise<Source | null> {
  if (ref.kind === 'none') return null;
  if (ref.kind === 'demo') return sourceFromDemo(ref.id);
  if (ref.encoding === 'dataurl') {
    const blob = await (await fetch(ref.data)).blob();
    return sourceFromBlob(blob, ref.name);
  }
  try {
    const data = await decodePixels(ref.data, ref.width, ref.height);
    return { name: ref.name, w: ref.width, h: ref.height, data, originalW: ref.originalW ?? ref.width, originalH: ref.originalH ?? ref.height };
  } catch (e) {
    throw new PictureError(e instanceof Error ? e.message : 'The embedded picture is damaged.');
  }
}

/** How a patch refers to a source: demo by id, anything else embedded losslessly. */
export async function refFromSource(src: Source | null): Promise<ImageRef> {
  if (!src) return { kind: 'none' };
  if (src.demo) return { kind: 'demo', id: src.demo };
  return { kind: 'embedded', name: src.name, width: src.w, height: src.h, encoding: 'rgba-delta-deflate', data: await encodePixels(src.data, src.w, src.h), originalW: src.originalW, originalH: src.originalH };
}
