import * as THREE from 'three';
import { hash2 } from './noise.js';
import { addMist } from './atmosphere.js';

const RANGE = 32;
const CELL = 0.7;
const MAX = Math.ceil((Math.PI * RANGE * RANGE) / (CELL * CELL));

function bladeClump() {
  const pos = [], col = [], nor = [];
  const BLADES = 6;
  for (let b = 0; b < BLADES; b++) {
    const a = b * 2.4;
    const cx = Math.cos(a), sz = Math.sin(a);
    const w = 0.035;
    const ox = Math.cos(b * 1.7) * 0.12, oz = Math.sin(b * 2.9) * 0.12;
    const tall = 0.7 + ((b * 37) % 10) / 30;
    const lean = 0.18 * Math.sin(b * 1.3);
    // Two triangles tapering to a tip, slightly leaning.
    const verts = [
      [-w, 0], [w, 0], [w * 0.5, 0.55],
      [-w, 0], [w * 0.5, 0.55], [0, 1],
    ];
    for (const [u, y] of verts) {
      pos.push(ox + cx * u + lean * y * sz, y * tall, oz + sz * u - lean * y * cx);
      const shade = 0.6 + 0.45 * y;
      col.push(shade, shade, shade);
      nor.push(0, 1, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// A world-anchored field of grass clumps that only exists near the viewer.
export class Grass {
  constructor(scene, shared) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = shared.uTime;
      shader.uniforms.uWindDir = shared.uWindDir;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uWindDir;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 ip = instanceMatrix[3].xyz;
          // Fade blades out with distance from the camera, continuously (no rebuild pops).
          float fadeD = length(ip.xz - cameraPosition.xz);
          transformed *= 1.0 - smoothstep(${(RANGE * 0.55).toFixed(1)}, ${(RANGE * 0.9).toFixed(1)}, fadeD);
          // Gust bands roll across the field in the wind direction, bending and brightening blades.
          float along = dot(ip.xz, uWindDir);
          float across = dot(ip.xz, vec2(-uWindDir.y, uWindDir.x));
          float gust = pow(0.5 + 0.5 * sin(along * 0.11 - uTime * 1.7 + sin(across * 0.05) * 1.5), 3.0);
          float flutter = sin(uTime * 2.3 + ip.x * 0.7 + ip.z * 0.5) * 0.25;
          vec2 windL = normalize((transpose(mat3(instanceMatrix)) * vec3(uWindDir.x, 0.0, uWindDir.y)).xz);
          float h2 = position.y * position.y;
          transformed.xz += windL * h2 * (0.08 + gust * 0.22 + flutter * 0.05);
          vColor.rgb *= 1.0 + gust * 0.2 * position.y;`,
        );
      // Light both sides of a blade like the ground beneath it.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\nnormal = normalize(vNormal);',
      );
    };
    addMist(mat, shared);
    this.mesh = new THREE.InstancedMesh(bladeClump(), mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.cfg = null;
    this.last = new THREE.Vector2(Infinity, Infinity);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.c = new THREE.Color();
    this.tip = new THREE.Color();
  }

  setBiome(cfg) {
    this.cfg = cfg;
    if (cfg) this.tip.set(cfg.color);
    this.last.set(Infinity, Infinity);
    this.mesh.count = 0;
  }

  update(px, pz, world) {
    const cfg = this.cfg;
    if (!cfg) return;
    if (Math.hypot(px - this.last.x, pz - this.last.y) < 3) return;
    this.last.set(px, pz);
    const { m, q, c } = this;
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3(), s = new THREE.Vector3();
    let n = 0;
    const g0x = Math.floor((px - RANGE) / CELL), g1x = Math.ceil((px + RANGE) / CELL);
    const g0z = Math.floor((pz - RANGE) / CELL), g1z = Math.ceil((pz + RANGE) / CELL);
    for (let gz = g0z; gz <= g1z; gz++)
      for (let gx = g0x; gx <= g1x; gx++) {
        if (n >= MAX) break;
        if (hash2(gx, gz, 5) > cfg.density) continue;
        const x = (gx + hash2(gx, gz, 6)) * CELL;
        const z = (gz + hash2(gx, gz, 7)) * CELL;
        const d = Math.hypot(x - px, z - pz);
        if (d > RANGE) continue;
        // Grass grows in soft patches, leaving open ground between.
        const patch = world.N.fbm(x / 34 + 91, z / 34 - 23, 2);
        const grow = THREE.MathUtils.smoothstep(patch, cfg.patch ?? 0.05, (cfg.patch ?? 0.05) + 0.2);
        if (grow < 0.15) continue;
        const h = world.height(x, z);
        if (h < world.waterLevel + (cfg.shore ?? 0.4)) continue;
        const k = cfg.height * (0.6 + hash2(gx, gz, 8) * 0.8) * grow;
        q.setFromAxisAngle(up, hash2(gx, gz, 9) * Math.PI * 2);
        m.compose(v.set(x, h - 0.03, z), q, s.set(k * 1.4, k, k * 1.4));
        this.mesh.setMatrixAt(n, m);
        this.mesh.setColorAt(n, c.copy(this.tip).multiplyScalar(0.8 + hash2(gx, gz, 10) * 0.35));
        n++;
      }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
