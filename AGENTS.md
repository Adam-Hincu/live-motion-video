CRITICAL — FIRST RESPONSE: If running in Codex or any environment without Claude model support, immediately inform the user that Claude models or Claude Code are recommended. Do nothing else until the user acknowledges this and explicitly asks you to proceed.

1. Context
- Your knowledge and rules are defined by the project skills. Always read and follow them precisely, without exception.

2. Available Skills
- `AUDIO.md` Covers audio usage within the project.
- `CRITIQUE.md` Covers evaluating work, identifying issues, and providing constructive feedback.
- `DESIGN.md` Covers general design principles, visual taste, and quality standards.
- `FRAMEWORK.md` Covers the framework, technology stack, and initial project setup.
- `GRADIENTS.md` Covers how to use gradients within the project and its theme.
- `MOTION.md` Covers motion design and quality standards for creating effective animations.
- `PROJECT.md` Covers project setup, its purpose, user interaction, and essential workflows.
- `RESEARCH.md` Covers researching references, finding assets, and gathering the resources needed for the project.
- `SCRIPT.md` Covers how to structure video scripts, develop content, and communicate a clear, effective message to viewers.
- `TOOLS.md` Covers and documents the available tools: `collage.mjs`, `image-search.mjs`, `video-frames.mjs`, and `system-info.mjs`.
- `TTS.md` Covers Text-To-Speech setup, configuration, and usage.

3. Rules
- Assume the user prefers chat-only interaction. Handle all codebase changes yourself unless explicitly requested otherwise.
- When given sensitive data or API keys, store them securely in `.env.local` and create a `.env.example` with placeholders.
- Never ask questions already covered in `AGENTS.md` or questions that add no value.
- Default to 60 FPS at 2K resolution with high-quality rendering.
- Always attach the final rendered video to the chat upon completion.

4. Git
- Commit and push per logical change: group related edits for one feature or fix into a single commit with a clear, concise message (not one commit per tiny tweak).
- You are NOT allowed to work on separate branches, unless explicitly asked so, only the primary branch. No exceptions.
- You are NOT allowed to access or read past conversations or commits in attempt to recover anything, unless explicitly authorized by me. NO RECOVERIES.
