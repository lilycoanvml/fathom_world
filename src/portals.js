import * as THREE from 'three';
import { BRAND_COLORS, BIOMES } from './biomes.js';
import { FOG_GLSL } from './atmosphere.js';

const vertexShader = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormalL;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  void main() {
    vLocal = position;
    vNormalL = normal;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform vec2 uHalf;
  uniform float uReveal;
  uniform float uYaw;
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  // Destination glimpse
  uniform vec3 uDZenith;
  uniform vec3 uDHorizon;
  uniform vec3 uDSun;
  uniform vec3 uDSil1;
  uniform vec3 uDSil2;
  uniform vec3 uDGround;
  uniform float uDSunEl;
  uniform float uDWater;
  uniform float uDSnow;
  uniform float uDMesa;
  uniform float uDSeed;
  ${FOG_GLSL}

  varying vec3 vLocal;
  varying vec3 vNormalL;
  varying vec3 vWorld;
  varying vec3 vNormalW;

  float sdStadium(vec2 p, vec2 h) {
    float r = min(h.x, h.y);
    vec2 a = vec2(max(h.x - r, 0.0), max(h.y - r, 0.0));
    return length(p - clamp(p, -a, a)) - r;
  }
  float hash1(float n) { return fract(sin(n) * 43758.5453); }
  float vnoise(float x) {
    float i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash1(i + uDSeed), hash1(i + 1.0 + uDSeed), f);
  }
  float fbm1(float x) {
    return vnoise(x) * 0.55 + vnoise(x * 2.1 + 3.0) * 0.3 + vnoise(x * 4.3 + 7.0) * 0.15;
  }

  vec3 destSky(vec3 d) {
    float t = clamp(d.y, 0.0, 1.0);
    vec3 sky = mix(uDHorizon, uDZenith, pow(t, 0.5));
    vec3 sdir = normalize(vec3(0.35, sin(uDSunEl), -cos(uDSunEl)));
    float sd = max(dot(d, sdir), 0.0);
    return sky + uDSun * (pow(sd, 700.0) * 3.0 + pow(sd, 10.0) * 0.25);
  }

  // A small painted panorama of where this portal leads.
  vec3 destView(vec3 d) {
    float el = d.y;
    float az = atan(d.x, -d.z);
    vec3 col = destSky(d);
    float n1 = fbm1(az * 2.4 + 1.7);
    if (uDMesa > 0.5) n1 = floor(n1 * 4.0 + 0.5) / 4.0;
    float h1 = 0.02 + 0.16 * n1;
    float h2 = -0.005 + 0.07 * fbm1(az * 6.0 + 9.1);
    if (el < h1) {
      col = mix(uDSil1, uDHorizon, 0.3 + 0.4 * smoothstep(h1 - 0.12, h1, el) * 0.3);
      if (uDSnow > 0.5 && el > 0.1) col = mix(col, vec3(0.92), 0.75);
    }
    if (el < h2) col = mix(uDSil2, uDHorizon, 0.18);
    if (el < -0.01) {
      vec3 ground = mix(uDGround, uDHorizon, 0.25 / (1.0 + 40.0 * -el));
      vec3 refl = destSky(vec3(d.x, -d.y, d.z)) * 0.85;
      col = mix(ground, mix(refl, uDGround, 0.25), uDWater);
    }
    return col;
  }

  void main() {
    vec3 nL = normalize(vNormalL);
    vec3 nW = normalize(vNormalW);
    float sd = sdStadium(vLocal.xy, uHalf);

    // Soft gradient between two approved colors only.
    float g = smoothstep(uHalf.y, -uHalf.y, vLocal.y);
    vec3 base = mix(uColA, uColB, g * 0.18);

    vec3 V = normalize(cameraPosition - vWorld);
    float ndl = max(dot(nW, uSunDir), 0.0);
    float fres = pow(1.0 - abs(dot(nW, V)), 3.0);
    float breath = 0.5 + 0.5 * sin(uTime * 0.8);
    vec3 col = base * (0.8 + 0.2 * ndl + 0.06 * smoothstep(-uHalf.y, uHalf.y, vLocal.y));
    col += base * fres * (0.08 + 0.3 * uReveal);
    // Inner glow line just inside the rim, stronger on approach.
    float ring = smoothstep(0.55, 0.0, abs(sd + 0.45));
    col += base * ring * (0.03 + 0.2 * uReveal) * (0.8 + 0.2 * breath);

    float face = smoothstep(0.6, 0.95, abs(nL.z));
    float inner = smoothstep(-0.35, -1.1, sd);
    float m = uReveal * face * inner;
    if (m > 0.001) {
      vec3 dW = normalize(vWorld - cameraPosition);
      float c = cos(uYaw), s = sin(uYaw);
      vec3 dl = vec3(c * dW.x - s * dW.z, dW.y, s * dW.x + c * dW.z);
      if (nL.z < 0.0) { dl.x = -dl.x; dl.z = -dl.z; }
      vec3 pv = destView(vec3(dl.x, dl.y, dl.z));
      pv = mix(pv, uColA, 0.12);
      col = mix(col, pv, m);
    }

    float fd = length(cameraPosition - vWorld);
    col = mix(col, uFogColor, aerial(fd, uFogNear, uFogFar) * 0.8);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

function stadiumShape(w, h) {
  const s = new THREE.Shape();
  const hw = w / 2, hh = h / 2;
  if (w >= h) {
    const r = hh, a = hw - r;
    s.moveTo(-a, -hh);
    s.lineTo(a, -hh);
    s.absarc(a, 0, r, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(-a, hh);
    s.absarc(-a, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  } else {
    const r = hw, a = hh - r;
    s.moveTo(hw, -a);
    s.lineTo(hw, a);
    s.absarc(0, a, r, 0, Math.PI, false);
    s.lineTo(-hw, -a);
    s.absarc(0, -a, r, Math.PI, 2 * Math.PI, false);
  }
  return s;
}

const col = (hex) => new THREE.Color(hex);

export class Portals {
  constructor(scene, shared) {
    this.scene = scene;
    this.shared = shared;
    this.active = new Map();
  }

  create(def) {
    const bevel = 0.45;
    const geo = new THREE.ExtrudeGeometry(stadiumShape(def.w, def.h), {
      depth: def.depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 6,
      curveSegments: 40,
    });
    geo.translate(0, 0, -def.depth / 2);
    const dest = BIOMES[def.dest];
    const sunEl = THREE.MathUtils.degToRad(dest.sky.elevation);
    const pv = dest.preview;
    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      toneMapped: false,
      uniforms: {
        uColA: { value: col(BRAND_COLORS[def.colorIdx]) },
        uColB: { value: col(BRAND_COLORS[(def.colorIdx + 1) % 3]) },
        uHalf: { value: new THREE.Vector2(def.w / 2, def.h / 2) },
        uReveal: { value: 0 },
        uYaw: { value: def.yaw },
        uTime: this.shared.uTime,
        uSunDir: this.shared.uSunDir,
        uFogColor: this.shared.uFogColor,
        uFogNear: this.shared.uFogNear,
        uFogFar: this.shared.uFogFar,
        uDZenith: { value: col(dest.sky.zenith) },
        uDHorizon: { value: col(dest.sky.horizon) },
        uDSun: { value: col(dest.sky.sun) },
        uDSil1: { value: col(pv.sil1) },
        uDSil2: { value: col(pv.sil2) },
        uDGround: { value: col(pv.ground) },
        uDSunEl: { value: sunEl },
        uDWater: { value: dest.water ? 1 : 0 },
        uDSnow: { value: pv.snow ? 1 : 0 },
        uDMesa: { value: 0 },
        uDSeed: { value: dest.seed },
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(def.x, def.baseY + def.h / 2, def.z);
    mesh.rotation.y = def.yaw;
    mesh.castShadow = true;
    this.scene.add(mesh);
    const portal = { ...def, mesh, reveal: 0 };
    this.active.set(def.key, portal);
    return portal;
  }

  remove(key) {
    const p = this.active.get(key);
    if (!p) return;
    this.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    p.mesh.material.dispose();
    this.active.delete(key);
  }

  clear() {
    for (const key of [...this.active.keys()]) this.remove(key);
  }

  // Updates approach reveal; returns { entered, nearest } for the player position.
  update(px, feetY, pz, dt) {
    let entered = null;
    let nearest = null;
    let nearestD = Infinity;
    for (const p of this.active.values()) {
      const dx = px - p.x, dz = pz - p.z;
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      const lx = c * dx - s * dz;
      const lz = s * dx + c * dz;
      const dist = Math.hypot(dx, dz);
      const target = 1 - THREE.MathUtils.smoothstep(dist, 5, 22);
      p.reveal += (target - p.reveal) * Math.min(1, dt * 3);
      p.mesh.material.uniforms.uReveal.value = p.reveal;
      if (dist < nearestD) { nearestD = dist; nearest = p; }

      if (Math.abs(lz) < p.depth / 2 + 0.5) {
        const centerY = p.baseY + p.h / 2;
        for (const off of [0.9, 1.6]) {
          const ly = feetY + off - centerY;
          if (sdStadium(lx, ly, p.w / 2, p.h / 2) < 0.1) { entered = p; break; }
        }
      }
    }
    return { entered, nearest, nearestD };
  }
}

function sdStadium(x, y, hx, hy) {
  const r = Math.min(hx, hy);
  const ax = Math.max(hx - r, 0), ay = Math.max(hy - r, 0);
  const qx = x - Math.min(Math.max(x, -ax), ax);
  const qy = y - Math.min(Math.max(y, -ay), ay);
  return Math.hypot(qx, qy) - r;
}
