import { describe, it, expect } from "vitest";
import type { SessionState } from "../types.js";
import { injectShareCard, shareCardMeta } from "./shareCard.js";

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>BandScroll</title>
    <meta name="description" content="Default description." />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="BandScroll — real-time synchronized PDF scrolling" />
    <meta property="og:description" content="Default og description." />
    <meta name="twitter:title" content="BandScroll" />
    <meta name="twitter:description" content="Default twitter description." />
  </head>
  <body><div id="root"></div></body>
</html>`;

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "s1",
    code: "SESSION-1234",
    title: "Summer Set",
    description: "Our July rooftop gig setlist.",
    pdfUrl: "",
    status: "live",
    playing: false,
    progress: 0,
    speed: 0,
    updatedAt: 0,
    connectedClients: 0,
    createdAt: 0,
    markers: [],
    locked: false,
    playbackMode: "scroll",
    backgroundMode: "light",
    autoStopAtSongEnd: false,
    currentPage: 1,
    numPages: 0,
    stateVersion: 0,
    ...overrides,
  };
}

describe("shareCardMeta", () => {
  it("uses the session name and description", () => {
    const meta = shareCardMeta(makeSession());
    expect(meta.title).toBe("Summer Set · BandScroll");
    expect(meta.description).toBe("Our July rooftop gig setlist.");
  });

  it("falls back to the document description then a generic line", () => {
    expect(shareCardMeta(makeSession({ description: "", documentDescription: "Chart PDF" })).description).toBe(
      "Chart PDF"
    );
    expect(
      shareCardMeta(makeSession({ description: undefined, documentDescription: undefined })).description
    ).toContain("Follow this live PDF");
  });

  it("handles an empty title", () => {
    expect(shareCardMeta(makeSession({ title: "" })).title).toBe("Untitled session · BandScroll");
  });
});

describe("injectShareCard", () => {
  it("injects session name/description into the shell", () => {
    const out = injectShareCard(INDEX_HTML, makeSession(), "https://example.com/session/SESSION-1234");
    expect(out).toContain("<title>Summer Set · BandScroll</title>");
    expect(out).toContain('property="og:title" content="Summer Set · BandScroll"');
    expect(out).toContain('property="og:description" content="Our July rooftop gig setlist."');
    expect(out).toContain('name="twitter:title" content="Summer Set · BandScroll"');
    expect(out).toContain('name="twitter:description" content="Our July rooftop gig setlist."');
    expect(out).toContain('name="description" content="Our July rooftop gig setlist."');
    expect(out).toContain('property="og:url" content="https://example.com/session/SESSION-1234"');
    // Untouched tags stay put.
    expect(out).toContain('property="og:type" content="website"');
  });

  it("escapes HTML-significant characters", () => {
    const out = injectShareCard(INDEX_HTML, makeSession({ title: `Rock & "Roll"`, description: "Loud <night>" }));
    expect(out).toContain("<title>Rock &amp; &quot;Roll&quot; · BandScroll</title>");
    expect(out).toContain("Loud &lt;night&gt;");
    expect(out).not.toContain("<night>");
  });

  it("does not add og:url when no canonical url is given", () => {
    const out = injectShareCard(INDEX_HTML, makeSession());
    expect(out).not.toContain("og:url");
  });
});
