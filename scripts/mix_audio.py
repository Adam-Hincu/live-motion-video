"""Builds the music + sound-effects bed that plays under the narration.

- Music is ducked smoothly under the voice (envelope follower), softened above 11 kHz.
- Sound effects are real percussion recordings from VSCO-2 CE, kept low and soft.
- Writes audio/mix/bed.wav (used by index.html) and audio/mix/preview_full.wav (voice + bed, for checks).

usage: .venv-align/bin/python scripts/mix_audio.py <packs-dir>
"""
import glob, json, os, sys
import numpy as np, soundfile as sf
from scipy import signal

PACKS = sys.argv[1]
SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = lambda *p: os.path.join(ROOT, *p)

def load(path):
    a, sr = sf.read(path, dtype='float32', always_2d=True)
    if a.shape[1] == 1: a = np.repeat(a, 2, axis=1)
    if sr != SR: a = signal.resample_poly(a, SR, sr, axis=0).astype('float32')
    return a

music = load(A('audio/music/music.wav'))
voice = load(A('audio/voice/narration.wav'))
N = len(music)
vfull = np.zeros_like(music); vfull[:min(N, len(voice))] = voice[:N]

# ---- duck music under voice
env = np.abs(vfull).mean(axis=1)
win = int(0.05 * SR)
env = np.convolve(env, np.ones(win) / win, mode='same')
active = (env > 0.01).astype('float32')
# smooth: fast attack (80 ms), slow release (450 ms)
g = np.zeros_like(active); a_att = np.exp(-1 / (0.08 * SR)); a_rel = np.exp(-1 / (0.45 * SR)); y = 0.0
for i, x in enumerate(active):
    y = a_att * y + (1 - a_att) * x if x > y else a_rel * y + (1 - a_rel) * x
    g[i] = y
duck_db = -7.5
gain = 10 ** (duck_db * g / 20)
b, a = signal.butter(2, 11000 / (SR / 2), 'low')
music = signal.lfilter(b, a, music, axis=0).astype('float32') * gain[:, None]

# ---- sound effects
VS = os.path.join(PACKS, 'vsco')
def sample(pattern):
    return load(sorted(glob.glob(os.path.join(VS, '**', pattern), recursive=True))[0])
def pitch(x, semis):
    if semis == 0: return x
    r = 2 ** (semis / 12)
    return signal.resample(x, int(len(x) / r), axis=0).astype('float32')
LIB = {
    'tap': lambda: sample('Tumba-Tap1*.wav'),
    'conga': lambda: sample('Conga-Tap1*.wav'),
    'click': lambda: pitch(sample('Claves1_Hit_v1*.wav'), -10),
    'timp': lambda: sample('Timpani2_Hit_v1*.wav'),
}
cache = {}
sfx = np.zeros_like(music)
events = json.load(open(A('audio/sfx.json')))
for ev in events:
    key = ev['sound']
    if key not in cache: cache[key] = LIB[key]()
    x = pitch(cache[key], ev.get('pitch', 0)) * ev.get('gain', 0.3)
    i = int(ev['t'] * SR); j = min(N, i + len(x))
    sfx[i:j] += x[:j - i]

bed = music * 0.62 + sfx
peak = np.abs(bed).max()
if peak > 0.7: bed *= 0.7 / peak
os.makedirs(A('audio/mix'), exist_ok=True)
sf.write(A('audio/mix/bed.wav'), bed, SR)
full = bed + vfull * 0.95
full *= min(1.0, 0.95 / np.abs(full).max())
sf.write(A('audio/mix/preview_full.wav'), full, SR)
rms = lambda x: 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)
speech = g > 0.5
print('bed peak', round(float(np.abs(bed).max()), 3), '| voice rms', round(rms(vfull[speech]), 1),
      'dB | bed rms under voice', round(rms(bed[speech]), 1), 'dB | bed rms in gaps', round(rms(bed[~speech]), 1), 'dB')
