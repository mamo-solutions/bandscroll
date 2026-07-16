import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outputDir = resolve(process.cwd(), process.argv[2] ?? "release-assets");
const clientVersion = readFileSync(resolve(process.cwd(), "client/src/version.ts"), "utf8");
const serverManifest = readFileSync(resolve(process.cwd(), "server/src/runtimeManifest.ts"), "utf8");
const clientBuildId = /APP_VERSION = "([^"]+)"/.exec(clientVersion)?.[1];
const serverBuildId = /buildId: "([^"]+)"/.exec(serverManifest)?.[1];

if (!clientBuildId || !serverBuildId || clientBuildId !== serverBuildId) {
  throw new Error("client and server release build IDs do not match");
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(
  resolve(outputDir, "runtime-manifest.json"),
  `${JSON.stringify({ syncProtocol: 2, buildId: clientBuildId }, null, 2)}\n`
);
