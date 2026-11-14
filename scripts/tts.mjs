// Generates narration with Fish Audio. Model is fixed to s2.1-pro-free (free tier) on purpose.
// usage: node scripts/tts.mjs <text-file> <out.wav>
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const MODEL = 's2.1-pro-free';
const VOICE = 'f0c0270e9e4840deb4a5887a51a179f5';
const [, , inFile, outFile] = process.argv;
const text = fs.readFileSync(inFile, 'utf8').trim();
const res = await fetch('https://api.fish.audio/v1/tts', {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.FISH_AUDIO_API_KEY}`, 'Content-Type': 'application/json', model: MODEL },
  body: JSON.stringify({ text, reference_id: VOICE, format: 'wav', sample_rate: 44100, latency: 'normal', normalize: true, chunk_length: 300 }),
});
if (!res.ok) { console.error(res.status, await res.text()); process.exit(1); }
fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
console.log('wrote', outFile, 'model', MODEL);
