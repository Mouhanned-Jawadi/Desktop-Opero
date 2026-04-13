# Opero Desktop — CLAUDE.md

## What this is
Electron.js wrapper that delivers the **Opero** React SPA as a native Windows/macOS/Linux desktop application.

## Architecture
```
desktop-opero/
├── main.js          — Electron main process (window, tray, menu, IPC, state persistence)
├── preload.js       — Contextbridge: exposes safe APIs to renderer
├── server.js        — Local Express HTTP server serving build/ + proxying /api + /socket.io
├── build/           — Production React SPA (copied from Frontend-Opero/build)
├── assets/
│   ├── icon.png     — 512×512 app icon (used for taskbar, dock, window)
│   └── tray-icon.png — 16×16 system-tray icon
├── package.json     — Electron + electron-builder config
└── dist/            — Output of `npm run dist` (.exe installer on Windows)
```

## How it connects to the backend
`server.js` starts a **local Express server on a random free port** when the app launches.

| Request path      | Forwarded to |
|---|---|
| `/api/*`          | `OPERO_BACKEND_URL` (default: `https://www.opero.cloud-ip.cc`) |
| `/socket.io/*`    | same backend — WebSocket upgraded automatically |
| `/*` (static)     | `build/index.html` + static assets |

Set `OPERO_BACKEND_URL` in `.env` to point at a different backend (e.g. `http://localhost:5000` for local dev).

## Scripts
```bash
npm start          # run in dev mode (DevTools open)
npm run dev        # alias for start
npm run dist       # build Windows NSIS installer → dist/
npm run dist:mac   # build macOS .dmg
npm run dist:linux # build Linux AppImage
```

## Dev setup
1. Make sure `Frontend-Opero` has been built: `cd ../Frontend-Opero && npm run build`
2. Ensure the build is copied: `cp -r ../Frontend-Opero/build ./build`
3. `npm install`
4. `npm start`

## Environment variables
| Variable | Default | Description |
|---|---|---|
| `OPERO_BACKEND_URL` | `https://www.opero.cloud-ip.cc` | Backend API + Socket.IO base URL |

Create a `.env` file in `desktop-opero/` to override.

## Packaging rules
- Never commit `dist/`, `node_modules/`, or `build/` to git
- Icon must be `assets/icon.png` ≥ 512×512 — electron-builder auto-converts to `.ico` / `.icns`
- NSIS installer config is in `package.json` under `"build"`
