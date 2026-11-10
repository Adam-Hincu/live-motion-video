CRITICAL — READ THIS FIRST: Not all themes use gradients; some must remain completely flat. Gradients are STRICTLY FORBIDDEN unless the selected theme explicitly specifies them. Never add gradients of any kind, whether CSS-based or using `gradient-shader.js`. The ONLY exception is an explicit, direct user request to add gradients or a similar effect. No other exceptions. Check `theme.css` and `THEME.md` to verify whether the selected theme allows gradients.

This guide explains how to use gradients within the project and its theme.

1. Gradient Component
- Use the `gradient-shader.js` component for all gradients in the app.
- If `gradient-shader.js` fails, fix any compatibility issues with the renderer. If it cannot work, use an alternative approach or remove gradients entirely.
- Run `system-info.mjs` to check the system specifications and verify that the hardware and renderer support the gradient.

2. Gradient Design Rules
- Use at least 4 gradient colors, preferably 5–7 when appropriate.
- Use a cohesive color palette with complementary shades rather than contrasting hues. Favor harmonious combinations like yellow–orange–red or light blue–blue–deep blue.
- This is a particular case, avoid blue–purple gradients whenever possible, as they are often associated with generic AI-generated designs.
- Define all gradient colors in `theme.css` and reference them from there.
- Render and preview multiple gradient variations, refining their size, colors, and rotation until the result is polished. Never ship without visual verification. You can use `collage.mjs`.
- Adjust the gradient scale to avoid excessive zoom in either direction, ensuring all colors remain clearly visible and blend beautifully, DO NOT zoom out too much.
- Keep background gradients subtle and unobtrusive, ensuring text and UI elements remain clearly readable. Avoid distracting, harsh, or eye-straining colors.
- Use subtle dithering when a technical or developer-oriented aesthetic fits. Apply it sparingly and cleanly to avoid visual distraction or eye strain.
- Grayscale gradients are also welcome, such as subtle silver tones over a near-black background.
