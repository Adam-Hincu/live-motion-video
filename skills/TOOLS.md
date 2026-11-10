This guide covers the available tools: `collage.mjs`, `image-search.mjs`, `video-frames.mjs`, and `system-info.mjs`.

1. Collage
- What it does: `collage.mjs` combines multiple images into one collage, saving tokens and making it easier to compare and select images.
- Why It's Useful: Comparing image options, reviewing video frames to understand progression over time, and analyzing multiple screenshots efficiently.
- Limitations: Images have a minimum size to preserve readability and understanding. If all images cannot fit in one collage, additional collages are generated automatically as separate image files. And it requires `npm install` in `tools/collage`.

2. Image Search
- What it does: `image-search.mjs` searches Openverse and Wikimedia Commons using your query, then automatically generates labeled collages with image IDs for easy selection.
- Why It's Useful: Finding suitable images and backgrounds for videos, especially when recreating them isn't practical. Not all videos have images. Check `theme.css` and `THEME.md` to see if the current theme does.
- Limitations: Subject to rate limits and general usage restrictions.

3. Video Frames
- What it does: `video-frames.mjs` pulls frames out of a video and sends them straight to the collage tool. Frames are never saved, only collages are written. Every tile is captioned `frame <n>  HH:MM:SS.mmm`.
- Picking frames (combinable): `--count N` (evenly spread, first and last included), `--at <time>` (repeatable), `--frame N` (repeatable), `--from A --to B` with `--every 5f` or `--every 0.5s` (A/B are timestamps or frames like `f120`). With no selection it takes 16 frames. Times accept `12.5`, `1:02.5`, `00:01:02.500`, `250ms`.
- Why It's Useful: Analyzing videos (reference clips, renders, screen recordings
- Limitations: Needs `ffmpeg` and `ffprobe` on the PATH and `npm install` in `tools/collage`. Capped at 200 frames per run (`--max-frames`).

4. System Info
- What it does: `system-info.mjs` retrieves relevant system specifications, including GPU, CPU, RAM, storage, and other hardware details.
- Why It's Useful: Useful for adapting local model downloads, heavy rendering, and other hardware-intensive tasks to the system's capabilities.
- Limitations: Designed for cross-platform use, but errors or inconsistencies may occur. Fix any issues and extend the tool if additional system information is needed.
