"""Splits the aligned narration at sentence boundaries, inserts pauses, writes narration.wav + narration.json.
usage: .venv-align/bin/python scripts/pace_narration.py <take.wav> <take.json> <outdir>"""
import json, sys
import numpy as np, soundfile as sf
wav, js, out = sys.argv[1:4]
d = json.load(open(js)); words = d['words']
audio, sr = sf.read(wav, dtype='float32')
LEAD = 0.6
# (index of first word of a segment, extra pause inserted before it)
BREAKS = {'meet': 0.9, 'watch': 0.6, 'put': 0.45, 'or': 0.25, 'pick': 0.9, 'every': 0.35, 'forty': 0.8, 'completely': 0.25, 'bring': 0.6, 'download': 0.2}
toks = [w['token'] for w in words]
starts = []
seen = set()
for i, t in enumerate(toks):
    if t in BREAKS and t not in seen and i > 0:
        if t == 'every' and toks[i-1] != 'apply': continue
        if t == 'or' and toks[i-1] != 'screen': continue
        seen.add(t); starts.append(i)
cuts = [0.0] + [(words[i-1]['end'] + words[i]['start']) / 2 for i in starts] + [len(audio) / sr]
pauses = [LEAD] + [BREAKS[toks[i]] for i in starts]
fade = int(0.01 * sr)
pieces, shift_for, t_out = [], [], 0.0
for k in range(len(cuts) - 1):
    seg = audio[int(cuts[k] * sr):int(cuts[k + 1] * sr)].copy()
    seg[:fade] *= np.linspace(0, 1, fade); seg[-fade:] *= np.linspace(1, 0, fade)
    pieces.append(np.zeros(int(pauses[k] * sr), dtype='float32')); t_out += pauses[k]
    shift_for.append((cuts[k], cuts[k + 1], t_out - cuts[k]))
    pieces.append(seg); t_out += len(seg) / sr
pieces.append(np.zeros(int(1.0 * sr), dtype='float32'))
res = np.concatenate(pieces)
sf.write(f'{out}/narration.wav', res, sr)
nw = []
for w in words:
    sh = next(s for a, b, s in shift_for if a <= w['start'] < b)
    nw.append({**w, 'start': round(w['start'] + sh, 3), 'end': round(w['end'] + sh, 3)})
json.dump({'audio': 'audio/voice/narration.wav', 'duration': round(len(res) / sr, 3), 'words': nw}, open(f'{out}/narration.json', 'w'), indent=1)
print('duration', round(len(res) / sr, 2))
print(' '.join(f"{w['token']}@{w['start']:.2f}" for w in nw))
