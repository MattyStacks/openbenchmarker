import * as THREE from "three";
import { radialTexture, type BuildCtx } from "../ctx";
import { HALF } from "../world";

/** Sky dome, moon, lights (moon light casts the shadows), and the ground plane. */
export function buildSky(ctx: BuildCtx): void {
  const { group, track, preset, shadows } = ctx;
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
  ctx.onUpdate((_t, cam) => {
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
}
