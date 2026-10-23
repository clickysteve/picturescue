/**
 * Lossless picture embedding for patches. The RGBA pixels are split into four planes, each
 * row delta-filtered (every value minus its left neighbour, as PNG's Sub filter), deflated
 * with the browser's CompressionStream and base64-encoded. Decoding gives back exactly the
 * same bytes, with no browser colour management or premultiplied-alpha rounding in the way,
 * so a reopened patch analyses the very same pixels.
 */

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function encodePixels(data: Uint8ClampedArray | Uint8Array, w: number, h: number): Promise<string> {
  const n = w * h;
  const planes = new Uint8Array(n * 4);
  for (let c = 0; c < 4; c++) {
    for (let y = 0; y < h; y++) {
      let prev = 0;
      for (let x = 0; x < w; x++) {
        const v = data[(y * w + x) * 4 + c]!;
        planes[c * n + y * w + x] = (v - prev) & 255;
        prev = v;
      }
    }
  }
  return toBase64(await pipe(planes, new CompressionStream('deflate')));
}

export class PixelError extends Error {}

export async function decodePixels(b64: string, w: number, h: number): Promise<Uint8ClampedArray> {
  let planes: Uint8Array;
  try {
    planes = await pipe(fromBase64(b64), new DecompressionStream('deflate'));
  } catch {
    throw new PixelError('The embedded picture is damaged.');
  }
  const n = w * h;
  if (planes.length !== n * 4) throw new PixelError('The embedded picture has the wrong size.');
  const out = new Uint8ClampedArray(n * 4);
  for (let c = 0; c < 4; c++) {
    for (let y = 0; y < h; y++) {
      let prev = 0;
      for (let x = 0; x < w; x++) {
        prev = (prev + planes[c * n + y * w + x]!) & 255;
        out[(y * w + x) * 4 + c] = prev;
      }
    }
  }
  return out;
}
