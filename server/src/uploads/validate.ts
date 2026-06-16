import { readFileSync } from "node:fs";

/**
 * Validate that a file's contents match its claimed mimetype by checking
 * well-known magic-byte signatures. This prevents a client from renaming an
 * arbitrary file (e.g. HTML/JS) to an allowed extension and bypassing the
 * mimetype filter.
 */
export function validateUploadFile(path: string, claimedMimetype: string): boolean {
  let header: Buffer;
  try {
    header = readFileSync(path);
  } catch {
    return false;
  }
  if (header.length === 0) return false;

  const asAscii = (start: number, end: number) =>
    header.toString("ascii", start, end);

  switch (claimedMimetype) {
    case "application/pdf":
      return asAscii(0, 4) === "%PDF";

    case "image/png":
      return header[0] === 0x89 && asAscii(1, 4) === "PNG";

    case "image/jpeg":
      // JPEG markers: SOI (FFD8) followed by an APP or DQT/DCF marker.
      return header[0] === 0xff && header[1] === 0xd8;

    case "image/webp":
      // RIFF....WEBP
      return (
        asAscii(0, 4) === "RIFF" &&
        asAscii(8, 12) === "WEBP"
      );

    case "image/gif":
      return asAscii(0, 3) === "GIF" && (asAscii(3, 6) === "87a" || asAscii(3, 6) === "89a");

    case "image/avif":
      // ISO Base Media File Format: ...ftypavif or ...ftypavis
      return (
        asAscii(4, 8) === "ftyp" &&
        (asAscii(8, 12) === "avif" || asAscii(8, 12) === "avis")
      );

    default:
      return false;
  }
}
