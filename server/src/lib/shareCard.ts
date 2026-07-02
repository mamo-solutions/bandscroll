import type { SessionState } from "../types.js";

/** Escape text for safe interpolation into an HTML attribute or text node. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Collapse whitespace and hard-cap length so share cards stay tidy. */
function normalize(value: string, maxLength: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
}

/** The title/description a session should advertise in its share card. */
export function shareCardMeta(session: SessionState): { title: string; description: string } {
  const name = normalize(session.title || "Untitled session", 90);
  const rawDescription =
    session.description?.trim() ||
    session.documentDescription?.trim() ||
    "Follow this live PDF in perfect sync — a host controls the auto-scroll, you just watch.";
  return {
    title: `${name} · BandScroll`,
    description: normalize(rawDescription, 200),
  };
}

/**
 * Rewrite the static index.html share-card tags with session-specific values so
 * link unfurlers (which don't run JS) show the session name and description.
 * Replaces the value of a known set of tags in place; tags not present are left
 * untouched. `canonicalUrl` populates og:url when provided.
 */
export function injectShareCard(
  html: string,
  session: SessionState,
  canonicalUrl?: string
): string {
  const { title, description } = shareCardMeta(session);
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);

  let out = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${safeTitle}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[\s\S]*?("\s*\/?>)/,
      `$1${safeDescription}$2`
    )
    .replace(
      /(<meta\s+property="og:title"\s+content=")[\s\S]*?("\s*\/?>)/,
      `$1${safeTitle}$2`
    )
    .replace(
      /(<meta\s+property="og:description"\s+content=")[\s\S]*?("\s*\/?>)/,
      `$1${safeDescription}$2`
    )
    .replace(
      /(<meta\s+name="twitter:title"\s+content=")[\s\S]*?("\s*\/?>)/,
      `$1${safeTitle}$2`
    )
    .replace(
      /(<meta\s+name="twitter:description"\s+content=")[\s\S]*?("\s*\/?>)/,
      `$1${safeDescription}$2`
    );

  if (canonicalUrl) {
    const safeUrl = escapeHtml(canonicalUrl);
    const ogUrlTag = `<meta property="og:url" content="${safeUrl}" />`;
    if (/<meta\s+property="og:url"\s+content="/.test(out)) {
      out = out.replace(
        /(<meta\s+property="og:url"\s+content=")[\s\S]*?("\s*\/?>)/,
        `$1${safeUrl}$2`
      );
    } else {
      out = out.replace(/<\/head>/, `    ${ogUrlTag}\n  </head>`);
    }
  }

  return out;
}
