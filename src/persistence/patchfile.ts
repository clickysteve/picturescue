/**
 * Patch files: portable JSON (".picturescue.json"). A patch carries the whole musical
 * configuration and its picture (a demo id, or the pixels embedded losslessly), so it opens
 * the same anywhere. Loading is forgiving about missing fields (they take the defaults, so
 * older patches open in newer versions) and strict about what cannot be right.
 */
import { clonePatch, PATCH_FORMAT, PATCH_VERSION, sanitisePatch, type Patch } from '../engine/types';

export class PatchError extends Error {}

export const PATCH_EXT = '.picturescue.json';

/** Patches above this size get a warning (the picture is at most 640 px, so this is rare). */
export const LARGE_PATCH = 4 * 1024 * 1024;

export function serialisePatch(p: Patch): string {
  const c = clonePatch(p);
  c.format = PATCH_FORMAT;
  c.version = PATCH_VERSION;
  return JSON.stringify(c, null, 1);
}

export interface ParsedPatch {
  patch: Patch;
  warnings: string[];
}

export function parsePatch(text: string): ParsedPatch {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    throw new PatchError('The file is not a PICTURESCUE patch (it is not valid JSON).');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new PatchError('The file is not a PICTURESCUE patch.');
  const r = o as Record<string, unknown>;
  if (r.format !== PATCH_FORMAT) throw new PatchError(r.format === undefined ? 'The file is not a PICTURESCUE patch (no format).' : `The file is not a PICTURESCUE patch (${String(r.format)}).`);
  const version = Number(r.version);
  if (!Number.isInteger(version) || version < 1) throw new PatchError('The patch has no valid version number.');
  if (version > PATCH_VERSION) throw new PatchError(`This patch was made by a newer PICTURESCUE (format v${version}).`);
  const warnings: string[] = [];
  const patch = sanitisePatch(o);
  const img = r.image as Record<string, unknown> | undefined;
  if (img && img.kind && img.kind !== 'none' && patch.image.kind === 'none') warnings.push('The patch’s picture could not be read; it opened without one.');
  if (!Array.isArray(r.regions) || r.regions.length < 4) warnings.push('Some regions were missing and took their default settings.');
  return { patch, warnings };
}

export function patchFileName(p: Patch): string {
  const base = p.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'patch';
  return base + PATCH_EXT;
}
