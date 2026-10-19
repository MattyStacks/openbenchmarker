import * as THREE from "three";
import type { Preset } from "../benchmark/presets";

/** City grid: street centre lines every BLOCK units, buildings inside blocks. */
export const BLOCK = 64;
export const STREET = 18;
export const HALF = 704; // city half-extent (11 blocks each side)
/** Nothing solid (buildings, signs, searchlight bases) within this distance of the flight path. */
export const CORRIDOR = 24;
/** Seconds for one lap of the flight loop. */
export const LOOP_SECONDS = 64;

/** Fixed closed flight loop (CatmullRom), x/y/z world units. */
export const FLIGHT_POINTS: readonly [number, number, number][] = [
  [-330, 42, -320],
  [-90, 30, -370],
  [170, 56, -330],
  [372, 44, -150],
  [350, 34, 110],
  [250, 62, 318],
  [10, 38, 380],
  [-250, 28, 316],
  [-392, 52, 70],
  [-370, 40, -170],
];

export const FLIGHT_CURVE = new THREE.CatmullRomCurve3(
  FLIGHT_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  true,
  "centripetal",
);

// Polyline through the curve. Sampled with getPoint(k / N) where N is a multiple of the
// control-point count, so every control point is an exact vertex.
const SAMPLES_PER_SEGMENT = 48;
const PATH_XZ: Float64Array = (() => {
  const n = FLIGHT_POINTS.length * SAMPLES_PER_SEGMENT;
  const out = new Float64Array(n * 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    FLIGHT_CURVE.getPoint(i / n, v);
    out[i * 2] = v.x;
    out[i * 2 + 1] = v.z;
  }
  return out;
})();

/** Horizontal distance from (x, z) to the flight path (segment-wise, closed loop). */
export function distToPath(x: number, z: number): number {
  const n = PATH_XZ.length / 2;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = PATH_XZ[i * 2], az = PATH_XZ[i * 2 + 1];
    const dx = PATH_XZ[j * 2] - ax, dz = PATH_XZ[j * 2 + 1] - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = ax + dx * t - x, ez = az + dz * t - z;
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BuildingSpot {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

/** Seeded, corridor-respecting building layout (pure: no GPU objects). */
export function layoutBuildings(count: number, seed: number): BuildingSpot[] {
  const rnd = mulberry32(seed);
  const blocks = Math.round(HALF / BLOCK);
  const interior = (BLOCK - STREET) / 2;
  const out: BuildingSpot[] = [];
  for (let attempt = 0; out.length < count && attempt < count * 80; attempt++) {
    const bx = Math.floor(rnd() * blocks * 2) - blocks;
    const bz = Math.floor(rnd() * blocks * 2) - blocks;
    const w = 12 + rnd() * (interior * 2 - 14);
    const d = 12 + rnd() * (interior * 2 - 14);
    const x = (bx + 0.5) * BLOCK + (rnd() * 2 - 1) * (interior - w / 2);
    const z = (bz + 0.5) * BLOCK + (rnd() * 2 - 1) * (interior - d / 2);
    const centre = 1 - Math.min(1, Math.hypot(x, z) / (HALF * 1.1));
    const h = 24 + Math.pow(rnd(), 1.8) * (90 + 180 * centre);
    if (distToPath(x, z) < CORRIDOR + 0.5 * Math.hypot(w, d)) continue;
    out.push({ x, z, w, d, h });
  }
  return out;
}

/** Searchlight / hologram anchor points, kept clear of the corridor. */
function clearSpot(rnd: () => number, margin: number): [number, number] {
  for (let i = 0; i < 500; i++) {
    const x = (rnd() * 2 - 1) * HALF * 0.85;
    const z = (rnd() * 2 - 1) * HALF * 0.85;
    if (distToPath(x, z) >= CORRIDOR + margin) return [x, z];
  }
  return [HALF * 0.8, HALF * 0.8];
}

const NEON = [0xff2bd6, 0x22e6ff, 0xff4f6a, 0x9b5cff, 0x3dffb0, 0xffb02e];

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

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

function hologramTexture(rnd: () => number, color: string): THREE.CanvasTexture {
  return canvasTexture(256, 384, (c) => {
    c.clearRect(0, 0, 256, 384);
    c.strokeStyle = color;
    c.fillStyle = color;
    c.shadowColor = color;
    c.shadowBlur = 10;
    c.lineWidth = 5;
    for (let r = 30; r < 120; r += 22) {
      c.beginPath();
      c.arc(128, 150, r, rnd() * 3, rnd() * 3 + 3.5);
      c.stroke();
    }
    c.beginPath();
    c.ellipse(128, 150, 26, 36, 0, 0, Math.PI * 2);
    c.fill();
    for (let i = 0; i < 9; i++) c.fillRect(34, 280 + i * 10, 40 + rnd() * 150, 5);
  });
}

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  return canvasTexture(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
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

export interface City {
  group: THREE.Group;
  /** Directional "moon" light (shadow caster when the preset enables shadows). */
  moonLight: THREE.DirectionalLight;
  counts: Record<string, number>;
  update(t: number, camera: THREE.Camera): void;
  dispose(): void;
}

export function buildCity(preset: Preset, seed = 1984): City {
  const rnd = mulberry32(seed);
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => (disposables.push(x), x);
  const updaters: ((t: number, camera: THREE.Camera) => void)[] = [];
  const shadows = preset.shadowMap > 0;

  // --- Sky, moon, haze ------------------------------------------------------
  const sky = new THREE.Mesh(
    track(new THREE.SphereGeometry(3000, 32, 16)),
    track(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {},
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vDir; void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 top = vec3(0.025, 0.02, 0.11);
          vec3 mid = vec3(0.16, 0.05, 0.30);
          vec3 hor = vec3(0.55, 0.12, 0.42);
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h));
          c = mix(c, top, smoothstep(0.18, 0.75, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
      }),
    ),
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);

  const moonDir = new THREE.Vector3(-0.45, 0.42, -0.78).normalize();
  const moon = new THREE.Mesh(
    track(new THREE.CircleGeometry(110, 48)),
    track(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.45, 1.7), fog: false, toneMapped: false, depthWrite: false })),
  );
  const halo = new THREE.Sprite(
    track(
      new THREE.SpriteMaterial({
        map: track(radialTexture("rgba(255,170,240,0.55)", "rgba(255,80,200,0)")),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    ),
  );
  halo.scale.setScalar(700);
  moon.renderOrder = halo.renderOrder = -9;
  group.add(moon, halo);
  updaters.push((_t, cam) => {
    moon.position.copy(cam.position).addScaledVector(moonDir, 2600);
    moon.lookAt(cam.position);
    halo.position.copy(moon.position);
    sky.position.copy(cam.position);
  });

  group.add(new THREE.HemisphereLight(0x8a7dff, 0x2a0a3a, 1.1));
  group.add(new THREE.AmbientLight(0x50408a, 0.9));
  const moonLight = new THREE.DirectionalLight(0xb9b4ff, 1.6);
  moonLight.position.copy(moonDir).multiplyScalar(900);
  moonLight.target.position.set(0, 0, 0);
  group.add(moonLight, moonLight.target);
  if (shadows) {
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.set(preset.shadowMap, preset.shadowMap);
    const cam = moonLight.shadow.camera;
    cam.left = cam.bottom = -HALF;
    cam.right = cam.top = HALF;
    cam.near = 10;
    cam.far = 2400;
    moonLight.shadow.bias = -0.0008;
  }

  // --- Ground ---------------------------------------------------------------
  const groundMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x15122a,
      roughness: preset.reflections > 0 ? 0.25 : 0.55,
      metalness: 0.55,
      transparent: preset.reflections > 0,
      opacity: preset.reflections > 0 ? 0.62 : 1,
    }),
  );
  const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(HALF * 2 + 800, HALF * 2 + 800)), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.05;
  ground.receiveShadow = shadows;
  group.add(ground);

  // --- Towers -----------------------------------------------------------------
  const spots = layoutBuildings(preset.buildings, seed);
  const palettes = [
    ["#ffd59a", "#ffb35c", "#fff1c9"],
    ["#7fe9ff", "#3fc8ff", "#d6f7ff"],
    ["#ff7ad9", "#c46bff", "#ffd0f4"],
  ];
  const box = track(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const towerMeshes = palettes.map((pal) => {
    const tex = track(windowTexture(rnd, pal));
    const mat = track(
      new THREE.MeshStandardMaterial({
        color: 0x272840,
        roughness: 0.45,
        metalness: 0.7,
        emissive: 0xffffff,
        emissiveMap: tex,
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
    const mesh = new THREE.InstancedMesh(box, towerMeshes[mi], Math.max(1, list.length));
    mesh.count = list.length;
    list.forEach((s, i) => mesh.setMatrixAt(i, m4.makeScale(s.w, s.h, s.d).setPosition(s.x, 0, s.z)));
    mesh.castShadow = mesh.receiveShadow = shadows;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });

  // Rooftop beacons: tiny red lights on the taller towers.
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

  // --- Neon signs on tower faces --------------------------------------------
  const signVariants = SIGN_WORDS.map((word, i) => {
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
    const v = signVariants[Math.floor(rnd() * signVariants.length)];
    const face = Math.floor(rnd() * 4);
    const nx = face === 0 ? 1 : face === 1 ? -1 : 0;
    const nz = face === 2 ? 1 : face === 3 ? -1 : 0;
    const sw = v.vertical ? 5 + rnd() * 4 : 14 + rnd() * 12;
    const sh = v.vertical ? sw * 4 : sw / 3;
    const along = nx !== 0 ? s.d : s.w;
    if (sw > along * 0.9) continue;
    const x = s.x + nx * (s.w / 2 + 0.6) + (nz !== 0 ? (rnd() - 0.5) * (s.w - sw) : 0);
    const z = s.z + nz * (s.d / 2 + 0.6) + (nx !== 0 ? (rnd() - 0.5) * (s.d - sw) : 0);
    if (distToPath(x, z) < CORRIDOR) continue;
    const y = 12 + rnd() * Math.max(1, s.h - sh - 16) + sh / 2;
    obj.position.set(x, y, z);
    obj.rotation.set(0, Math.atan2(nx, nz), 0);
    obj.scale.set(sw, sh, 1);
    obj.updateMatrix();
    v.mats.push(obj.matrix.clone());
    i++;
  }
  const plane = track(new THREE.PlaneGeometry(1, 1));
  let signCount = 0;
  for (const v of signVariants) {
    if (!v.mats.length) continue;
    const mesh = new THREE.InstancedMesh(plane, v.mat, v.mats.length);
    v.mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.computeBoundingSphere();
    signCount += v.mats.length;
    group.add(mesh);
  }

  // --- Unlit neon avenue strips along the flight path -------------------------
  const pathPts = FLIGHT_CURVE.getSpacedPoints(420);
  const stripGeo = track(new THREE.BoxGeometry(1, 0.35, 1));
  const strips = [
    { side: 1, color: new THREE.Color(0x22e6ff).multiplyScalar(3) },
    { side: -1, color: new THREE.Color(0xff2bd6).multiplyScalar(3) },
  ].map(({ side, color }) => {
    const mesh = new THREE.InstancedMesh(stripGeo, track(new THREE.MeshBasicMaterial({ color, toneMapped: false })), pathPts.length - 1);
    for (let i = 0; i < pathPts.length - 1; i++) {
      const a = pathPts[i], b = pathPts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const px = (-dz / len) * 11 * side, pz = (dx / len) * 11 * side;
      obj.position.set((a.x + b.x) / 2 + px, 0.25, (a.z + b.z) / 2 + pz);
      obj.rotation.set(0, Math.atan2(dx, dz), 0);
      obj.scale.set(0.9, 1, len * 0.7);
      obj.updateMatrix();
      mesh.setMatrixAt(i, obj.matrix);
    }
    mesh.computeBoundingSphere();
    return mesh;
  });
  group.add(...strips);

  // --- Rain (GPU points, wrapped around the camera) -----------------------------
  const RAIN_BOX = new THREE.Vector3(220, 140, 220);
  const rainPos = new Float32Array(preset.rain * 3);
  for (let i = 0; i < preset.rain; i++) {
    rainPos[i * 3] = rnd() * RAIN_BOX.x;
    rainPos[i * 3 + 1] = rnd() * RAIN_BOX.y;
    rainPos[i * 3 + 2] = rnd() * RAIN_BOX.z;
  }
  const rainGeo = track(new THREE.BufferGeometry());
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rainMat = track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: RAIN_BOX } },
      vertexShader: `uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; varying float vFade;
        void main(){
          vec3 p = position;
          p.y = mod(p.y - uTime * 95.0, uBox.y);
          p.x = mod(p.x + uTime * 6.0 - uCam.x, uBox.x) - uBox.x * 0.5 + uCam.x;
          p.z = mod(p.z - uCam.z, uBox.z) - uBox.z * 0.5 + uCam.z;
          p.y += uCam.y - uBox.y * 0.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(600.0 / -mv.z, 1.0, 48.0);
          vFade = clamp(1.0 - (-mv.z) / (uBox.x * 0.5), 0.0, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vFade; void main(){
          vec2 c = gl_PointCoord - 0.5;
          float streak = smoothstep(0.06, 0.0, abs(c.x)) * (1.0 - smoothstep(0.2, 0.5, abs(c.y)));
          if (streak < 0.01) discard;
          gl_FragColor = vec4(vec3(0.55, 0.7, 1.0) * streak * vFade * 0.9, 1.0);
        }`,
    }),
  );
  const rain = new THREE.Points(rainGeo, rainMat);
  rain.frustumCulled = false;
  group.add(rain);
  updaters.push((t, cam) => {
    rainMat.uniforms.uTime.value = t;
    rainMat.uniforms.uCam.value.copy(cam.position);
  });

  // --- Traffic: ground + flying cars with light trails --------------------------
  interface Car { axis: 0 | 1; lane: number; y: number; dir: number; speed: number; phase: number }
  const blocks = Math.round(HALF / BLOCK);
  const groundCount = Math.round(preset.cars * 0.5);
  const cars: Car[] = [];
  for (let i = 0; i < preset.cars; i++) {
    const flying = i >= groundCount;
    const dir = rnd() < 0.5 ? 1 : -1;
    const street = (Math.floor(rnd() * blocks * 2) - blocks + 1) * BLOCK;
    cars.push({
      axis: rnd() < 0.5 ? 0 : 1,
      lane: street + dir * (flying ? 3 + rnd() * 4 : 4),
      y: flying ? 30 + rnd() * 90 : 1.0,
      dir,
      speed: flying ? 70 + rnd() * 90 : 28 + rnd() * 30,
      phase: rnd() * HALF * 2,
    });
  }
  const carBodies = new THREE.InstancedMesh(
    track(new THREE.BoxGeometry(2.4, 1.3, 5)),
    track(new THREE.MeshStandardMaterial({ color: 0x1b1d2e, metalness: 0.9, roughness: 0.3, emissive: 0x220a30 })),
    Math.max(1, cars.length),
  );
  carBodies.count = cars.length;
  const trailGeo = track(new THREE.BoxGeometry(0.7, 0.45, 1).translate(0, 0, -0.5));
  const trails = new THREE.InstancedMesh(
    trailGeo,
    track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })),
    Math.max(1, cars.length * 2),
  );
  trails.count = cars.length * 2;
  const trailCol = new THREE.Color();
  cars.forEach((c, i) => {
    const flying = c.y > 2;
    const hex = flying ? NEON[Math.floor(rnd() * 3)] : c.dir > 0 ? 0xff2a3a : 0xfff0c8;
    trailCol.set(hex).multiplyScalar(flying ? 3 : 2.4);
    trails.setColorAt(i * 2, trailCol);
    trails.setColorAt(i * 2 + 1, trailCol);
  });
  carBodies.frustumCulled = trails.frustumCulled = false;
  group.add(carBodies, trails);
  const span = HALF * 2;
  updaters.push((t) => {
    const body = carBodies.instanceMatrix.array as Float32Array;
    const tr = trails.instanceMatrix.array as Float32Array;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const s = ((((c.phase + c.dir * c.speed * t) % span) + span) % span) - HALF;
      const x = c.axis === 0 ? s : c.lane;
      const z = c.axis === 0 ? c.lane : s;
      // Heading: +z for axis 1, +x for axis 0, flipped by dir. Column-major rotation about Y.
      const fx = c.axis === 0 ? c.dir : 0, fz = c.axis === 1 ? c.dir : 0;
      writeOriented(body, i * 16, fx, fz, 1, 1, 1, x, c.y, z);
      const len = c.y > 2 ? 26 : 9;
      writeOriented(tr, i * 32, fx, fz, 1, 1, len, x - fx * 2.5 + fz * 0.8, c.y, z - fz * 2.5 - fx * 0.8);
      writeOriented(tr, i * 32 + 16, fx, fz, 1, 1, len, x - fx * 2.5 - fz * 0.8, c.y, z - fz * 2.5 + fx * 0.8);
    }
    carBodies.instanceMatrix.needsUpdate = true;
    trails.instanceMatrix.needsUpdate = true;
  });

  // --- Drones orbiting between towers -----------------------------------------
  const droneSpec = Array.from({ length: preset.drones }, () => {
    const s = spots[Math.floor(rnd() * spots.length)] ?? { x: 0, z: 0, h: 60, w: 20, d: 20 };
    return { cx: s.x, cz: s.z, y: 20 + rnd() * (s.h + 20), r: Math.max(s.w, s.d) * 0.7 + 6 + rnd() * 18, w: (0.4 + rnd()) * (rnd() < 0.5 ? 1 : -1), p: rnd() * 6.28 };
  });
  const drones = new THREE.InstancedMesh(
    track(new THREE.OctahedronGeometry(1.3)),
    track(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })),
    Math.max(1, droneSpec.length),
  );
  drones.count = droneSpec.length;
  droneSpec.forEach((_, i) => drones.setColorAt(i, trailCol.set(NEON[i % NEON.length]).multiplyScalar(3)));
  drones.frustumCulled = false;
  group.add(drones);
  updaters.push((t) => {
    const a = drones.instanceMatrix.array as Float32Array;
    droneSpec.forEach((d, i) => {
      const ang = d.p + t * d.w;
      writeOriented(a, i * 16, 0, 1, 1, 1, 1, d.cx + Math.cos(ang) * d.r, d.y + Math.sin(t * 1.7 + d.p) * 3, d.cz + Math.sin(ang) * d.r);
    });
    drones.instanceMatrix.needsUpdate = true;
  });

  // --- Rotating hologram billboards -----------------------------------------
  const holoGeo = track(new THREE.PlaneGeometry(26, 39));
  const holos: THREE.Mesh[] = [];
  for (let i = 0; i < preset.holos; i++) {
    const hex = "#" + new THREE.Color(NEON[(i * 2 + 1) % NEON.length]).getHexString();
    const mat = track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uMap: { value: track(hologramTexture(rnd, hex)) }, uTime: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform sampler2D uMap; uniform float uTime; varying vec2 vUv; void main(){
          vec4 c = texture2D(uMap, vUv + vec2(sin(vUv.y * 80.0 + uTime * 9.0) * 0.004, 0.0));
          float scan = 0.65 + 0.35 * sin(vUv.y * 260.0 - uTime * 14.0);
          float flick = 0.85 + 0.15 * sin(uTime * 31.0 + vUv.y * 4.0);
          gl_FragColor = vec4(c.rgb * scan * flick * 2.2, 1.0) * c.a;
        }`,
      }),
    );
    const mesh = new THREE.Mesh(holoGeo, mat);
    const anchor = spots.length && rnd() < 0.6 ? spots[Math.floor(rnd() * spots.length)] : null;
    const [x, z] = anchor ? [anchor.x, anchor.z] : clearSpot(rnd, 20);
    mesh.position.set(x, (anchor ? anchor.h : 30 + rnd() * 40) + 22, z);
    mesh.userData.spin = (0.3 + rnd() * 0.5) * (rnd() < 0.5 ? 1 : -1);
    holos.push(mesh);
    group.add(mesh);
  }
  updaters.push((t) => {
    for (const h of holos) {
      h.rotation.y = t * h.userData.spin;
      (h.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    }
  });

  // --- Sweeping searchlight cones (additive overdraw) --------------------------
  const coneGeo = track(new THREE.ConeGeometry(30, 320, 32, 1, true).translate(0, -160, 0).rotateX(Math.PI));
  const coneMat = track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0.55, 0.6, 1.0) } },
      vertexShader: `varying float vH; varying vec3 vN; varying vec3 vV; void main(){
        vH = position.y / 320.0;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; varying float vH; varying vec3 vN; varying vec3 vV; void main(){
        // Clamp: rounding can push |dot| past 1, and pow() of a negative base is NaN on many GPUs.
        float edge = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.5);
        float a = (1.0 - vH) * (0.25 + 0.5 * (1.0 - edge)) * 0.32;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    }),
  );
  const cones: THREE.Mesh[] = [];
  const coneCount = Math.max(2, Math.round(preset.holos * 2));
  for (let i = 0; i < coneCount; i++) {
    const [x, z] = clearSpot(rnd, 30);
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(x, 1, z);
    cone.userData = { p: rnd() * 6.28, w: 0.25 + rnd() * 0.35 };
    cones.push(cone);
    group.add(cone);
  }
  updaters.push((t) => {
    for (const c of cones) {
      c.rotation.z = Math.sin(t * c.userData.w + c.userData.p) * 0.45;
      c.rotation.x = Math.cos(t * c.userData.w * 0.7 + c.userData.p) * 0.3;
    }
  });

  return {
    group,
    moonLight,
    counts: {
      buildings: spots.length,
      signs: signCount,
      rain: preset.rain,
      cars: cars.length,
      drones: droneSpec.length,
      holos: holos.length,
      searchlights: cones.length,
    },
    update(t, camera) {
      for (const u of updaters) u(t, camera);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      group.clear();
    },
  };
}

/** Write a Y-rotation (heading fx,fz) + scale + translation matrix, column-major. */
function writeOriented(a: Float32Array, o: number, fx: number, fz: number, sx: number, sy: number, sz: number, x: number, y: number, z: number): void {
  // local +z -> (fx, 0, fz); local +x -> (fz, 0, -fx)
  a[o] = fz * sx; a[o + 1] = 0; a[o + 2] = -fx * sx; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = fx * sz; a[o + 9] = 0; a[o + 10] = fz * sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}
