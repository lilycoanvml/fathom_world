import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise } from './noise.js';
import { addMist } from './atmosphere.js';

const N = makeNoise(97);

function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Darkens vertices toward the bottom/inside of a form as cheap ambient occlusion.
function occlude(geo, fn) {
  const p = geo.attributes.position;
  const c = geo.attributes.color;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = fn(v);
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return geo;
}

function clean(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  return g;
}

// Smooth, noise-displaced blob — the base of every rock-like form.
function blob(radius, detail, amp, freq, seed) {
  let g = new THREE.IcosahedronGeometry(radius, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 1 + amp * N.n(v.x * freq + seed, v.y * freq + v.z * freq * 0.7 - seed);
    v.multiplyScalar(d);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function pine() {
  const parts = [paint(new THREE.CylinderGeometry(0.1, 0.26, 3.2, 7).translate(0, 1.6, 0), '#4a3a2e')];
  // Jagged, drooping tiers read as branch clusters rather than smooth cones.
  const tiers = 8;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = 2.0 * (1 - t) + 0.3;
    const h = 2.3 - t * 0.8;
    const g = new THREE.ConeGeometry(r, h, 14, 2, true);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const rim = (h / 2 - y) / h; // 0 at apex, 1 at rim
      const a = Math.atan2(z, x);
      const jag = 1 + rim * (0.28 * Math.sin(a * 7 + i * 1.9) + 0.12 * Math.sin(a * 13 + i));
      p.setXYZ(k, x * jag, y - rim * rim * 0.45 * (1 + 0.5 * Math.sin(a * 7 + i * 1.9)), z * jag);
    }
    g.computeVertexNormals();
    g.rotateY(i * 0.9).translate(Math.sin(i * 2.3) * 0.07, 2.3 + t * 6.3, Math.cos(i * 1.7) * 0.07);
    const c = new THREE.Color('#2b4433').lerp(new THREE.Color('#4f6e4c'), t * 0.75);
    paint(g, '#' + c.getHexString());
    // Tips catch light; the inside of each tier sits in shade.
    occlude(g, (v) => {
      const d = Math.hypot(v.x, v.z) / (r * 1.1);
      return 0.55 + 0.6 * Math.min(1, d);
    });
    parts.push(g);
  }
  return mergeGeometries(parts.map(clean));
}

function roundTree() {
  const parts = [paint(new THREE.CylinderGeometry(0.16, 0.3, 4, 8).translate(0, 2, 0), '#574636')];
  const lobes = [[0, 5.0, 0, 1.9], [1.3, 4.4, 0.5, 1.4], [-1.2, 4.6, -0.4, 1.5], [0.3, 4.3, -1.3, 1.3], [-0.4, 4.2, 1.3, 1.3], [0.2, 6.1, 0.2, 1.3]];
  lobes.forEach(([x, y, z, r], i) => {
    const g = blob(r, 2, 0.18, 1.1, i * 3.1).translate(x, y, z);
    paint(g, i % 2 ? '#667a42' : '#5b7040');
    occlude(g, (v) => 0.6 + 0.5 * THREE.MathUtils.smoothstep(v.y, 3.2, 6.6));
    parts.push(g);
  });
  return mergeGeometries(parts.map(clean));
}

function boulder() {
  const g = paint(blob(1, 3, 0.22, 0.9, 7).scale(1.35, 0.8, 1.1), '#8b877e');
  // Lighter, weathered tops; darker, damp undersides.
  occlude(g, (v) => 0.62 + 0.5 * THREE.MathUtils.smoothstep(v.y, -0.6, 0.7));
  return clean(g);
}

function seastack() {
  const g = new THREE.CylinderGeometry(5, 7.5, 44, 18, 14);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    const k = 1 + 0.22 * N.n(Math.cos(a) * 1.3 + v.y * 0.05, Math.sin(a) * 1.3 + v.y * 0.04) + 0.05 * Math.sin(v.y * 0.9);
    // Round the crown over so the stack reads as eroded, not cut.
    const top = Math.max(0, (v.y - 16) / 6);
    const r = k * (1 - 0.35 * top * top);
    p.setXYZ(i, v.x * r, v.y + 12, v.z * r);
  }
  g.computeVertexNormals();
  const c = new THREE.Color('#4a4341');
  const lichen = new THREE.Color('#6d6a52');
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const m = c.clone().lerp(lichen, THREE.MathUtils.smoothstep(y, 28, 34));
    m.multiplyScalar((0.75 + 0.25 * THREE.MathUtils.smoothstep(y, -2, 10)) * (0.9 + 0.1 * Math.sin(y * 1.7)));
    colors.set([m.r, m.g, m.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return clean(g);
}

function hoodoo() {
  const parts = [
    blob(1.5, 2, 0.12, 1.2, 1).scale(1, 0.9, 1).translate(0, 1.0, 0),
    blob(1.15, 2, 0.12, 1.2, 2).scale(1, 0.8, 1).translate(0.1, 2.7, 0),
    blob(0.85, 2, 0.12, 1.2, 3).scale(1, 0.8, 1).translate(-0.05, 4.0, 0.05),
  ];
  paint(parts[0], '#c47f5e');
  paint(parts[1], '#d39a76');
  paint(parts[2], '#b56f53');
  for (const g of parts) occlude(g, (v) => 0.7 + 0.35 * THREE.MathUtils.smoothstep(v.y, 0, 4.5));
  return mergeGeometries(parts.map(clean));
}

// A lying capsule — a quiet echo of the portal pill in the landscape.
function capsule() {
  const g = paint(new THREE.CapsuleGeometry(1.1, 3.2, 8, 20).rotateZ(Math.PI / 2).translate(0, 0.9, 0), '#a49d92');
  occlude(g, (v) => 0.7 + 0.35 * THREE.MathUtils.smoothstep(v.y, 0, 1.8));
  return clean(g);
}

export const PROP_RADIUS = { pine: 0.55, roundTree: 0.6, boulder: 1.2, seastack: 7, hoodoo: 1.4, capsule: 2.2 };

const SWAYS = new Set(['pine', 'roundTree']);

export function buildPropAssets(shared) {
  const geos = { pine: pine(), roundTree: roundTree(), boulder: boulder(), seastack: seastack(), hoodoo: hoodoo(), capsule: capsule() };
  const mats = {};
  for (const k of Object.keys(geos)) {
    geos[k].computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: k === 'capsule' ? 0.7 : 0.95,
      metalness: 0,
      side: k === 'pine' ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (SWAYS.has(k)) {
      // Slow, wind-led sway that grows toward the crown.
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = shared.uTime;
        shader.uniforms.uWindDir = shared.uWindDir;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uWindDir;')
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vec3 tp = instanceMatrix[3].xyz;
            float bend = pow(max(position.y, 0.0) / 8.0, 2.0);
            float s = sin(uTime * 0.9 + tp.x * 0.13 + tp.z * 0.11) * 0.6 + sin(uTime * 2.1 + tp.x) * 0.15;
            vec2 windL = normalize((transpose(mat3(instanceMatrix)) * vec3(uWindDir.x, 0.0, uWindDir.y)).xz);
            transformed.xz += windL * (0.25 + s * 0.35) * bend;`,
          );
      };
    }
    addMist(mat, shared);
    mats[k] = mat;
  }
  return { geos, mats };
}
