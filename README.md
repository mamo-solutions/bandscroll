# BandScroll

**Real-time synchronized PDF scrolling for live sessions.**

[![Tests](https://github.com/mamo-solutions/bandscroll/actions/workflows/ci-release.yml/badge.svg?branch=main&event=push)](https://github.com/mamo-solutions/bandscroll/actions/workflows/ci-release.yml?query=branch%3Amain)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

BandScroll lets a host — a conductor, band leader, or presenter — open a PDF
(sheet music, a set sheet, slides) or an image and control its playback while
many read-only viewers follow along in perfect sync over WebSockets. The
audience just opens a link or types a session code; their document advances
itself, exactly in time with the host.

> Self-hostable · no accounts for viewers · mobile-first PWA

---

## Features

- 🎼 **Host-controlled auto-scroll** — play, pause, stop, seek, speed, restart.
- 🖥️ **Fullscreen live reader** — distraction-free public session view with
  auto-hiding overlays and edge-to-edge document presentation.
- 📄 **Scroll mode and page mode** — continuous scrolling for long sheets or
  page-by-page playback with direct page navigation.
- 🎚️ **Stable document tempo** — fixed Slow/Medium/Fast presets and an
  advanced PDF-points-per-second value; speed never depends on a viewport.
- 🎸 **Song markers / setlist** — save titled markers per page and jump to them
  instantly during the session.
- 🦶 **Foot-switch friendly keyboard shortcuts** — arrow keys control speed
  (`↑`/`↓`), tap tempo (`←`) and play/pause (`→`/`Space`).
- 🖼️ **PDF and image uploads** — use the same synchronized viewer for sheet
  music, slides, posters, or reference images.
- 🔄 **Real-time sync** over Socket.IO; viewers are strictly read-only.
- 🎵 **Swap songs live** — change the PDF mid-session without dropping viewers.
- 👀 **Open session list + join-by-code** (e.g. `SESSION-7421`) on the home page.
- 🔐 **Password-protected host area**; the password lives only in the backend
  `.env` and never reaches the browser bundle.
- 💾 **Pluggable persistence** — run with in-memory storage, file-backed JSON,
  or SQLite depending on how durable you need sessions to be.
- 🧮 **Canonical PDF-coordinate sync** — the server owns an integer intrinsic
  PDF cursor. Every viewport renders that same coordinate at its top edge,
  without page fractions, scroll heights, or screen-based calculations.
- 🌍 **English & German UI**, auto-detected from the browser with a manual toggle.
- 📱 **Installable PWA** with a modern, responsive, warm-pastel interface; the
  admin control view is optimized for tablets in portrait mode.
- 📈 **Structured logs and admin metrics** — request/socket metrics plus a live
  admin metrics endpoint for operational visibility.
- 🚀 **Automated CI and releases** — pushes to `main` run tests, build the app,
  and publish a GitHub release for new semver versions.
- 🐳 **Docker-ready**, or run it behind your existing nginx / Caddy.

## How it works

For PDF scroll sessions, the server owns a `DocumentCursor`: an integer offset
from the start of the PDF measured in micro-points. On upload, BandScroll reads
the immutable PDF page geometry and stores a document revision. Playback adds a
PDF-points-per-second velocity to that cursor; it never uses normalized progress,
page fractions, viewport dimensions, or CSS scroll height.

The server broadcasts timestamped `SyncSnapshot`s while playing. Each viewer
uses `requestAnimationFrame` to render a local PDF-coordinate trajectory between
snapshots. A seek, pause, reconnect, fullscreen/resize layout recovery, document
reload, or significant mismatch snaps exactly to the latest server cursor.
Normal uninterrupted playback receives only bounded coordinate corrections, so
the scroll remains smooth while every client keeps the same PDF point at the top
of its view.

The admin sends discrete revision-checked controls (`resume`, `pause`, `seek`,
`restart`, `stop`, marker seek, and speed change). A renewable controller lease
ensures that one conductor is authoritative. Selecting a marker sends its ID;
the server resolves the persisted page to the exact geometry-derived page start.

Clients must also match the server's generated build ID and sync protocol before
joining. An older PWA automatically updates its service worker and reloads, so
it cannot participate using stale synchronization code.

## Tech stack

- **Frontend:** React + Vite + TypeScript, React Router, `react-pdf` (PDF.js),
  `socket.io-client`, Tailwind v4 with shadcn-style components, PWA.
- **Backend:** Node + TypeScript + Express, Socket.IO, `express-session`,
  `multer` for uploads. Pluggable storage: in-memory by default, file-backed
  JSON via `STORAGE=file`, or SQLite via `STORAGE=sqlite` (durable per-write).
- **Tests:** Vitest (unit + an integration suite that boots the real server).
- **Automation:** GitHub Actions for CI, build verification, and release
  publication from committed semver versions.

## Quick start

Requirements: Node.js 24.x and npm 10+.

```bash
git clone <your-fork-url> bandscroll && cd bandscroll
cp .env.example .env          # then edit ADMIN_PASSWORD and ADMIN_SESSION_SECRET
npm install && npm run install:all
npm run dev                   # backend on :3000, frontend on :5173
```

If you switch Node versions, reinstall dependencies before running tests so
native addons such as `better-sqlite3` are rebuilt for the active runtime:

```bash
nvm use
npm install && npm run install:all
```

Open <http://localhost:5173>. The host area is at `/admin` (link in the footer).

| Command | What it does |
| --- | --- |
| `npm run dev` | Run backend + frontend together (hot reload). |
| `npm run build` | Build the client, then the server (also the typecheck gate). |
| `npm test` | Run the server and client test suites. |
| `npm run version:sync` | Advance the committed semver version based on new git history. |

## Load testing

The protocol-aware load runner creates and removes its own session, verifies the
server runtime manifest, and connects synthetic public Socket.IO viewers. For
scroll mode, supply a PDF so the server can extract canonical document geometry.

```bash
ADMIN_PASSWORD='your-admin-password' \
npm --prefix server run load:test -- \
  --base-url https://bandscroll.example.com \
  --clients 300 \
  --batch-size 15 \
  --ramp-ms 10000 \
  --late-join-clients 20 \
  --late-join-delay-ms 2000 \
  --duration-ms 60000 \
  --pdf-path /absolute/path/to/document.pdf \
  --speed 36
```

Viewers connect in batches of 15 by default, distributed over `--ramp-ms`. Once
scroll playback is active, a late wave of up to 20 viewers (or 20% of the total,
whichever is lower) joins after two seconds. Adjust this with `--batch-size`,
`--late-join-clients`, and `--late-join-delay-ms`; set late join clients to `0`
to disable that wave. Late viewers are also batched, with a 250 ms pause between
batches by default; adjust it with `--late-join-batch-delay-ms`.

The runner validates authoritative snapshots, controller errors, cursor/document
revisions, sequence ordering, the late viewers' active canonical cursor, a
controlled viewer reconnect, lease renewal, and the canonical pause, seek,
marker, restart, resume, and stop controls. It is a server/socket capacity test,
not a replacement for browser E2E coverage of PDF rendering, animation
smoothness, fullscreen, or viewport layout.

## Configuration

All configuration is via the root `.env` (see `.env.example`):

| Variable | Description |
| --- | --- |
| `NODE_ENV` | `development` or `production` (enables the `secure` cookie). |
| `PORT` | Backend port (default `3000`). |
| `ADMIN_PASSWORD` | Host login password. **Backend only — never in the frontend.** |
| `ADMIN_SESSION_SECRET` | Long random string used to sign the session cookie. |
| `UPLOAD_DIR` | Where uploaded PDFs are stored. |
| `PUBLIC_BASE_URL` | Public base URL, used for shareable links. |
| `STORAGE` | `memory` (default), `file`, or `sqlite` for persisted sessions. |
| `DATA_DIR` | Where `sessions.json` (`file`) or `sessions.db` (`sqlite`) is stored. |
| `AI_CONFIG_ENCRYPTION_KEY` | Required to store app-wide AI provider keys encrypted at rest. |
| `LOG_LEVEL` | `debug` / `info` (default) / `warn` / `error`. |
| `METRICS_INTERVAL_MS` | Performance-stats summary interval in ms (default `60000`, `0` disables). |
| `BUILD_ID` | Immutable build identifier required for Docker/release builds; generated locally for development. |

There is intentionally **no** `VITE_ADMIN_PASSWORD`: the password is POSTed once
and authentication lives in an http-only cookie.

## Observability

The server emits **structured logs** — one JSON object per line in production
(`{level,time,msg,...}`, grep/scrape friendly) and a compact pretty form in
development. Verbosity is gated by `LOG_LEVEL`. HTTP requests (method, path,
status, duration), Socket.IO lifecycle (connect/disconnect/room joins/admin
denials), and storage/upload warnings are all logged; the high-frequency
playback snapshots are emitted at a controlled cadence and do not cause
persistent session writes, so normal scroll playback does not flood storage.

**Performance stats** are summarized to the log every `METRICS_INTERVAL_MS`
(`msg: "metrics"`) and served live, admin-only, at `GET /api/admin/metrics`:
process memory/uptime, active sockets, session + viewer counts, HTTP throughput
and latency, and socket-event rates (including `adminSync` throughput).

The client reports uncaught errors (and socket connection failures) to
`POST /api/client-log`, rate-limited to 10/min, so crashes without a visible
console — notably mobile Safari — still land in the server log.

## Release workflow

BandScroll now keeps its package versions in sync with git history. The
committed semver number is the release source of truth, while the client build
adds the short git hash for display in the UI.

- `feat:` commits trigger a minor bump.
- `fix:` and other shipped code changes trigger a patch bump.
- `BREAKING CHANGE` or `!` markers trigger a major bump.
- Pushes to `main` run GitHub Actions tests and builds, then publish a GitHub
  release for the committed version if the matching `vX.Y.Z` tag/release does
  not already exist.

## Deployment

The server serves the built client and the uploads directory, so a reverse proxy
only needs to forward one port (`3000`) — including WebSocket upgrades.

**Docker Compose (with bundled Caddy for TLS):**

```bash
cp .env.example .env          # set production values, NODE_ENV=production
export BUILD_ID="$(node -p \"require('./package.json').version\")+$(git rev-parse HEAD)"
docker compose up --build
```

**Behind an existing nginx / Caddy:** run the app (via the `Dockerfile` or a
systemd service) bound to `127.0.0.1:3000` and reverse-proxy a subdomain to it.
The proxy must forward WebSocket upgrade headers and allow ~50 MB request bodies
for PDF uploads. Set `NODE_ENV=production` so the session cookie is marked
`secure`; the app already trusts `X-Forwarded-Proto`.

Production deployments assume exactly one trusted reverse proxy hop and do not
support exposing the Node app port directly to the internet. Keep the app bound
to a private interface or container network and let the proxy terminate TLS.

Every deployment requires an immutable `BUILD_ID`. The client and server reject
different build IDs, so deploy the matching client/server release artifacts and
their `runtime-manifest.json` together. Never reuse a build ID for a new image.

BandScroll is intentionally designed for audience-visible/live-session content.
Treat uploaded documents for listed or live sessions as visible to anyone with
the public link or code; private/confidential document access control is out of
scope for the current product model.

## Project structure

```
bandscroll/
├── client/          # React + Vite PWA
│   └── src/{api,sockets,types,components,pages,i18n}
│       └── components/ui/   # shadcn-style Tailwind primitives
├── server/          # Express + Socket.IO
│   └── src/{app,index,env,types,sessionStore,auth}.ts
│       ├── routes/{publicRoutes,adminRoutes}.ts
│       ├── sockets/socketServer.ts
│       ├── lib/{documentPosition,sessionControl,syncSnapshot}.ts
│       ├── store/{memorySessionStore,fileSessionStore,sqliteSessionStore}.ts
│       └── uploads/{cleanup,validate}.ts
├── .github/workflows/ # CI and release automation
├── scripts/         # repository automation helpers
├── uploads/         # uploaded PDFs
├── Dockerfile · docker-compose.yml · Caddyfile
└── .env.example
```

## Limitations & roadmap

Sessions default to in-memory storage; set `STORAGE=file` (JSON) or
`STORAGE=sqlite` (durable per-write) in `.env` to persist them across restarts.
Uploads are garbage-collected when a session is deleted or its PDF is replaced,
provided no other session references the same file. There is a single shared
host password (no per-user accounts). Possible next steps: a Postgres adapter, a
Redis adapter for horizontal scaling, multi-file setlists, and per-user roles.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) — we
use the Developer Certificate of Origin (`git commit -s`) rather than a CLA.

## License

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for
attribution.
