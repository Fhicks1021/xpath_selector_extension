import { copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const browser = process.argv[2];
if (!browser || (browser !== "chrome" && browser !== "firefox")) {
  console.error("Usage: node scripts/sync-manifest.mjs <chrome|firefox>");
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, `manifest.${browser}.json`);
const destination = resolve(root, "manifest.json");

await copyFile(source, destination);
console.log(`Using ${browser} manifest -> manifest.json`);
