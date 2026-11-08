/**
 * Image search for Openverse + Wikimedia Commons. The search API is dependency-free;
 * the CLI at the bottom (download + collages) needs `sharp` (run `npm install` in this folder).
 *
 * CLI: node image-search.mjs "red fox" ["mountain" ...] [--count 40] [--min-size 300]
 *   [--width 2400] [--height 1600] [--gap 24] [--out dir] [--source openverse|commons]
 * Writes searches/<query>/originals/0001.jpg, collages/collage-01.jpg, results.json.
 *
 * Tiny, dependency-free image search for Openverse + Wikimedia Commons.
 * Node.js 18+ or browsers with fetch. No API key, account, or build step.
 *
 * import searchImages, { createImageSearch } from './images.mjs';
 * await searchImages('red fox');
 * await searchImages({ query: 'red fox', source: 'commons', output: 'urls' });
 * await searchImages(['red fox', 'mountain'], { output: 'compact' });
 * const search = createImageSearch({ source: 'openverse', limit: 12 });
 * await search('forest', { output: 'full' });
 *
 * Input: string, { query, ...options }, or array of either (batch returns arrays).
 * Output: 'images' (default), 'compact', 'urls', or 'full' (includes pagination).
 * Options: source ('openverse'|'commons'|'auto'), limit (1..20), page (1+),
 * fallback (true), fallbackOnEmpty (true), retries (2), retryDelay (300 ms),
 * timeout (8000 ms/request), thumbnailWidth (600), orientation ('wide'|'tall'|'square'),
 * minWidth, minHeight, openverse: { category, size, license, ... },
 * userAgent, signal, fetch (inject your own fetch, useful for testing).
 * Wikimedia needs a contact-bearing userAgent for compliant server-side use.
 */

const OPENVERSE = 'https://api.openverse.org/v1/images/';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const DEFAULTS = {
  source: 'openverse', limit: 20, page: 1, output: 'images',
  fallback: true, fallbackOnEmpty: true, retries: 2,
  retryDelay: 300, timeout: 8000, thumbnailWidth: 600,
};
const OPENVERSE_FILTERS = new Set([
  'category', 'aspect_ratio', 'size', 'license', 'license_type',
  'source', 'excluded_source', 'extension', 'mature', 'filter_dead',
]);
const OUTPUTS = new Set(['images', 'compact', 'urls', 'full']);

function checkOptions(options) {
  if (typeof options.query !== 'string' || !options.query.trim()) {
    throw new TypeError('query must be a non-empty string');
  }
  if (options.query.length > 200) throw new RangeError('query must be <= 200 characters');
  for (const [key, min, max] of [
    ['limit', 1, 20], ['page', 1, Number.MAX_SAFE_INTEGER],
    ['retries', 0, 8], ['retryDelay', 0, 60_000],
    ['timeout', 1, 300_000], ['thumbnailWidth', 1, 3000],
  ]) {
    if (!Number.isSafeInteger(options[key]) || options[key] < min || options[key] > max) {
      throw new RangeError(`${key} must be an integer between ${min} and ${max}`);
    }
  }
  if (!OUTPUTS.has(options.output)) throw new TypeError(`Invalid output: ${options.output}`);
  if (!['auto', 'openverse', 'commons', 'wikimedia'].includes(options.source)) {
    throw new TypeError(`Invalid source: ${options.source}`);
  }
  if (options.orientation != null && !['wide', 'tall', 'square'].includes(options.orientation)) {
    throw new TypeError(`Invalid orientation: ${options.orientation}`);
  }
  for (const key of ['minWidth', 'minHeight']) {
    if (options[key] != null && (!Number.isSafeInteger(options[key]) || options[key] < 0)) {
      throw new RangeError(`${key} must be a non-negative integer`);
    }
  }
  if (options.openverse != null) {
    if (typeof options.openverse !== 'object' || Array.isArray(options.openverse)) {
      throw new TypeError('openverse must be an object of API filters');
    }
    for (const key of Object.keys(options.openverse)) {
      if (!OPENVERSE_FILTERS.has(key)) throw new TypeError(`Unknown Openverse filter: ${key}`);
    }
  }
}

function toURL(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return url.href;
}

function buildRequest(source, o) {
  if (source === 'openverse') {
    return toURL(OPENVERSE, {
      q: o.query.trim(), page: o.page, page_size: o.limit,
      ...(o.orientation ? { aspect_ratio: o.orientation } : {}),
      ...o.openverse,
    });
  }
  return toURL(COMMONS, {
    action: 'query', generator: 'search', gsrsearch: `${o.query.trim()} filetype:bitmap`,
    gsrnamespace: 6, gsrlimit: o.limit, gsroffset: (o.page - 1) * o.limit,
    prop: 'imageinfo', iiprop: 'url|size|mime', iiurlwidth: o.thumbnailWidth,
    format: 'json', formatversion: 2, origin: '*',
  });
}

function normalizeOpenverse(data) {
  if (!Array.isArray(data?.results)) throw new Error('Unexpected Openverse response');
  return {
    images: data.results.map((r) => ({
      id: `openverse:${r.id}`, provider: 'openverse', title: r.title || '',
      url: r.url || null, thumbnail: r.thumbnail || r.url || null,
      width: r.width ?? null, height: r.height ?? null,
      pageUrl: r.foreign_landing_url || null,
      creator: r.creator || null, license: r.license || null, source: r.source || null,
    })),
    hasMore: Boolean(data.next) || (Number.isFinite(data.page_count) && data.page < data.page_count),
  };
}

function normalizeCommons(data) {
  if (data?.error) {
    const error = new Error(`Wikimedia: ${data.error.info || data.error.code}`);
    error.retryable = ['ratelimited', 'maxlag', 'readonly'].includes(data.error.code);
    throw error;
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Unexpected Wikimedia Commons response');
  }
  // The Action API can omit `query` when a generator finds no matching pages.
  if (!data.query && !('batchcomplete' in data)) {
    throw new Error('Unexpected Wikimedia Commons response');
  }
  const pages = Array.isArray(data.query?.pages) ? data.query.pages : Object.values(data.query?.pages || {});
  const images = pages.sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity))
    .map((p) => {
      const file = p.imageinfo?.[0];
      if (!file?.url || (file.mime && !file.mime.startsWith('image/'))) return null;
      return {
        id: `commons:${p.pageid}`, provider: 'commons',
        title: (p.title || '').replace(/^File:/i, '').replace(/\.[^.]+$/, '').replace(/_/g, ' '),
        url: file.url, thumbnail: file.thumburl || file.url,
        width: file.width ?? null, height: file.height ?? null,
        pageUrl: file.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent((p.title || '').replace(/ /g, '_'))}`,
        creator: null, license: null, source: 'wikimedia-commons',
      };
    }).filter(Boolean);
  return { images, hasMore: data.continue?.gsroffset != null };
}

function applyFilters(images, o) {
  return images.filter((im) => {
    if (!im.url || !/^https?:\/\//i.test(im.url)) return false;
    if (o.minWidth && (im.width ?? 0) < o.minWidth) return false;
    if (o.minHeight && (im.height ?? 0) < o.minHeight) return false;
    if (o.orientation) {
      if (!im.width || !im.height) return false;
      const ratio = im.width / im.height;
      if (o.orientation === 'wide' && ratio <= 1.15) return false;
      if (o.orientation === 'tall' && ratio >= 0.87) return false;
      if (o.orientation === 'square' && (ratio < 0.87 || ratio > 1.15)) return false;
    }
    return true;
  });
}

function retryAfterMs(response) {
  const raw = response.headers?.get?.('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error('Aborted'));
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason || new Error('Aborted')); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function request(url, o) {
  const fetcher = o.fetch || globalThis.fetch;
  if (typeof fetcher !== 'function') throw new TypeError('fetch is unavailable (requires Node 18+ or a fetch implementation)');
  const headers = { Accept: 'application/json' };
  if (o.userAgent) {
    // Browsers cannot set User-Agent. Wikimedia supports Api-User-Agent instead.
    headers[typeof process !== 'undefined' && process.versions?.node ? 'User-Agent' : 'Api-User-Agent'] = o.userAgent;
  }
  const controller = new AbortController();
  const abort = () => controller.abort(o.signal.reason);
  if (o.signal?.aborted) throw o.signal.reason || new Error('Aborted');
  o.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), o.timeout);
  try {
    const response = await fetcher(url, { headers, signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
      error.status = response.status;
      error.retryable = [408, 425, 429].includes(response.status) || response.status >= 500;
      error.retryAfter = retryAfterMs(response);
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', abort);
  }
}

async function tryProvider(source, o) {
  const url = buildRequest(source, o);
  for (let attempt = 0; attempt <= o.retries; attempt++) {
    try {
      const data = await request(url, o);
      const result = source === 'openverse' ? normalizeOpenverse(data) : normalizeCommons(data);
      return { ...result, images: applyFilters(result.images, o), source };
    } catch (error) {
      if (o.signal?.aborted) throw error;
      if (attempt === o.retries || error.retryable === false) throw error;
      const wait = error.retryAfter ?? o.retryDelay * 2 ** attempt;
      // Respect long Retry-After limits: avoid hammering; switch providers instead.
      if (wait > 3000) throw error;
      await delay(wait, o.signal);
    }
  }
}

function formatResult(result, o, requestedSource, fallbackUsed, errors) {
  if (o.output === 'urls') return result.images.map((im) => im.url);
  if (o.output === 'compact') return result.images.map(({ title, url, thumbnail, width, height, provider }) =>
    ({ title, url, thumbnail, width, height, provider }));
  if (o.output === 'full') return {
    query: o.query, source: result.source, requestedSource, fallbackUsed,
    page: o.page, limit: o.limit, hasMore: result.hasMore,
    nextPage: result.hasMore ? o.page + 1 : null, images: result.images,
    errors: errors.map(({ source, error }) => ({ source, message: error.message, status: error.status ?? null })),
  };
  return result.images;
}

/** Search one query or an array of queries (batch requests are sequential). */
export async function searchImages(input, options = {}) {
  if (Array.isArray(input)) {
    const output = [];
    for (const item of input) output.push(await searchImages(item, options));
    return output;
  }
  const o = { ...DEFAULTS, ...(typeof input === 'string' ? { query: input } : input), ...options };
  checkOptions(o);
  const requestedSource = o.source === 'auto' ? 'openverse' : o.source === 'wikimedia' ? 'commons' : o.source;
  const sources = o.fallback ? [requestedSource, requestedSource === 'openverse' ? 'commons' : 'openverse'] : [requestedSource];
  const errors = [];
  let successfulEmpty;
  for (const source of sources) {
    try {
      const result = await tryProvider(source, o);
      if (!result.images.length && o.fallbackOnEmpty && sources.length > 1 && source === sources[0]) {
        successfulEmpty = result;
        continue;
      }
      return formatResult(result, o, requestedSource, source !== requestedSource, errors);
    } catch (error) {
      if (o.signal?.aborted) throw error;
      errors.push({ source, error });
    }
  }
  if (successfulEmpty) return formatResult(successfulEmpty, o, requestedSource, false, errors);
  if (errors.length === 1) throw errors[0].error;
  throw new AggregateError(errors.map((e) => e.error), 'Both image providers failed');
}

/** Create a search function with reusable defaults. Per-call options override defaults. */
export function createImageSearch(defaults = {}) {
  return (input, options = {}) => {
    if (Array.isArray(input)) {
      return searchImages(input.map((x) => typeof x === 'string' ? { ...defaults, query: x } : { ...defaults, ...x }), options);
    }
    return searchImages(typeof input === 'string' ? { ...defaults, query: input } : { ...defaults, ...input }, options);
  };
}

// ---------------------------------------------------------------------------
// Download + collage pipeline (CLI). Node only; needs `sharp`.
// ---------------------------------------------------------------------------

const EXT = { jpeg: 'jpg', tiff: 'tif', heif: 'heic' };
const xmlEscape = (t) => String(t).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const slugify = (t) => t.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 60) || 'search';

/**
 * Pick the best justified-row layout for the images with aspect ratios `asp`.
 * Every image keeps its aspect ratio, rows fill the full width, each image's shorter
 * side is >= minSize and the whole thing fits in `height`. Among row counts the one
 * using the most vertical space wins, so a short last collage gets big images.
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

async function renderCollage(sharp, page, o, file) {
  const pad = o.gap, W = o.width + 2 * pad, H = page.layout.height + 2 * pad;
  const composites = [], labels = [];
  for (const tile of page.layout.rows.flat()) {
    const im = page.images[tile.index];
    const input = await sharp(im.path, { failOn: 'none' }).rotate().resize(tile.w, tile.h, { fit: 'fill' })
      .flatten({ background: '#ffffff' }).png().toBuffer();
    composites.push({ input, left: pad + tile.x, top: pad + tile.y });
    const text = `${im.file}  ${im.width}×${im.height}`;
    const size = Math.max(9, Math.min(o.caption * 0.5, tile.w / (text.length * 0.62)));
    labels.push(`<text x="${pad + tile.x}" y="${pad + tile.y + tile.h + o.caption * 0.68}" font-size="${size.toFixed(1)}">${xmlEscape(text)}</text>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><g font-family="Arial, Helvetica, sans-serif" fill="#222222">${labels.join('')}</g></svg>`;
  composites.push({ input: Buffer.from(svg), left: 0, top: 0 });
  await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
    .composite(composites).jpeg({ quality: 92 }).toFile(file);
  return { width: W, height: H };
}

async function downloadAll(found, dir, o, sharp) {
  const { writeFile } = await import('node:fs/promises');
  const results = new Array(found.length);
  let next = 0;
  const worker = async () => {
    while (next < found.length) {
      const i = next++, item = found[i];
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await fetch(item.url, { headers: { 'User-Agent': o.userAgent }, signal: AbortSignal.timeout(60_000) });
          if (!res.ok) {
            const wait = Number(res.headers.get('retry-after'));
            throw Object.assign(new Error(`HTTP ${res.status}`), { retry: res.status === 429 || res.status >= 500, wait: Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30) * 1000 : 0 });
          }
          const buf = Buffer.from(await res.arrayBuffer());
          const meta = await sharp(buf, { failOn: 'none' }).metadata();
          const swap = meta.orientation >= 5;
          const width = swap ? meta.height : meta.width, height = swap ? meta.width : meta.height;
          if (!width || !height) throw new Error('unreadable image');
          results[i] = { item, buf, width, height, ext: EXT[meta.format] || meta.format };
          break;
        } catch (error) {
          if (attempt === 4 || error.retry === false) { console.warn(`  skip ${item.url.split('?')[0]}: ${error.message}`); break; }
          await new Promise((r) => setTimeout(r, error.wait || 1500 * 2 ** attempt));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: o.concurrency }, worker));
  const saved = [];
  for (const r of results) {
    if (!r) continue;
    const file = `${String(saved.length + 1).padStart(4, '0')}.${r.ext}`;
    await writeFile(`${dir}/${file}`, r.buf);
    saved.push({ file, id: file.replace(/\.[^.]+$/, ''), path: `${dir}/${file}`, width: r.width, height: r.height, ...r.item });
  }
  return saved;
}

async function runSearch(query, o, sharp) {
  const { mkdir, writeFile, access } = await import('node:fs/promises');
  const found = [], seen = new Set();
  for (let page = 1; found.length < o.count && page <= 20; page++) {
    const res = await searchImages({ query, page, limit: 20, output: 'full', source: o.source, userAgent: o.userAgent });
    for (const im of res.images) if (!seen.has(im.url)) { seen.add(im.url); found.push(im); }
    if (!res.hasMore || !res.images.length) break;
  }
  found.length = Math.min(found.length, o.count);
  console.log(`"${query}": ${found.length} results`);

  let root = `${o.out}/${slugify(query)}`;
  for (let n = 2; await access(root).then(() => true, () => false); n++) root = `${o.out}/${slugify(query)}-${n}`;
  const originals = `${root}/originals`, collages = `${root}/collages`;
  await mkdir(originals, { recursive: true });
  await mkdir(collages, { recursive: true });

  const saved = await downloadAll(found, originals, o, sharp);
  console.log(`  downloaded ${saved.length}/${found.length}`);
  const pages = layoutPages(saved, o);
  const collageInfo = [];
  for (let p = 0; p < pages.length; p++) {
    const name = `collage-${String(p + 1).padStart(2, '0')}.jpg`;
    const dims = await renderCollage(sharp, pages[p], o, `${collages}/${name}`);
    collageInfo.push({ file: name, ...dims, images: pages[p].images.map((im) => im.file) });
    console.log(`  ${name}: ${pages[p].images.length} images (${dims.width}×${dims.height})`);
  }
  await writeFile(`${root}/results.json`, JSON.stringify({
    query, createdAt: new Date().toISOString(),
    images: saved.map(({ file, id, width, height, title, url, pageUrl, creator, license, source, provider }) =>
      ({ file, id, width, height, title, url, pageUrl, creator, license, source, provider })),
    collages: collageInfo,
  }, null, 2));
  console.log(`  -> ${root}`);
}

async function main() {
  const { parseArgs } = await import('node:util');
  const { positionals, values: v } = parseArgs({
    allowPositionals: true,
    options: {
      count: { type: 'string', default: '40' }, out: { type: 'string', default: 'searches' },
      'min-size': { type: 'string', default: '300' }, width: { type: 'string', default: '2400' },
      height: { type: 'string', default: '1600' }, gap: { type: 'string', default: '24' },
      caption: { type: 'string', default: '44' }, concurrency: { type: 'string', default: '2' }, source: { type: 'string', default: 'openverse' },
      'user-agent': { type: 'string', default: 'image-search-script/1.0 (local tool)' },
    },
  });
  if (!positionals.length) {
    console.error('Usage: node image-search.mjs "query" ["query2" ...] [--count 40] [--min-size 300] [--width 2400] [--height 1600] [--gap 24] [--out searches] [--source openverse|commons]');
    process.exit(1);
  }
  const { fileURLToPath } = await import('node:url');
  const { resolve, dirname } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  let sharp;
  try { sharp = (await import('sharp')).default; } catch { console.error('Missing dependency: run `npm install` in tools/image-search'); process.exit(1); }
  const o = {
    count: Number(v.count), minSize: Number(v['min-size']), width: Number(v.width), height: Number(v.height),
    concurrency: Number(v.concurrency), gap: Number(v.gap), caption: Number(v.caption), source: v.source, userAgent: v['user-agent'],
    // The default output folder sits next to this script; an explicit --out is relative to the cwd.
    out: v.out === 'searches' ? resolve(here, 'searches') : resolve(process.cwd(), v.out),
  };
  // Inner canvas excludes the outer margin (= gap), which renderCollage adds back.
  o.width -= 2 * o.gap;
  o.height -= 2 * o.gap;
  for (const q of positionals) await runSearch(q, o, sharp);
}

if (typeof process !== 'undefined' && process.argv?.[1]
  && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  await main();
}

export default searchImages;
