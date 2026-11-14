This guide covers Text-To-Speech setup, configuration, and usage.

1. User Questions
- Ask how the user wants to access the TTS service: MCP, API key, browser, local model, or another method.
- If an API key or other sensitive information is needed, offer two options: share it in chat for you to configure, or add it privately to `.env.local`. Briefly explain the privacy risks of sharing secrets in chat, without exaggerating or repeating the warning. Warning the user once is enough.

2. Setup
- Once connected to the TTS service, run a quick test to verify it works. If it fails, explain the issue simply, including insufficient credits or usage limits.
- Run `system-info.mjs` to check the user's system specifications and hardware capabilities.
- Install the most accurate local speech alignment model compatible with the user's hardware and language, capable of identifying each spoken word's precise start and end timestamps.
- Add a model installation script to Git and exclude the large model files from version control.
- Use word-level speech alignment to synchronize all video elements precisely with the narration.
- For local TTS, prefer Kokoro or Fish Audio, depending on the user's hardware capabilities.
