import * as THREE from "three";
import { NEON, canvasTexture, type BuildCtx } from "../ctx";
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
    const [x, z] = clearSpot(rnd, 30, 4);
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(x, 1, z);
    cone.userData = { p: rnd() * 6.28, w: 0.25 + rnd() * 0.35 };
    cones.push(cone);
    group.add(cone);
  }
  ctx.onUpdate((t) => {
    for (const c of cones) {
      c.rotation.z = Math.sin(t * c.userData.w + c.userData.p) * 0.45;
      c.rotation.x = Math.cos(t * c.userData.w * 0.7 + c.userData.p) * 0.3;
    }
  });
  ctx.counts.holos = holos.length;
  ctx.counts.searchlights = cones.length;
}
