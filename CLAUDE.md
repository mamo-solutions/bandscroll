# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`BandScroll` — a self-hostable React PWA that synchronizes PDF auto-scroll of a live session over WebSockets. A host/conductor controls scroll progress; many read-only public clients follow in real time. Two npm packages, `client/` (React + Vite + TS) and `server/` (Express + Socket.IO + TS), plus root tooling.

## Commands

```bash
# From repo root
npm install && npm run install:all   # root concurrently + both packages
npm run dev                          # backend :3000 + frontend :5173 in parallel
npm run build                        # client build, then server tsc
npm test                             # server suite, then client suite

# Per package
cd server && npm run dev             # tsx watch (hot reload), serves :3000
cd server && npm test                # vitest run (unit + integration)
cd server && npx tsc --noEmit        # typecheck app code (tests excluded from this config)
cd client && npm run dev             # vite dev :5173
cd client && npm run build           # tsc && vite build  (also the typecheck gate)
cd client && npm test                # vitest run

# Single test file / name filter
cd server && npx vitest run src/sessionStore.test.ts
cd server && npx vitest run -t "broadcasts an authenticated admin seek"
```

Tests use **Vitest**. Server: `sessionStore.test.ts` + `auth.test.ts` (pure units) and `server.integration.test.ts` (boots the real app via `createAppServer()` on an ephemeral port, then drives REST + `socket.io-client` to assert auth gating and sync broadcasts). Client: `src/types/session.test.ts` covers the `effectiveProgress`/`clamp01` math. The integration test injects a known `ADMIN_PASSWORD` and a temp `UPLOAD_DIR` via [server/vitest.config.ts](server/vitest.config.ts) (`env`); dotenv does not override already-set vars. Server test files are excluded from the build tsconfig so they never reach `dist`.

Login uses `ADMIN_PASSWORD` from the root `.env` (not `.env.example`). The value may differ from the default `change-me-now`; read `.env` before assuming.

## Architecture

### Authoritative state + client-side extrapolation
The server holds the single source of truth per session in a pluggable store ([server/src/sessionStore.ts](server/src/sessionStore.ts)). The default adapter is an in-memory `Map` (`MemorySessionStore`), with optional persistent adapters: `FileSessionStore` (writes `DATA_DIR/sessions.json`) and `SqliteSessionStore` (writes `DATA_DIR/sessions.db` via `better-sqlite3`, one row write per mutation). Both load once into an in-memory mirror at startup and reset transient fields (`connectedClients`, `updatedAt`), so read semantics match the memory store. `progress` is normalized `0..1`, `speed` is `progress`/second, `updatedAt` is a server ms timestamp. The server does **not** tick progress on a timer. Instead each client computes its own position via `effectiveProgress()` ([client/src/types/session.ts](client/src/types/session.ts) and mirrored in [server/src/types.ts](server/src/types.ts)):

```
effectiveProgress = clamp01(progress + ((now - updatedAt) / 1000) * speed)
```

So a single `session-state` with `playing:true` is enough to make a client auto-scroll indefinitely. The host additionally emits a slim `admin-sync` every 250 ms to refresh `progress`/`updatedAt` and keep everyone aligned. Viewers ease toward the target each animation frame and snap when the delta is large (seek/correction) — see the rAF loops in [SessionViewer.tsx](client/src/pages/SessionViewer.tsx) and [AdminSessionControl.tsx](client/src/pages/AdminSessionControl.tsx).

### App wiring
[server/src/app.ts](server/src/app.ts) exports `createAppServer()` which builds the wired Express app + HTTP server + Socket.IO but does **not** listen. [index.ts](server/src/index.ts) is a thin launcher that calls it and listens; the integration test calls it on an ephemeral port. Add middleware/routes in `app.ts`, not `index.ts`.

### Auth is one express-session shared by HTTP and WebSocket
[server/src/auth.ts](server/src/auth.ts) defines `sessionMiddleware`. It is registered on Express **and** on Socket.IO via `io.engine.use(sessionMiddleware)` ([socketServer.ts](server/src/sockets/socketServer.ts)). Admin HTTP routes are guarded by `requireAdmin`; admin socket events are guarded by `isAdminSocket()` reading `socket.request.session.isAdmin`. Unauthenticated admin events are dropped and answered with `admin-error` — never trust the client for `admin-*`.

**Critical gotcha:** the server reads the session **only at the websocket handshake**. The browser socket is a singleton ([client/src/sockets/socket.ts](client/src/sockets/socket.ts)) that often connects anonymously on the public home page *before* login. After login/logout you MUST force a fresh handshake so the socket carries (or drops) the admin cookie — `auth.login`/`auth.logout` call `reconnectSocket()` for exactly this. If admin commands silently stop propagating, suspect a stale pre-login handshake first.

### Server → client broadcast helpers
Routes mutate state then broadcast through module-level helpers in [socketServer.ts](server/src/sockets/socketServer.ts): `broadcastSessionState` (to the session room `session:<code>`), `broadcastSessionEnded`, and `broadcastSessionListUpdated` (global — drives the public home list to refresh). REST admin actions and socket admin events both funnel state changes through `updateSessionState` + these broadcasts, so the two control surfaces stay consistent.

### Frontend UI system
Styling is **Tailwind v4** (via `@tailwindcss/vite`, no `tailwind.config` — theme lives in [client/src/styles.css](client/src/styles.css)) with **shadcn-style** primitives in `client/src/components/ui/` (Button, Card, Input, Label, Badge, Slider) built on Radix + CVA + the `cn()` helper ([client/src/lib/utils.ts](client/src/lib/utils.ts)). The `@/*` path alias maps to `client/src` (set in both `tsconfig.json` and `vite.config.ts`). Design language: warm-pastel "soft UI" — clay-terracotta primary on a cream canvas, sage = live/playing, amber = paused; semantic CSS variables mapped via `@theme inline` (use `bg-primary`, `text-muted-foreground`, etc., never raw hex). Icons are **lucide-react** (never emoji). Everything is mobile-first; verify at 375px. Add new shadcn components with `npx shadcn@latest add <name>` (configured via [client/components.json](client/components.json)).

Most routes render inside [Layout.tsx](client/src/components/Layout.tsx) (shared sticky header + [Footer.tsx](client/src/components/Footer.tsx)). The **public viewer `/session/:code` is intentionally OUTSIDE that Layout** ([App.tsx](client/src/App.tsx)) — it's a full-screen immersive reader: the PDF/image fills `h-dvh` and a single merged bar (brand/home + title + code + connection + progress) plus the footer float as translucent overlays. While `playing`, those overlays auto-hide after ~2.5 s idle and reveal on any interaction (the effect in [SessionViewer.tsx](client/src/pages/SessionViewer.tsx) listening on window pointer/key events) — never trap the user; keep a reveal path. The PDF viewer ([PdfViewer.tsx](client/src/components/PdfViewer.tsx)) renders react-pdf for PDFs and a plain `<img>` for image uploads, both inside the same scroll container so the sync loop is identical.

### Public visibility
`listPublicSessions()` returns all **non-ended** sessions (draft + live), newest first. Creating a session makes it instantly visible on `/` and fires `session-list-updated`. A listed draft may have no PDF yet; the viewer shows a placeholder and updates live when the PDF/state changes.

### Session codes & uploads
Codes are `SESSION-####` generated in `generateCode()`. PDF uploads (multer, [adminRoutes.ts](server/src/routes/adminRoutes.ts)) are admin-only, PDF-only, ≤50 MB, stored under `UPLOAD_DIR` with a random UUID filename (never the client filename — path-traversal safe). Served read-only at `/uploads/:file`. Obsolete upload files are removed by [cleanup.ts](server/src/uploads/cleanup.ts) when a session is deleted or its PDF is replaced, as long as no other session still references the file.

## Conventions & constraints

- **ESM with `.js` extensions on relative imports in `server/src`** — required so the same source runs under `tsx` (dev) and compiled `node dist` (prod). Keep this when adding server files.
- The `client` and `server` `tsconfig.json` differ (DOM lib + bundler/noEmit vs Node ESM emit). Run typechecks in the right package dir.
- Dev relies on Vite proxying `/api`, `/uploads`, `/socket.io` → `:3000` so the browser sees one origin (cookies + WS work without CORS friction). In prod the server serves the built client `dist` + a SPA fallback; Caddy terminates TLS and proxies to `app:3000`.
- State storage is configurable via `STORAGE` (`memory`, `file`, or `sqlite`). With `file`/`sqlite`, sessions survive restarts in `DATA_DIR/sessions.json` / `DATA_DIR/sessions.db`; `connectedClients` and `updatedAt` are reset on load. `sqlite` uses `better-sqlite3`, whose native addon has no musl prebuild — the Dockerfile installs a build toolchain to compile it. `ADMIN_PASSWORD` must never reach the client bundle — there is intentionally no `VITE_ADMIN_PASSWORD`; the password is POSTed once and auth lives in an http-only cookie.
- Set `NODE_ENV=production` in prod so the session cookie is sent with `secure: true`.
