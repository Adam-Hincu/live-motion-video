"""Word-level forced alignment of narration against its known script (torchaudio MMS_FA).
usage: TORCH_HOME=models .venv-align/bin/python scripts/align.py <audio.wav> <script.txt> <out.json>"""
import json, re, sys
import torch, torchaudio, soundfile as sf

audio_path, text_path, out_path = sys.argv[1:4]
bundle = torchaudio.pipelines.MMS_FA
model = bundle.get_model(with_star=False).eval()
tokenizer, aligner = bundle.get_tokenizer(), bundle.get_aligner()

data, sr = sf.read(audio_path, dtype='float32', always_2d=True)
wave = torch.from_numpy(data.mean(axis=1)).unsqueeze(0)
wave = torchaudio.functional.resample(wave, sr, bundle.sample_rate)

raw = open(text_path, encoding='utf8').read().split()
NUM = {'forty-six': 'forty six'}
display, norm = [], []
for w in raw:
    key = w.lower().strip('.,!?;:')
    if key == 'livemotionapp.com':
        parts = ['livemotionapp', 'dot', 'com']
    else:
        parts = re.sub(r"[^a-z' ]", ' ', NUM.get(key, key).replace('-', ' ')).split()
    for i, p in enumerate(parts):
        display.append(w if i == 0 else '')
        norm.append(p.replace("'", ''))

with torch.inference_mode():
    emission, _ = model(wave)
    spans = aligner(emission[0], tokenizer(norm))
ratio = wave.shape[1] / emission.shape[1] / bundle.sample_rate
words = []
for disp, n, sp in zip(display, norm, spans):
    score = sum(s.score * (s.end - s.start) for s in sp) / sum(s.end - s.start for s in sp)
    words.append({'word': disp or n, 'token': n, 'start': round(sp[0].start * ratio, 3), 'end': round(sp[-1].end * ratio, 3), 'score': round(score, 3)})
json.dump({'audio': audio_path, 'duration': round(wave.shape[1] / bundle.sample_rate, 3), 'words': words}, open(out_path, 'w'), indent=1)
low = [w for w in words if w['score'] < 0.5]
print(f'{len(words)} words aligned, mean score {sum(w["score"] for w in words)/len(words):.3f}, low-confidence: {[(w["token"], w["score"]) for w in low]}')
