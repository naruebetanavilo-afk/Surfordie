import * as THREE from "three";

const cache = new Map<string, THREE.Texture>();

function canvasTex(key: string, size: number, draw: (c: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const c = cv.getContext("2d")!;
  draw(c, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** soft round blob for fake shadows (use with color black, transparent) */
export function blobShadowTexture(): THREE.Texture {
  return canvasTex("blob", 64, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.55, "rgba(255,255,255,0.75)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });
}

/** soft glow dot (additive particles, glows) */
export function glowTexture(): THREE.Texture {
  return canvasTex("glow", 64, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.8)");
    g.addColorStop(0.6, "rgba(255,255,255,0.2)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });
}

/** 4-point star sparkle */
export function sparkTexture(): THREE.Texture {
  return canvasTex("spark", 64, (c, s) => {
    const h = s / 2;
    const g = c.createRadialGradient(h, h, 0, h, h, h);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.2, "rgba(255,255,255,0.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(h, 0);
    c.quadraticCurveTo(h, h, s, h);
    c.quadraticCurveTo(h, h, h, s);
    c.quadraticCurveTo(h, h, 0, h);
    c.quadraticCurveTo(h, h, h, 0);
    c.fill();
  });
}
