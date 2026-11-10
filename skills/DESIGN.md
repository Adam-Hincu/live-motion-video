This guide covers general design principles, visual taste, and quality standards.

1. Understanding Environment
- You are working within a user-chosen theme. Respect it and its design direction. Preserve its core identity instead of unnecessarily changing its established elements.
- The theme is defined in `theme.css` and `THEME.md`. Thoroughly review both to understand its design rules and identity.
- `THEME.md` defines the video's visual style, mood, and overall feel. Treat it as the definitive creative direction, not a rigid rulebook, and follow it faithfully.
- `theme.css` defines the design system and tokens. Add tokens when needed, following the existing system. Stick with the current style. Modify or remove existing tokens only when explicitly requested.

2. Design Principles
- Avoid eyebrow labels and subtitles entirely.
- If the theme uses gradients, carefully read and follow `GRADIENTS.md`. Otherwise, skip it.
- Add a subtle but beautifully visible motion blur.
- Ensure every card, container, and surface follows consistent concentricity, with properly aligned corners, radii, and spacing.
- Thoroughly read and follow `MOTION.md` for clean, consistent animations.
- Prioritize minimalism and generous negative space.
- Avoid grid and dotted backgrounds. Prefer solid colors or gradients when permitted by the theme.

3. Rules
- If the theme uses images or media, never recreate them with shapes or SVGs. Use real, meaningful visuals, following `RESEARCH.md` and using `image-search.mjs`.
- CRITICAL: ALWAYS use design tokens. NEVER hardcode values unless absolutely necessary. Prefer reusable tokens in theme.css, but avoid tokens for one-off values. Keep theme.css minimal and hardcoding to an absolute minimum.
- If the video features a product UI, verify its official interface before recreating it. Otherwise, omit it or request references.
- Recreate UI elements directly in videos, with code. Never use screenshots, overlays, or workarounds.
- Assume viewers read every word on screen. Show only essential text that adds meaningful context.
- Never add elements without a clear, immediately recognizable purpose and substantial value.
