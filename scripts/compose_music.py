"""Original score for the Live Motion video, performed with real sampled instruments.

Instruments (see audio/CREDITS.md):
  - FreePats Clean Electric Guitar (FSBS) .sf2      -> arpeggios
  - FreePats Finger Bass (YR) .sf2                  -> bass line
  - FreePats MuldjordKit acoustic drum kit .sf2     -> drums
  - VSCO-2 CE string sections, contrabass, harp     -> pads and plucks
  - VSCO-2 CE suspended cymbal                       -> swells into section changes

usage: .venv-align/bin/python scripts/compose_music.py <packs-dir> <out-dir>
"""
import os, random, subprocess, sys, glob, re
import numpy as np, soundfile as sf, mido
from scipy import signal

PACKS, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
SR = 48000
random.seed(7)

BPM = 96
BEAT = 60 / BPM          # 0.625 s
BAR = 4 * BEAT           # 2.5 s
FIRST_DOWNBEAT = 1.86    # bar 1; bar 4 lands on "Meet Live Motion" (9.36 s)
TOTAL = 47.5

def t_of(bar, beat=0.0):
    return FIRST_DOWNBEAT + (bar - 1) * BAR + beat * BEAT

NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
def midi(n):
    m = re.match(r'([A-G])(#|b)?(-?\d)', n)
    v = NOTE[m[1]] + (1 if m[2] == '#' else -1 if m[2] == 'b' else 0)
    return 12 * (int(m[3]) + 1) + v

# chord per bar: (bass root, guitar voicing, pad voicing)
CH = {
    'Bm': ('B1', ['B2', 'F#3', 'D4', 'F#4', 'B4'], ['B2', 'F#3', 'D4']),
    'G':  ('G1', ['G2', 'D3', 'B3', 'D4', 'G4'], ['G2', 'D3', 'B3']),
    'Em': ('E1', ['E2', 'B2', 'G3', 'B3', 'E4'], ['E2', 'B2', 'G3']),
    'A':  ('A1', ['A2', 'E3', 'C#4', 'E4', 'A4'], ['A2', 'E3', 'C#4']),
    'Asus': ('A1', ['A2', 'E3', 'D4', 'E4', 'A4'], ['A2', 'E3', 'D4']),
    'D':  ('D2', ['D3', 'A3', 'F#4', 'A4', 'D5'], ['D3', 'A3', 'F#4']),
}
BARS = {1: 'Bm', 2: 'G', 3: 'Em', 4: 'D', 5: 'A', 6: 'Bm', 7: 'G', 8: 'D', 9: 'A', 10: 'Bm', 11: 'G',
        12: 'Em', 13: 'Asus', 14: 'D', 15: 'A', 16: 'G', 17: 'D'}
FULL = set(range(4, 10)) | {14, 15, 16}        # drums + bass driving
BREAK = {10, 11, 12}                              # "Pick a wallpaper" section: lighter
BUILD = {13}

def hum(t, amt=0.008):
    return max(0.0, t + random.uniform(-amt, amt))

# ---------------------------------------------------------------- MIDI parts
def write_midi(path, events, program=0, channel=0, bank=None):
    """events: list of (start_s, dur_s, note, velocity)"""
    mid = mido.MidiFile(ticks_per_beat=960)
    tr = mido.MidiTrack(); mid.tracks.append(tr)
    tempo = mido.bpm2tempo(BPM)
    tr.append(mido.MetaMessage('set_tempo', tempo=tempo))
    if bank is not None:
        tr.append(mido.Message('control_change', control=0, value=bank, channel=channel))
    tr.append(mido.Message('program_change', program=program, channel=channel))
    tr.append(mido.Message('control_change', control=7, value=110, channel=channel))
    msgs = []
    for s, d, n, v in events:
        msgs.append((s, 1, mido.Message('note_on', note=n, velocity=int(v), channel=channel)))
        msgs.append((s + d, 0, mido.Message('note_off', note=n, velocity=0, channel=channel)))
    msgs.sort(key=lambda x: (x[0], x[1]))
    last = 0
    for s, _, m in msgs:
        tick = int(round(mido.second2tick(s, 960, tempo)))
        m.time = max(0, tick - last); last = tick; tr.append(m)
    mid.save(path)

guitar, bass, drums = [], [], []
for bar, name in BARS.items():
    root, gv, _ = CH[name]
    if bar == 17:
        for i, n in enumerate(gv):  # final strum, let it ring
            guitar.append((hum(t_of(bar) + i * 0.035), 5.0, midi(n), 70 - i * 3))
        bass.append((t_of(bar), 4.5, midi(root), 80))
        continue
    # guitar: eighth-note arpeggio, softer and sparser in the intro and the break
    order = [0, 2, 3, 4, 3, 2, 1, 2]
    for k in range(8):
        if bar <= 3 and k % 2 == 1:
            continue
        vel = (52 if bar <= 3 else 60 if bar in BREAK else 70) + (8 if k in (0, 4) else 0) + random.randint(-6, 4)
        guitar.append((hum(t_of(bar, k * 0.5)), BEAT * 0.9, midi(gv[order[k]]), vel))
    # bass
    if bar in FULL or bar in BUILD:
        pattern = [0, 1.5, 2, 3, 3.5] if bar in FULL else [0, 2]
        for b in pattern:
            n = midi(root) + (12 if b == 3.5 else 0)
            bass.append((hum(t_of(bar, b), 0.005), BEAT * (0.45 if b % 1 else 0.9), n, 92 if b == 0 else 78))
    elif bar in BREAK:
        bass.append((t_of(bar), BAR * 0.95, midi(root), 72))
    # drums: MuldjordKit layout (48 kick, 51 snare, 52 closed hi-hat); written below as 36/37/42 and remapped
    DMAP = {36: 48, 37: 51, 42: 52}
    if bar in FULL:
        for b in (0, 1.5, 2, 2.75):
            if b == 2.75 and bar % 2: continue
            drums.append((hum(t_of(bar, b), 0.004), 0.2, 36, 100 if b == 0 else 82))
        for b in (1, 3):
            drums.append((hum(t_of(bar, b), 0.004), 0.2, 37, 88))
        for k in range(8):
            drums.append((hum(t_of(bar, k * 0.5), 0.006), 0.1, 42, (70 if k % 2 == 0 else 50) + random.randint(-6, 6)))
    elif bar in BREAK:
        for k in range(8):
            drums.append((hum(t_of(bar, k * 0.5), 0.006), 0.1, 42, (52 if k % 2 == 0 else 36) + random.randint(-5, 5)))
        for b in (1, 3):
            drums.append((hum(t_of(bar, b), 0.004), 0.2, 37, 62))
    elif bar in BUILD:
        for k in range(16):
            drums.append((t_of(bar, k * 0.25), 0.1, 42, 40 + k * 3))
    if bar == 17:
        drums.append((t_of(bar), 0.3, 36, 96))
# soft kick on the reveal downbeat
drums.append((t_of(4), 0.3, 36, 112))

sf2 = lambda pat: glob.glob(os.path.join(PACKS, '**', pat), recursive=True)[0]
parts = {
    'guitar': (guitar, sf2('EGuitarFSBS-clean bridge*.sf2'), 0, 0, None),
    'bass': (bass, sf2('FingerBassYR*.sf2'), 0, 0, None),
    'drums': ([(s, d, {36: 48, 37: 51, 42: 52}[n], v * (0.8 if n == 37 else 1)) for s, d, n, v in drums], sf2('MuldjordKit*.sf2'), 0, 0, None),
}

def load(path):
    a, sr = sf.read(path, dtype='float32', always_2d=True)
    if a.shape[1] == 1: a = np.repeat(a, 2, axis=1)
    if sr != SR: a = signal.resample_poly(a, SR, sr, axis=0).astype('float32')
    return a

stems = {}
for name, (ev, font, prog, ch, bank) in parts.items():
    mp, wp = f'{OUT}/{name}.mid', f'{OUT}/{name}_raw.wav'
    write_midi(mp, ev, prog, ch, bank)
    subprocess.run(['fluidsynth', '-ni', '-g', '0.6', '-r', str(SR), '-F', wp, font, mp], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    stems[name] = load(wp)

# ---------------------------------------------------------------- VSCO sample parts
VS = os.path.join(PACKS, 'vsco')
def sample_bank(folder, pattern=r'_([A-G]#?)(\d)_'):
    bank = {}
    for f in glob.glob(os.path.join(VS, folder, '*.wav')):
        m = re.search(pattern, os.path.basename(f))
        if not m: continue
        n = midi(m[1] + m[2])
        if n not in bank or '_v1_' in f: bank[n] = f
    return bank

def play(bank, note, dur, gain=1.0, attack=0.6, release=1.2):
    near = min(bank, key=lambda k: abs(k - note))
    a = load(bank[near])
    shift = note - near
    if shift:
        ratio = 2 ** (shift / 12)
        a = signal.resample(a, int(len(a) / ratio), axis=0).astype('float32')
    n = min(len(a), int((dur + release) * SR))
    a = a[:n].copy()
    env = np.ones(n, dtype='float32')
    at = min(n, int(attack * SR)); env[:at] = np.linspace(0, 1, at) ** 2
    rel_start = int(dur * SR)
    if rel_start < n: env[rel_start:] *= np.linspace(1, 0, n - rel_start)
    return a * env[:, None] * gain

def add(buf, a, t):
    i = int(t * SR); j = min(len(buf), i + len(a))
    if i < len(buf): buf[i:j] += a[:j - i]

N = int(TOTAL * SR)
pad = np.zeros((N, 2), dtype='float32')
cello = sample_bank('Strings/Cello Section/susvib')
viola = sample_bank('Strings/Viola Section/susvib')
violin = sample_bank('Strings/Violin Section/susVib', r'_([A-G]#?)(\d)')
cbass = sample_bank('Strings/Solo Contrabass/SusNV', r'_([A-G]#?)(\d)')
harp = sample_bank('Strings/Harp', r'_([A-G]#?)(\d)_')

# intro pad fades in from the very start
for n, bank, g in (('B2', cello, 0.30), ('F#3', viola, 0.22), ('D4', viola, 0.16)):
    add(pad, play(bank, midi(n), 1.86 + BAR, g, attack=1.6, release=1.4), 0.0)
for bar, name in BARS.items():
    _, _, pv = CH[name]
    if bar == 1: continue
    level = 0.22 if bar <= 3 else 0.16 if bar in BREAK else 0.26
    dur = BAR * (2.2 if bar == 17 else 1.0)
    for n, bank in zip(pv, (cello, viola, viola)):
        add(pad, play(bank, midi(n), dur, level, attack=0.5 if bar != 4 else 0.08), t_of(bar))
    if bar in FULL or bar == 17:
        top = midi(pv[-1]) + 12
        add(pad, play(violin, top, dur, level * 0.55, attack=0.7), t_of(bar))
    if bar >= 4 and bar not in BREAK:
        add(pad, play(cbass, midi(CH[name][0]) + 12, dur, level * 0.5, attack=0.3), t_of(bar))

# harp: rising arpeggio on the reveal and on the final chord
harp_buf = np.zeros_like(pad)
for start_bar, chord in ((4, 'D'), (14, 'D'), (17, 'D')):
    tones = [midi(x) for x in CH[chord][1]] + [midi(x) + 12 for x in CH[chord][1][2:]]
    for i, n in enumerate(tones):
        add(harp_buf, play(harp, n, 2.4, 0.35, attack=0.002, release=1.5), t_of(start_bar) + i * 0.07)

# suspended cymbal swells (real recordings) peaking on the section changes
fx = np.zeros_like(pad)
swell = load(glob.glob(os.path.join(VS, 'Percussion', 'susCymb1-cresc-Median*.wav'))[0])
peak = int(np.argmax(np.abs(swell).mean(axis=1)))
for t_hit, g in ((t_of(4), 0.55), (t_of(14), 0.5)):
    add(fx, swell[:peak] * g, t_hit - peak / SR)
hit = load(glob.glob(os.path.join(VS, 'Percussion', 'susCymb1-hit_pp*.wav'))[0])
add(fx, hit * 0.35, t_of(4)); add(fx, hit * 0.3, t_of(17))

def fit(a):
    out = np.zeros((N, 2), dtype='float32'); n = min(N, len(a)); out[:n] = a[:n]; return out
gtr, bss, drm = fit(stems['guitar']), fit(stems['bass']), fit(stems['drums'])

# ---------------------------------------------------------------- mix
def lowpass_sweep(x, t_open):
    """Muffled 'same old desktop' intro that opens up on the reveal."""
    b, a = signal.butter(2, 900 / (SR / 2), 'low')
    closed = signal.lfilter(b, a, x, axis=0).astype('float32')
    mix = np.clip((np.arange(len(x)) / SR - (t_open - 0.8)) / 0.8, 0, 1)[:, None].astype('float32')
    return closed * (1 - mix) + x * mix

music = 0.85 * gtr + 0.9 * bss + 0.75 * drm + pad + harp_buf
music = lowpass_sweep(music, t_of(4)) + fx
# gentle room reverb via sox, then master
sf.write(f'{OUT}/music_dry.wav', music, SR)
subprocess.run(['sox', f'{OUT}/music_dry.wav', f'{OUT}/music_rev.wav', 'reverb', '35', '50', '80', '100', '8', '0'], check=True)
music = load(f'{OUT}/music_rev.wav')[:N]
fade = int(2.5 * SR); music[-fade:] *= np.linspace(1, 0, fade)[:, None]
music *= 0.89 / max(1e-6, np.abs(music).max())
sf.write(f'{OUT}/music.wav', music, SR)
print('music written', f'{OUT}/music.wav', round(len(music) / SR, 2), 's')
