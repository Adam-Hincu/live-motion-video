/**
 * Collage tool: packs any set of images into captioned contact-sheet collages.
 * Needs `sharp` (run `npm install` in this folder).
 *
 * Rules
 * - Images keep their aspect ratio; rows are justified to fill the full canvas width.
 * - The shorter side of every image is >= minSize (default 300 px).
 * - As many images as possible go on each collage; when the next one cannot fit without
 *   dropping below minSize, a new collage starts.
 * - Each collage uses the largest layout that fits, so a short last collage gets bigger
 *   images instead of leaving empty space. Its height is trimmed to the content.
 * - Under every image: a caption (default "<filename>  <width>x<height>").
 *
 * CLI (--out is required; every run gets its own folder inside it):
 *   node collage.mjs <files or folders...> --out collages [--name my-run] [--width 2400]
 *     [--height 1600] [--gap 24] [--min-size 300] [--caption-height 44] [--no-captions]
 *     [--format jpg|png]
 *   -> collages/<name or collage-YYYYMMDD-HHMMSS>/collage-01.jpg ... + manifest.json
 *
 * Library:
 *   import { createCollages } from '../collage/collage.mjs';
 *   const { collages } = await createCollages(
 *     ['a.jpg', { path: 'b.png', caption: 'custom text' }],
 *     { outDir: 'path/to/folder' }); // files are written straight into outDir
 */

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|tiff?|heic|svg)$/i;
const xmlEscape = (t) => String(t).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

/** Load `sharp` with a clear error when the tool has not been set up yet. */
export async function getSharp() {
  try { return (await import('sharp')).default; } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    throw new Error('Missing dependency "sharp": run `npm install` in tools/collage');
  }
}

/** Real displayed size of an image file or buffer (EXIF rotation applied) plus its format. */
export async function readImageInfo(input) {
  const sharp = await getSharp();
  const meta = await sharp(input, { failOn: 'none' }).metadata();
  const swap = meta.orientation >= 5;
  const width = swap ? meta.height : meta.width, height = swap ? meta.width : meta.height;
  if (!width || !height) throw new Error('unreadable image');
  return { width, height, format: meta.format };
}

/**
 * Best justified-row layout for images with aspect ratios `asp`, or null when they cannot
 * fit on one canvas (inner size o.width x o.height) with every shorter side >= o.minSize.
 * Among row counts the one using the most vertical space wins.
 */
function bestLayout(asp, o) {
  const n = asp.length, { width: W, height: H, gap, caption: cap, minSize } = o;
  const rowH = (i, j) => {
    let sum = 0, minA = 1;
    for (let t = i; t < j; t++) { sum += asp[t]; minA = Math.min(minA, asp[t]); }
    const h = (W - (j - i - 1) * gap) / sum;
    if (h * minA < minSize - 1e-6 || h + cap > H) return Infinity;
    return h;
  };
  const cost = Array.from({ length: n }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (j > i ? rowH(i, j) : Infinity)));
  let best = null;
  let prev = Array(n + 1).fill(Infinity);
  prev[0] = 0;
  const parents = [];
  for (let r = 1; r <= n; r++) {
    const cur = Array(n + 1).fill(Infinity), par = Array(n + 1).fill(-1);
    for (let j = 1; j <= n; j++) {
      for (let i = r - 1; i < j; i++) {
        const v = prev[i] + cost[i][j] + cap;
        if (v < cur[j]) { cur[j] = v; par[j] = i; }
      }
    }
    parents.push(par);
    const total = cur[n] + (r - 1) * gap;
    if (total <= H && (!best || total > best.total)) best = { total, r };
    prev = cur;
  }
  if (!best) return null;
  const cuts = [n];
  for (let r = best.r, j = n; r >= 1; r--) { j = parents[r - 1][j]; cuts.unshift(j); }
  const rows = [];
  let y = 0;
  for (let k = 0; k < cuts.length - 1; k++) {
    const i = cuts[k], j = cuts[k + 1], h = Math.round(cost[i][j]);
    const tiles = [];
    let x = 0, sum = 0;
    for (let t = i; t < j; t++) sum += asp[t];
    const avail = W - (j - i - 1) * gap;
    for (let t = i; t < j; t++) {
      const w = t === j - 1 ? W - x : Math.round((asp[t] / sum) * avail);
      tiles.push({ index: t, x, y, w, h });
      x += w + gap;
    }
    rows.push(tiles);
    y += h + cap + gap;
  }
  return { rows, height: y - gap };
}

/** Greedily put as many images as fit on each collage page. */
function layoutPages(images, o) {
  const pages = [];
  for (let i = 0; i < images.length;) {
    let best = null, n = 0;
    // Feasibility is not strictly monotonic in the image count (12 may not fit while 13
    // does, because row breaks shift), so keep scanning a while past the first failure.
    for (let k = 1, misses = 0; i + k <= images.length && misses < 12; k++) {
      const lay = bestLayout(images.slice(i, i + k).map((im) => im.width / im.height), o);
      if (!lay) { if (best) misses++; continue; }
      best = lay; n = k; misses = 0;
    }
    if (!best) {
      // Too extreme for the min size: show it alone, scaled to fit the canvas.
      const im = images[i], scale = Math.min(o.width / im.width, (o.height - o.caption) / im.height);
      const w = Math.round(im.width * scale), h = Math.round(im.height * scale);
      best = { rows: [[{ index: 0, x: Math.round((o.width - w) / 2), y: 0, w, h }]], height: h + o.caption };
      n = 1;
    }
    pages.push({ images: images.slice(i, i + n), layout: best });
    i += n;
  }
  return pages;
}

async function renderPage(sharp, page, o, file) {
  const pad = o.gap, W = o.width + 2 * pad, H = page.layout.height + 2 * pad;
  const composites = [], labels = [];
  for (const tile of page.layout.rows.flat()) {
    const im = page.images[tile.index];
    const input = await sharp(im.path, { failOn: 'none' }).rotate().resize(tile.w, tile.h, { fit: 'fill' })
      .flatten({ background: '#ffffff' }).png().toBuffer();
    composites.push({ input, left: pad + tile.x, top: pad + tile.y });
    if (o.caption) {
      const size = Math.max(9, Math.min(o.caption * 0.5, tile.w / (im.caption.length * 0.62)));
      labels.push(`<text x="${pad + tile.x}" y="${pad + tile.y + tile.h + o.caption * 0.68}" font-size="${size.toFixed(1)}">${xmlEscape(im.caption)}</text>`);
    }
  }
  if (labels.length) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><g font-family="Arial, Helvetica, sans-serif" fill="#222222">${labels.join('')}</g></svg>`;
    composites.push({ input: Buffer.from(svg), left: 0, top: 0 });
  }
  const canvas = sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).composite(composites);
  await (o.format === 'png' ? canvas.png() : canvas.jpeg({ quality: 92 })).toFile(file);
  return { width: W, height: H };
}

/**
 * Build collages from `images` (paths, or { path, caption?, width?, height? }) and write them
 * into `options.outDir` (required, used exactly as given). Unreadable files are skipped.
 * Options: width 2400, height 1600 (max canvas incl. outer margin), gap 24 (between images and
 * around the edge), minSize 300, captionHeight 44, captions true, format 'jpg'|'png', prefix 'collage'.
 * Returns { outDir, collages: [{ file, path, width, height, images: [{ path, caption, width, height }] }], skipped }.
 */
export async function createCollages(images, options = {}) {
  if (!options.outDir || typeof options.outDir !== 'string') throw new TypeError('createCollages: options.outDir is required');
  const { mkdir } = await import('node:fs/promises');
  const { basename, resolve } = await import('node:path');
  const sharp = await getSharp();
  const gap = options.gap ?? 24;
  const format = options.format === 'png' ? 'png' : 'jpg';
  const o = {
    gap, minSize: options.minSize ?? 300, format,
    caption: options.captions === false ? 0 : options.captionHeight ?? 44,
    // Inner canvas excludes the outer margin (= gap), which renderPage adds back.
    width: (options.width ?? 2400) - 2 * gap, height: (options.height ?? 1600) - 2 * gap,
  };
  const outDir = resolve(options.outDir);
  const items = [], skipped = [];
  for (const input of images) {
    const item = typeof input === 'string' ? { path: input } : { ...input };
    try {
      if (!item.width || !item.height) Object.assign(item, await readImageInfo(item.path));
      item.path = resolve(item.path);
      item.caption ??= `${basename(item.path)}  ${item.width}×${item.height}`;
      items.push(item);
    } catch (error) {
      skipped.push({ path: item.path, reason: error.message });
    }
  }
  await mkdir(outDir, { recursive: true });
  const prefix = options.prefix ?? 'collage';
  const collages = [];
  for (const [p, page] of layoutPages(items, o).entries()) {
    const file = `${prefix}-${String(p + 1).padStart(2, '0')}.${format}`;
    const path = `${outDir}/${file}`;
    const dims = await renderPage(sharp, page, o, path);
    collages.push({
      file, path, ...dims,
      images: page.images.map(({ path: imagePath, caption, width, height }) => ({ path: imagePath, caption, width, height })),
    });
  }
  return { outDir, collages, skipped };
}

async function expandInputs(inputs) {
  const { stat, readdir } = await import('node:fs/promises');
  const { resolve, join } = await import('node:path');
  const files = [];
  for (const input of inputs) {
    const path = resolve(input);
    if ((await stat(path)).isDirectory()) {
      const names = (await readdir(path)).filter((n) => IMAGE_EXT.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      files.push(...names.map((n) => join(path, n)));
    } else files.push(path);
  }
  return files;
}

async function main() {
  const { parseArgs } = await import('node:util');
  const { resolve } = await import('node:path');
  const { access, writeFile } = await import('node:fs/promises');
  const { positionals, values: v } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' }, name: { type: 'string' }, width: { type: 'string' }, height: { type: 'string' },
      gap: { type: 'string' }, 'min-size': { type: 'string' }, 'caption-height': { type: 'string' },
      'no-captions': { type: 'boolean' }, format: { type: 'string' },
    },
  });
  if (!positionals.length || !v.out) {
    console.error('Usage: node collage.mjs <files or folders...> --out <output folder> [--name run-name] [--width 2400] [--height 1600] [--gap 24] [--min-size 300] [--caption-height 44] [--no-captions] [--format jpg|png]');
    process.exit(1);
  }
  const files = await expandInputs(positionals);
  if (!files.length) { console.error('No images found in the given inputs.'); process.exit(1); }

  // One folder per run inside --out.
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const base = (v.name || `collage-${stamp}`).replace(/[^\w.-]+/g, '-');
  let runDir = resolve(v.out, base);
  for (let n = 2; await access(runDir).then(() => true, () => false); n++) runDir = resolve(v.out, `${base}-${n}`);

  const num = (x) => (x == null ? undefined : Number(x));
  const result = await createCollages(files, {
    outDir: runDir, width: num(v.width), height: num(v.height), gap: num(v.gap), minSize: num(v['min-size']),
    captionHeight: num(v['caption-height']), captions: !v['no-captions'], format: v.format,
  });
  for (const s of result.skipped) console.warn(`skip ${s.path}: ${s.reason}`);
  for (const c of result.collages) console.log(`${c.file}: ${c.images.length} images (${c.width}×${c.height})`);
  await writeFile(`${runDir}/manifest.json`, JSON.stringify({ createdAt: new Date().toISOString(), collages: result.collages, skipped: result.skipped }, null, 2));
  console.log(`-> ${runDir}`);
}

if (typeof process !== 'undefined' && process.argv?.[1]
  && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => { console.error(error.message); process.exit(1); });
}
