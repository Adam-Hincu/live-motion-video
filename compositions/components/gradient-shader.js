/**
 * gradient-shader — a single-file, dependency-free <gradient-shader> web component.
 *
 * Renders animated, volumetric gradients on the GPU (WebGL) with optional grain or dither.
 *
 *   <script type="module" src="gradient-shader.js"></script>
 *   <gradient-shader shape="clouds" style="width:100%;height:400px"></gradient-shader>
 *
 * Give the element a size (CSS width/height). Every setting is an attribute AND a JS property:
 *
 *   attribute        property        default            notes
 *   ---------------  --------------  -----------------  ---------------------------------------------
 *   shape            shape           "streak"           streak | aurora | waves | haze | liquid | clouds | lines
 *   colors           colors          3 neutral warm      comma-separated hex, 3–12, evenly spaced ramp
 *   angle            angle           0                  rotation in degrees
 *   scale            scale           1                  zoom, > 1 = bigger features
 *   seed             seed            0                  picks the pattern; every value is unrelated
 *   depth            depth           1                  relief / volume strength
 *   density          density         11                 lines only: columns per unit, 2–25
 *   animate          animate         true               "true" | "false"
 *   speed            speed           1                  animation speed multiplier
 *   grain            grain           true               film-grain texture ("true" | "false")
 *   grain-size       grainSize       1                  relative to the gradient's size (never < 1 px)
 *   grain-amount     grainAmount     1                  grain strength, 0 = none, 2 = heavy
 *   dither           dither          false              ordered (Bayer) dither; replaces grain when on
 *   dither-size      ditherSize      1                  relative like grain-size, whole pixels
 *   dither-levels    ditherLevels    4                  colour levels per channel, 2–16
 *   time             time            –                  seconds. Renders exactly that moment, no loop (see below)
 *   pixel-ratio      pixelRatio      auto               canvas pixels per CSS pixel; auto follows the screen (max 2), 1 in video renders
 *
 * Video rendering (HyperFrames and similar): the component never needs its own clock. It draws
 * the exact moment it is told to, synchronously, with no frame callbacks or wall-clock reads:
 *   - it listens for the renderer's "hf-seek" event (detail.time, seconds) and draws that time;
 *   - or set `el.time = seconds` / `time="…"` yourself from any clock (scroll, a timeline, …).
 * The same time always produces the same pixels. `animate="false"` holds the first frame.
 *
 * Methods: play(), pause(), toDataURL(type?, quality?).   Events: "ready", "error".
 * Statics: GradientShader.shapes, GradientShader.maxPixelRatio.
 *
 * Good citizen: pauses while off screen, honours prefers-reduced-motion (unless animate is set
 * explicitly), recovers from WebGL context loss, releases the GPU context on removal, and falls
 * back to a plain CSS gradient where WebGL is unavailable.
 */

// ─── Configuration ──────────────────────────────────────────────────────────

/** Available shapes, in shader order (the index is the shader's shape id). */
export const SHAPES = Object.freeze(['streak', 'aurora', 'waves', 'haze', 'liquid', 'clouds', 'lines']);

const TAG = 'gradient-shader';
// A ramp needs at least 3 colors to read as a gradient. The maximum is generous: 12 is far more
// than any palette needs, and still well inside every GPU's uniform limits.
const MIN_COLORS = 3;
const MAX_COLORS = 12;

// Used when `colors` is missing or invalid. Every shape uses the same neutral default; styling
// (palettes, angles, seeds) is the caller's job.
const DEFAULT_COLORS = ['#ff5f6d', '#ffc371', '#fff1c1'];

// Numeric attributes: name → [default, min, max].
const NUMBERS = {
  angle:           [0,  -Infinity, Infinity],
  scale:           [1,  0.01,      Infinity],
  seed:            [0,  -Infinity, Infinity],
  depth:           [1,  0.01,      Infinity],
  speed:           [1,  0,         Infinity],
  density:         [11, 2,         25],
  'grain-size':    [1,  0,         Infinity],
  'grain-amount':  [1,  0,         Infinity],
  'dither-size':   [1,  0,         Infinity],
  'dither-levels': [4,  2,         16],
  'pixel-ratio':   [0,  0,         8],   // 0 = automatic
};

// Boolean attributes: name → default. Written as "true" / "false"; a bare attribute means true.
const BOOLEANS = { animate: true, grain: true, dither: false };

const camel = (s) => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());

// ─── Shaders ────────────────────────────────────────────────────────────────

const VERTEX_SRC = `attribute vec2 a;varying vec2 v;void main(){v=a*.5+.5;gl_Position=vec4(a,0.,1.);}`;

const FRAGMENT_SRC = `precision highp float;
#define N ${MAX_COLORS}
varying vec2 v;
uniform vec2 u_res;
uniform int u_shape, u_count;
uniform float u_angle, u_scale, u_seed, u_depth, u_time, u_density, u_grain, u_gamt, u_dither, u_dlev;
uniform vec3 u_col[N];

vec3 ramp(float t){
  float f = clamp(t, 0., 1.) * float(u_count - 1);
  vec3 c = u_col[0];
  for (int i = 0; i < N - 1; i++)
    if (i + 1 < u_count) c = mix(c, u_col[i + 1], clamp(f - float(i), 0., 1.));
  return c;
}

// Sine-free 2D -> 3D hash (no visible tiling or banding), used for grain.
vec3 hash3(vec2 p){
  vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx);
}

// 8x8 Bayer ordered-dither threshold (0..1) for integer cell coordinates, built from the
// 2x2 matrix [[0,2],[3,1]] applied at three bit levels (no arrays needed in GLSL ES 1.0).
float bay2(vec2 a){ return mod(2. * a.x + 3. * a.y, 4.); }
float bayer8(vec2 p){
  float f = bay2(mod(p, 2.)) * 16. + bay2(mod(floor(p / 2.), 2.)) * 4. + bay2(mod(floor(p / 4.), 2.));
  return (f + .5) / 64.;
}

// Smooth (quintic) value noise returning 3 independent channels. Interpolating between
// lattice points keeps grain round and even at any size, with no blocky cell edges.
vec3 gnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * f * (f * (f * 6. - 15.) + 10.);
  return mix(mix(hash3(i), hash3(i + vec2(1., 0.)), f.x), mix(hash3(i + vec2(0., 1.)), hash3(i + vec2(1., 1.)), f.x), f.y);
}

// Value noise + fbm, used by clouds. Each lattice value oscillates on its own phase
// over time, so the shapes morph in place instead of scrolling.
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lat(vec2 i, float tm){ return .5 + .5 * sin(tm + 6.2831 * hash(i)); }
float vnoise(vec2 p, float tm){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(lat(i, tm), lat(i + vec2(1., 0.), tm), f.x), mix(lat(i + vec2(0., 1.), tm), lat(i + vec2(1., 1.), tm), f.x), f.y);
}
float fbm(vec2 p){
  float a = .5, r = 0., tm = u_time * 1.2;
  for (int i = 0; i < 4; i++) { r += a * vnoise(p, tm); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; tm *= 1.3; }
  return r;
}

void main(){
  vec2 p = (v - .5) * vec2(u_res.x / u_res.y, 1.) * 2.;
  float c = cos(u_angle), sn = sin(u_angle);
  p = mat2(c, -sn, sn, c) * p / u_scale;
  float s = u_seed + u_time;                // phase: seed offset + animation time
  float d = u_depth, t = 0.;

  if (u_shape == 0) {                       // streak: widening diagonal light band
    float u = p.x / (1. + .35 * p.y * d) + .25 * sin(p.y * 1.5 + s) * d + .3 * sin(s);
    t = u * .3 + .5;

  } else if (u_shape == 1) {                // aurora: vertical streaks fading upward
    float st = .5 + .5 * sin(p.x * 7. + 2. * d * sin(p.y * 2. + s) + 2. * sin(p.x * 2.3 + s));
    float up = smoothstep(-1.2, 1.2, p.y + .5 * sin(p.x * 1.4 + s) * d);
    t = up * (.3 + .7 * st);

  } else if (u_shape == 2) {                // waves: warped layered bands
    float y = p.y + .35 * sin(p.x * 1.2 + s) + .12 * d * sin(p.x * 3.3 - s * 1.4);
    t = .5 + .5 * sin(y * 2.6 + 1.);

  } else if (u_shape == 3) {                // haze: one continuous flowing field, stretched into soft smears
    vec2 q = p * vec2(1.3, .6);                                  // stretch features into streaks
    for (int i = 0; i < 3; i++) {                                // layered warps make the flow organic
      float fi = float(i);
      q += .45 * d * vec2(sin(q.y * 1.7 + s * .7 + fi * 2.1), cos(q.x * 1.5 - s * .5 + fi * 1.4));
    }
    float f = sin(q.x * 1.2 + s * .4) + .8 * sin(q.y * 1.7 - s * .3) + .6 * sin((q.x + q.y) * 1.1 + s * .2);
    f = f / 2.4 * .5 + .5;
    float g = exp(-dot(p - vec2(sin(s * .37) * .6, cos(s * .29) * .4), p - vec2(sin(s * .37) * .6, cos(s * .29) * .4)) * .5);
    t = smoothstep(.22, .78, f) * .85 + .2 * g;                  // soft contrast + warm focal glow

  } else if (u_shape == 4) {                // liquid: iterated domain warp, flowing swirls
    vec2 q = p;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      q += .55 * d * vec2(sin(q.y * 1.6 + s + fi * 1.7), cos(q.x * 1.4 + s * 1.3 + fi * 2.3));
    }
    t = .5 + .5 * sin(q.x * 1.4 + q.y * .9);

  } else if (u_shape == 5) {                // clouds: billowy fbm masses over a sky gradient
    vec2 q = p * vec2(.65, .9) + vec2(u_seed * .37, u_seed * .21);  // seed picks the sky; time morphs it in place
    q += .8 * d * (vec2(fbm(q + 3.1), fbm(q + 7.7)) - .5);       // domain warp: curling, wispy edges
    float c = smoothstep(.32, .72, fbm(q * 1.3));                // cloud mass
    float sky = smoothstep(-1., 1., p.y);                        // blue below, bright above
    float lift = .35 + .65 * smoothstep(-.7, .6, p.y + .25 * (fbm(q * .6) - .5)); // clouds pile toward the top
    t = sky * .55 + c * lift * .5;

  } else {                                  // lines: diagonal gradient broken into vertical columns
    float x = p.x * u_density, id = floor(x), f = fract(x);
    float h = fract(sin(id * 12.9898 + u_seed * 7.) * 43758.5453);   // per-column offset
    float y = p.y + .25 * p.x + (h - .5) * .14 * d + .05 * d * sin(f * 3.14159);
    t = (.5 + .5 * sin(y * 1.5 + s * .3 + 1.2)) * (.92 + .08 * sin(f * 3.14159));
  }

  vec3 col = ramp(t);

  if (u_grain > 0.) {                       // grain: u_grain = cell size in device pixels
    vec2 fc = gl_FragCoord.xy + u_seed * 13.7;
    vec3 n = gnoise(fc / u_grain) * .5                    // grain body, sized by grain-size
           + gnoise(fc / (u_grain * .5) + 17.3) * .25     // finer octave keeps detail crisp when scaled up
           + hash3(fc) * .25;                             // per-pixel sparkle, always sharp
    n = smoothstep(.2, .8, n);                            // S-curve: defined, high-contrast grains instead of a soft blur
    n = mix(vec3(n.x), n, .6) - .5;         // mostly luminance grain with a little colour speckle
    float lum = dot(col, vec3(.299, .587, .114));
    col += n * .22 * u_gamt * (.5 + .5 * (1. - abs(lum * 2. - 1.)));  // strongest in midtones, calmer at pure black/white
  }

  if (u_dither > 0.) {                      // dither: ordered Bayer quantisation to u_dlev levels per channel
    float b = bayer8(floor(gl_FragCoord.xy / u_dither));
    col = floor(col * (u_dlev - 1.) + b) / (u_dlev - 1.);
  }

  gl_FragColor = vec4(clamp(col, 0., 1.), 1.);
}`;

const UNIFORMS = ['u_res', 'u_shape', 'u_count', 'u_angle', 'u_scale', 'u_seed', 'u_depth', 'u_time',
  'u_density', 'u_grain', 'u_gamt', 'u_dither', 'u_dlev', 'u_col'];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** "#abc" / "#aabbcc" → [r, g, b] in 0..1, or null if invalid. */
function parseHex(str) {
  let h = String(str).trim().replace(/^#/, '');
  if (h.length === 3) h = h.replace(/./g, '$&$&');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255);
}

const warned = new Set();
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`<${TAG}>: ${message}`);
}

// ─── Component ──────────────────────────────────────────────────────────────

export class GradientShader extends HTMLElement {
  static observedAttributes = ['shape', 'colors', 'time', ...Object.keys(NUMBERS), ...Object.keys(BOOLEANS)];

  /** Upper bound for the canvas pixel ratio. Lower it to save GPU on very dense screens. */
  static maxPixelRatio = 2;

  /** The available shape names. */
  static get shapes() { return SHAPES; }

  #canvas = null;
  #gl = null;
  #uniforms = {};
  #fallback = null;       // CSS-gradient element shown when WebGL is unavailable
  #colorBuffer = new Float32Array(MAX_COLORS * 3);
  #resizeObserver = null;
  #intersectionObserver = null;
  #motionQuery = null;
  #raf = 0;
  #time = 0;              // accumulated animation time
  #last = 0;              // timestamp of the previous frame
  #visible = true;        // false while scrolled off screen
  #announced = false;     // "ready" has been dispatched
  #seek = null;           // time (seconds) pushed by a video renderer via "hf-seek"; null = not rendered externally

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host { display: block; position: relative; overflow: hidden; }
      :host([hidden]) { display: none; }
      canvas, .fallback { display: block; width: 100%; height: 100%; }
      [hidden] { display: none; }
    </style><div class="fallback" part="fallback" hidden></div>`;
    this.#fallback = root.querySelector('.fallback');
  }

  // ── Lifecycle ──

  connectedCallback() {
    if (this.hasAttribute('aria-label') && !this.hasAttribute('role')) this.setAttribute('role', 'img');

    this.#motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this.#motionQuery.addEventListener('change', this.#queue);
    this.#resizeObserver = new ResizeObserver(this.#queue);
    this.#resizeObserver.observe(this);
    this.#intersectionObserver = new IntersectionObserver(([entry]) => {
      this.#visible = entry.isIntersecting;
      this.#queue();
    });
    this.#intersectionObserver.observe(this);

    // Video renderers (HyperFrames) seek time frame by frame via "hf-seek" and detect their runtime
    // through globals the runtime creates up front. Start in externally-driven mode right away
    // there, so no free-running loop ever exists to disagree with the renderer's clock.
    window.addEventListener('hf-seek', this.#onSeek);
    if (this.#seek === null && ('__hyperframes' in window || '__timelines' in window)) {
      this.#seek = Number(window.__hfThreeTime) || 0;
    }

    this.#setup();
    this.#queue();
  }

  disconnectedCallback() {
    window.removeEventListener('hf-seek', this.#onSeek);
    cancelAnimationFrame(this.#raf);
    this.#motionQuery?.removeEventListener('change', this.#queue);
    this.#resizeObserver?.disconnect();
    this.#intersectionObserver?.disconnect();
    // Release the GPU context right away; a fresh canvas is created if the element is re-attached.
    this.#gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.#canvas?.remove();
    this.#canvas = this.#gl = null;
  }

  attributeChangedCallback(_name, oldValue, newValue) {
    if (oldValue !== newValue) this.#queue();
  }

  // ── Public API ──

  /** Start (or resume) the animation. Same as animate="true". */
  play() { this.setAttribute('animate', 'true'); }

  /** Freeze the current frame. Same as animate="false". */
  pause() { this.setAttribute('animate', 'false'); }

  /** The current frame as a data URL (PNG by default). Returns "" if WebGL is unavailable. */
  toDataURL(type = 'image/png', quality) {
    if (!this.#gl) return '';
    this.#draw();
    return this.#canvas.toDataURL(type, quality);
  }

  /** The internal <canvas>, or null when disconnected / using the CSS fallback. */
  get canvas() { return this.#gl ? this.#canvas : null; }

  // Properties mirroring every attribute (generated below in the static block).
  static {
    const define = (name, descriptor) => Object.defineProperty(this.prototype, name, { enumerable: true, configurable: true, ...descriptor });
    const write = (el, attr, value) => (value == null ? el.removeAttribute(attr) : el.setAttribute(attr, String(value)));

    define('shape', { get() { return this.#shape(); }, set(v) { write(this, 'shape', v); } });
    define('time', {
      get() { const v = parseFloat(this.getAttribute('time')); return Number.isFinite(v) ? v : null; },
      set(v) { write(this, 'time', v); },
    });
    define('colors', {
      get() { return this.#colors().map(([r, g, b]) => '#' + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')); },
      set(v) { write(this, 'colors', Array.isArray(v) ? v.join(',') : v); },
    });
    for (const attr of Object.keys(NUMBERS)) {
      define(camel(attr), { get() { return this.#number(attr); }, set(v) { write(this, attr, v); } });
    }
    for (const attr of Object.keys(BOOLEANS)) {
      define(attr, { get() { return this.#boolean(attr); }, set(v) { this.setAttribute(attr, v ? 'true' : 'false'); } });
    }
  }

  // ── Resolved settings (attribute → validated value, falling back to the default) ──

  #shape() {
    const raw = this.getAttribute('shape');
    if (raw == null) return SHAPES[0];
    if (SHAPES.includes(raw)) return raw;
    warnOnce(`shape:${raw}`, `unknown shape "${raw}", using "${SHAPES[0]}". Available: ${SHAPES.join(', ')}.`);
    return SHAPES[0];
  }

  #number(attr) {
    const [fallback, min, max] = NUMBERS[attr];
    const raw = parseFloat(this.getAttribute(attr));
    const value = Number.isFinite(raw) ? raw : fallback;
    return Math.min(max, Math.max(min, value));
  }

  #boolean(attr) {
    if (attr === 'animate') return this.#animating();
    const raw = this.getAttribute(attr);
    return raw === null ? BOOLEANS[attr] : raw !== 'false';
  }

  #colors() {
    const raw = this.getAttribute('colors');
    if (raw == null) return DEFAULT_COLORS.map(parseHex);
    const tokens = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const parsed = tokens.map((t) => [t, parseHex(t)]);
    for (const [token, rgb] of parsed) {
      if (!rgb) warnOnce(`color:${token}`, `"${token}" is not a valid hex color (use #rgb or #rrggbb); ignored.`);
    }
    const all = parsed.map(([, rgb]) => rgb).filter(Boolean);
    if (all.length > MAX_COLORS) warnOnce('colors:many', `at most ${MAX_COLORS} colors are used; the extra ${all.length - MAX_COLORS} are ignored.`);
    if (all.length >= MIN_COLORS) return all.slice(0, MAX_COLORS);
    warnOnce('colors:few', `colors needs at least ${MIN_COLORS} valid hex colors; using the default colors.`);
    return DEFAULT_COLORS.map(parseHex);
  }

  /**
   * Time (seconds) when something else owns the clock, else null (the component runs its own loop).
   * An explicit `time` attribute wins; otherwise the last "hf-seek" time, held at 0 by animate="false".
   */
  #controlled() {
    const manual = parseFloat(this.getAttribute('time'));
    if (Number.isFinite(manual)) return manual;
    if (this.#seek === null) return null;
    return this.getAttribute('animate') === 'false' ? 0 : this.#seek;
  }

  #onSeek = (event) => {
    const time = Number(event.detail?.time);
    if (!Number.isFinite(time)) return;
    this.#seek = time;
    this.#queue(); // draws synchronously: the renderer captures right after the event returns
  };

  /** Explicit animate="true|false" always wins; otherwise animate unless the user prefers reduced motion. */
  #animating() {
    const raw = this.getAttribute('animate');
    if (raw !== null) return raw !== 'false';
    return !this.#motionQuery?.matches;
  }

  // ── WebGL ──

  #setup() {
    this.#canvas?.remove();
    const canvas = this.#canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.addEventListener('webglcontextlost', this.#onContextLost);
    canvas.addEventListener('webglcontextrestored', this.#onContextRestored);
    this.shadowRoot.append(canvas);
    this.#initGL();
  }

  #initGL() {
    const canvas = this.#canvas;
    const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) return this.#fail('WebGL is not available');

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : (this.#fail(gl.getShaderInfoLog(shader)), null);
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SRC);
    const fragment = vertex && compile(gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    if (!vertex || !fragment) return;

    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return this.#fail(gl.getProgramInfoLog(program));
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.#uniforms = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]));
    this.#gl = gl;
    canvas.hidden = false;
    this.#fallback.hidden = true;
  }

  /** WebGL can't be used: show a CSS gradient built from the colors instead, and tell the page. */
  #fail(message) {
    warnOnce(`fail:${message}`, `${message}; showing a CSS gradient fallback.`);
    this.#gl = null;
    if (this.#canvas) this.#canvas.hidden = true;
    this.#fallback.hidden = false;
    this.dispatchEvent(new CustomEvent('error', { detail: { message } }));
  }

  #onContextLost = (event) => {
    event.preventDefault(); // lets the browser restore the context
    cancelAnimationFrame(this.#raf);
    this.#gl = null;
  };

  #onContextRestored = () => {
    this.#initGL();
    this.#queue();
  };

  // ── Rendering ──

  /** Coalesce changes into one draw, or run the animation loop (only while on screen). */
  #queue = () => {
    if (!this.isConnected) return;
    cancelAnimationFrame(this.#raf);
    if (this.#controlled() !== null) {
      // Externally clocked: no loop, no frame callbacks. Draw this exact moment right now.
      this.#draw();
      return;
    }
    if (this.#gl && this.#animating() && this.#visible) {
      this.#last = 0;
      this.#raf = requestAnimationFrame(this.#tick);
    } else {
      this.#raf = requestAnimationFrame(() => this.#draw());
    }
  };

  #tick = (now) => {
    this.#raf = requestAnimationFrame(this.#tick);
    // Accumulate time so changing speed never makes the animation jump.
    if (this.#last) this.#time += Math.min((now - this.#last) / 1000, 0.1) * this.#number('speed') * 0.5;
    this.#last = now;
    this.#draw();
  };

  #draw() {
    if (!this.#gl) {
      if (!this.#fallback.hidden) this.#paintFallback();
      return;
    }
    if (!this.clientWidth || !this.clientHeight) {
      warnOnce('size', 'the element has no size; give it a width and height with CSS.');
      return;
    }

    const gl = this.#gl;
    const u = this.#uniforms;
    // Pixel ratio: explicit pixel-ratio wins; video renders pin it to 1 so output never depends
    // on the machine; otherwise follow the screen, capped by maxPixelRatio.
    const pinned = this.#number('pixel-ratio');
    const dpr = pinned > 0 ? pinned : this.#seek !== null ? 1 : Math.min(devicePixelRatio || 1, GradientShader.maxPixelRatio);
    const controlled = this.#controlled();
    const w = Math.max(1, Math.round(this.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.clientHeight * dpr));
    if (this.#canvas.width !== w || this.#canvas.height !== h) {
      this.#canvas.width = w;
      this.#canvas.height = h;
    }
    gl.viewport(0, 0, w, h);

    const colors = this.#colors();
    this.#colorBuffer.fill(0);
    colors.forEach((c, i) => this.#colorBuffer.set(c, i * 3));

    // The shaders use the seed as a phase inside sin/cos, which repeats every ~6.28.
    // Hash it first so every seed lands on an unrelated phase (0–100) and nothing loops.
    const hashed = Math.sin(this.#number('seed') * 12.9898 + 78.233) * 43758.5453;

    // Grain and dither sizes are relative to the gradient: 1 = 1/1000 of its average dimension,
    // so the texture keeps the same proportions at any size or screen density.
    const relative = Math.sqrt(w * h) / 1000;
    // Grain and dither are mutually exclusive: dither wins, so dither="true" alone is enough.
    const dither = this.#boolean('dither');
    const grain = this.#boolean('grain') && !dither;

    gl.uniform2f(u.u_res, w, h);
    gl.uniform1i(u.u_shape, SHAPES.indexOf(this.#shape()));
    gl.uniform1i(u.u_count, colors.length);
    gl.uniform1f(u.u_angle, this.#number('angle') * Math.PI / 180);
    gl.uniform1f(u.u_scale, this.#number('scale'));
    gl.uniform1f(u.u_seed, (hashed - Math.floor(hashed)) * 100);
    gl.uniform1f(u.u_depth, this.#number('depth'));
    // Same time scale as the live loop, so `speed` looks identical either way.
    gl.uniform1f(u.u_time, controlled !== null ? controlled * this.#number('speed') * 0.5 : this.#time);
    gl.uniform1f(u.u_density, this.#number('density'));
    gl.uniform1f(u.u_gamt, this.#number('grain-amount'));
    gl.uniform1f(u.u_grain, grain ? Math.max(1, this.#number('grain-size') * relative) : 0);
    // Dither cells are whole device pixels so the Bayer pattern stays regular.
    gl.uniform1f(u.u_dither, dither ? Math.max(1, Math.round(this.#number('dither-size') * relative)) : 0);
    gl.uniform1f(u.u_dlev, Math.round(this.#number('dither-levels')));
    gl.uniform3fv(u.u_col, this.#colorBuffer);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (controlled !== null) gl.finish(); // the frame is complete before a renderer captures it

    if (!this.#announced) {
      this.#announced = true;
      this.dispatchEvent(new CustomEvent('ready'));
    }
  }

  #paintFallback() {
    const stops = this.#colors().map(([r, g, b]) => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`);
    this.#fallback.style.background = `linear-gradient(${180 - this.#number('angle')}deg, ${stops.join(', ')})`;
  }
}

// ─── Registration ───────────────────────────────────────────────────────────

/**
 * Register the element under a custom tag name (the default <gradient-shader> is
 * registered automatically on import). Returns the registered class.
 */
export function define(tagName = TAG) {
  const existing = customElements.get(tagName);
  if (existing) return existing;
  const ctor = tagName === TAG ? GradientShader : class extends GradientShader {};
  customElements.define(tagName, ctor);
  return ctor;
}

define();

export default GradientShader;
