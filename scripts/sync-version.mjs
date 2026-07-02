import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const stateFile = resolve(repoRoot, ".version-sync.json");
const manifestPaths = [
  resolve(repoRoot, "package.json"),
  resolve(repoRoot, "client/package.json"),
  resolve(repoRoot, "server/package.json"),
];
const lockfilePaths = [
  resolve(repoRoot, "package-lock.json"),
  resolve(repoRoot, "client/package-lock.json"),
  resolve(repoRoot, "server/package-lock.json"),
];

const apply = process.argv.includes("--apply");
const shouldSkip = process.env.SKIP_VERSION_SYNC === "1";

/**
 * Read a JSON file with its existing formatting conventions preserved on write.
 *
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

/**
 * Persist JSON using the repository's standard two-space indentation.
 *
 * @param {string} filePath
 * @param {Record<string, unknown>} value
 * @returns {void}
 */
function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Run a git command inside the repository and return trimmed stdout.
 *
 * @param {string[]} args
 * @returns {string}
 */
function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8" }).trim();
}

/**
 * Pick the highest required semver bump from the new commits.
 *
 * major: explicit breaking markers
 * minor: new feature commits
 * patch: any shipped code change that is not docs/chore only
 *
 * @param {Array<{ subject: string; body: string }>} commits
 * @returns {"major" | "minor" | "patch" | null}
 */
function determineBump(commits) {
  let bump = null;

  for (const { subject, body } of commits) {
    const text = `${subject}\n${body}`;

    if (/BREAKING CHANGE|!:/.test(text)) {
      return "major";
    }

    if (/^feat(\(.+\))?:/i.test(subject) || /^(add|introduce)\b/i.test(subject)) {
      bump = bump ?? "minor";
      continue;
    }

    if (/^(docs?|chore|style|test|ci)(\(.+\))?:/i.test(subject)) {
      continue;
    }

    if (bump === null) {
      bump = "patch";
    }
  }

  return bump;
}

/**
 * Increment a semver string by the requested release type.
 *
 * @param {string} version
 * @param {"major" | "minor" | "patch"} bump
 * @returns {string}
 */
function incrementVersion(version, bump) {
  const match = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/.exec(version);
  if (!match?.groups) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  let major = Number(match.groups.major);
  let minor = Number(match.groups.minor);
  let patch = Number(match.groups.patch);

  if (bump === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bump === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
}

/**
 * Read commits since the last synced commit hash.
 *
 * @param {string} lastProcessedCommit
 * @returns {Array<{ subject: string; body: string }>}
 */
function readCommitsSince(lastProcessedCommit) {
  if (!lastProcessedCommit) {
    return [];
  }

  let output = "";
  try {
    const range = `${lastProcessedCommit}..HEAD`;
    output = git(["log", "--format=%s%x1f%b%x1e", range]);
  } catch {
    return [];
  }

  if (!output) {
    return [];
  }

  return output
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject, body = ""] = entry.split("\x1f");
      return { subject: subject.trim(), body: body.trim() };
    });
}

/**
 * Keep lockfiles aligned with the package versions npm expects.
 *
 * @param {string} version
 * @returns {void}
 */
function syncLockfiles(version) {
  for (const lockfilePath of lockfilePaths) {
    const lockfile = readJson(lockfilePath);
    lockfile.version = version;

    if (
      typeof lockfile.packages === "object" &&
      lockfile.packages !== null &&
      typeof lockfile.packages[""] === "object" &&
      lockfile.packages[""] !== null
    ) {
      lockfile.packages[""].version = version;
    }

    writeJson(lockfilePath, lockfile);
  }
}

const rootManifest = readJson(manifestPaths[0]);
const currentVersion = String(rootManifest.version);
const headCommit = git(["rev-parse", "HEAD"]);
const state = existsSync(stateFile) ? readJson(stateFile) : { lastProcessedCommit: headCommit };
const lastProcessedCommit =
  typeof state.lastProcessedCommit === "string" ? state.lastProcessedCommit : headCommit;

const commits = readCommitsSince(lastProcessedCommit);
const bump = determineBump(commits);
const nextVersion = bump ? incrementVersion(currentVersion, bump) : currentVersion;

if (apply && !shouldSkip) {
  for (const manifestPath of manifestPaths) {
    const manifest = readJson(manifestPath);
    manifest.version = nextVersion;
    writeJson(manifestPath, manifest);
  }

  syncLockfiles(nextVersion);
  writeJson(stateFile, {
    lastProcessedCommit: headCommit,
  });

  execFileSync("node", [resolve(repoRoot, "client/scripts/version.js")], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

process.stdout.write(
  JSON.stringify({
    currentVersion,
    nextVersion,
    bump,
    commitsAnalyzed: commits.length,
    headCommit,
    lastProcessedCommit,
    apply,
    skipped: shouldSkip,
  })
);
