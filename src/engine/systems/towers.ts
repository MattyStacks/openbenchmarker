import * as THREE from "three";
import { canvasTexture, type BuildCtx } from "../ctx";
import { layoutBuildings, spotBox, type BuildingSpot } from "../layout";
import { stream } from "../rng";

/** 256x512 = 32x64 world units; 16x32 window cells; pixel (0..2, 0..2) is always dark wall. */
function windowTexture(rnd: () => number, palette: string[]): THREE.CanvasTexture {
  const tex = canvasTexture(256, 512, (c) => {
    c.fillStyle = "#07060f";
    c.fillRect(0, 0, 256, 512);
    for (let row = 0; row < 32; row++) {
      const floorLit = rnd() < 0.85;
      for (let col = 0; col < 16; col++) {
        if (!floorLit || rnd() < 0.42) continue;
        const color = palette[Math.floor(rnd() * palette.length)];
        c.globalAlpha = 0.45 + rnd() * 0.55;
        c.fillStyle = color;
        c.fillRect(col * 16 + 4, row * 16 + 5, 9, 8);
      }
    }
    c.globalAlpha = 1;
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function patchBuildingMaterial(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
#if defined(USE_EMISSIVEMAP) && defined(USE_INSTANCING)
  vec3 bsc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  float bhz = abs(normal.x) > 0.5 ? bsc.z : bsc.x;
  vEmissiveMapUv = abs(normal.y) > 0.5 ? vec2(0.002) : uv * vec2(bhz, bsc.y) / vec2(32.0, 64.0);
#endif`,
    );
  };
}

/** Instanced towers (one box per footprint) and rooftop beacons. */
export function buildTowers(ctx: BuildCtx): BuildingSpot[] {
  const { group, track, preset, shadows } = ctx;
  const rnd = stream(ctx.seed, 2);
  const spots = layoutBuildings(preset.buildings, ctx.seed);
  for (const s of spots) ctx.solids.add(spotBox(s));
  const palettes = [
    ["#ffd59a", "#ffb35c", "#fff1c9"],
    ["#7fe9ff", "#3fc8ff", "#d6f7ff"],
    ["#ff7ad9", "#c46bff", "#ffd0f4"],
  ];
  const box = track(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const mats = palettes.map((pal) => {
    const mat = track(
      new THREE.MeshStandardMaterial({
        color: 0x272840,
        roughness: 0.45,
        metalness: 0.7,
        emissive: 0xffffff,
        emissiveMap: track(windowTexture(rnd, pal)),
        emissiveIntensity: 1.5,
      }),
    );
    patchBuildingMaterial(mat);
    return mat;
  });
  const perMat: BuildingSpot[][] = palettes.map(() => []);
  spots.forEach((s, i) => perMat[i % palettes.length].push(s));
  const m4 = new THREE.Matrix4();
  perMat.forEach((list, mi) => {
    const mesh = new THREE.InstancedMesh(box, mats[mi], Math.max(1, list.length));
    mesh.count = list.length;
    list.forEach((s, i) => mesh.setMatrixAt(i, m4.makeScale(s.w, s.h, s.d).setPosition(s.x, 0, s.z)));
    mesh.castShadow = mesh.receiveShadow = shadows;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });

  const tall = spots.filter((s) => s.h > 110);
  if (tall.length) {
    const beacons = new THREE.InstancedMesh(
      track(new THREE.SphereGeometry(1.1, 8, 6)),
      track(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.5), toneMapped: false })),
      tall.length,
    );
    tall.forEach((s, i) => beacons.setMatrixAt(i, m4.makeTranslation(s.x, s.h + 1.5, s.z)));
    group.add(beacons);
  }
  ctx.counts.buildings = spots.length;
  return spots;
}
