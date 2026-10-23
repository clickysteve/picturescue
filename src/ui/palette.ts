/**
 * PICTURESCUE's colour palettes: Slop Factory Core's palette system (the same model, presets,
 * palette files, preferences and editor as the other instruments), with PICTURESCUE's roles.
 * Purely cosmetic: a palette colours the interface, never the picture (the image's own
 * pixels are always shown and analysed as they are).
 *
 * Roles: Core's shared six, plus one per region (REGION 1-4: outlines, scan cursors and
 * activity lanes). They follow INK unless a palette gives them colours of their own, so in
 * CLASSIC (black and white) the regions are told apart by their line patterns and numbers.
 *
 * Built in: CLASSIC (Core's ATARI, the original 1-bit look, the default), DARK, COLOUR
 * (PICTURESCUE's own, a colour for each region), then Core's other shared presets.
 */
import { ATARI, DARK, PaletteLibrary, SHARED_PRESETS, SHARED_ROLES, SWAP_INK_PAPER, type Palette, type PaletteConfig } from '@slopfactory/core/palette';

export const CLASSIC: Palette = { ...ATARI, name: 'Classic' };

export const COLOUR: Palette = {
  id: 'colour',
  name: 'Colour',
  builtIn: true,
  colors: { desktop: '#23303a', paper: '#fbf8ef', ink: '#202020', dim: '#8c8576', r1: '#c0392b', r2: '#1d6a86', r3: '#2c7149', r4: '#8d2fa3', activity: '#d0372a', selection: '#2b78c9' },
};

/** Dark with region colours of its own. */
const DARK_REGIONS: Palette = { ...DARK, colors: { ...DARK.colors, r1: '#e3b65c', r2: '#7fa7d1', r3: '#9fcf8a', r4: '#e08fb0' } };

export const PICTURESCUE_PALETTES: PaletteConfig = {
  app: 'picturescue',
  roles: [
    ...SHARED_ROLES.slice(0, 4),
    { id: 'r1', label: 'Region 1', help: 'region 1 outline, scan cursor and lane', css: '--r1', contrast: 2, from: 'ink' },
    { id: 'r2', label: 'Region 2', help: 'region 2 outline, scan cursor and lane', css: '--r2', contrast: 2, from: 'ink' },
    { id: 'r3', label: 'Region 3', help: 'region 3 outline, scan cursor and lane', css: '--r3', contrast: 2, from: 'ink' },
    { id: 'r4', label: 'Region 4', help: 'region 4 outline, scan cursor and lane', css: '--r4', contrast: 2, from: 'ink' },
    ...SHARED_ROLES.slice(4),
  ],
  builtIns: [CLASSIC, DARK_REGIONS, COLOUR, ...SHARED_PRESETS.filter((p) => p.id !== ATARI.id && p.id !== DARK.id)],
  // palettes made in the other Slop Factory instruments import by the roles they share
  accept: ['emmm-palette', 'breakery-palette', 'downbeat-palette', 'anvil-palette'],
  extraCss: () => `.flash{filter:none;${SWAP_INK_PAPER}}\n@keyframes mrefuse{0%,49%{filter:none;${SWAP_INK_PAPER}}50%,100%{filter:none}}\n`,
};

export function paletteLibrary(): PaletteLibrary {
  return new PaletteLibrary(PICTURESCUE_PALETTES);
}
