export type Lang = "de" | "en";

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
];

// Flat, dotted keys keep lookups + typing simple. Both maps share the same shape.
export const de = {
  "common.join": "Beitreten",
  "common.backToOverview": "Zur Übersicht",

  "footer.project": "ein {link} Projekt",
  "footer.hostSession": "Session hosten",

  "home.heroTitle": "Folge der Session in Echtzeit",
  "home.heroSubtitle":
    "Das PDF scrollt automatisch synchron zum Host. Tritt einer offenen Session bei oder gib deinen Code ein.",
  "home.codePlaceholder": "Code, z. B. SESSION-7421",
  "home.codeAria": "Session-Code",
  "home.openSessions": "Offene Sessions",
  "home.activeCount": "{count} aktiv",

  "list.emptyTitle": "Gerade keine offenen Sessions",
  "list.emptyDesc":
    "Sobald ein Host eine Session startet, erscheint sie hier automatisch – oder tritt direkt über einen Code bei.",

  "status.live": "Live",
  "status.draft": "Entwurf",
  "status.ended": "Beendet",

  "conn.connected": "Verbunden",
  "conn.disconnected": "Getrennt",
  "conn.playing": "Läuft",
  "conn.paused": "Pausiert",

  "viewer.notFoundTitle": "Session nicht gefunden",
  "viewer.notFoundDesc":
    "Der Code {code} existiert nicht oder die Session wurde beendet.",
  "viewer.backAria": "Zurück zur Übersicht",
  "viewer.loading": "Lädt…",
  "viewer.endedBanner": "Diese Session wurde vom Host beendet.",
  "viewer.reconnecting": "Verbindung verloren – versuche neu zu verbinden…",
  "viewer.noPdf":
    "Der Host hat noch kein PDF hinterlegt. Sobald es bereitsteht, erscheint es automatisch.",

  "login.title": "Host-Anmeldung",
  "login.desc": "Geschützter Bereich für Dirigent:innen und Hosts.",
  "login.password": "Passwort",
  "login.showPassword": "Passwort anzeigen",
  "login.hidePassword": "Passwort verbergen",
  "login.error": "Falsches Passwort. Bitte erneut versuchen.",
  "login.checking": "Prüfe…",
  "login.submit": "Anmelden",

  "nav.dashboard": "Dashboard",
  "nav.logout": "Abmelden",

  "auth.checking": "Prüfe Anmeldung…",

  "dash.title": "Dashboard",
  "dash.subtitleOne": "{count} Session verwaltet",
  "dash.subtitleOther": "{count} Sessions verwaltet",
  "dash.newSession": "Neue Session",
  "dash.titleLabel": "Titel",
  "dash.titlePlaceholder": "z. B. Konzert – Set 1",
  "dash.descriptionLabel": "Beschreibung",
  "dash.optional": "Optional",
  "dash.uploadPdf": "PDF hochladen",
  "dash.uploadHint":
    "Optional, nur PDF, max. 50 MB. Kann auch später hinzugefügt werden.",
  "dash.create": "Session erstellen",
  "dash.creating": "Erstelle…",
  "dash.createError": "Fehler beim Erstellen",
  "dash.allSessions": "Alle Sessions",
  "dash.empty": "Noch keine Sessions. Erstelle oben deine erste.",
  "dash.pdfReady": "PDF bereit",
  "dash.noPdf": "Kein PDF",
  "dash.control": "Steuern",
  "dash.link": "Link",
  "dash.copied": "Kopiert",
  "dash.end": "Beenden",
  "dash.deleteAria": "Session löschen",
  "dash.deleteConfirm":
    "Session wirklich löschen? Das kann nicht rückgängig gemacht werden.",

  "controls.progress": "Fortschritt",
  "controls.tempo": "Tempo",
  "controls.status": "Status",
  "controls.viewers": "Zuschauer",
  "controls.position": "Position",
  "controls.positionAria": "Position der Session",
  "controls.play": "Play",
  "controls.pause": "Pause",
  "controls.stop": "Stop",
  "controls.startOver": "Anfang",
  "controls.here": "Hierher",
  "controls.speed": "Geschwindigkeit",
  "controls.slow": "Langsam",
  "controls.medium": "Mittel",
  "controls.fast": "Schnell",
  "controls.duration": "Songdauer (Sek.)",
  "controls.durationPlaceholder": "z. B. 180",
  "controls.apply": "Übernehmen",

  "control.noPdfTitle": "Kein PDF hochgeladen",
  "control.noPdfDesc": "Lade im Dashboard ein PDF zu dieser Session hoch.",
  "control.loading": "Session wird geladen…",
  "control.changePdf": "PDF wechseln",
  "control.addPdf": "PDF hinzufügen",
  "control.uploading": "Lädt hoch…",
} as const;

export type TKey = keyof typeof de;

export const en: Record<TKey, string> = {
  "common.join": "Join",
  "common.backToOverview": "Back to overview",

  "footer.project": "a {link} project",
  "footer.hostSession": "Host a session",

  "home.heroTitle": "Follow the session in real time",
  "home.heroSubtitle":
    "The PDF scrolls automatically in sync with the host. Join an open session or enter your code.",
  "home.codePlaceholder": "Code, e.g. SESSION-7421",
  "home.codeAria": "Session code",
  "home.openSessions": "Open sessions",
  "home.activeCount": "{count} active",

  "list.emptyTitle": "No open sessions right now",
  "list.emptyDesc":
    "As soon as a host starts a session it appears here automatically – or join directly with a code.",

  "status.live": "Live",
  "status.draft": "Draft",
  "status.ended": "Ended",

  "conn.connected": "Connected",
  "conn.disconnected": "Disconnected",
  "conn.playing": "Playing",
  "conn.paused": "Paused",

  "viewer.notFoundTitle": "Session not found",
  "viewer.notFoundDesc":
    "The code {code} does not exist or the session has ended.",
  "viewer.backAria": "Back to overview",
  "viewer.loading": "Loading…",
  "viewer.endedBanner": "This session was ended by the host.",
  "viewer.reconnecting": "Connection lost – trying to reconnect…",
  "viewer.noPdf":
    "The host hasn't added a PDF yet. It will appear automatically once it's ready.",

  "login.title": "Host login",
  "login.desc": "Protected area for conductors and hosts.",
  "login.password": "Password",
  "login.showPassword": "Show password",
  "login.hidePassword": "Hide password",
  "login.error": "Wrong password. Please try again.",
  "login.checking": "Checking…",
  "login.submit": "Sign in",

  "nav.dashboard": "Dashboard",
  "nav.logout": "Sign out",

  "auth.checking": "Checking sign-in…",

  "dash.title": "Dashboard",
  "dash.subtitleOne": "{count} session managed",
  "dash.subtitleOther": "{count} sessions managed",
  "dash.newSession": "New session",
  "dash.titleLabel": "Title",
  "dash.titlePlaceholder": "e.g. Concert – Set 1",
  "dash.descriptionLabel": "Description",
  "dash.optional": "Optional",
  "dash.uploadPdf": "Upload PDF",
  "dash.uploadHint": "Optional, PDF only, max. 50 MB. Can be added later too.",
  "dash.create": "Create session",
  "dash.creating": "Creating…",
  "dash.createError": "Could not create session",
  "dash.allSessions": "All sessions",
  "dash.empty": "No sessions yet. Create your first one above.",
  "dash.pdfReady": "PDF ready",
  "dash.noPdf": "No PDF",
  "dash.control": "Control",
  "dash.link": "Link",
  "dash.copied": "Copied",
  "dash.end": "End",
  "dash.deleteAria": "Delete session",
  "dash.deleteConfirm": "Really delete this session? This cannot be undone.",

  "controls.progress": "Progress",
  "controls.tempo": "Tempo",
  "controls.status": "Status",
  "controls.viewers": "Viewers",
  "controls.position": "Position",
  "controls.positionAria": "Session position",
  "controls.play": "Play",
  "controls.pause": "Pause",
  "controls.stop": "Stop",
  "controls.startOver": "Start",
  "controls.here": "Here",
  "controls.speed": "Speed",
  "controls.slow": "Slow",
  "controls.medium": "Medium",
  "controls.fast": "Fast",
  "controls.duration": "Song length (sec.)",
  "controls.durationPlaceholder": "e.g. 180",
  "controls.apply": "Apply",

  "control.noPdfTitle": "No PDF uploaded",
  "control.noPdfDesc": "Upload a PDF to this session from the dashboard.",
  "control.loading": "Loading session…",
  "control.changePdf": "Change PDF",
  "control.addPdf": "Add PDF",
  "control.uploading": "Uploading…",
};

export const dictionaries: Record<Lang, Record<TKey, string>> = { de, en };
