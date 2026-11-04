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

/** soft round glow with a hot centre (white; tint per instance) */
export function softGlowTex(): THREE.Texture {
  return canvasTex("w:glow", 64, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, "rgba(255,255,255,0.85)");
    g.addColorStop(0.45, "rgba(255,255,255,0.28)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });
}

/** motion-blur disc for spinning blades: bright swept arcs on an annulus */
export function spinBlurTex(): THREE.Texture {
  return canvasTex("w:spinblur", 128, (c, s) => {
    const h = s / 2;
    c.translate(h, h);
    for (let k = 0; k < 2; k++) {
      const a0 = k * Math.PI;
      for (let i = 0; i < 24; i++) {
        const t = i / 24;
        c.strokeStyle = `rgba(255,255,255,${(1 - t) * 0.55})`;
        c.lineWidth = s * 0.07 * (1 - t * 0.6);
        c.beginPath();
        c.arc(0, 0, h * 0.78, a0 - t * 1.9 - 0.08, a0 - t * 1.9);
        c.stroke();
      }
    }
    const g = c.createRadialGradient(0, 0, h * 0.2, 0, 0, h);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.6, "rgba(255,255,255,0.12)");
    g.addColorStop(0.8, "rgba(255,255,255,0.22)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, h, 0, Math.PI * 2);
    c.fill();
  });
}

/** wispy flame (teardrop, tip towards -y in texture space) */
export function wispTex(): THREE.Texture {
  return canvasTex("w:wisp", 64, (c, s) => {
    const g = c.createRadialGradient(s / 2, s * 0.62, 0, s / 2, s * 0.62, s * 0.42);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.7)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(s / 2, s * 0.04);
    c.bezierCurveTo(s * 0.62, s * 0.3, s * 0.92, s * 0.5, s * 0.86, s * 0.7);
    c.bezierCurveTo(s * 0.8, s * 0.95, s * 0.2, s * 0.95, s * 0.14, s * 0.7);
    c.bezierCurveTo(s * 0.08, s * 0.5, s * 0.38, s * 0.3, s / 2, s * 0.04);
    c.fill();
  });
}
