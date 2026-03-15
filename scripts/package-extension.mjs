import { cp, mkdir, readFile, rm, readdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const browser = process.argv[2];
if (!browser || (browser !== "chrome" && browser !== "firefox")) {
  console.error("Usage: node scripts/package-extension.mjs <chrome|firefox>");
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = resolve(root, "build");
const stageDir = resolve(buildRoot, browser);
const distDir = resolve(root, "dist");

await mkdir(buildRoot, { recursive: true });
await rm(stageDir, { recursive: true, force: true });
await mkdir(stageDir, { recursive: true });

const manifestPath = resolve(root, `manifest.${browser}.json`);
const manifestRaw = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw);
const version = String(manifest.version ?? "0.0.0");

await cp(manifestPath, resolve(stageDir, "manifest.json"));
await cp(resolve(root, "public"), resolve(stageDir, "public"), { recursive: true });
await cp(resolve(root, "icons"), resolve(stageDir, "icons"), { recursive: true });
await mkdir(resolve(stageDir, "dist"), { recursive: true });

for (const name of await readdir(distDir)) {
  if (extname(name) !== ".js") continue;
  await cp(join(distDir, name), resolve(stageDir, "dist", name));
}

if (browser === "chrome" && manifest.background?.scripts) {
  console.error("Chrome package aborted: manifest.json still contains background.scripts");
  process.exit(1);
}

const zipName = `selector-generator-${browser}-v${version}.zip`;
const zipPath = resolve(buildRoot, zipName);
await rm(zipPath, { force: true });

try {
  await run("zip", ["-r", zipPath, "."], { cwd: stageDir });
} catch {
  console.error("Packaging failed: `zip` command not found or failed.");
  process.exit(1);
}

console.log(`Packaged ${browser}: ${zipPath}`);
