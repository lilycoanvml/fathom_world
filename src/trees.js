import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise, mulberry32 } from './noise.js';
import { addMist } from './atmosphere.js';

// Vegetation built from textured cards (needle sprays, leaf clusters) around simple trunks,
// which reads far more naturally than solid cones and spheres. Distant trees use impostors:
// two crossed quads showing a pre-rendered picture of the full tree.

const N = makeNoise(97);

// ---------- Procedural foliage textures ----------

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// A conifer branch spray: a stem with side twigs, each covered in short needles.
function needleTexture(palette, seed) {
  const r = mulberry32(seed);
  const c = canvas(256, 128);
  const g = c.getContext('2d');
  const pick = () => palette[Math.floor(r() * palette.length)];
  g.lineCap = 'round';
  const needle = (x, y, a, len) => {
    g.strokeStyle = pick();
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  };
  const twig = (x0, y0, a, len, depth) => {
    const steps = Math.floor(len / 3);
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const x = x0 + Math.cos(a) * len * t, y = y0 + Math.sin(a) * len * t;
      const nl = 9 * (1 - t * 0.5);
      needle(x, y, a - 1.1 + (r() - 0.5) * 0.4, nl);
      needle(x, y, a + 1.1 + (r() - 0.5) * 0.4, nl);
      if (depth > 0 && i % 6 === 3 && t < 0.8) twig(x, y, a + (r() < 0.5 ? -0.75 : 0.75), len * (1 - t) * 0.55, depth - 1);
    }
  };
  g.strokeStyle = '#4a3c2c';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(4, 64);
  g.lineTo(250, 64);
  g.stroke();
  for (let i = 0; i < 9; i++) {
    const x = 10 + i * 26;
    const len = 50 * (1 - i / 11);
    twig(x, 64, -0.75 + (r() - 0.5) * 0.3, len, 1);
    twig(x + 10, 64, 0.75 + (r() - 0.5) * 0.3, len, 1);
  }
  twig(4, 64, 0, 250, 2);
  return toTexture(c);
}

// A cluster of broad leaves.
function leafTexture(palette, seed, { count = 160, size = 9, round = 0.55 } = {}) {
  const r = mulberry32(seed);
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 110;
    const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
    g.save();
    g.translate(x, y);
    g.rotate(r() * Math.PI * 2);
    g.fillStyle = palette[Math.floor(r() * palette.length)];
    const s = size * (0.7 + r() * 0.6);
    g.beginPath();
    g.ellipse(0, 0, s, s * round, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  return toTexture(c);
}

// A sword-fern frond: a rachis lined with tapering leaflets.
function fernTexture(palette, seed) {
  const r = mulberry32(seed);
  const c = canvas(256, 64);
  const g = c.getContext('2d');
  g.strokeStyle = '#3c4a26';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(2, 32);
  g.lineTo(254, 32);
  g.stroke();
  for (let x = 8; x < 250; x += 7) {
    const t = x / 256;
    const len = 26 * (1 - t * 0.85);
    for (const dir of [-1, 1]) {
      g.save();
      g.translate(x, 32);
      g.rotate(dir * (1.05 + (r() - 0.5) * 0.15));
      g.fillStyle = palette[Math.floor(r() * palette.length)];
      g.beginPath();
      g.ellipse(len / 2, 0, len / 2, 3.2 * (1 - t * 0.5), 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
  return toTexture(c);
}

// ---------- Geometry builders ----------

class CardBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
  }
  // Quad from base to tip, with half-widths at each end; normal and AO per corner.
  card(base, tip, side, wBase, wTip, normal, aoBase, aoTip) {
    const b0 = base.clone().addScaledVector(side, -wBase), b1 = base.clone().addScaledVector(side, wBase);
    const t0 = tip.clone().addScaledVector(side, -wTip), t1 = tip.clone().addScaledVector(side, wTip);
    const quad = [[b0, 0, 0, aoBase], [b1, 0, 1, aoBase], [t1, 1, 1, aoTip], [b0, 0, 0, aoBase], [t1, 1, 1, aoTip], [t0, 1, 0, aoTip]];
    for (const [p, u, v, ao] of quad) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(normal.x, normal.y, normal.z);
      this.uv.push(u, v);
      this.col.push(ao, ao, ao);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

function trunk(height, r0, r1, color, lean = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, height, 8, 4).translate(0, height / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + lean * (y / height) ** 2 * height * 0.1);
  }
  g.computeVertexNormals();
  const c = new THREE.Color(color);
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = 0.75 + 0.25 * Math.min(1, p.getY(i) / 3) + 0.1 * N.n(p.getX(i) * 3, p.getY(i) * 2);
    col.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g.toNonIndexed();
}

const UP = new THREE.Vector3(0, 1, 0);

function conifer({ height, radius, start, tiers, perTier, droop, profile, seed, spire = true }) {
  const r = mulberry32(seed);
  const b = new CardBuilder();
  for (let i = 0; i < tiers; i++) {
    const t = start + (1 - start) * (i / tiers);
    const y = height * t;
    const len = Math.max(0.5, radius * profile(t) * (0.85 + r() * 0.3));
    const off = r() * Math.PI * 2;
    for (let k = 0; k < perTier; k++) {
      const a = off + (k / perTier) * Math.PI * 2 + (r() - 0.5) * 0.5;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const base = new THREE.Vector3(0, y, 0);
      const tip = base.clone().addScaledVector(out, len).add(new THREE.Vector3(0, -droop * len * (0.6 + r() * 0.6), 0));
      const along = tip.clone().sub(base).normalize();
      const side = new THREE.Vector3().crossVectors(along, UP).normalize();
      const lift = new THREE.Vector3().crossVectors(side, along).normalize();
      const n = out.clone().multiplyScalar(0.8).addScaledVector(UP, 0.6).normalize();
      const w = Math.max(0.5, len * 0.5);
      const ao = 0.45 + 0.3 * t;
      b.card(base, tip, side, w * 0.4, w, n, ao, Math.min(1, ao + 0.5));
      b.card(base, tip, lift, w * 0.3, w * 0.7, n, ao, Math.min(1, ao + 0.45));
    }
  }
  if (spire) {
    for (const a of [0, Math.PI / 2]) {
      const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      b.card(new THREE.Vector3(0, height * 0.9, 0), new THREE.Vector3(0, height * 1.02, 0), side, 0.5, 0.1, UP, 0.8, 1);
    }
  }
  return b.geometry();
}

// Leaf cards scattered over one or more ellipsoid clumps.
function crown({ clumps, cards, size, seed }) {
  const r = mulberry32(seed);
  const b = new CardBuilder();
  for (let i = 0; i < cards; i++) {
    const c = clumps[Math.floor(r() * clumps.length)];
    const dir = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
    const d = 0.55 + r() * 0.45;
    const p = new THREE.Vector3(c.x + dir.x * c.rx * d, c.y + dir.y * c.ry * d, c.z + dir.z * c.rx * d);
    const s = size * (0.7 + r() * 0.6);
    const side = new THREE.Vector3(r() * 2 - 1, (r() - 0.5) * 0.6, r() * 2 - 1).normalize();
    const along = new THREE.Vector3().crossVectors(side, dir).normalize();
    const n = dir.clone().addScaledVector(UP, 0.4).normalize();
    const ao = 0.5 + 0.5 * THREE.MathUtils.clamp(0.5 + dir.y * 0.5, 0, 1) * d;
    b.card(p.clone().addScaledVector(along, -s / 2), p.clone().addScaledVector(along, s / 2), side, s / 2, s / 2, n, ao, ao);
  }
  return b.geometry();
}

function boulder() {
  let g = new THREE.IcosahedronGeometry(1, 3);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 1 + 0.25 * N.n(v.x * 0.9 + 7, v.y * 0.9 + v.z * 0.6 - 7) + 0.07 * N.n(v.x * 3.1, v.z * 3.1 + v.y);
    v.multiplyScalar(d);
    p.setXYZ(i, v.x * 1.4, v.y * 0.75, v.z * 1.1);
  }
  g.computeVertexNormals();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = 0.6 + 0.45 * THREE.MathUtils.smoothstep(p.getY(i), -0.6, 0.7);
    col.set([k, k, k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2));
  return g.toNonIndexed();
}

function fern(seed) {
  const r = mulberry32(seed);
  const b = new CardBuilder();
  const fronds = 13;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + r() * 0.4;
    const len = 0.9 + r() * 0.5;
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const base = new THREE.Vector3(0, 0.08, 0);
    const tip = out.clone().multiplyScalar(len).add(new THREE.Vector3(0, 0.35 + r() * 0.35, 0));
    const side = new THREE.Vector3().crossVectors(tip.clone().sub(base).normalize(), UP).normalize();
    const n = out.clone().multiplyScalar(0.5).addScaledVector(UP, 0.8).normalize();
    b.card(base, tip, side, 0.12, 0.08, n, 0.55, 1);
  }
  return b.geometry();
}

// ---------- Species ----------

const FIR_NEEDLES = ['#24361f', '#2c4226', '#35502c', '#3f5c33', '#4a6a3a'];
const SPRUCE_NEEDLES = ['#283a33', '#2f4639', '#385241', '#40594a'];
const PINE_NEEDLES = ['#3a4f2a', '#46602f', '#526d36', '#5d783d'];
const REDWOOD_NEEDLES = ['#26391f', '#2f4524', '#38532b', '#40602f'];

const SPECIES = {
  fir: () => ({
    bark: trunk(30, 0.55, 0.12, '#4d3d31'),
    foliage: conifer({ height: 30, radius: 5.4, start: 0.25, tiers: 24, perTier: 8, droop: 0.32, seed: 1, profile: (t) => Math.pow(1 - t, 0.9) + 0.06 }),
    tex: needleTexture(FIR_NEEDLES, 11),
    radius: 0.7,
  }),
  spruce: () => ({
    bark: trunk(20, 0.4, 0.1, '#4b4038'),
    foliage: conifer({ height: 20, radius: 3.1, start: 0.06, tiers: 24, perTier: 8, droop: 0.45, seed: 2, profile: (t) => Math.pow(1 - t, 1.05) + 0.05 }),
    tex: needleTexture(SPRUCE_NEEDLES, 12),
    radius: 0.5,
  }),
  pine: () => ({
    bark: trunk(18, 0.42, 0.14, '#6d4a34'),
    foliage: conifer({ height: 18, radius: 3.8, start: 0.45, tiers: 13, perTier: 7, droop: 0.12, seed: 3, profile: (t) => 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, (t - 0.4) / 0.6)) }),
    tex: needleTexture(PINE_NEEDLES, 13),
    radius: 0.5,
  }),
  redwood: () => ({
    bark: trunk(38, 1.0, 0.25, '#6e3b2a'),
    foliage: conifer({ height: 38, radius: 4.6, start: 0.3, tiers: 26, perTier: 8, droop: 0.22, seed: 4, profile: (t) => 0.35 + 0.65 * Math.pow(1 - t, 0.8) }),
    tex: needleTexture(REDWOOD_NEEDLES, 14),
    radius: 1.1,
  }),
  aspen: () => ({
    bark: trunk(11, 0.18, 0.08, '#d9d6cc'),
    foliage: crown({ clumps: [{ x: 0, y: 8.2, z: 0, rx: 1.9, ry: 2.6 }, { x: 0.4, y: 6.4, z: 0.2, rx: 1.6, ry: 1.6 }], cards: 70, size: 1.3, seed: 5 }),
    tex: leafTexture(['#d9b13b', '#e6c24a', '#c99a2c', '#b9b046', '#9fa83f'], 15, { size: 8, round: 0.8 }),
    radius: 0.3,
  }),
  oak: () => ({
    bark: trunk(4.2, 0.45, 0.25, '#4f4639', 1),
    foliage: crown({
      clumps: [{ x: 0, y: 6.2, z: 0, rx: 4.2, ry: 2.6 }, { x: 2.6, y: 5.2, z: 1.0, rx: 2.6, ry: 1.9 }, { x: -2.3, y: 5.4, z: -1.2, rx: 2.6, ry: 2.0 }, { x: 0.3, y: 7.6, z: 0.6, rx: 2.4, ry: 1.6 }],
      cards: 170, size: 1.9, seed: 6,
    }),
    tex: leafTexture(['#465a2c', '#52683a', '#5d7240', '#3e5228', '#6a7a46'], 16, { size: 7, round: 0.5 }),
    radius: 0.6,
  }),
  cypress: () => ({
    bark: trunk(5, 0.5, 0.25, '#4a3e34', 2),
    foliage: crown({
      clumps: [{ x: 1.4, y: 7.0, z: 0, rx: 5.2, ry: 1.5 }, { x: -1.6, y: 6.2, z: 0.8, rx: 3.4, ry: 1.4 }, { x: 0.6, y: 5.0, z: -1.2, rx: 3.0, ry: 1.2 }],
      cards: 150, size: 2.0, seed: 7,
    }),
    tex: leafTexture(['#2c3d28', '#34482f', '#3d5434', '#2a3a2a'], 17, { count: 260, size: 6, round: 0.45 }),
    radius: 0.6,
  }),
  fern: () => ({
    bark: null,
    foliage: fern(9),
    tex: fernTexture(['#3f5a2a', '#4a6830', '#567536', '#3a5226'], 19),
    radius: 0,
  }),
  scrub: () => ({
    bark: null,
    foliage: crown({ clumps: [{ x: 0, y: 0.7, z: 0, rx: 1.4, ry: 0.85 }, { x: 0.8, y: 0.5, z: 0.4, rx: 0.9, ry: 0.6 }], cards: 34, size: 1.1, seed: 8 }),
    tex: leafTexture(['#5d6544', '#6b7350', '#4f5a3c', '#7a7a55', '#8a7f58'], 18, { count: 220, size: 6, round: 0.6 }),
    radius: 0.9,
  }),
};

// ---------- Materials ----------

function swayPatch(mat, shared, strength) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uWindDir = shared.uWindDir;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uWindDir;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
        vec3 tp = instanceMatrix[3].xyz;
        vec2 windL = normalize((transpose(mat3(instanceMatrix)) * vec3(uWindDir.x, 0.0, uWindDir.y)).xz);
        #else
        vec3 tp = vec3(0.0);
        vec2 windL = uWindDir;
        #endif
        float bend = pow(max(position.y, 0.0) / 20.0, 2.0) * ${strength.toFixed(2)};
        float s = sin(uTime * 0.8 + tp.x * 0.13 + tp.z * 0.11) * 0.6 + sin(uTime * 2.3 + tp.x + position.y) * 0.12;
        transformed.xz += windL * (0.3 + s * 0.5) * bend;`,
      );
    // Foliage cards carry soft "volume" normals; don't flip them on back faces.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
  };
}

function foliageMaterial(tex, shared, strength = 1) {
  const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85 });
  swayPatch(m, shared, strength);
  addMist(m, shared);
  return m;
}

function barkMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  addMist(m, shared);
  return m;
}

// Renders a tree to a texture once, for use on distant impostor cards.
function bakeImpostor(renderer, geo, mats) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 1.04;
  const h = (bb.max.y - Math.min(0, bb.min.y)) * 1.02;
  const rt = new THREE.WebGLRenderTarget(256, Math.min(512, Math.round(256 * (h / w))), { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const scene = new THREE.Scene();
  const basic = mats.map((m) => new THREE.MeshBasicMaterial({ map: m.map, alphaTest: m.alphaTest, vertexColors: true, side: THREE.DoubleSide, color: m.map ? 0xffffff : 0xffffff }));
  const mesh = new THREE.Mesh(geo, basic);
  scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h, 0, -100, 100);
  cam.position.set(0, 0, 50);
  cam.lookAt(0, 0, 0);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x2c3a26, 0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  basic.forEach((m) => m.dispose());

  const b = new CardBuilder();
  const n0 = new THREE.Vector3(0, 0.75, 0.66).normalize();
  b.card(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, h, 0), new THREE.Vector3(1, 0, 0), w / 2, w / 2, n0, 1, 1);
  b.card(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, h, 0), new THREE.Vector3(0, 0, 1), w / 2, w / 2, n0, 1, 1);
  const g = b.geometry();
  // Card UVs run base->tip along u; impostor texture wants x across, y up.
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
  return { geo: g, texture: rt.texture };
}

export const VEG_RADIUS = { boulder: 1.3 };

export function buildVegetation(renderer, shared) {
  const out = { full: {}, impostor: {}, radius: { ...VEG_RADIUS } };
  const bark = barkMaterial(shared);
  for (const [type, make] of Object.entries(SPECIES)) {
    const s = make();
    const strength = type === 'scrub' || type === 'fern' ? 0.2 : 1;
    const foliage = foliageMaterial(s.tex, shared, strength);
    let geo;
    if (s.bark) {
      geo = mergeGeometries([s.bark, s.foliage], true); // groups: 0 bark, 1 foliage
    } else {
      geo = s.foliage;
      geo.addGroup(0, geo.attributes.position.count, 1);
    }
    geo.computeBoundingSphere();
    const mats = [bark, foliage];
    out.full[type] = { geo, mats };
    const imp = bakeImpostor(renderer, geo, mats);
    const impMat = foliageMaterial(imp.texture, shared, strength * 0.6);
    impMat.alphaTest = 0.5;
    imp.geo.computeBoundingSphere();
    out.impostor[type] = { geo: imp.geo, mats: impMat };
    out.radius[type] = s.radius;
  }
  const rock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  addMist(rock, shared);
  const rg = boulder();
  rg.computeBoundingSphere();
  out.full.boulder = { geo: rg, mats: rock };
  return out;
}
