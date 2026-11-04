#!/usr/bin/env node
// Headless smoke test: boots the Vite dev server, opens the game in Chromium
// (phone-sized viewport), lets the autoplay bot run, captures screenshots and
// reports console errors + perf/game stats as JSON.
//
// usage: node scripts/smoke.mjs [--seconds 20] [--params "god=1&t=240"]
//        [--port 5199] [--out test-output/smoke] [--shots 3] [--size 390x844]
//        [--url http://localhost:5173/]   (skip starting a server)
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const seconds = parseFloat(arg("seconds", "20"));
const extra = arg("params", "");
const port = parseInt(arg("port", String(5100 + Math.floor(Math.random() * 800))), 10);
const out = path.resolve(root, arg("out", "test-output/smoke"));
const shots = parseInt(arg("shots", "3"), 10);
const [vw, vh] = arg("size", "390x844").split("x").map(Number);
const givenUrl = arg("url", "");
mkdirSync(out, { recursive: true });

let server = null;
let base = givenUrl;
if (!base) {
  const { createServer } = await import(path.join(root, "node_modules/vite/dist/node/index.js"));
  server = await createServer({ root, server: { port, strictPort: false, host: "127.0.0.1" }, logLevel: "error" });
  await server.listen();
  const addr = server.httpServer.address();
  base = `http://127.0.0.1:${addr.port}/`;
}

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("/opt/node-tools/node_modules/playwright"));
}
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, hasTouch: true });
const errors = [];
const warnings = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
  else if (m.type() === "warning") warnings.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e && e.stack ? e.stack : e)));

const params = ["autoplay=1", "fps=1", "seed=7", extra].filter(Boolean).join("&");
const url = `${base}?${params}`;
const result = { url, ok: false, errors, warnings: [], samples: [], screenshots: [] };
try {
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__game && window.__game.state !== "boot", null, { timeout: 30000 });
  const interval = (seconds * 1000) / Math.max(1, shots);
  for (let s = 0; s < shots; s++) {
    await page.waitForTimeout(interval);
    const sample = await page.evaluate(() => {
      const g = window.__game;
      return {
        state: g.state,
        time: +g.time.toFixed(1),
        fps: +g.perf.fps.toFixed(1),
        frameMs: +g.perf.frameMs.toFixed(2),
        enemies: g.perf.enemies,
        particles: g.perf.particles,
        drawCalls: g.perf.drawCalls,
        kills: g.stats.kills,
        level: g.player.level,
        hp: Math.round(g.player.hp),
        weapons: g.weapons.weapons.map((w) => `${w.def.id}:${w.level}${w.evolved ? "E" : ""}`),
        passives: [...g.weapons.passives].map(([k, v]) => `${k}:${v}`),
        damageBy: Object.fromEntries(Object.entries(g.stats.damageBy).map(([k, v]) => [k, Math.round(v)])),
      };
    });
    result.samples.push(sample);
    const file = path.join(out, `shot-${s + 1}.png`);
    await page.screenshot({ path: file });
    result.screenshots.push(file);
  }
  result.ok = errors.length === 0;
} catch (e) {
  errors.push("SMOKE: " + String(e));
}
result.warnings = [...new Set(warnings)].slice(0, 20);
writeFileSync(path.join(out, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
if (server) await server.close();
process.exit(result.ok ? 0 : 1);
