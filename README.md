# PlayGround

<!-- omgithub:readme:start -->
## 🚀 Build, play, and remix with OMGithub

**Created using [OMGithub.com](https://go.ondev.store/).**

[![OMGithub](https://img.shields.io/badge/OMGithub-Open%20project-orange?style=for-the-badge)](https://go.ondev.store/Rashadthe1/PlayGround)
[![GitHub](https://img.shields.io/badge/GitHub-Source-181717?logo=github&style=for-the-badge)](https://github.com/Rashadthe1/PlayGround)

- 🎮 [Open the project](https://go.ondev.store/Rashadthe1/PlayGround).
- ✨ [Remix this project](https://go.ondev.store/Rashadthe1/PlayGround?remix=1).
- 💻 [Explore the source](https://github.com/Rashadthe1/PlayGround).
- 🛠️ [Check build runs](https://github.com/Rashadthe1/PlayGround/actions).
- 🐛 [Report an issue](https://github.com/Rashadthe1/PlayGround/issues).
- 👤 [Explore the creator's projects](https://go.ondev.store/Rashadthe1).
- 🌍 [Create with OMGithub](https://go.ondev.store/).
<!-- omgithub:readme:end -->

## RINGZERO — playable prototype

This repository contains a dependency-free browser prototype for the character-based tournament fighter. Open `index.html` directly, or serve the project directory with `python3 -m http.server 3002` and visit `http://localhost:3002`.

### Play

- Choose Kirima (TRF / The Rainbow Fist), Reen (BlackHole), or Tela (Comical Antics); each is Extraordinary rarity and serves as your mentor.
- Customize a static face with independently selectable eyes, eyebrows, mouth, blush, and decoration.
- Join the 8-seat single-elimination bracket. In this solo prototype, seven CPU contenders fill the open seats after a brief queue; this substitutes for the requested real-player matchmaking service, which requires a backend.
- Fight with WASD or arrow keys, M1 for light attacks, Shift+M1 for heavy attacks, and Space to dodge. Attacks use windup/readable warning, active hit, and recovery timing; opponent attacks flash red before impact. M2 is reserved.
- Win to advance through quarterfinals, semifinals, and the grand final. A 60-second intermission separates rounds. The bracket records match winners and CPU-only fixtures.

Combat currently runs locally in one browser tab; there is no network multiplayer, account persistence, shop, or ability/equipment system. Character visuals are original CSS-drawn placeholders because the referenced attachment images are not present in the repository. The project intentionally does not implement mentor abilities or progression.

### Development checks

Run `node --check game.js` and `git diff --check` after editing. The game has no package dependencies or build step.
