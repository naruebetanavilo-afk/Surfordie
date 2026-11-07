#!/usr/bin/env node
// Renders the app icons (PWA / home-screen) procedurally with a headless
// browser canvas and writes them to public/icons/. Run once after changing the
// design: node scripts/make-icons.mjs
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("/opt/node-tools/node_modules/playwright"));
}

// draw(c, s, maskable): a grinning cartoon zombie head on a purple burst.
// Maskable icons keep the art inside the central 80% safe circle.
const draw = String(function draw(c, s, maskable) {
  const h = s / 2;
  const g = c.createRadialGradient(h, h * 0.9, s * 0.05, h, h, s * 0.75);
  g.addColorStop(0, "#5a2f96");
  g.addColorStop(1, "#160d24");
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
  const k = maskable ? 0.78 : 0.95; // art scale
  c.save();
  c.translate(h, h);
  c.scale(k, k);
  c.translate(-h, -h);
  // magenta burst
  c.save();
  c.translate(h, h);
  c.fillStyle = "rgba(255, 61, 154, 0.55)";
  c.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = (i % 2 ? 0.3 : 0.47) * s;
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  c.closePath();
  c.fill();
  c.restore();
  const ink = "#160d24";
  const lw = s * 0.03;
  c.lineJoin = "round";
  c.lineCap = "round";
  // head
  c.beginPath();
  c.ellipse(h, h * 1.04, s * 0.3, s * 0.28, 0, 0, Math.PI * 2);
  const hg = c.createLinearGradient(0, s * 0.25, 0, s * 0.8);
  hg.addColorStop(0, "#b5f06a");
  hg.addColorStop(1, "#4fae3a");
  c.fillStyle = hg;
  c.fill();
  c.lineWidth = lw * 1.4;
  c.strokeStyle = ink;
  c.stroke();
  // hair tuft
  c.beginPath();
  c.moveTo(h - s * 0.08, s * 0.27);
  c.quadraticCurveTo(h - s * 0.02, s * 0.12, h + s * 0.05, s * 0.25);
  c.quadraticCurveTo(h + s * 0.1, s * 0.15, h + s * 0.14, s * 0.29);
  c.fillStyle = "#3b2a1a";
  c.fill();
  c.lineWidth = lw;
  c.stroke();
  // left eye: big white with pupil
  c.beginPath();
  c.arc(h - s * 0.11, h * 0.98, s * 0.085, 0, Math.PI * 2);
  c.fillStyle = "#fffbe8";
  c.fill();
  c.lineWidth = lw;
  c.stroke();
  c.beginPath();
  c.arc(h - s * 0.095, h, s * 0.035, 0, Math.PI * 2);
  c.fillStyle = ink;
  c.fill();
  // right eye: glowing X
  c.strokeStyle = "#ffd23f";
  c.lineWidth = lw * 1.5;
  const ex = h + s * 0.12;
  const ey = h * 0.98;
  const e = s * 0.05;
  c.beginPath();
  c.moveTo(ex - e, ey - e);
  c.lineTo(ex + e, ey + e);
  c.moveTo(ex + e, ey - e);
  c.lineTo(ex - e, ey + e);
  c.stroke();
  // stitched grin
  c.strokeStyle = ink;
  c.lineWidth = lw * 1.1;
  c.beginPath();
  c.moveTo(h - s * 0.14, h * 1.24);
  c.quadraticCurveTo(h, h * 1.36, h + s * 0.15, h * 1.2);
  c.stroke();
  c.lineWidth = lw * 0.7;
  for (let i = -2; i <= 2; i++) {
    const x = h + i * s * 0.055;
    const y = h * 1.27 + Math.abs(i) * -s * 0.008;
    c.beginPath();
    c.moveTo(x, y - s * 0.03);
    c.lineTo(x, y + s * 0.03);
    c.stroke();
  }
  c.restore();
});

const browser = await chromium.launch();
const page = await browser.newPage();
const specs = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
  ["favicon-64.png", 64, false],
];
for (const [name, size, maskable] of specs) {
  const b64 = await page.evaluate(
    ({ src, size, maskable }) => {
      const fn = new Function("return " + src)();
      const cv = document.createElement("canvas");
      cv.width = cv.height = size;
      fn(cv.getContext("2d"), size, maskable);
      return cv.toDataURL("image/png").split(",")[1];
    },
    { src: draw, size, maskable },
  );
  writeFileSync(path.join(outDir, name), Buffer.from(b64, "base64"));
  console.log("wrote", name);
}
await browser.close();
