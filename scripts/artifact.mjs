#!/usr/bin/env node
// Turn the single-file build (dist-single/index.html) into a page body for
// publishing as a hosted artifact: the host wraps the file in its own
// <!doctype>/<html>/<head>/<body> skeleton (charset + viewport meta), so this
// keeps only <title>, the font <link>, <style> blocks, the body markup and the
// inline module script.
// usage: npm run build:single && node scripts/artifact.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(root, "dist-single", "index.html"), "utf8");

const head = src.slice(src.indexOf("<head>") + 6, src.indexOf("</head>"));
const body = src.slice(src.indexOf("<body>") + 6, src.lastIndexOf("</body>"));

const title = (head.match(/<title>[^<]*<\/title>/) ?? ["<title>Surfordie</title>"])[0];
const fontLinks = head.match(/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g) ?? [];
const styles = head.match(/<style>[\s\S]*?<\/style>/g) ?? [];
// module script may sit in <head> (vite default) or <body>
const headScripts = head.match(/<script[\s\S]*?<\/script>/g) ?? [];

if (/<script[^>]*\ssrc=/.test(headScripts.join("") + body)) {
  throw new Error("external script left in the build — run npm run build:single first");
}

// the game is one fixed full-screen app with its own safe-area handling; keep the
// host's :root safe-area padding (it does not affect the fixed layers) and
// commit to the game's single dark look
const hostCompat = `<style>
html { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
:root { color-scheme: dark; }
html, body { background: #10161c; }
</style>`;

const out = [title, ...fontLinks, ...styles, hostCompat, body.trim(), ...headScripts].join("\n");

const outDir = path.join(root, "dist-artifact");
mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, "surfordie.html");
writeFileSync(file, out);
console.log(`wrote ${file} (${(out.length / 1024).toFixed(0)} KB)`);
