# BandScroll contributor guidance

## What this is

`BandScroll` is a self-hostable React PWA for synchronized live documents. A
conductor controls a session while read-only public viewers follow the same
server-owned position over WebSockets. The repository contains `client/`
(React + Vite + TypeScript), `server/` (Express + Socket.IO + TypeScript), and
root-level build/release tooling.

`AGENTS.md` is a symlink to this file. Keep shared contributor guidance here.

## Runtime and commands

Node.js 24.x and npm 10+ are required. The server scripts reject other Node
majors because `better-sqlite3` is a native addon. After switching Node versions,
reinstall or rebuild dependencies before starting the server or running tests.

```bash
# From the repository root
nvm use
npm install && npm run install:all
npm run dev                    # server :3000, Vite client :5173
npm test                        # server then client Vitest suites
npm run build                   # client build/typecheck then server typecheck

# Per package
cd server && npm run dev
cd server && npm test
cd server && npx tsc --noEmit
cd client && npm run dev
cd client && npm test
cd client && npm run build
```

Server integration tests boot `createAppServer()` on an ephemeral port. The
Vitest configuration forces `STORAGE=memory` and a temporary `DATA_DIR`, so the
ordinary test suite never depends on SQLite or a local native addon. Keep that
test isolation intact.

## Canonical PDF synchronization

For a PDF scroll session, the server owns the only authoritative position:

- `DocumentGeometry`: immutable page heights and total document distance in
  intrinsic PDF points, tied to a document revision.
- `DocumentCursor`: integer `yMicroPoints` from the start of that revision.
- `scrollVelocityPointsPerSecond`, `positionUpdatedAt`, and a discrete
  `controlVersion`.

The server emits materialized `SyncSnapshot`s with a monotonic
`positionSequence` and server timestamp. Clients render a local PDF-coordinate
trajectory with `requestAnimationFrame` between broadcasts. They snap to the
latest canonical cursor after a discrete action, reconnect, hidden-tab wake,
document reload, fullscreen/resize layout recovery, or a large mismatch;
uninterrupted playback uses bounded coordinate correction only.

Viewport size, CSS scroll height, rendered canvas dimensions, page fractions,
normalized `progress`, and screens-per-minute are never valid input to canonical
scroll synchronization. A viewport only maps the same PDF cursor to its own CSS
pixels, with that cursor at the top edge. `progress`, `scrollAnchor`, and
scroll-mode `currentPage` are legacy/migration or display fields; do not revive
them for scroll-mode controls.

## Controls, markers, and playback

Every canonical scroll-mode conductor action uses the `admin-control` socket
command and `applyCanonicalControl()` in `server/src/lib/sessionControl.ts`:
`resume`, `pause`, `seek`, `restart`, `stop`, `seek-marker`, and `set-speed`.
Commands include a document revision and expected `controlVersion`; the server
materializes the cursor at receipt time, validates it, applies the patch
atomically, and broadcasts the result.

The active admin holds a renewable 15-second controller lease and renews it
every five seconds. Marker navigation sends only a marker ID. The server resolves
the stored marker page through document geometry, pauses at the exact page start,
and atomically restores an optional canonical marker velocity.

Playback broadcasts are ephemeral: they do not persist every 250 ms and do not
increment `controlVersion`. Persist only discrete controls and terminal
transitions. Do not add browser position heartbeats, `admin-sync`, parallel
control paths, or viewport-derived auto-stop logic. Server cursor advancement
handles the end of the document and scroll-mode song-boundary auto-stop.

## Runtime compatibility and deployment

The generated `SYNC_PROTOCOL` and build ID are checked through `/api/runtime`
and in the Socket.IO handshake. The client checks before it renders, when a
socket reconnects, on focus/visibility, and once a minute. A mismatch updates
the service worker and reloads before the client can join a session.

Keep `client/scripts/version.js`, `server/scripts/version.js`, and
`scripts/create-release-manifest.mjs` aligned. Container builds require a
non-empty immutable `BUILD_ID`; deploy matching client/server artifacts and
their runtime manifest together. Preserve no-cache HTML/service-worker behavior
and hashed-asset caching.

## Architecture and conventions

- `server/src/app.ts` exports `createAppServer()` and does not listen;
  `server/src/index.ts` is the production launcher. Add app wiring in `app.ts`.
- Express and Socket.IO share one `express-session` middleware. A login/logout
  must reconnect the socket to obtain a new authenticated handshake.
- Server relative imports use ESM `.js` extensions. Use strict TypeScript.
- Session persistence is selectable with `STORAGE=memory|file|sqlite`; file and
  SQLite adapters keep an in-memory mirror and reset transient client counts on
  load.
- PDF uploads extract geometry and a revision. Image signatures are validated
  before native preview rendering. Never pass unchecked input to native decoders.
- Use the structured server logger, never `console.*`. Send client errors via
  `reportError()`.
- The UI uses Tailwind v4 and shadcn-style primitives. The public viewer is an
  immersive route outside the normal layout; preserve its keyboard/pointer path
  for revealing auto-hidden overlays.
- Preserve unrelated user changes and avoid destructive Git commands without
  explicit approval.
