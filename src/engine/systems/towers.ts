import * as THREE from "three";
import type { BuildCtx } from "../ctx";
import { makeGlow } from "../glow";
import { K, partBox, planCity, type CityPlan, type Kind, type Part } from "../towergen";
import { makeWindowMaterial } from "../windows";

/**
 * Towers from the procedural city plan: one InstancedMesh per part kind (three window-shaded
 * shells, three dark-metal detail kinds, emissive light bars), plus rooftop beacons and
 * street-level shop lanterns as glow sprites.
 */
export function buildTowers(ctx: BuildCtx): CityPlan {
  const { group, track, preset, shadows } = ctx;
  const plan = planCity(preset.buildings, preset.towerDetail, ctx.seed);
  for (const p of plan.parts) if (p.k !== K.LightBar) ctx.solids.add(partBox(p));

  const byKind = new Map<Kind, Part[]>();
  for (const p of plan.parts) {
    let l = byKind.get(p.k);
    if (!l) byKind.set(p.k, (l = []));
    l.push(p);
  }
  const uTime = { value: 0 };
  ctx.onUpdate((t) => void (uTime.value = t));

  const base = <T extends THREE.BufferGeometry>(g: T) => track(g.translate(0, 0.5, 0));
  const geos: Record<Kind, THREE.BufferGeometry> = {
    [K.ShellBox]: base(new THREE.BoxGeometry(1, 1, 1)),
    [K.ShellRound]: base(new THREE.CylinderGeometry(0.5, 0.5, 1, 16)),
    [K.ShellOct]: base(new THREE.CylinderGeometry(0.5, 0.5, 1, 8)),
    [K.DetBox]: base(new THREE.BoxGeometry(1, 1, 1)),
    [K.DetCyl]: base(new THREE.CylinderGeometry(0.5, 0.5, 1, 8)),
    [K.DetCone]: base(new THREE.ConeGeometry(0.5, 1, 6)),
    [K.LightBar]: base(new THREE.BoxGeometry(1, 1, 1)),
  };
  // Bloom presets glow more on their own, so windows are a little dimmer there.
  const gain = preset.bloom > 0 ? 0.55 : 0.85;
  const simple = preset.towerDetail === 0;
  const winBox = track(makeWindowMaterial(false, uTime, gain, simple));
  const winRound = track(makeWindowMaterial(true, uTime, gain, simple));
  const metal = track(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.55 }));
  const glowMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  const mats: Record<Kind, THREE.Material> = {
    [K.ShellBox]: winBox,
    [K.ShellRound]: winRound,
    [K.ShellOct]: winRound,
    [K.DetBox]: metal,
    [K.DetCyl]: metal,
    [K.DetCone]: metal,
    [K.LightBar]: glowMat,
  };

  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  for (const [k, list] of byKind) {
    const shell = k === K.ShellBox || k === K.ShellRound || k === K.ShellOct;
    // Shells need their own geometry copy for the per-instance window attribute.
    const geo = shell ? track(geos[k].clone()) : geos[k];
    const mesh = new THREE.InstancedMesh(geo, mats[k], list.length);
    const win = shell ? new Float32Array(list.length * 4) : null;
    list.forEach((p, i) => {
      mesh.setMatrixAt(i, m4.makeScale(p.sx, p.sy, p.sz).setPosition(p.x, p.y, p.z));
      if (win) win.set(p.win!, i * 4);
      else if (k === K.LightBar) mesh.setColorAt(i, col.set(p.c).multiplyScalar(p.i ?? 1));
      else mesh.setColorAt(i, col.set(p.c));
    });
    if (win) geo.setAttribute("aWin", new THREE.InstancedBufferAttribute(win, 4));
    mesh.castShadow = shadows && k !== K.LightBar;
    mesh.receiveShadow = shadows && k !== K.LightBar;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // Outer filler boxes: same facade shader, no shadow casting (they are far from the flight).
  if (plan.filler.length) {
    const geo = track(geos[K.ShellBox].clone());
    const mesh = new THREE.InstancedMesh(geo, winBox, plan.filler.length);
    const win = new Float32Array(plan.filler.length * 4);
    plan.filler.forEach((p, i) => {
      mesh.setMatrixAt(i, m4.makeScale(p.sx, p.sy, p.sz).setPosition(p.x, p.y, p.z));
      win.set(p.win!, i * 4);
      ctx.solids.add(partBox(p));
    });
    geo.setAttribute("aWin", new THREE.InstancedBufferAttribute(win, 4));
    mesh.receiveShadow = shadows;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // Rooftop beacons: slow red blink. Shop lanterns: steady red and amber.
  const nb = plan.beacons.length;
  if (nb) {
    const color = new Float32Array(nb * 3), params = new Float32Array(nb * 4);
    for (let i = 0; i < nb; i++) {
      color.set([4, 0.35, 0.3], i * 3);
      params.set([0.7, 0.55 + ((i * 0.37) % 0.5), (i * 0.618) % 1, 0.5], i * 4);
    }
    const g = makeGlow(ctx, { count: nb, color, params, minPx: 1.5 });
    plan.beacons.forEach((b, i) => g.pos.set(b, i * 3));
    g.markDirty();
  }
  const nl = plan.lanterns.length;
  if (nl) {
    const color = new Float32Array(nl * 3), params = new Float32Array(nl * 4);
    plan.lanterns.forEach((l, i) => {
      color.set(l[3] === 0 ? [3.2, 0.7, 0.3] : [3, 1.8, 0.45], i * 3);
      params.set([0.5, 0, 0, 1], i * 4);
    });
    const g = makeGlow(ctx, { count: nl, color, params, minPx: 1.2 });
    plan.lanterns.forEach((l, i) => g.pos.set([l[0], l[1], l[2]], i * 3));
    g.markDirty();
  }

  ctx.counts.buildings = plan.towers.length;
  ctx.counts.towerParts = plan.parts.length;
  ctx.counts.fillerTowers = plan.filler.length;
  ctx.counts.bridges = plan.bridges;
  ctx.counts.lanterns = nl;
  return plan;
}
