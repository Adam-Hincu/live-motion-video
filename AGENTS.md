

6. Research
- Study the subject’s brand designs first.
- Find every asset that fits, whatever the idea needs.

9. Ideas
- Morphing shapes but avoid meaningless morphing shapes. Every visual element must add context or value to the video.
- Verified, Not invented Subject UI
- Morphing text
- Zooms

10. Rules
- No slop. Study the subject closely: smoothness, timing, shot durations, fonts, elements.
- It should look like something you did completely on yourself with your own taste.
- Every morph must be flawless, with no stretching, clipping, or abrupt transitions.
- Avoid invented or “vibe-coded” UI. Verify the subject’s official interface before recreating it; otherwise, omit it or request references.
- The video must be fully understandable without audio. Never rely on sound to communicate essential information.
- Assume the user prefers chat-only interaction. Handle all codebase changes yourself unless explicitly requested otherwise.
- When given sensitive data or API keys, store them securely in `.env.local` and create a `.env.example` with placeholders.
- If the video has spoken text, use a lightweight, high-accuracy forced-alignment model to extract word-level timestamps from the provided script and audio, ensuring precise audio-visual sync. Check system specs and choose the best supported model.
- Never ask questions already covered in `AGENTS.md` or questions that add no value.
- Complete the initial questions and optional TTS setup, then begin immediately. Fill gaps independently and work without interruption, automatically using fallbacks when issues arise.
- Every on-screen text element must add meaningful context asume the viewers read everything.

11. Note
- Audio assets are not currently provided, regardless of prior instructions. Download suitable alternatives for now. Do NOT use hyperframes audio.
