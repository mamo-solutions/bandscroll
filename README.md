# BandScroll

**Real-time synchronized PDF scrolling for live sessions.**

BandScroll lets a host — a conductor, band leader, or presenter — open a PDF
(sheet music, a set sheet, slides) and control its auto-scroll while many
read-only viewers follow along in perfect sync over WebSockets. The audience
just opens a link or types a session code; their PDF scrolls itself, exactly in
time with the host.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

> Self-hostable · no accounts for viewers · mobile-first PWA

---

## Features

- 🎼 **Host-controlled auto-scroll** — play, pause, stop, seek, speed, restart.
- 🎚️ **Tap tempo** — tap in the beat and BandScroll derives the scroll speed
  from pages per song and beats per song.
- 🎸 **Song markers / setlist** — save titled markers per page and jump to them
  instantly during the session.
- 🦶 **Foot-switch friendly keyboard shortcuts** — arrow keys control speed
  (`↑`/`↓`), tap tempo (`←`) and play/pause (`→`/`Space`).
- 🔄 **Real-time sync** over Socket.IO; viewers are strictly read-only.
- 🎵 **Swap songs live** — change the PDF mid-session without dropping viewers.
- 👀 **Open session list + join-by-code** (e.g. `SESSION-7421`) on the home page.
- 🔐 **Password-protected host area**; the password lives only in the backend
  `.env` and never reaches the browser bundle.
- 🧮 **Drift-free playback** — viewers extrapolate position locally and gently
  correct toward the host's authoritative state; playback keeps moving even when
  the host tab is in the background.
- 🌍 **English & German UI**, auto-detected from the browser with a manual toggle.
- 📱 **Installable PWA** with a modern, responsive, warm-pastel interface; the
  admin control view is optimized for tablets in portrait mode.
- 🐳 **Docker-ready**, or run it behind your existing nginx / Caddy.

## How it works

The server holds the single source of truth per session: a normalized
`progress` (0–1), a `speed` (progress per second), and a server timestamp. It
does **not** tick a timer — instead every client computes its own position:

```ts
effectiveProgress = clamp01(progress + ((now - updatedAt) / 1000) * speed)
```

So a single state update with `playing: true` is enough to keep a client
scrolling indefinitely. The host emits discrete events on play/pause/seek/speed
plus a slim sync every 250 ms to keep everyone aligned; viewers ease toward the
target each frame and snap on large corrections (seeks). State is authoritative
on the server and shared between HTTP and WebSocket via a single session.

## Tech stack

- **Frontend:** React + Vite + TypeScript, React Router, `react-pdf` (PDF.js),
  `socket.io-client`, Tailwind v4 with shadcn-style components, PWA.
- **Backend:** Node + TypeScript + Express, Socket.IO, `express-session`,
  `multer` for uploads. Pluggable storage: in-memory by default, file-backed
  JSON via `STORAGE=file`, or SQLite via `STORAGE=sqlite` (durable per-write).
- **Tests:** Vitest (unit + an integration suite that boots the real server).

## Quick start

Requirements: Node.js 20+ and npm.

```bash
git clone <your-fork-url> bandscroll && cd bandscroll
cp .env.example .env          # then edit ADMIN_PASSWORD and ADMIN_SESSION_SECRET
npm install && npm run install:all
npm run dev                   # backend on :3000, frontend on :5173
```

Open <http://localhost:5173>. The host area is at `/admin` (link in the footer).

| Command | What it does |
| --- | --- |
| `npm run dev` | Run backend + frontend together (hot reload). |
| `npm run build` | Build the client, then the server (also the typecheck gate). |
| `npm test` | Run the server and client test suites. |

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
| `LOG_LEVEL` | `debug` / `info` (default) / `warn` / `error`. |
| `METRICS_INTERVAL_MS` | Performance-stats summary interval in ms (default `60000`, `0` disables). |

There is intentionally **no** `VITE_ADMIN_PASSWORD`: the password is POSTed once
and authentication lives in an http-only cookie.

## Observability

The server emits **structured logs** — one JSON object per line in production
(`{level,time,msg,...}`, grep/scrape friendly) and a compact pretty form in
development. Verbosity is gated by `LOG_LEVEL`. HTTP requests (method, path,
status, duration), Socket.IO lifecycle (connect/disconnect/room joins/admin
denials), and storage/upload warnings are all logged; the high-frequency
`admin-sync` loop logs only at `debug`, so it never floods the log at the
default level.

**Performance stats** are summarized to the log every `METRICS_INTERVAL_MS`
(`msg: "metrics"`) and served live, admin-only, at `GET /api/admin/metrics`:
process memory/uptime, active sockets, session + viewer counts, HTTP throughput
and latency, and socket-event rates (including `adminSync` throughput).

The client reports uncaught errors (and socket connection failures) to
`POST /api/client-log`, rate-limited to 10/min, so crashes without a visible
console — notably mobile Safari — still land in the server log.

## Deployment

The server serves the built client and the uploads directory, so a reverse proxy
only needs to forward one port (`3000`) — including WebSocket upgrades.

**Docker Compose (with bundled Caddy for TLS):**

```bash
cp .env.example .env          # set production values, NODE_ENV=production
docker compose up --build
```

**Behind an existing nginx / Caddy:** run the app (via the `Dockerfile` or a
systemd service) bound to `127.0.0.1:3000` and reverse-proxy a subdomain to it.
The proxy must forward WebSocket upgrade headers and allow ~50 MB request bodies
for PDF uploads. Set `NODE_ENV=production` so the session cookie is marked
`secure`; the app already trusts `X-Forwarded-Proto`.

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
│       ├── store/{memorySessionStore,fileSessionStore}.ts
│       └── uploads/{cleanup,validate}.ts
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
