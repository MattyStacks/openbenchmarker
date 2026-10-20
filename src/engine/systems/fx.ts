import * as THREE from "three";
import { NEON, canvasTexture, type BuildCtx } from "../ctx";
import { FOG_DENSITY, FOG_FN } from "../fog";
import { stream } from "../rng";
import { HALF, clearOfPath } from "../world";

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

/** A ground point at least `margin` from the camera path (plus the solid clearance). */
function clearSpot(rnd: () => number, margin: number, height: number): [number, number] {
  for (let i = 0; i < 500; i++) {
    const x = (rnd() * 2 - 1) * HALF * 0.85;
    const z = (rnd() * 2 - 1) * HALF * 0.85;
    if (clearOfPath(x - margin, 0, z - margin, x + margin, height, z + margin)) return [x, z];
  }
  return [HALF * 0.8, HALF * 0.8];
}

/** Rotating hologram billboards above towers, and sweeping searchlight cones. */
export function buildFx(ctx: BuildCtx): void {
  const { group, track, preset, spots } = ctx;
  const rnd = stream(ctx.seed, 7);

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
    // Rotating 26-wide panel: keep its whole swept cylinder clear of the path.
    let placed = false;
    for (let k = 0; k < 40 && !placed; k++) {
      const anchor = spots.length && rnd() < 0.6 ? spots[Math.floor(rnd() * spots.length)] : null;
      const [x, z] = anchor ? [anchor.x, anchor.z] : clearSpot(rnd, 20, 120);
      const y = (anchor ? anchor.h : 30 + rnd() * 40) + 22;
      if (!clearOfPath(x - 13, y - 20, z - 13, x + 13, y + 20, z + 13)) continue;
      mesh.position.set(x, y, z);
      placed = true;
    }
    if (!placed) continue;
    mesh.userData.spin = (0.3 + rnd() * 0.5) * (rnd() < 0.5 ? 1 : -1);
    holos.push(mesh);
    group.add(mesh);
  }
  ctx.onUpdate((t) => {
    for (const h of holos) {
      h.rotation.y = t * h.userData.spin;
      (h.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    }
  });

  // --- Searchlights: thin sweeping beams from tall rooftops, dusty with rain -----------------
  // Unit cone, apex at the origin, opening up to radius 1 at y = 1 (scaled per beam).
  const coneGeo = track(new THREE.ConeGeometry(1, 1, 24, 1, true).rotateX(Math.PI).translate(0, 0.5, 0));
  const coneMat = track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uFogDensity: { value: FOG_DENSITY } },
      vertexShader: /* glsl */ `
        uniform float uFogDensity;
        varying float vH, vFog;
        varying vec3 vN, vV, vCol;
        ${FOG_FN}
        void main() {
          vH = position.y;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vec4 mv = viewMatrix * wp;
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vV = normalize(-mv.xyz);
          vCol = vec3(1.0);
          #ifdef USE_INSTANCING_COLOR
            vCol = instanceColor;
          #endif
          vFog = ogbFogAmount(cameraPosition, wp.xyz, uFogDensity);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying float vH, vFog;
        varying vec3 vN, vV, vCol;
        float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
        void main() {
          // Clamp: rounding can push |dot| past 1, and pow() of a negative base is NaN on many GPUs.
          float facing = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
          float core = pow(facing, 1.6);
          float k = vH * 60.0 - uTime * 0.6;
          float dust = 0.75 + 0.25 * mix(h11(floor(k)), h11(floor(k) + 1.0), fract(k));
          float a = pow(clamp(1.0 - vH, 0.0, 1.0), 1.3) * core * dust * 0.16 * (1.0 - 0.85 * vFog);
          gl_FragColor = vec4(vCol * a, 1.0);
        }`,
    }),
  );
  const tall = spots.filter((s) => s.h > 100);
  const beams: { x: number; y: number; z: number; p: number; w: number; tilt: number }[] = [];
  for (let i = 0; i < tall.length && beams.length < preset.lightShafts; i += 2) {
    const s = tall[i];
    beams.push({ x: s.x, y: s.h + 1, z: s.z, p: rnd() * 6.28, w: 0.12 + rnd() * 0.22, tilt: 0.12 + rnd() * 0.3 });
  }
  const cones = new THREE.InstancedMesh(coneGeo, coneMat, Math.max(1, beams.length));
  cones.count = beams.length;
  const bc = new THREE.Color();
  beams.forEach((_, i) => cones.setColorAt(i, rnd() < 0.6 ? bc.setRGB(0.75, 0.78, 1.0) : rnd() < 0.5 ? bc.setRGB(1.0, 0.4, 0.9) : bc.setRGB(0.4, 0.9, 1.0)));
  cones.frustumCulled = false;
  group.add(cones);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3(16, 560, 16);
  ctx.onUpdate((t) => {
    coneMat.uniforms.uTime.value = t;
    beams.forEach((b, i) => {
      e.set(Math.cos(t * b.w * 0.7 + b.p) * b.tilt, 0, Math.sin(t * b.w + b.p) * (b.tilt + 0.12));
      q.setFromEuler(e);
      cones.setMatrixAt(i, m4.compose(pos.set(b.x, b.y, b.z), q, scl));
    });
    cones.instanceMatrix.needsUpdate = true;
  });
  ctx.counts.holos = holos.length;
  ctx.counts.searchlights = beams.length;
}
