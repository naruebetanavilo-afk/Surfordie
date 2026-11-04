#!/usr/bin/env node
// Inline the production build (dist/) into a single self-contained HTML file:
// dist-single/index.html. Useful for sharing the game as one file.
// usage: npm run build && node scripts/inline.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const outDir = path.join(root, "dist-single");
let html = readFileSync(path.join(dist, "index.html"), "utf8");

// <script type="module" crossorigin src="./assets/index-xxx.js"></script>
html = html.replace(/<script([^>]*?)\ssrc="([^"]+)"([^>]*)><\/script>/g, (m, a, src, b) => {
  if (/^https?:/.test(src)) return m;
  const js = readFileSync(path.join(dist, src), "utf8").replace(/<\/script/gi, "<\\/script");
  const attrs = (a + b).replace(/\scrossorigin(="[^"]*")?/, "");
  return `<script${attrs}>${js}</script>`;
});
// <link rel="stylesheet" crossorigin href="./assets/index-xxx.css">
html = html.replace(/<link([^>]*?)rel="stylesheet"([^>]*?)href="([^"]+)"([^>]*)>/g, (m, _a, _b, href) => {
  if (/^https?:/.test(href)) return m;
  const css = readFileSync(path.join(dist, href), "utf8");
  return `<style>${css}</style>`;
});
// drop modulepreload hints for local chunks
html = html.replace(/<link rel="modulepreload"[^>]*>/g, "");

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "index.html"), html);
console.log(`wrote ${path.join(outDir, "index.html")} (${(html.length / 1024).toFixed(0)} KB)`);
