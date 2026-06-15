# PDF Sync Stage

Eine selbst hostbare **React-PWA**, mit der das PDF-Scrolling einer Live-Session
in Echtzeit über WebSockets synchronisiert wird. Eine Band, ein Dirigent oder
ein Host öffnet ein PDF (z. B. Noten oder ein Set-Sheet), steuert den
automatischen Scroll-Fortschritt und überträgt diesen Zustand live an viele
Zuschauer-Clients. Öffentliche Nutzer können Sessions sehen und beitreten; der
Steuerungs-/Dirigent-Bereich ist passwortgeschützt.

> MVP – funktional, testbar und gut erweiterbar. In-Memory-State, keine Datenbank.

---

## Features

- 🎼 Host/Dirigent steuert Auto-Scroll eines PDFs für ein Publikum
- 🔄 Echtzeit-Sync über Socket.IO (Play / Pause / Stop / Seek / Speed)
- 👀 Öffentliche, read-only Zuschauer-Ansicht je Session-Code (`SESSION-7421`)
- 🔐 Admin-Login per Passwort **ausschließlich aus der Backend-`.env`**
  (HTTP-only Session-Cookie, kein Passwort im React-Bundle)
- 🧮 Driftfreie Sync-Logik: Clients berechnen die Position lokal weiter und
  korrigieren weich anhand der Server-Snapshots
- 📤 PDF-Upload (nur PDF, max. 50 MB, zufällige Dateinamen → kein Path-Traversal)
- 📱 Installierbar als PWA; modernes, warm-pastelliges UI (Tailwind v4 +
  shadcn/ui), mobile-first und responsiv auf allen Bildschirmgrößen
- 🐳 Docker + Docker Compose + Caddy Reverse-Proxy

---

## Architektur

```
Browser (React PWA)  ──HTTP/WS──>  Caddy  ──>  Node/Express + Socket.IO
   /                   PDF.js                      In-Memory SessionStore
   /session/:code      Auto-Scroll                 /uploads (lokales Volume)
   /admin*             Steuerung
```

- **Frontend:** React + Vite + TypeScript, React Router, `react-pdf` (PDF.js),
  `socket.io-client`, `vite-plugin-pwa`.
- **Backend:** Node + TypeScript + Express, `socket.io`, `express-session`
  (Session-Cookie wird mit Socket.IO geteilt → Admin-Events serverseitig
  authentifiziert), `multer` für Uploads.
- **State:** autoritativ im Server (`Map<string, SessionState>`). `progress` ist
  von `0.0` bis `1.0` normalisiert, `speed` ist `progress` pro Sekunde.
- **Prod:** Der Server liefert das gebaute React-`dist` und `/uploads` statisch
  aus; Caddy terminiert TLS und proxyt auf `app:3000`.

### Sync-Logik (Kern)

Der Server hält den State. Während `playing === true` berechnet jeder Client
lokal seine Position:

```ts
effectiveProgress = clamp01(state.progress + ((Date.now() - state.updatedAt) / 1000) * state.speed);
scrollTop = effectiveProgress * (scrollHeight - clientHeight);
```

Eingehende Updates springen nicht hart: bei kleiner Differenz wird weich
angenähert, bei großer Differenz (Seek/Korrektur) direkt gesetzt. Der Host
sendet diskrete Events bei Play/Pause/Seek/Speed und zusätzlich während des
Abspielens alle **250 ms** einen schlanken `admin-sync`.

---

## Lokale Installation

Voraussetzungen: Node.js 20+ (getestet mit Node 22/26), npm.

### Variante A – beide Apps zusammen (Root)

```bash
npm install            # installiert nur 'concurrently' im Root
npm run install:all    # installiert server/ und client/ Dependencies
npm run dev            # startet Backend (:3000) und Frontend (:5173) parallel
```

### Variante B – getrennt

```bash
# Backend
cd server
npm install
npm run dev            # http://localhost:3000

# Frontend (zweites Terminal)
cd client
npm install
npm run dev            # http://localhost:5173
```

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:3000> (Health-Check: `/api/health`)

Vite proxyt `/api`, `/uploads` und `/socket.io` im Dev-Modus auf `:3000`, sodass
der Browser eine einzige Origin sieht (Cookies + WebSockets ohne CORS-Probleme).

---

## Installation mit Docker Compose

```bash
cp .env.example .env   # Werte anpassen (siehe unten)
docker compose up --build
```

- App + Caddy starten. Aufruf über <https://localhost> (Caddy stellt für
  `localhost` ein lokales Zertifikat aus).
- `uploads/` ist als Volume gemountet und bleibt erhalten.
- Für eine echte Domain: `Caddyfile` anpassen (siehe Kommentare darin) und
  `PUBLIC_BASE_URL` sowie `NODE_ENV=production` in der `.env` setzen.

---

## `.env` Konfiguration

`.env` liegt im Projekt-Root (wird vom Server geladen). Siehe `.env.example`:

| Variable               | Beschreibung                                                            |
| ---------------------- | ----------------------------------------------------------------------- |
| `NODE_ENV`             | `development` oder `production` (steuert `secure`-Cookie).              |
| `PORT`                 | Backend-Port (Default `3000`).                                          |
| `ADMIN_PASSWORD`       | Admin-/Dirigent-Passwort. **Nur Backend. Niemals im Frontend.**        |
| `ADMIN_SESSION_SECRET` | Langer, zufälliger String zum Signieren des Session-Cookies.           |
| `UPLOAD_DIR`           | Upload-Verzeichnis (Dev: `../uploads`, Docker: `/uploads`).            |
| `PUBLIC_BASE_URL`      | Öffentliche Basis-URL (für geteilte Links).                            |

> ⚠️ Es gibt bewusst **keine** `VITE_ADMIN_PASSWORD` o. Ä. – das Passwort darf
> nie ins Client-Bundle gelangen. Der Login schickt das Passwort einmalig an das
> Backend; die Authentifizierung lebt danach im HTTP-only Cookie.

---

## Admin-Login

1. `/admin/login` öffnen.
2. Passwort aus der `.env` (`ADMIN_PASSWORD`) eingeben → POST `/api/admin/login`.
3. Bei Erfolg setzt das Backend ein HTTP-only Cookie und leitet zu `/admin`.
4. `/admin` und `/admin/session/:id` sind ohne gültiges Cookie nicht erreichbar
   (geprüft über `/api/admin/me`).
5. Das Passwort wird **nicht** in `localStorage`/`sessionStorage` gespeichert.

---

## Public-Session-Flow

1. Admin erstellt im Dashboard eine Session (Titel, optionale Beschreibung, PDF).
2. Ein Session-Code wird generiert (z. B. `SESSION-7421`).
3. Admin öffnet die Dirigent-Ansicht und startet die Wiedergabe (Play).
4. Zuschauer öffnen `/` und treten per Karte oder Code-Eingabe bei
   (`/session/:code`).
5. Clients joinen den Socket-Room, erhalten den aktuellen State und scrollen
   automatisch synchron mit. Bei Verbindungsverlust erscheint ein Hinweis; bei
   Reconnect wird der Room neu betreten, der State neu angefordert und die
   Position korrigiert. Clients können **keine** Steuerbefehle senden.

---

## WebSocket-Event-Übersicht

**Client → Server**

| Event                   | Payload          | Zweck                          |
| ----------------------- | ---------------- | ------------------------------ |
| `join-session`          | `code`           | Session-Room beitreten         |
| `leave-session`         | –                | Room verlassen                 |
| `request-session-state` | `code?`          | Aktuellen State anfordern      |

**Admin → Server** (serverseitig authentifiziert; sonst ignoriert + `admin-error`)

| Event               | Payload                        | Zweck                         |
| ------------------- | ------------------------------ | ----------------------------- |
| `admin-join-session`| `sessionId`                    | Als Host dem Room beitreten   |
| `admin-play`        | `sessionId`                    | Wiedergabe starten            |
| `admin-pause`       | `sessionId`                    | Pausieren                     |
| `admin-stop`        | `sessionId`                    | Stop + Position auf 0         |
| `admin-seek`        | `{ sessionId, progress }`      | Position setzen               |
| `admin-set-speed`   | `{ sessionId, speed }`         | Geschwindigkeit (progress/s)  |
| `admin-sync`        | `{ sessionId, progress, playing }` | Schlanker 250-ms-Sync     |

**Server → Clients**

| Event                  | Payload                              | Zweck                       |
| ---------------------- | ------------------------------------ | --------------------------- |
| `session-state`        | `SessionState`                       | Vollständiger Zustand       |
| `session-ended`        | `{ id }`                             | Session wurde beendet       |
| `session-not-found`    | `{ code }`                           | Unbekannter Code            |
| `client-count`         | `{ sessionId, connectedClients }`    | Aktualisierte Client-Zahl   |
| `session-list-updated` | –                                    | Öffentliche Liste änderte sich |

---

## REST-API (Kurzüberblick)

Public: `GET /api/health`, `GET /api/sessions/public`,
`GET /api/sessions/code/:code`, `GET /uploads/:filename`.

Admin (Cookie nötig): `POST /api/admin/login|logout`, `GET /api/admin/me`,
`GET/POST /api/admin/sessions`, `GET /api/admin/sessions/:id`,
`POST /api/admin/sessions/:id/{pdf,start,pause,seek,speed,end}`,
`DELETE /api/admin/sessions/:id`.

---

## Load-Test-Hinweise (Ziel: bis 300 Clients)

- Die Last ist überwiegend ausgehend: Der Server broadcastet pro Session ~4
  schlanke `session-state`-Nachrichten pro Sekunde an alle Room-Mitglieder.
- Beispiel-Lasttest mit [`artillery`](https://www.artillery.io/) +
  `engine: socketio`: 300 virtuelle Nutzer, jeweils `connect` →
  `join-session` mit einem Code → 60 s idle (nur empfangen).
- Achte auf Datei-Deskriptor-Limits (`ulimit -n`) und genügend RAM.
- Optional für mehr Durchsatz: Socket.IO mit einem Redis-Adapter horizontal
  skalieren (nicht Teil des MVP).
- Tipp: Das PDF wird einmalig pro Client geladen (statisches Caching durch
  Caddy/Browser); der laufende Sync-Traffic ist klein.

---

## Bekannte MVP-Einschränkungen

- **In-Memory-State:** Sessions gehen bei einem Server-Neustart verloren.
- **Eine einzige Admin-Rolle** (ein gemeinsames Passwort, keine Nutzerkonten).
- Keine PDF-Vorschau/Seitennavigation außer dem fortlaufenden Scroll.
- Keine horizontale Skalierung (Single-Node Socket.IO, kein Redis-Adapter).
- Uploads werden nicht automatisch aufgeräumt (auch nach `delete`/`end` bleibt
  die PDF-Datei liegen).
- Keine Rate-Limits/Brute-Force-Schutz am Login (für Testbetrieb ausreichend).

---

## Nächste Ausbaustufen

- Persistenz (SQLite/Postgres) für Sessions und Uploads-Metadaten.
- Redis-Adapter für Socket.IO → mehrere App-Instanzen.
- Eigene Nutzerkonten/Rollen statt eines globalen Admin-Passworts.
- PDF-Seitenmarken/Sprungmarken, Setlist mit mehreren Stücken.
- Aufräumen verwaister Uploads, Rate-Limiting am Login, Audit-Log.
- Latenzmessung/Clock-Offset-Korrektur für noch präziseren Sync.

---

## Projektstruktur

```
play-a-sync/
├── client/          # React + Vite PWA
│   └── src/{api,sockets,types,components,pages}
├── server/          # Express + Socket.IO
│   └── src/{index,env,types,sessionStore,auth}.ts
│       ├── routes/{publicRoutes,adminRoutes}.ts
│       └── sockets/socketServer.ts
├── uploads/         # hochgeladene PDFs (Volume)
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── Caddyfile
└── README.md
```
