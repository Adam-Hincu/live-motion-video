This guide covers the framework, technology stack, and initial project setup.

1. HyperFrames
- This project uses HyperFrames: an open-source framework by HeyGen that enables AI agents and developers to turn standard HTML, CSS, and JavaScript into deterministic, frame-accurate videos
- Install it globally using `npm install -g hyperframes`
- No skills, No README, No AGENTS.md or CLAUDE.md (Coming from HyperFrames), No templates or example compositions.
- Documentation: https://hyperframes.heygen.com/introduction
- Before installing Hyperframes, ensure no existing files or directories, including `compositions`, will be overwritten.
- Initialize the Hyperframes project with `hyperframes init projectname`.
- Hyperframes automatically generates files such as `AGENTS.md` and `CLAUDE.md`. Prevent Hyperframes from overwriting existing files during initialization, then delete its generated `AGENTS.md`, `CLAUDE.md`, etc.
- Use the current folder as the project root. If nested, move the files into it using terminal commands and leave no leftovers.
- Ensure `hyperframes.json`, `meta.json`, and `package.json` are correctly initialized with paths and references matching the current project structure. Update them if needed.
- Ensure `theme.css` is properly imported in `index.html` and all relevant files, with its design tokens consistently applied.
- This setup is only done once, if the project is already created you have nothing to do other than ensure these rules are still respected.
