# Super Inu — Neon District

A standalone Three.js 3D Super Inu demo: a rainy neon city, a textured and animated SI character, 360° view, flight and palm-laser effects. The street includes Nio and Matrix signs and an open area reserved for future combat. Enemies and combat are not implemented yet.

## Run locally

Requires an installed Node.js runtime. No account, API key, subscription, package installation or build step is needed.

On Windows, double-click `START-SUPER-INU.cmd` and keep its server window open. Then open **http://127.0.0.1:8051/** in a WebGL-capable browser.

Or, from this repository's folder:

```sh
npm start
```

The included server binds only to `127.0.0.1` and serves only `dist/`. It stops when its terminal closes. This repository link is source code, not an always-on hosted game.

## Controls

- WASD or arrow keys: move
- Shift: faster movement
- F: take off / land
- Space: palm-laser action
- 360° VIEW: rotate the character
- Drag: orbit the camera
- R: reset the camera
- Touch joystick and on-screen buttons: mobile controls

## Checks

```sh
npm test
```

The tests use Node's built-in test runner and the bundled Three.js modules; no dependency installation is needed.

## Public scope

This repository contains only the standalone 3D demo, the final character asset, the SI shield, startup instructions, relevant tests and bundled runtime libraries. It does not contain the arcade game, credentials, wallet or contract data, private backups, generation references, conversations or rejected model variants.

The browser demo uses same-origin bundled files, with no analytics, account integration or external generation API. All client code and assets in this public repository can be inspected and downloaded by anyone.

Three.js retains its MIT license in `dist/vendor/THREE-LICENSE.txt`. That third-party license is not an additional license grant for the SI character or branding assets.
