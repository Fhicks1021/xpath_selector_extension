import * as esbuild from "esbuild";
import { argv } from "node:process";

const isWatch = argv.includes("--watch");

/** @type {esbuild.BuildOptions} */
const base = {
  entryPoints: {
    background: "src/background.ts",
    content: "src/content.ts",
    popup: "src/popup.ts"
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: ["es2022"],
  sourcemap: true,
  logLevel: "info"
};

if (isWatch) {
  const ctx = await esbuild.context(base);
  await ctx.watch();
  console.log("Watching...");
} else {
  await esbuild.build(base);
  console.log("Built.");
}