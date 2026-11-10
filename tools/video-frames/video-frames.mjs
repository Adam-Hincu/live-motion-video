/**
 * Video frames tool: pulls frames out of a video and packs them into captioned collages
 * (via ../collage/collage.mjs) so a video can be analysed by looking at a few images.
 * Needs `ffmpeg` + `ffprobe` on the PATH (or FFMPEG_PATH / FFPROBE_PATH) and `sharp`
 * (run `npm install` in tools/collage).
 *
 * Frames are NEVER saved: they are decoded into a temp folder, sent to the collage tool and
 * deleted. Only the collages and results.json are written (like image-search).
 *
 * Precision: the exact presentation time of every frame is read from the container packets
 * (ffprobe), so frame numbers and times are exact, also for variable-frame-rate videos.
 * Frame numbers are 0-based (the first frame is frame 0). Time 0 = start of the file.
 * Every tile caption is "frame <number>  <HH:MM:SS.mmm>"; results.json keeps the full
 * precision (seconds as a float, plus the exact packet timestamp).
 *
 * Picking frames (combine freely, results are merged, sorted by time and de-duplicated):
 *   --count N              N frames spread evenly (first and last included) over the video,
 *                          or over --from/--to when a range is given
 *   --at T                 frame shown at timestamp T (repeatable or comma separated)
 *   --frame N              frame number N (repeatable or comma separated)
 *   --from A --to B        a range; A and B are timestamps or frame numbers (f120 / 120f).
 *                          Either may be left out (start / end of video).
 *   --every STEP           inside the range, one frame every STEP: "5f" = every 5 frames,
 *                          "0.5s" or "0.5" = every half second. Both ends are included.
 *   Timestamps: 12.5, 12.5s, 250ms, 1:02.5, 00:01:02.500.  Frames: f120 or 120f.
 *   Nothing given at all -> --count 16 over the whole video.
 *
 * CLI:
 *   node video-frames.mjs <video> [selection options] [--out dir] [--name run-name]
 *     [--max-frames 200] [--frame-size 1280] [--width 2400] [--height 1600] [--gap 24]
 *     [--min-size 300] [--caption 44] [--precision 3]
 *   -> <out>/<name>/collages/collage-01.jpg ... + results.json   (default out: ./analyses
 *      next to this script)
 *
 * Library:
 *   import { extractVideoFrames } from './video-frames.mjs';
 *   await extractVideoFrames('clip.mp4', { count: 12 }, { outDir: 'where/to/write' });
 *   await extractVideoFrames('clip.mp4', { from: '0:10', to: '0:12', every: '2f' }, { outDir });
 *   await extractVideoFrames('clip.mp4', { at: ['1.5', '00:00:03.250'], frames: [200] }, { outDir });
 */

import { spawn } from 'node:child_process';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    const out = [], err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => reject(e.code === 'ENOENT'
      ? new Error(`"${cmd}" not found: install FFmpeg and put it on the PATH (or set ${cmd === FFPROBE ? 'FFPROBE_PATH' : 'FFMPEG_PATH'})`) : e));
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString(), stderr = Buffer.concat(err).toString();
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} failed (${code}): ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Parsing and formatting
// ---------------------------------------------------------------------------

/** "f120" / "120f" -> { frame: 120 }; any timestamp form -> { time: seconds }. */
export function parsePoint(value) {
  const s = String(value).trim().toLowerCase();
  let m = s.match(/^f(\d+)$/) || s.match(/^(\d+)f$/);
  if (m) return { frame: Number(m[1]) };
  if ((m = s.match(/^(\d+(?:\.\d+)?)ms$/))) return { time: Number(m[1]) / 1000 };
  if (/^(\d+:){1,2}\d+(\.\d+)?$/.test(s)) return { time: s.split(':').reduce((acc, p) => acc * 60 + Number(p), 0) };
  if ((m = s.match(/^(\d+(?:\.\d+)?)s?$/))) return { time: Number(m[1]) };
  throw new Error(`Invalid time or frame "${value}" (use 12.5, 1:02.5, 00:01:02.500, 250ms, f120 or 120f)`);
}

/** "5f" -> { frames: 5 }, "0.5s" / "0.5" / "250ms" -> { seconds: 0.5 }. */
export function parseStep(value) {
  const p = parsePoint(value);
  if (p.frame != null) { if (!p.frame) throw new Error('--every must be greater than 0'); return { frames: p.frame }; }
  if (!(p.time > 0)) throw new Error('--every must be greater than 0');
  return { seconds: p.time };
}

/** HH:MM:SS.mmm (decimals configurable), computed on integer units so it never shows 60.000. */
export function formatTime(seconds, decimals = 3) {
  const unit = 10 ** decimals;
  const total = Math.round(Math.max(0, seconds) * unit);
  const whole = Math.floor(total / unit), frac = total % unit;
  const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${decimals ? '.' + String(frac).padStart(decimals, '0') : ''}`;
}

const asList = (v) => (v == null ? [] : (Array.isArray(v) ? v : [v])).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

const frac = (r) => { const [a, b] = String(r || '').split('/').map(Number); return b ? a / b : Number.isFinite(a) ? a : 0; };

/** Video info plus the exact presentation time (seconds from file start) of every frame. */
export async function probeVideo(file) {
  const { stdout: info } = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,width,height,avg_frame_rate,r_frame_rate,sample_aspect_ratio:format=start_time,duration', '-of', 'json', file]);
  const meta = JSON.parse(info);
  const stream = meta.streams?.[0];
  if (!stream) throw new Error('No video stream found in this file');
  const start = Number(meta.format?.start_time) || 0;

  const { stdout: packets } = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,dts_time', '-of', 'csv=p=0', file]);
  let times = [], missing = false;
  for (const line of packets.split('\n')) {
    if (!line.trim()) continue;
    const [pts, dts] = line.trim().split(',');
    const t = Number(pts !== 'N/A' && pts !== '' ? pts : dts);
    if (Number.isFinite(t) && pts !== 'N/A' && pts !== '') times.push(t); else { missing = true; times.push(NaN); }
  }
  const fps = frac(stream.avg_frame_rate) || frac(stream.r_frame_rate) || 0;
  if (missing || !times.length) {
    // Raw streams without timestamps: fall back to a constant frame rate.
    if (!fps) throw new Error('Cannot determine frame timing for this video');
    const n = times.length || Math.round((Number(meta.format?.duration) || 0) * fps);
    times = Array.from({ length: n }, (_, i) => start + i / fps);
  }
  times.sort((a, b) => a - b);
  const rel = times.map((t) => Math.max(0, t - start));
  // Duration of the last frame = the typical gap (or 1/fps).
  const lastGap = rel.length > 1 ? rel[rel.length - 1] - rel[rel.length - 2] : (fps ? 1 / fps : 0);
  return {
    width: stream.width, height: stream.height, codec: stream.codec_name,
    sar: stream.sample_aspect_ratio && stream.sample_aspect_ratio !== 'N/A' && stream.sample_aspect_ratio !== '0:1'
      ? stream.sample_aspect_ratio.split(':').map(Number) : [1, 1],
    fps, frameCount: rel.length, start, times: rel, rawTimes: times,
    duration: rel.length ? rel[rel.length - 1] + lastGap : 0,
    variableFrameRate: rel.length > 2 && new Set(rel.slice(1).map((t, i) => Math.round((t - rel[i]) * 1e5))).size > 3,
  };
}

// ---------------------------------------------------------------------------
// Frame selection
// ---------------------------------------------------------------------------

/** Index of the frame on screen at time t (the last frame starting at or before t). */
function frameAtTime(times, t) {
  let lo = 0, hi = times.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (times[mid] <= t + 1e-6) lo = mid; else hi = mid - 1; }
  return lo;
}

/** Resolve a selection into a sorted, de-duplicated list of { index, why }. */
export function selectFrames(video, sel = {}) {
  const { times, frameCount: F } = video;
  const warnings = [];
  const picks = new Map(); // index -> reason
  const add = (index, why) => { if (!picks.has(index)) picks.set(index, why); };
  const clampIndex = (i, label) => {
    if (i < 0 || i >= F) { warnings.push(`${label} is outside the video (${F} frames, ${formatTime(video.duration)}): clamped`); }
    return Math.min(Math.max(i, 0), F - 1);
  };
  const toIndex = (p, label) => {
    if (p.frame != null) return clampIndex(p.frame, `${label} frame ${p.frame}`);
    if (p.time > video.duration) warnings.push(`${label} ${formatTime(p.time)} is past the end (${formatTime(video.duration)}): clamped`);
    return frameAtTime(times, p.time);
  };

  const pointsAt = asList(sel.at), pointsFrame = asList(sel.frames ?? sel.frame);
  const hasRange = sel.from != null || sel.to != null;
  for (const v of pointsAt) {
    const p = parsePoint(v);
    if (p.frame != null) add(clampIndex(p.frame, `frame ${p.frame}`), `frame ${p.frame}`); else add(toIndex(p, '--at'), `at ${v}`);
  }
  for (const v of pointsFrame) {
    const n = Number(String(v).replace(/^f|f$/i, ''));
    if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid frame number "${v}"`);
    add(clampIndex(n, `frame ${n}`), `frame ${n}`);
  }

  const wantsRange = hasRange || sel.every != null;
  const noPoints = !pointsAt.length && !pointsFrame.length;
  if (wantsRange || sel.count != null || noPoints) {
    const a = sel.from != null ? toIndex(parsePoint(sel.from), '--from') : 0;
    const b = sel.to != null ? toIndex(parsePoint(sel.to), '--to') : F - 1;
    if (a > b) throw new Error(`--from (frame ${a}) is after --to (frame ${b})`);
    if (sel.every != null) {
      const step = typeof sel.every === 'object' ? sel.every : parseStep(sel.every);
      if (step.frames) for (let i = a; i <= b; i += step.frames) add(i, 'range');
      else {
        // Time steps start at the exact --from time (not the frame's rounded time).
        const t0 = sel.from != null && parsePoint(sel.from).time != null ? parsePoint(sel.from).time : times[a];
        const tEnd = times[b];
        for (let k = 0; ; k++) {
          const t = t0 + k * step.seconds;
          if (t > tEnd + 1e-6) break;
          add(frameAtTime(times, t), 'range');
        }
      }
    } else {
      const n = sel.count != null ? Number(sel.count) : 16;
      if (!Number.isInteger(n) || n < 1) throw new Error('--count must be a whole number >= 1');
      if (n === 1) add(Math.round((a + b) / 2), 'count');
      else for (let i = 0; i < n; i++) add(Math.round(a + (i * (b - a)) / (n - 1)), 'count');
    }
  }
  const frames = [...picks.keys()].sort((x, y) => x - y).map((index) => ({ index, why: picks.get(index) }));
  return { frames, warnings };
}

// ---------------------------------------------------------------------------
// Decoding one frame
// ---------------------------------------------------------------------------

/** Decode exactly frame `index` to a PNG; verifies from the decoder's own timestamp that it is the right one. */
async function decodeFrame(file, video, index, outFile, frameSize) {
  const t = video.times[index];
  const prev = index > 0 ? video.times[index - 1] : null;
  const next = index + 1 < video.frameCount ? video.times[index + 1] : null;
  const gap = Math.min(prev != null ? t - prev : Infinity, next != null ? next - t : Infinity);
  const g = Number.isFinite(gap) && gap > 0 ? gap : (video.fps ? 1 / video.fps : 0.04);
  // ffmpeg returns the first frame at or after -ss, so aim just before this frame's own timestamp.
  const attempts = [Math.max(0, t - g * 0.25), Math.max(0, t - g * 0.45), t];
  const [sn, sd] = video.sar;
  const M = frameSize;
  const filter = [
    'showinfo',
    ...(sn !== sd ? [`scale=trunc(iw*${sn}/${sd}/2)*2:ih`, 'setsar=1'] : []),
    `scale=w='if(gte(iw\\,ih)\\,min(iw\\,${M})\\,-2)':h='if(gte(iw\\,ih)\\,-2\\,min(ih\\,${M}))'`,
  ].join(',');
  let lastSeen = null;
  for (const ss of attempts) {
    const { stderr } = await run(FFMPEG, ['-hide_banner', '-loglevel', 'info', '-ss', (ss + video.start).toFixed(6), '-i', file,
      '-map', '0:v:0', '-frames:v', '1', '-vf', filter, '-y', outFile]);
    const m = stderr.match(/pts_time:\s*(-?[\d.]+)/);
    // The output timestamps are shifted by -ss, so adding it back gives the file time.
    const got = m ? Number(m[1]) + ss : null;
    lastSeen = got;
    if (got == null || Math.abs(got - t) <= g * 0.25) return got ?? t;
  }
  throw new Error(`frame ${index}: decoder returned a frame at ${lastSeen?.toFixed(6)}s but ${t.toFixed(6)}s was expected`);
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Extract frames and build collages. `selection`: { count, at, frames, from, to, every }.
 * `options`: outDir (required; collages go to <outDir>/collages), frameSize 1280 (longest side of
 * each decoded frame), concurrency 4, maxFrames 200, precision 3 (timestamp decimals), plus the
 * collage options width, height, gap, minSize, captionHeight.
 * Returns { outDir, video, frames, collages, warnings }.
 */
export async function extractVideoFrames(videoFile, selection = {}, options = {}) {
  if (!options.outDir) throw new TypeError('extractVideoFrames: options.outDir is required');
  const { mkdtemp, rm, mkdir, writeFile, stat } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { resolve, join, basename } = await import('node:path');
  const collage = await import('../collage/collage.mjs');
  await collage.getSharp();

  const file = resolve(videoFile);
  if (!(await stat(file).catch(() => null))?.isFile()) throw new Error(`Video not found: ${file}`);
  const video = await probeVideo(file);
  const { frames, warnings } = selectFrames(video, selection);
  const maxFrames = options.maxFrames ?? 200;
  if (!frames.length) throw new Error('No frames selected');
  if (frames.length > maxFrames) throw new Error(`${frames.length} frames selected, above --max-frames ${maxFrames}: use a larger step or raise --max-frames`);

  const decimals = options.precision ?? 3;
  const outDir = resolve(options.outDir), collagesDir = join(outDir, 'collages');
  await mkdir(collagesDir, { recursive: true });
  const tmp = await mkdtemp(join(tmpdir(), 'video-frames-'));
  try {
    const results = new Array(frames.length);
    let next = 0;
    const worker = async () => {
      while (next < frames.length) {
        const i = next++, { index, why } = frames[i];
        const path = join(tmp, `frame-${String(index).padStart(8, '0')}.png`);
        try {
          const seen = await decodeFrame(file, video, index, path, options.frameSize ?? 1280);
          results[i] = { index, why, time: video.times[index], decoderTime: seen, path };
        } catch (error) { warnings.push(`skipped ${error.message}`); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, frames.length) }, worker));

    const good = results.filter(Boolean);
    if (!good.length) throw new Error('Could not decode any frame');
    for (const r of good) r.caption = `frame ${r.index}  ${formatTime(r.time, decimals)}`;
    const built = await collage.createCollages(good.map((r) => ({ path: r.path, caption: r.caption })), {
      outDir: collagesDir, width: options.width, height: options.height, gap: options.gap,
      minSize: options.minSize, captionHeight: options.captionHeight,
    });
    // Map every frame to the collage it ended up in (tiles are in the same order as the input).
    const placed = new Map();
    for (const c of built.collages) c.images.forEach((im, pos) => placed.set(im.path, { collage: c.file, position: pos + 1 }));
    const outFrames = good.map((r) => ({
      frame: r.index, time: r.time, timecode: formatTime(r.time, decimals), selectedBy: r.why,
      collage: placed.get(resolve(r.path))?.collage ?? null, position: placed.get(resolve(r.path))?.position ?? null,
    }));
    const info = {
      file, name: basename(file), width: video.width, height: video.height, codec: video.codec,
      fps: video.fps, variableFrameRate: video.variableFrameRate, frameCount: video.frameCount, duration: video.duration,
      durationTimecode: formatTime(video.duration, decimals),
    };
    const collages = built.collages.map((c) => ({ file: c.file, width: c.width, height: c.height, frames: c.images.map((im) => Number(im.caption.match(/^frame (\d+)/)[1])) }));
    const summary = { createdAt: new Date().toISOString(), video: info, selection, frames: outFrames, collages, warnings };
    await writeFile(join(outDir, 'results.json'), JSON.stringify(summary, null, 2));
    return { outDir, video: info, frames: outFrames, collages, warnings };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const slugify = (t) => t.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 60) || 'video';

async function main() {
  const { parseArgs } = await import('node:util');
  const { positionals, values: v } = parseArgs({
    allowPositionals: true,
    options: {
      count: { type: 'string' }, at: { type: 'string', multiple: true }, frame: { type: 'string', multiple: true },
      from: { type: 'string' }, to: { type: 'string' }, every: { type: 'string' },
      out: { type: 'string' }, name: { type: 'string' }, 'max-frames': { type: 'string', default: '200' },
      'frame-size': { type: 'string', default: '1280' }, width: { type: 'string' }, height: { type: 'string' },
      gap: { type: 'string' }, 'min-size': { type: 'string' }, caption: { type: 'string' }, precision: { type: 'string', default: '3' },
      concurrency: { type: 'string', default: '4' },
    },
  });
  if (positionals.length !== 1) {
    console.error(`Usage: node video-frames.mjs <video> [--count N] [--at T ...] [--frame N ...] [--from A --to B [--every 5f|0.5s]]
         [--out dir] [--name run-name] [--max-frames 200] [--frame-size 1280] [--width 2400] [--height 1600]
         [--gap 24] [--min-size 300] [--caption 44] [--precision 3]
  T / A / B: seconds (12.5), 1:02.5, 00:01:02.500, 250ms, or a frame as f120 / 120f`);
    process.exit(1);
  }
  const { fileURLToPath } = await import('node:url');
  const { resolve, dirname, basename, extname } = await import('node:path');
  const { access } = await import('node:fs/promises');
  const here = dirname(fileURLToPath(import.meta.url));
  const out = v.out ? resolve(process.cwd(), v.out) : resolve(here, 'analyses');
  const base = slugify(v.name || basename(positionals[0], extname(positionals[0])));
  let runDir = resolve(out, base);
  for (let n = 2; await access(runDir).then(() => true, () => false); n++) runDir = resolve(out, `${base}-${n}`);

  const num = (x) => (x == null ? undefined : Number(x));
  const result = await extractVideoFrames(positionals[0], {
    count: v.count, at: v.at, frames: v.frame, from: v.from, to: v.to, every: v.every,
  }, {
    outDir: runDir, maxFrames: num(v['max-frames']), frameSize: num(v['frame-size']), width: num(v.width), height: num(v.height),
    gap: num(v.gap), minSize: num(v['min-size']), captionHeight: num(v.caption), precision: num(v.precision), concurrency: num(v.concurrency),
  });
  const vi = result.video;
  console.log(`${vi.name}: ${vi.width}×${vi.height}, ${vi.fps.toFixed(3)} fps${vi.variableFrameRate ? ' (variable)' : ''}, ${vi.frameCount} frames, ${vi.durationTimecode}`);
  for (const w of result.warnings) console.warn(`  warning: ${w}`);
  console.log(`${result.frames.length} frames`);
  for (const c of result.collages) console.log(`  ${c.file}: ${c.frames.length} frames (${c.width}×${c.height})  frames ${c.frames.join(', ')}`);
  console.log(`  -> ${runDir}`);
}

if (typeof process !== 'undefined' && process.argv?.[1]
  && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => { console.error(error.message); process.exit(1); });
}
