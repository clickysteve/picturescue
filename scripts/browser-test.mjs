#!/usr/bin/env node
/**
 * Real-browser test of PICTURESCUE in headless Chromium (Playwright).
 *
 *   npm run test:browser        (builds, serves dist/ with `vite preview`, runs this)
 *
 * A fake Web MIDI device is injected before the app loads: one output ("Fake Synth") that
 * records every message with its timestamp. Everything else is the real app, driven with real
 * mouse and keyboard input. This does not test real MIDI hardware or audible sound.
 *
 * Environment: SHOTS=dir for screenshots (default: a temporary folder, printed at the end);
 * PORT (default 4179); CHROMIUM=path to a browser executable (default: Playwright's).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 4179);
const BASE = `http://localhost:${PORT}/`;
const work = mkdtempSync(join(tmpdir(), 'picturescue-browser-'));
const SHOTS = process.env.SHOTS || join(work, 'shots');
mkdirSync(SHOTS, { recursive: true });

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `: ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ a PNG to load (written here, no dependencies)
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * 4 + 1) + 1 + x * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pngPath = join(work, 'stripes.png');
writeFileSync(pngPath, png(200, 100, (x, y) => (Math.floor(x / 10) % 2 ? [250, 220, 40, 255] : [20, 40, 160 + (y % 50), 255])));
const badPath = join(work, 'not-a-picture.png');
writeFileSync(badPath, 'this is not a png');

// ------------------------------------------------------------------ server and browser
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
process.on('exit', () => server.kill('SIGTERM'));
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {
    /* not yet */
  }
  await sleep(250);
}

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.addInitScript(() => {
  window.__midi = [];
  const out = { id: 'fake-out', name: 'Fake Synth', manufacturer: 'Test', state: 'connected', send: (d, t) => window.__midi.push({ d: Array.from(d), t: t ?? performance.now() }), clear() {} };
  const access = { outputs: new Map([['fake-out', out]]), inputs: new Map(), addEventListener() {}, removeEventListener() {} };
  navigator.requestMIDIAccess = () => Promise.resolve(access);
  try {
    localStorage.clear();
  } catch {
    /* fine */
  }
});

const app = (f) => page.evaluate(f);
const key = async (k) => page.keyboard.press(k);
/** Centre of an element, by selector. */
async function centre(sel) {
  const b = await page.locator(sel).first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}
/** Screen position of a normalised picture point. */
async function picturePoint(nx, ny) {
  const b = await page.locator('.picture-area canvas').boundingBox();
  return { x: b.x + nx * b.width, y: b.y + ny * b.height };
}

try {
  console.log('PICTURESCUE browser test');
  await page.goto(BASE);
  await page.waitForFunction(() => window.picturescue && window.picturescue.analysis);
  await sleep(400);
  check('loads with a demo picture and no errors', errors.length === 0 && (await app(() => window.picturescue.source?.demo)) === 'st-lowres', errors.join(' | '));
  check('title and menus are there', (await page.title()) === 'PICTURESCUE' && (await page.locator('#menubar .menu').count()) >= 7);
  await page.screenshot({ path: join(SHOTS, '01-start.png') });

  // ---- load an image (file chooser)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.btn', { hasText: 'OPEN…' }).first().click()]);
  await chooser.setFiles(pngPath);
  await page.waitForFunction(() => window.picturescue.source?.name === 'stripes.png');
  const dims = await app(() => [window.picturescue.source.w, window.picturescue.source.h, window.picturescue.analysis.w]);
  check('loads a PNG from the file chooser', dims[0] === 200 && dims[1] === 100 && dims[2] === 200, JSON.stringify(dims));
  // a file that is not a picture gives a message, not a crash
  const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.btn', { hasText: 'OPEN…' }).first().click()]);
  await chooser2.setFiles(badPath);
  await page.waitForFunction(() => /could not be read/.test(window.picturescue.status));
  check('refuses a broken file with a message', (await app(() => window.picturescue.source?.name)) === 'stripes.png');

  // back to a demo for the rest
  await app(() => window.picturescue.loadDemo('city-lights'));
  await sleep(200);

  // ---- select a region on the picture
  let p = await picturePoint(0.8, 0.8);
  await page.mouse.click(p.x, p.y);
  check('clicking a region selects it', (await app(() => window.picturescue.selected)) === 3);
  await key('Digit2');
  check('key 2 selects region 2', (await app(() => window.picturescue.selected)) === 1);

  // ---- drag a region
  const before = await app(() => ({ ...window.picturescue.patch.regions[1] }));
  p = await picturePoint(before.x + before.w / 2, before.y + before.h / 2);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x - 60, p.y + 40, { steps: 6 });
  await page.mouse.up();
  const after = await app(() => ({ ...window.picturescue.patch.regions[1] }));
  check('dragging moves the region (inside the picture)', after.x < before.x && after.y > before.y && after.x >= 0 && after.y + after.h <= 1.0001, `${before.x.toFixed(2)},${before.y.toFixed(2)} → ${after.x.toFixed(2)},${after.y.toFixed(2)}`);
  // resize from the south-east handle
  const se = await picturePoint(after.x + after.w, after.y + after.h);
  await page.mouse.move(se.x, se.y);
  await page.mouse.down();
  await page.mouse.move(se.x - 30, se.y - 20, { steps: 4 });
  await page.mouse.up();
  const resized = await app(() => ({ ...window.picturescue.patch.regions[1] }));
  check('a handle resizes the region', resized.w < after.w && resized.h < after.h && Math.abs(resized.x - after.x) < 1e-9, `${after.w.toFixed(2)}×${after.h.toFixed(2)} → ${resized.w.toFixed(2)}×${resized.h.toFixed(2)}`);

  // ---- change the mapping with the PRESET selector
  const presetSel = page.locator('.mwin[data-win="region"] .msel[aria-label="PRESET"]');
  await presetSel.click();
  await page.locator('.msel-list .msel-item', { hasText: 'EDGES → RHYTHM' }).click();
  const m = await app(() => ({ ...window.picturescue.patch.regions[1] }));
  check('a mapping preset changes the mapping', m.trigger === 'edges' && m.velFrom === 'edges', JSON.stringify([m.pitchFrom, m.velFrom, m.trigger]));
  // MODE selector with the keyboard (arrows on a clicked selector)
  const modeSel = page.locator('.mwin[data-win="region"] .msel[aria-label="MODE"]');
  await modeSel.click();
  await page.locator('.msel-list .msel-item', { hasText: 'POINTILLIST' }).click();
  check('the MODE selector sets the interpretation mode', (await app(() => window.picturescue.patch.regions[1].mode)) === 'pointillist');
  // a number box: click and type
  const chBox = page.locator('.mwin[data-win="region"] .num[aria-label="CH"]');
  await chBox.click();
  await page.keyboard.type('7');
  await key('Enter');
  check('typing into a number box sets the MIDI channel', (await app(() => window.picturescue.patch.regions[1].channel)) === 7);

  // ---- MIDI: connect the fake output
  await key('Alt+KeyM');
  await page.waitForFunction(() => window.picturescue.midiAccess.status === 'ready');
  const outSel = page.locator('.mwin[data-win="midi"] .msel[aria-label="MIDI output"]');
  await outSel.click();
  await page.locator('.msel-list .msel-item', { hasText: 'Fake Synth' }).click();
  check('chooses a MIDI output', (await app(() => window.picturescue.midi.portName)) === 'Fake Synth');
  await page.locator('.mwin[data-win="midi"] .close').click();

  // ---- play with Space, watch the scan
  await page.mouse.click(5, 5); // focus the page, not a control
  await key('Escape');
  await key('Space');
  await sleep(300);
  check('Space starts playback', (await app(() => window.picturescue.transport.state)) === 'playing');
  const cur = async () => page.evaluate(() => [...document.querySelectorAll('[data-cursor]')].map((g) => [g.getAttribute('visibility'), g.querySelector('rect')?.getAttribute('x'), g.querySelector('rect')?.getAttribute('y')]));
  const c1 = await cur();
  await sleep(700);
  const c2 = await cur();
  check('scan cursors are visible', c2.filter((c) => c[0] === 'visible').length >= 3, JSON.stringify(c2));
  check('scan cursors move', JSON.stringify(c1) !== JSON.stringify(c2));
  await sleep(1500);
  await page.screenshot({ path: join(SHOTS, '02-playing.png') });
  const midi = await app(() => window.__midi);
  const ons = midi.filter((x) => (x.d[0] & 0xf0) === 0x90 && x.d[2] > 0);
  const chans = new Set(ons.map((x) => (x.d[0] & 15) + 1));
  const expectCh = await app(() => window.picturescue.patch.regions.filter((r) => r.enabled && !r.mute).map((r) => r.channel));
  check('MIDI notes arrive on the regions’ channels', ons.length > 5 && [...chans].every((c) => expectCh.includes(c)), `${ons.length} notes on ${[...chans]}`);
  check('the internal audio preview is running', await app(() => window.picturescue.audio.running));
  const levels = await page.evaluate(async () => {
    const out = {};
    for (const sound of ['sine', 'pluck', 'pad', 'perc', 'bell']) {
      const ctx = new OfflineAudioContext(1, 44100 * 3, 44100);
      const inst = new window.picturescueSynth(sound);
      const h = inst.start(ctx, ctx.destination, { time: 0.05, pitch: 60, velocity: 110 });
      h.release(0.6);
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0);
      let peak = 0;
      let tail = 0;
      for (let i = 0; i < d.length; i++) {
        peak = Math.max(peak, Math.abs(d[i]));
        if (i > d.length - 4410) tail = Math.max(tail, Math.abs(d[i]));
      }
      out[sound] = [Math.round(peak * 1000) / 1000, tail];
    }
    return out;
  });
  check('every preview sound makes sound and dies away after its release', Object.values(levels).every(([peak, tail]) => peak > 0.02 && peak < 1 && tail < 1e-4), JSON.stringify(levels));
  const posTxt = await page.locator('.mwin[data-win="transport"] .box').first().textContent();
  check('bar . beat is shown', /^\d{4} \. [1-4]$/.test(posTxt.trim()), posTxt);

  // ---- stop with Space: nothing left sounding
  await key('Space');
  await sleep(300);
  const all = await app(() => window.__midi);
  const sounding = new Set();
  for (const x of [...all].sort((a, b) => a.t - b.t)) {
    const st = x.d[0] & 0xf0;
    const k = `${x.d[0] & 15}:${x.d[1]}`;
    if (st === 0x90 && x.d[2] > 0) sounding.add(k);
    else if (st === 0x80 || (st === 0x90 && x.d[2] === 0)) sounding.delete(k);
  }
  check('Space stops, and no MIDI note is left hanging', (await app(() => window.picturescue.transport.state)) === 'stopped' && sounding.size === 0, [...sounding].join(' '));

  // ---- export MIDI
  await key('Control+KeyE');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.mwin[data-win="export"] .btn', { hasText: 'EXPORT MIDI FILE' }).click()]);
  const midPath = join(work, 'out.mid');
  await dl.saveAs(midPath);
  const mid = readFileSync(midPath);
  check('exports a Standard MIDI File', mid.subarray(0, 4).toString() === 'MThd' && mid.readUInt16BE(8) === 1 && mid.readUInt16BE(12) === 960, `${dl.suggestedFilename()}, ${mid.length} bytes`);
  await page.locator('.mwin[data-win="export"] .close').click();

  // ---- save and reopen a patch (with a loaded picture, embedded)
  const [chooser3] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.btn', { hasText: 'OPEN…' }).first().click()]);
  await chooser3.setFiles(pngPath);
  await page.waitForFunction(() => window.picturescue.source?.name === 'stripes.png');
  await app(() => {
    window.picturescue.patch.name = 'Browser Test';
    window.picturescue.patch.regions[0].mode = 'drone';
    window.picturescue.setSeedText('velvet harbour');
  });
  const [dl2] = await Promise.all([page.waitForEvent('download'), key('Control+KeyS')]);
  const patchPath = join(work, dl2.suggestedFilename());
  await dl2.saveAs(patchPath);
  const saved = JSON.parse(readFileSync(patchPath, 'utf8'));
  check('saves a patch with its picture embedded', saved.format === 'picturescue-patch' && saved.image.kind === 'embedded' && saved.image.width === 200 && saved.name === 'Browser Test', dl2.suggestedFilename());
  await app(() => window.picturescue.applyFactory('colour-drift'));
  await sleep(200);
  const [chooser4] = await Promise.all([page.waitForEvent('filechooser'), key('Control+Shift+KeyO')]);
  await chooser4.setFiles(patchPath);
  await page.waitForFunction(() => window.picturescue.patch.name === 'Browser Test');
  const reopened = await app(() => ({ mode: window.picturescue.patch.regions[0].mode, seed: window.picturescue.patch.seedText, src: window.picturescue.source?.name, w: window.picturescue.source?.w }));
  check('reopens the patch with its picture and settings', reopened.mode === 'drone' && reopened.seed === 'velvet harbour' && reopened.src === 'stripes.png' && reopened.w === 200, JSON.stringify(reopened));

  // ---- palettes
  await key('Alt+KeyP');
  await page.locator('.paletteeditor [data-palette="dark"]').dispatchEvent('pointerdown');
  await sleep(150);
  const paper = await app(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim());
  check('switching to the Dark palette restyles the interface', paper === '#17191c', paper);
  await page.locator('.mwin[data-win="palette"] .close').click();
  await app(() => window.picturescue.loadDemo('portrait'));
  await key('Space');
  await sleep(1200);
  await page.screenshot({ path: join(SHOTS, '03-dark.png') });
  await key('Space');
  await key('Alt+KeyP');
  await page.locator('.paletteeditor [data-palette="colour"]').dispatchEvent('pointerdown');
  await page.locator('.mwin[data-win="palette"] .close').click();
  await app(() => window.picturescue.loadDemo('four-colours'));
  await key('Space');
  await sleep(1200);
  await page.screenshot({ path: join(SHOTS, '04-colour.png') });
  await key('Space');
  const selected = await app(() => localStorage.getItem('picturescue.palette.selected'));
  check('the palette choice is remembered', selected === 'colour', selected);
  // the picture's own pixels are unchanged by the palette
  const px = await page.evaluate(() => {
    const c = document.querySelector('.picture-area canvas');
    return Array.from(c.getContext('2d').getImageData(5, 5, 1, 1).data);
  });
  const srcPx = await app(() => Array.from(window.picturescue.source.data.slice((5 * window.picturescue.source.w + 5) * 4, (5 * window.picturescue.source.w + 5) * 4 + 4)));
  check('the picture keeps its own colours under any palette', JSON.stringify(px) === JSON.stringify(srcPx), `${px} vs ${srcPx}`);

  // ---- views and help
  await key('Tab');
  check('Tab switches the VIEW', (await app(() => window.picturescue.prefs.view)) === 'brightness');
  await key('Tab');
  await key('Tab');
  await key('Tab');
  await page.screenshot({ path: join(SHOTS, '05-edges-view.png') });
  await app(() => {
    window.picturescue.prefs.view = 'picture';
    window.picturescue.changed('image');
  });
  check('no errors in the page', errors.length === 0, errors.join(' | '));
} catch (e) {
  failed++;
  console.log('  ✗ test crashed:', e?.message ?? e);
  await page.screenshot({ path: join(SHOTS, 'crash.png') }).catch(() => {});
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
console.log(`\nScreenshots: ${SHOTS}`);
console.log(failed ? `${failed} check(s) FAILED` : 'All browser checks passed.');
process.exit(failed ? 1 : 0);
