import * as THREE from "three";
import { NEON, canvasTexture, type BuildCtx } from "../ctx";
import { stream } from "../rng";
import { clearOfPath } from "../world";

const SIGN_WORDS = ["NEON", "HOTEL", "BAR", "NOODLE", "CLUB", "OPEN 24H", "DATA", "ARCADE"];

function signTexture(word: string, color: string, vertical: boolean): THREE.CanvasTexture {
  const W = vertical ? 96 : 384, H = vertical ? 384 : 128;
  return canvasTexture(W, H, (c) => {
    c.clearRect(0, 0, W, H);
    c.strokeStyle = color;
    c.lineWidth = 6;
    c.shadowColor = color;
    c.shadowBlur = 14;
    c.strokeRect(8, 8, W - 16, H - 16);
    c.fillStyle = "#ffffff";
    c.font = `bold ${vertical ? 56 : 72}px "Arial Black", Arial, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    if (vertical) {
      const letters = word.replace(/\s/g, "").slice(0, 5).split("");
      letters.forEach((ch, i) => c.fillText(ch, W / 2, ((i + 0.5) * (H - 24)) / letters.length + 12));
    } else {
      c.fillText(word, W / 2, H / 2 + 4, W - 36);
    }
  });
}

/** Neon signs on tower faces. */
export function buildSigns(ctx: BuildCtx): void {
  const { group, track, preset, spots } = ctx;
  const rnd = stream(ctx.seed, 3);
  const variants = SIGN_WORDS.map((word, i) => {
    const vertical = i % 2 === 0;
    const hex = "#" + new THREE.Color(NEON[i % NEON.length]).getHexString();
    return {
      vertical,
      mat: track(
        new THREE.MeshBasicMaterial({
          map: track(signTexture(word, hex, vertical)),
          color: new THREE.Color(NEON[i % NEON.length]).multiplyScalar(2.2),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      ),
      mats: [] as THREE.Matrix4[],
    };
  });
  const candidates = spots.filter((s) => s.h > 40);
  const obj = new THREE.Object3D();
  for (let i = 0, tries = 0; i < preset.signs && candidates.length && tries < preset.signs * 30; tries++) {
    const s = candidates[Math.floor(rnd() * candidates.length)];
    const v = variants[Math.floor(rnd() * variants.length)];
    const face = Math.floor(rnd() * 4);
    const nx = face === 0 ? 1 : face === 1 ? -1 : 0;
    const nz = face === 2 ? 1 : face === 3 ? -1 : 0;
    const sw = v.vertical ? 5 + rnd() * 4 : 14 + rnd() * 12;
    const sh = v.vertical ? sw * 4 : sw / 3;
    const along = nx !== 0 ? s.d : s.w;
    if (sw > along * 0.9) continue;
    const x = s.x + nx * (s.w / 2 + 0.6) + (nz !== 0 ? (rnd() - 0.5) * (s.w - sw) : 0);
    const z = s.z + nz * (s.d / 2 + 0.6) + (nx !== 0 ? (rnd() - 0.5) * (s.d - sw) : 0);
    const y = 12 + rnd() * Math.max(1, s.h - sh - 16) + sh / 2;
    const hx = nx !== 0 ? 0.1 : sw / 2, hz = nz !== 0 ? 0.1 : sw / 2;
    if (!clearOfPath(x - hx, y - sh / 2, z - hz, x + hx, y + sh / 2, z + hz)) continue;
    obj.position.set(x, y, z);
    obj.rotation.set(0, Math.atan2(nx, nz), 0);
    obj.scale.set(sw, sh, 1);
    obj.updateMatrix();
    v.mats.push(obj.matrix.clone());
    ctx.lights.push({ x: x + nx * 2, y, z: z + nz * 2, r: 10 + Math.max(sw, sh), color: v.mat.color.clone().multiplyScalar(1 / 2.2) });
    i++;
  }
  const plane = track(new THREE.PlaneGeometry(1, 1));
  let count = 0;
  for (const v of variants) {
    if (!v.mats.length) continue;
    const mesh = new THREE.InstancedMesh(plane, v.mat, v.mats.length);
    v.mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.computeBoundingSphere();
    count += v.mats.length;
    group.add(mesh);
  }
  ctx.counts.signs = count;
}
