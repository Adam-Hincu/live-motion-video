- If the video has spoken text, use a lightweight, high-accuracy forced-alignment model to extract word-level timestamps from the provided script and audio, ensuring precise audio-visual sync. Check system specs and choose the best supported model.

Forced alignment models:

1. ENGLISH — NORMAL
   Model: Montreal Forced Aligner (MFA)
   Size: ~144 MB

   Model Download (Hugging Face):
   https://huggingface.co/MontrealCorpusTools/english_us_arpa

   Documentation:
   https://montreal-forced-aligner.readthedocs.io/en/latest/


2. MULTILINGUAL — NORMAL
   Model: Multilingual Word Aligner (MWA)
   Size: ~1,300–1,600+ MB (1.3–1.6+ GB)

   Model Download (Read Speech):
   https://huggingface.co/MLSpeech/mwa-timit

   Model Download (Conversational Speech):
   https://huggingface.co/MLSpeech/mwa-buckeye

   Required MMS Backbone:
   https://huggingface.co/facebook/mms-1b-all

   Documentation:
   https://github.com/MLSpeech/Multilingual-Word-Aligner/blob/main/README.md


3. ENGLISH — COMPACT
   Model: PocketSphinx 5.1.1
   Size: ~29 MB (package download)
   Model data: ~38 MB uncompressed

   Model Download (Official GitHub Model Files):
   https://github.com/cmusphinx/pocketsphinx/tree/main/model/en-us

   Model Download (Hugging Face Mirror):
   https://huggingface.co/camenduru/pocketsphinx/tree/main/model/en-us

   Documentation:
   https://pocketsphinx.readthedocs.io/en/latest/


4. MULTILINGUAL — COMPACT
   Model: Bournemouth Forced Aligner 2.0 (ph66)
   Size: ~55 MB (acoustic model only)

   Model Download (Multilingual):
   https://huggingface.co/Tabahi/CUPE-3-mls7

   Model Download (English):
   https://huggingface.co/Tabahi/CUPE-3-en

   Documentation:
   https://speech-industry.github.io/bournemouth-forced-aligner/

   Model Documentation:
   https://speech-industry.github.io/bournemouth-forced-aligner/about-models/


IMPORTANT NOTES:
- All four support local, offline forced alignment.
- All require audio + supplied transcript for alignment.
- PocketSphinx also supports audio-only transcription.
- MFA requires a compatible pronunciation dictionary.
- MWA requires additional MMS model dependencies.
- BFA ph66 requires eSpeak-NG for phonemization.
- BFA's ~55 MB size excludes runtime and dependencies.
- PocketSphinx's ~29 MB figure refers to its package,
  not just the acoustic model.
- Reported sizes are approximate.
