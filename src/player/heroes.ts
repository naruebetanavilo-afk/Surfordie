import * as THREE from "three";
import type { PlayerStats } from "./stats";
import { iconBg, type IconDraw } from "../ui/icons";
import { toonGradient } from "../enemies/AnimatedMaterial";

export interface HeroDef {
  id: string;
  /** Thai display name */
  name: string;
  /** short Thai tagline */
  title: string;
  /** Thai description of the hero perk */
  desc: string;
  /** weapon id the hero starts with */
  startWeapon: string;
  /** stat overrides/bonuses applied on top of baseStats (multipliers multiply, others add) */
  bonus: Partial<PlayerStats>;
  /** gold price in the menu (0 = unlocked) */
  price: number;
  /** accent colour for UI */
  color: string;
  /**
   * Build the 3D model (facing +Z, feet at y=0, ~1.4 units tall).
   * Name animated children: "body", "head", "armL", "armR", "legL", "legR",
   * "weapon" (optional). Limbs should have their pivot at the joint (shoulder /
   * hip) so rotation.x swings them.
   */
  build: () => THREE.Group;
  portrait: IconDraw;
}

function toon(color: string): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
}

function limb(name: string, w: number, h: number, d: number, color: string, x: number, y: number, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color));
  m.position.y = -h / 2;
  g.add(m);
  return g;
}

/** Bucket Knight: tin-bucket helmet, teal cape, big sword. */
function buildKnight(): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.name = "body";
  root.add(body);
  const legL = limb("legL", 0.2, 0.42, 0.22, "#4a5468", -0.14, 0.42);
  const legR = limb("legR", 0.2, 0.42, 0.22, "#4a5468", 0.14, 0.42);
  root.add(legL, legR);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.25, 4, 10), toon("#c9d3dd"));
  torso.position.y = 0.72;
  body.add(torso);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 12), toon("#6b4a2b"));
  belt.position.y = 0.58;
  body.add(belt);
  const cape = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.05), toon("#1fa39a"));
  cape.position.set(0, 0.7, -0.3);
  cape.rotation.x = 0.18;
  body.add(cape);
  const head = new THREE.Group();
  head.name = "head";
  head.position.y = 1.02;
  body.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), toon("#ffd9b8"));
  face.position.y = 0.16;
  head.add(face);
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.31, 0.36, 14), toon("#9aa7b3"));
  bucket.position.y = 0.3;
  head.add(bucket);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.06), toon("#1b1f2a"));
  visor.position.set(0, 0.26, 0.29);
  head.add(visor);
  const plume = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 6), toon("#ff5a5a"));
  plume.position.set(0, 0.6, -0.04);
  head.add(plume);
  const armL = limb("armL", 0.15, 0.42, 0.16, "#c9d3dd", -0.38, 0.9);
  const armR = limb("armR", 0.15, 0.42, 0.16, "#c9d3dd", 0.38, 0.9);
  body.add(armL, armR);
  const weapon = new THREE.Group();
  weapon.name = "weapon";
  weapon.position.set(0, -0.4, 0.06);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.03), toon("#e9f3ff"));
  blade.position.set(0, 0, 0.45);
  blade.rotation.x = Math.PI / 2;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.06), toon("#d9a440"));
  weapon.add(blade, guard);
  armR.add(weapon);
  return root;
}

/** Apprentice mage: pointy hat, purple robe, glowing staff. */
function buildMage(): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.name = "body";
  root.add(body);
  const legL = limb("legL", 0.18, 0.36, 0.2, "#2e2846", -0.12, 0.36);
  const legR = limb("legR", 0.18, 0.36, 0.2, "#2e2846", 0.12, 0.36);
  root.add(legL, legR);
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.85, 12), toon("#6b46c1"));
  robe.position.y = 0.68;
  body.add(robe);
  const head = new THREE.Group();
  head.name = "head";
  head.position.y = 1.02;
  body.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 10), toon("#ffe0c4"));
  face.position.y = 0.12;
  head.add(face);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 16), toon("#3b2a78"));
  brim.position.y = 0.3;
  head.add(brim);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.6, 12), toon("#3b2a78"));
  hat.position.set(0, 0.6, -0.04);
  hat.rotation.x = -0.25;
  head.add(hat);
  const armL = limb("armL", 0.14, 0.38, 0.15, "#6b46c1", -0.32, 0.92);
  const armR = limb("armR", 0.14, 0.38, 0.15, "#6b46c1", 0.32, 0.92);
  body.add(armL, armR);
  const weapon = new THREE.Group();
  weapon.name = "weapon";
  weapon.position.set(0, -0.38, 0.05);
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), toon("#8a5a2b"));
  staff.position.y = 0.25;
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 12, 8),
    new THREE.MeshBasicMaterial({ color: "#7cf3ff" }),
  );
  orb.position.y = 0.82;
  weapon.add(staff, orb);
  armR.add(weapon);
  return root;
}

/** Axe ranger: green hood, scarf, hand axe. */
function buildRanger(): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.name = "body";
  root.add(body);
  const legL = limb("legL", 0.18, 0.42, 0.2, "#5b3b22", -0.13, 0.42);
  const legR = limb("legR", 0.18, 0.42, 0.2, "#5b3b22", 0.13, 0.42);
  root.add(legL, legR);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.25, 4, 10), toon("#3f8f4a"));
  torso.position.y = 0.72;
  body.add(torso);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 6, 12), toon("#e8b23a"));
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = 0.98;
  body.add(scarf);
  const head = new THREE.Group();
  head.name = "head";
  head.position.y = 1.02;
  body.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), toon("#f1c49b"));
  face.position.y = 0.14;
  head.add(face);
  const hood = new THREE.Mesh(
    new THREE.SphereGeometry(0.29, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
    toon("#2f6b38"),
  );
  hood.position.y = 0.18;
  hood.rotation.x = -0.35;
  head.add(hood);
  const armL = limb("armL", 0.14, 0.4, 0.15, "#3f8f4a", -0.35, 0.92);
  const armR = limb("armR", 0.14, 0.4, 0.15, "#3f8f4a", 0.35, 0.92);
  body.add(armL, armR);
  const weapon = new THREE.Group();
  weapon.name = "weapon";
  weapon.position.set(0, -0.4, 0.05);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6), toon("#7a4e26"));
  handle.rotation.x = Math.PI / 2;
  handle.position.z = 0.22;
  const head2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.18), toon("#d7dde4"));
  head2.position.set(0, 0.08, 0.45);
  weapon.add(handle, head2);
  armR.add(weapon);
  return root;
}

function portraitFor(skin: string, hat: string, accent: string): IconDraw {
  return (c, s) => {
    iconBg(c, s, accent);
    c.fillStyle = skin;
    c.beginPath();
    c.arc(s / 2, s * 0.58, s * 0.26, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = hat;
    c.beginPath();
    c.roundRect(s * 0.22, s * 0.18, s * 0.56, s * 0.3, s * 0.06);
    c.fill();
    c.fillStyle = "#1b1f2a";
    c.fillRect(s * 0.36, s * 0.56, s * 0.07, s * 0.07);
    c.fillRect(s * 0.57, s * 0.56, s * 0.07, s * 0.07);
  };
}

export const HEROES: HeroDef[] = [
  {
    id: "knight",
    name: "อัศวินถังเหล็ก",
    title: "ทนทาน ฟันหนัก",
    desc: "เริ่มด้วยดาบพิฆาต • พลังชีวิต +20% • เกราะ +1",
    startWeapon: "slash",
    bonus: { maxHp: 20, armor: 1 },
    price: 0,
    color: "#1fa39a",
    build: buildKnight,
    portrait: portraitFor("#ffd9b8", "#9aa7b3", "#1fa39a"),
  },
  {
    id: "mage",
    name: "จอมเวทฝึกหัด",
    title: "ระยะไกล พลังเวท",
    desc: "เริ่มด้วยลูกไฟวิญญาณ • ขอบเขต +10% • สปีดโจมตี +5%",
    startWeapon: "missile",
    bonus: { area: 0.1, cooldown: -0.05 },
    price: 0,
    color: "#8b5cf6",
    build: buildMage,
    portrait: portraitFor("#ffe0c4", "#3b2a78", "#8b5cf6"),
  },
  {
    id: "ranger",
    name: "พรานขวานบิน",
    title: "ว่องไว คล่องตัว",
    desc: "เริ่มด้วยขวานบูมเมอแรง • ความเร็ว +10% • แม่เหล็ก +30%",
    startWeapon: "axe",
    bonus: { moveSpeed: 0.46, magnet: 0.7 },
    price: 0,
    color: "#e8b23a",
    build: buildRanger,
    portrait: portraitFor("#f1c49b", "#2f6b38", "#e8b23a"),
  },
];

export function heroById(id: string): HeroDef {
  return HEROES.find((h) => h.id === id) ?? HEROES[0];
}
