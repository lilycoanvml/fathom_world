import * as THREE from 'three';
import { BIOMES, GROUP_BIOMES } from './biomes.js';
import { makeNoise, hash2 } from './noise.js';
import { buildVegetation } from './trees.js';
import { Portals } from './portals.js';
import { addMist } from './atmosphere.js';
import { loadHeightfield } from './terrainData.js';

const CHUNK = 64;
const SEG = 32;
const RADIUS = 6; // chunks of detailed terrain around the viewer
const TREE_FULL = 3; // chunks within which trees are fully modelled (impostors beyond)
const PORTAL_CHANCE = 0.17;
const PORTAL_CLEARING = 9;
const VIEW_CLEARING = 110; // metres of open ground ahead of an overlook arrival
const MID = { cells: 192, spacing: 60, rebuild: 600, sinkInner: 290, sinkOuter: 360 };
const FAR = { cells: 220, sinkInner: 4700, sinkOuter: 5050 };
const GREY = new THREE.Color('#8a8784');

function prepareColors(biome) {
  const g = biome.ground;
  const c = (h) => new THREE.Color(h);
  return {
    stops: g.stops.map(([h, hex]) => [h, c(hex)]),
    sand: g.sand ? c(g.sand) : null,
    rock: c(g.rock),
    alt: c(g.alt),
    canopy: c(g.canopy),
    floor: c(g.canopy).lerp(c('#4a3f30'), 0.5),
    snow: g.snow ? { from: g.snow.from, color: c(g.snow.color) } : null,
  };
}

// Terrain material shared by all detail levels; LODs sink themselves beneath finer levels near the camera.
function terrainMaterial(shared, sink) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterLevel = shared.uWaterLevel;
    shader.uniforms.uTime = shared.uTime;
    let vs = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;');
    if (sink) {
      vs = vs.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
          float cd = length(wp.xz - cameraPosition.xz);
          transformed.y -= ${sink.depth.toFixed(1)} * (1.0 - smoothstep(${sink.inner.toFixed(1)}, ${sink.outer.toFixed(1)}, cd));
        }`,
      );
    }
    shader.vertexShader = vs.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        uniform float uWaterLevel;
        uniform float uTime;
        float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(tHash(i), tHash(i + vec2(1, 0)), f.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), f.x), f.y);
        }
        float tBump(vec2 p) { return tNoise(p * 0.7) * 0.6 + tNoise(p * 2.3) * 0.3 + tNoise(p * 6.1) * 0.1; }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float camD = length(vWPos - cameraPosition);
        float n1 = tNoise(vWPos.xz * 0.06);
        float n2 = mix(tNoise(vWPos.xz * 0.45), 0.5, smoothstep(50.0, 150.0, camD));
        float n3 = mix(tNoise(vWPos.xz * 2.7), 0.5, smoothstep(8.0, 35.0, camD));
        float n0 = tNoise(vWPos.xz * 0.004);
        diffuseColor.rgb *= 0.78 + 0.16 * n0 + 0.14 * n1 + 0.16 * n2 + 0.14 * n3;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.03, 0.88), smoothstep(0.45, 0.8, n1) * 0.8);
        float dirt = smoothstep(0.66, 0.78, tNoise(vWPos.xz * 0.035 + 17.0)) * smoothstep(0.3, 0.6, n2);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.84, 0.76, 0.64), dirt * 0.6);
        // Wet ground at the waterline, and a soft lapping foam line.
        float above = vWPos.y - uWaterLevel;
        diffuseColor.rgb *= mix(1.0, 0.6, smoothstep(0.8, 0.0, above) * step(-3.0, above));
        float lap = 0.06 * sin(uTime * 0.9 + vWPos.x * 0.15 + vWPos.z * 0.1);
        float foam = smoothstep(0.18, 0.0, abs(above - lap - 0.02)) * (0.55 + 0.45 * tNoise(vWPos.xz * 1.3 + uTime * 0.3));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.9), foam * 0.7);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          float e = 0.15;
          vec2 q = vWPos.xz;
          float b0 = tBump(q);
          vec3 bw = vec3(tBump(q + vec2(e, 0.0)) - b0, 0.0, tBump(q + vec2(0.0, e)) - b0) / e;
          float k = 0.35 * (1.0 - smoothstep(10.0, 60.0, length(vWPos - cameraPosition)));
          normal = normalize(normal - (viewMatrix * vec4(bw.x, 0.0, bw.z, 0.0)).xyz * k);
        }`,
      );
  };
  addMist(m, shared);
  const key = m.customProgramCacheKey();
  m.customProgramCacheKey = () => key + (sink ? `|sink${sink.inner}` : '|near');
  return m;
}

export class World {
  constructor(scene, shared, renderer) {
    this.scene = scene;
    this.shared = shared;
    this.chunks = new Map();
    this.propCache = new Map();
    this.veg = buildVegetation(renderer, shared);
    this.portals = new Portals(scene, shared);
    this.terrainMat = terrainMaterial(shared, null);
    this.midMat = terrainMaterial(shared, { depth: 60, inner: MID.sinkInner, outer: MID.sinkOuter });
    this.farMat = terrainMaterial(shared, { depth: 400, inner: FAR.sinkInner, outer: FAR.sinkOuter });
    this.index = this.buildIndex();
    this.tmpColor = new THREE.Color();
    this.mid = null;
    this.far = null;
    this.midCenter = new THREE.Vector2(Infinity, Infinity);
    this.extraPortals = [];
    this.clearings = [];
    this.lastViewpoint = null;
  }

  async setBiome(key) {
    const biome = BIOMES[key];
    const hf = await loadHeightfield(key, biome.region);
    this.clear();
    this.biomeKey = key;
    this.biome = biome;
    this.hf = hf;
    this.N = makeNoise(biome.seed);
    this.colors = prepareColors(biome);
    this.waterLevel = biome.water ? biome.water.level : -Infinity;
    this.buildFar();
  }

  prefetch(key) {
    loadHeightfield(key, BIOMES[key].region).catch(() => {});
  }

  clear() {
    for (const key of [...this.chunks.keys()]) this.removeChunk(key);
    this.portals.clear();
    this.propCache.clear();
    this.extraPortals = [];
    this.clearings = [];
    for (const m of [this.mid, this.far]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.mid = this.far = null;
    this.midCenter.set(Infinity, Infinity);
  }

  // Real elevation plus a little fine relief the source data is too coarse to hold.
  height(x, z) {
    const base = this.hf.sample(x, z);
    const dry = THREE.MathUtils.smoothstep(base - this.waterLevel, 0.5, 4);
    return base + (this.N.fbm(x / 38, z / 38, 3) * 1.1 + this.N.fbm(x / 7, z / 7, 2) * 0.18) * dry;
  }

  ground(x, z) {
    return Math.max(this.height(x, z), this.waterLevel);
  }

  slope(x, z, d = 1.5) {
    const hx = this.height(x + d, z) - this.height(x - d, z);
    const hz = this.height(x, z + d) - this.height(x, z - d);
    return Math.hypot(hx, hz) / (2 * d);
  }

  // How much lower this point sits than its surroundings (positive in valleys).
  valley(x, z, h) {
    const r = 70;
    const s = this.hf.sample(x + r, z) + this.hf.sample(x - r, z) + this.hf.sample(x, z + r) + this.hf.sample(x, z - r);
    return s / 4 - h;
  }

  // 0..1 suitability of a point for one ecology entry.
  habitat(def, x, z, h, slope) {
    const [lo, hi] = def.elev;
    const band = Math.min(THREE.MathUtils.smoothstep(h, lo, lo + 60), 1 - THREE.MathUtils.smoothstep(h, hi - 80, hi));
    if (band <= 0) return 0;
    if (def.maxSlope !== undefined && slope > def.maxSlope) return 0;
    if (def.minSlope !== undefined && slope < def.minSlope) return 0;
    if (h < this.waterLevel + 0.6 && def.type !== 'boulder') return 0;
    let k = band;
    if (def.mask) k *= THREE.MathUtils.smoothstep(this.N.fbm(x * def.mask.freq + 40, z * def.mask.freq - 40, 3), def.mask.min, def.mask.min + 0.25);
    if (def.valley) k *= THREE.MathUtils.smoothstep(this.valley(x, z, h), def.valley * 0.4, def.valley);
    return k;
  }

  // Tree cover used to tint distant terrain so far-off forests read as forests.
  canopy(x, z, h, slope) {
    let k = 0;
    for (const def of this.biome.ecology) {
      if (def.type === 'boulder' || def.type === 'scrub' || def.type === 'fern') continue;
      k = Math.max(k, this.habitat(def, x, z, h, slope) * Math.min(1, def.density * 1.3));
    }
    return k;
  }

  // ---------- Deterministic content ----------

  portalFor(cx, cz) {
    const seed = this.biome.seed * 131;
    if (hash2(cx, cz, seed) > PORTAL_CHANCE) return null;
    const x = cx * CHUNK + 10 + hash2(cx, cz, seed + 1) * (CHUNK - 20);
    const z = cz * CHUNK + 10 + hash2(cx, cz, seed + 2) * (CHUNK - 20);
    const yaw = hash2(cx, cz, seed + 3) * Math.PI * 2;
    const vertical = hash2(cx, cz, seed + 4) < 0.4;
    const k = hash2(cx, cz, seed + 5);
    let w, h;
    if (vertical) {
      w = 4 + k * 1.8;
      h = w * (1.9 + hash2(cx, cz, seed + 6) * 0.7);
    } else {
      h = 5 + k * 2.4;
      w = h * (1.9 + hash2(cx, cz, seed + 6) * 0.8);
    }
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let minH = Infinity, maxH = -Infinity;
    for (const t of [-0.5, -0.25, 0, 0.25, 0.5]) {
      const gh = this.height(x + c * w * t, z - s * w * t);
      minH = Math.min(minH, gh);
      maxH = Math.max(maxH, gh);
    }
    if (minH < this.waterLevel + 0.6) return null;
    if (maxH - minH > Math.min(3, h * 0.35)) return null;

    const colorIdx = Math.floor(hash2(cx, cz, seed + 7) * 3) % 3;
    const options = GROUP_BIOMES[colorIdx];
    let dest = options[hash2(cx, cz, seed + 8) < 0.5 ? 0 : 1];
    if (dest === this.biomeKey) dest = options.find((b) => b !== this.biomeKey);
    return { key: `${cx},${cz}`, x, z, yaw, w, h, depth: 0.9, baseY: minH - 0.35, colorIdx, dest };
  }

  nearbyPortals(cx, cz) {
    const out = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const p = this.portalFor(cx + dx, cz + dz);
        if (p) out.push(p);
      }
    return out.concat(this.extraPortals);
  }

  propsFor(cx, cz) {
    const key = `${cx},${cz}`;
    const cached = this.propCache.get(key);
    if (cached) return cached;
    const list = [];
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const portals = this.nearbyPortals(cx, cz);
    const seedBase = this.biome.seed * 7919;
    const rockTint = new THREE.Color(this.biome.ground.rock);
    this.biome.ecology.forEach((def, ti) => {
      const sp = def.spacing;
      const seed = seedBase + ti * 101;
      for (let gz = Math.ceil(z0 / sp); gz * sp < z0 + CHUNK; gz++)
        for (let gx = Math.ceil(x0 / sp); gx * sp < x0 + CHUNK; gx++) {
          if (hash2(gx, gz, seed) > def.density) continue;
          const x = (gx + 0.1 + hash2(gx, gz, seed + 1) * 0.8) * sp;
          const z = (gz + 0.1 + hash2(gx, gz, seed + 2) * 0.8) * sp;
          const h = this.height(x, z);
          const k = this.habitat(def, x, z, h, this.slope(x, z));
          if (hash2(gx, gz, seed + 6) > k) continue;
          let blocked = false;
          for (const p of portals) {
            if (Math.hypot(x - p.x, z - p.z) < Math.max(p.w, p.h) / 2 + PORTAL_CLEARING) { blocked = true; break; }
          }
          if (blocked) continue;
          if (def.type !== 'fern' && def.type !== 'boulder' && this.inClearing(x, z)) continue;
          const r = hash2(gx, gz, seed + 3);
          const s = def.type === 'boulder' ? 0.5 + r * 1.8 : def.type === 'fern' ? 0.7 + r * 0.6 : (0.55 + r * 0.6) * (0.75 + 0.25 * k);
          const shade = 0.85 + hash2(gx, gz, seed + 5) * 0.25;
          list.push({
            type: def.type,
            x, z,
            y: h - (def.type === 'boulder' ? 0.3 * s : 0.2),
            s,
            rot: hash2(gx, gz, seed + 4) * Math.PI * 2,
            tint: def.type === 'boulder' ? rockTint.clone().lerp(GREY, 0.45).multiplyScalar(shade * 1.2) : new THREE.Color(shade, shade, shade * 0.97),
            r: (this.veg.radius[def.type] ?? 0.5) * s,
          });
        }
    });
    if (this.propCache.size > 800) this.propCache.clear();
    this.propCache.set(key, list);
    return list;
  }

  // ---------- Terrain meshes ----------

  buildIndex(seg = SEG) {
    const idx = [];
    const row = seg + 1;
    for (let j = 0; j < seg; j++)
      for (let i = 0; i < seg; i++) {
        const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    return (seg + 1) * (seg + 1) < 65536 ? new Uint16Array(idx) : new Uint32Array(idx);
  }

  groundColor(x, z, h, slope, out, lod = false) {
    const C = this.colors;
    const stops = C.stops;
    out.copy(stops[0][1]);
    for (let i = 1; i < stops.length; i++) {
      const t = THREE.MathUtils.clamp((h - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]), 0, 1);
      if (h > stops[i - 1][0]) out.lerp(stops[i][1], t);
    }
    out.lerp(C.alt, 0.35 * THREE.MathUtils.smoothstep(this.N.fbm(x / 160, z / 160, 2), -0.1, 0.5));
    // Forest: far away, the canopy itself; up close, the darker forest floor under real trees.
    const canopy = this.canopy(x, z, h, slope);
    if (canopy > 0) out.lerp(lod ? C.canopy : C.floor, canopy * (lod ? 0.85 : 0.45));
    out.lerp(C.rock, THREE.MathUtils.smoothstep(slope, 0.6, 1.1));
    if (C.sand) out.lerp(C.sand, 1 - THREE.MathUtils.smoothstep(h, this.waterLevel + 0.8, this.waterLevel + 3));
    if (C.snow) {
      const line = C.snow.from + this.N.fbm(x / 120, z / 120, 3) * 90;
      out.lerp(C.snow.color, THREE.MathUtils.smoothstep(h, line, line + 40) * (1 - THREE.MathUtils.smoothstep(slope, 0.9, 1.4)));
    }
    if (h < this.waterLevel) out.multiplyScalar(0.7);
    out.multiplyScalar(1 + this.N.fbm(x / 14, z / 14, 2) * 0.1);
    return out;
  }

  // A grid mesh in world coordinates, sampled by `heightAt`.
  gridMesh(x0, z0, size, cells, heightAt, material) {
    const step = size / cells;
    const n = cells + 1;
    const G = n + 2;
    const hs = new Float32Array(G * G);
    for (let j = 0; j < G; j++)
      for (let i = 0; i < G; i++) hs[j * G + i] = heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
    const pos = new Float32Array(n * n * 3);
    const nor = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const c = this.tmpColor;
    let k = 0;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++, k++) {
        const gi = i + 1, gj = j + 1;
        const h = hs[gj * G + gi];
        const dx = (hs[gj * G + gi + 1] - hs[gj * G + gi - 1]) / (2 * step);
        const dz = (hs[(gj + 1) * G + gi] - hs[(gj - 1) * G + gi]) / (2 * step);
        const inv = 1 / Math.hypot(dx, 1, dz);
        const x = x0 + i * step, z = z0 + j * step;
        pos.set([x, h, z], k * 3);
        nor.set([-dx * inv, inv, -dz * inv], k * 3);
        this.groundColor(x, z, h, Math.hypot(dx, dz), c, true);
        col.set([c.r, c.g, c.b], k * 3);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(this.buildIndex(cells), 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    return mesh;
  }

  // The real horizon: ~100 km of coarse terrain around the area.
  buildFar() {
    const b = this.hf.farBounds();
    this.far = this.gridMesh(b.x0, b.z0, b.size, FAR.cells, (x, z) => this.hf.sampleFar(x, z), this.farMat);
    this.far.renderOrder = -2;
    this.scene.add(this.far);
  }

  // Mid-distance ring (~6 km) from the detailed data, re-centred as the viewer travels.
  updateMid(px, pz) {
    if (Math.hypot(px - this.midCenter.x, pz - this.midCenter.y) < MID.rebuild) return;
    const s = MID.spacing * 4;
    const cx = Math.round(px / s) * s, cz = Math.round(pz / s) * s;
    this.midCenter.set(cx, cz);
    const size = MID.cells * MID.spacing;
    const mesh = this.gridMesh(cx - size / 2, cz - size / 2, size, MID.cells, (x, z) => this.hf.sample(x, z), this.midMat);
    mesh.renderOrder = -1;
    if (this.mid) {
      this.scene.remove(this.mid);
      this.mid.geometry.dispose();
    }
    this.mid = mesh;
    this.scene.add(mesh);
  }

  buildChunk(cx, cz) {
    const step = CHUNK / SEG;
    const G = SEG + 3;
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const hs = new Float32Array(G * G);
    for (let j = 0; j < G; j++)
      for (let i = 0; i < G; i++) hs[j * G + i] = this.height(x0 + (i - 1) * step, z0 + (j - 1) * step);

    const count = (SEG + 1) * (SEG + 1);
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const colr = new Float32Array(count * 3);
    const c = this.tmpColor;
    let k = 0;
    for (let j = 0; j <= SEG; j++)
      for (let i = 0; i <= SEG; i++, k++) {
        const gi = i + 1, gj = j + 1;
        const h = hs[gj * G + gi];
        const dx = (hs[gj * G + gi + 1] - hs[gj * G + gi - 1]) / (2 * step);
        const dz = (hs[(gj + 1) * G + gi] - hs[(gj - 1) * G + gi]) / (2 * step);
        const inv = 1 / Math.hypot(dx, 1, dz);
        pos.set([i * step, h, j * step], k * 3);
        nor.set([-dx * inv, inv, -dz * inv], k * 3);
        this.groundColor(x0 + i * step, z0 + j * step, h, Math.hypot(dx, dz), c);
        colr.set([c.r, c.g, c.b], k * 3);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    geo.setIndex(new THREE.BufferAttribute(this.index.slice(), 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.position.set(x0, 0, z0);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.scene.add(mesh);

    const props = this.propsFor(cx, cz);
    const byType = new Map();
    for (const p of props) {
      if (!byType.has(p.type)) byType.set(p.type, []);
      byType.get(p.type).push(p);
    }
    const full = [];
    const impostors = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const make = (asset, list) => {
      const im = new THREE.InstancedMesh(asset.geo, asset.mats, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        m.compose(v.set(p.x, p.y, p.z), q, sc.set(p.s, p.s, p.s));
        im.setMatrixAt(i, m);
        im.setColorAt(i, p.tint);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.scene.add(im);
      return im;
    };
    for (const [type, list] of byType) {
      const im = make(this.veg.full[type], list);
      // Ground cover only exists up close; it vanishes rather than becoming an impostor.
      im.userData.ground = type === 'fern';
      full.push(im);
      if (this.veg.impostor[type] && type !== 'fern') impostors.push(make(this.veg.impostor[type], list));
    }

    const pdef = this.portalFor(cx, cz);
    const portal = pdef ? this.portals.create(pdef) : null;
    this.chunks.set(`${cx},${cz}`, { cx, cz, mesh, full, impostors, props, portal, near: null });
  }

  removeChunk(key) {
    const ch = this.chunks.get(key);
    if (!ch) return;
    this.scene.remove(ch.mesh);
    ch.mesh.geometry.dispose();
    for (const im of [...ch.full, ...ch.impostors]) {
      this.scene.remove(im);
      im.dispose();
    }
    if (ch.portal) this.portals.remove(ch.portal.key);
    this.chunks.delete(key);
  }

  // Streams chunks around the viewer. budgetMs < 0 builds everything now.
  update(px, pz, budgetMs = 4) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const missing = [];
    for (let dz = -RADIUS; dz <= RADIUS; dz++)
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        if (dx * dx + dz * dz > (RADIUS + 0.5) * (RADIUS + 0.5)) continue;
        const cx = pcx + dx, cz = pcz + dz;
        if (!this.chunks.has(`${cx},${cz}`)) missing.push([cx, cz, dx * dx + dz * dz]);
      }
    missing.sort((a, b) => a[2] - b[2]);
    const start = performance.now();
    for (const [cx, cz] of missing) {
      this.buildChunk(cx, cz);
      if (budgetMs >= 0 && performance.now() - start > budgetMs) break;
    }
    const keep = (RADIUS + 1.5) * (RADIUS + 1.5);
    const boulderGeo = this.veg.full.boulder.geo;
    for (const [key, ch] of this.chunks) {
      const dx = ch.cx - pcx, dz = ch.cz - pcz;
      const d2 = dx * dx + dz * dz;
      if (d2 > keep) {
        this.removeChunk(key);
        continue;
      }
      // Full trees nearby, impostor cards further out.
      const near = d2 <= TREE_FULL * TREE_FULL + 1;
      if (ch.near !== near) {
        ch.near = near;
        ch.full.forEach((im) => (im.visible = near || (im.geometry === boulderGeo && !im.userData.ground)));
        ch.impostors.forEach((im) => (im.visible = !near));
      }
    }
    this.updateMid(px, pz);
  }

  collide(x, z, r) {
    const pcx = Math.floor(x / CHUNK), pcz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const ch = this.chunks.get(`${pcx + dx},${pcz + dz}`);
        if (!ch) continue;
        for (const p of ch.props) {
          if (p.type === 'scrub' || p.type === 'fern') continue;
          const ox = x - p.x, oz = z - p.z;
          const min = p.r + r;
          const d2 = ox * ox + oz * oz;
          if (d2 < min * min && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            x = p.x + (ox / d) * min;
            z = p.z + (oz / d) * min;
          }
        }
      }
    return [x, z];
  }

  // ---------- Spawning ----------

  // Real overlooks are open ground: no trees in a cone along the arrival sightline.
  inClearing(x, z) {
    for (const c of this.clearings) {
      const ox = x - c.x, oz = z - c.z;
      const along = ox * c.fx + oz * c.fz;
      if (along < -14 || along > c.len) continue;
      if (Math.abs(ox * c.fz - oz * c.fx) < 12 + Math.max(0, along) * 0.4) return true;
    }
    return false;
  }

  isSpawnSafe(x, z) {
    const h = this.height(x, z);
    if (h < this.waterLevel + 0.8) return false;
    if (this.slope(x, z, 3) > 0.35) return false;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        for (const p of this.propsFor(cx + dx, cz + dz)) {
          if (p.type !== 'fern' && Math.hypot(x - p.x, z - p.z) < p.r + 2.5) return false;
        }
      }
    for (const p of this.nearbyPortals(cx, cz)) {
      if (Math.hypot(x - p.x, z - p.z) < Math.max(p.w, p.h) / 2 + 3) return false;
    }
    return true;
  }

  hasView(x, z, p) {
    const eye = this.ground(x, z) + 1.7;
    const target = p.baseY + p.h * 0.3;
    for (let t = 0.1; t < 0.95; t += 0.1) {
      const hx = x + (p.x - x) * t, hz = z + (p.z - z) * t;
      if (this.height(hx, hz) > eye + (target - eye) * t - 0.3) return false;
    }
    return true;
  }

  clearPath(x, z, p) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const pcx = Math.floor(p.x / CHUNK), pcz = Math.floor(p.z / CHUNK);
    const lx = p.x - x, lz = p.z - z;
    const len2 = lx * lx + lz * lz;
    for (let gz = Math.min(cz, pcz) - 1; gz <= Math.max(cz, pcz) + 1; gz++)
      for (let gx = Math.min(cx, pcx) - 1; gx <= Math.max(cx, pcx) + 1; gx++)
        for (const o of this.propsFor(gx, gz)) {
          if (o.type === 'fern') continue;
          const t = THREE.MathUtils.clamp(((o.x - x) * lx + (o.z - z) * lz) / len2, 0, 1);
          if (Math.hypot(x + lx * t - o.x, z + lz * t - o.z) < o.r + 1.5) return false;
        }
    return true;
  }

  // Open views make arrivals feel like discoveries: favour spots that see far.
  openness(x, z, yaw) {
    const eye = this.ground(x, z) + 1.7;
    let open = 0;
    for (const da of [-0.5, 0, 0.5])
      for (const d of [80, 200, 450]) {
        const a = yaw + da;
        if (this.hf.sample(x - Math.sin(a) * d, z - Math.cos(a) * d) < eye + d * 0.02) open++;
      }
    return open / 9;
  }

  spawnNear(ax, az, strict = false) {
    const ccx = Math.floor(ax / CHUNK), ccz = Math.floor(az / CHUNK);
    for (let r = 0; r <= 5; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const p = this.portalFor(ccx + dx, ccz + dz);
          if (!p) continue;
          for (const side of [1, -1])
            for (const d of [26, 32, 20, 38]) {
              const nx = Math.sin(p.yaw) * side, nz = Math.cos(p.yaw) * side;
              const x = p.x + nx * d, z = p.z + nz * d;
              if (!this.isSpawnSafe(x, z) || !this.hasView(x, z, p)) continue;
              const yaw = Math.atan2(nx, nz);
              if (strict && (!this.clearPath(x, z, p) || this.openness(x, z, yaw) < 0.5)) continue;
              return { x, z, yaw };
            }
        }
    return null;
  }

  fallbackSpawn(rand) {
    const half = this.hf.size * 0.35;
    for (let i = 0; i < 600; i++) {
      const x = (rand() * 2 - 1) * half, z = (rand() * 2 - 1) * half;
      if (this.isSpawnSafe(x, z)) return { x, z, yaw: rand() * Math.PI * 2 };
    }
    return { x: 0, z: 0, yaw: 0 };
  }

  // A portal standing just off to the side of an arrival view.
  arrivalPortal(x, z, yaw, rand) {
    for (const d of [26, 32, 22, 38])
      for (const side of [0.5, -0.5, 0.8, -0.8]) {
        const a = yaw + side;
        const px = x - Math.sin(a) * d, pz = z - Math.cos(a) * d;
        const pyaw = Math.atan2(x - px, z - pz);
        const vertical = rand() < 0.4;
        const k = rand();
        const w = vertical ? 4 + k * 1.8 : (5 + k * 2.4) * (1.9 + rand() * 0.8);
        const h = vertical ? w * (1.9 + rand() * 0.7) : w / (1.9 + rand() * 0.8);
        const c = Math.cos(pyaw), s = Math.sin(pyaw);
        let minH = Infinity, maxH = -Infinity;
        for (const t of [-0.5, -0.25, 0, 0.25, 0.5]) {
          const gh = this.height(px + c * w * t, pz - s * w * t);
          minH = Math.min(minH, gh);
          maxH = Math.max(maxH, gh);
        }
        if (minH < this.waterLevel + 0.6 || maxH - minH > Math.min(3, h * 0.35)) continue;
        const colorIdx = Math.floor(rand() * 3) % 3;
        const options = GROUP_BIOMES[colorIdx];
        const dest = options.find((b) => b !== this.biomeKey && rand() < 0.5) ?? options.find((b) => b !== this.biomeKey);
        return { key: 'arrival', x: px, z: pz, yaw: pyaw, w, h, depth: 0.9, baseY: minH - 0.35, colorIdx, dest };
      }
    return null;
  }

  // Whether the eye sees a point over terrain (and forest canopy beyond the overlook clearing).
  // Samples at growing distances so a hill right in front counts as much as a ridge far off.
  sightline(x, z, eye, fx, fz, dist, top) {
    let seen = 0, n = 0;
    for (let d = 12; d < dist * 0.97; d *= 1.15, n++) {
      const px = x + fx * d, pz = z + fz * d;
      const h = d < 6000 ? this.hf.sample(px, pz) : this.hf.sampleFar(px, pz);
      const canopy = d > VIEW_CLEARING ? 30 * this.canopy(px, pz, h, this.slope(px, pz)) : 0;
      if (h + canopy < eye + ((top - eye) * d) / dist) seen++;
    }
    return n ? seen / n : 1;
  }

  // How well a spot sees its target: a clear sightline to the target's summit (mountains),
  // the ground on the way there in view (lakes, valleys, coast), and land falling away ahead.
  viewScore(x, z, yaw, tx, tz) {
    const eye = this.ground(x, z) + 1.7;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const dist = Math.hypot(tx - x, tz - z);
    const surface = (d) => {
      const px = x + fx * d, pz = z + fz * d;
      return Math.max(d < 6000 ? this.hf.sample(px, pz) : this.hf.sampleFar(px, pz), this.waterLevel) + 1;
    };
    let score = this.sightline(x, z, eye, fx, fz, dist, surface(dist) + 1) * 4;
    for (const f of [0.15, 0.35, 0.6]) {
      const d = dist * f;
      if (d > 60 && this.sightline(x, z, eye, fx, fz, d, surface(d)) > 0.97) score += 0.6;
    }
    for (const d of [40, 80, 150, 300, 600]) {
      if (this.hf.sample(x + fx * d, z + fz * d) < eye - d * 0.01) score += 0.2;
    }
    return score;
  }

  // Arrive at a real overlook, facing what it's famous for.
  viewpointSpawn(rand) {
    const vps = [...(this.hf.region.viewpoints ?? [])].sort(() => rand() - 0.5);
    vps.sort((a, b) => (a.name === this.lastViewpoint) - (b.name === this.lastViewpoint));
    for (const vp of vps) {
      const [vx, vz] = this.hf.fromLatLon(vp.at[0], vp.at[1]);
      const [tx, tz] = this.hf.fromLatLon(vp.look[0], vp.look[1]);
      const spots = [];
      for (let r = 0; r <= 250; r += 12)
        for (let i = 0; i < (r ? 16 : 1); i++) {
          const a = (i / 16) * Math.PI * 2 + r;
          const x = vx + Math.cos(a) * r, z = vz + Math.sin(a) * r;
          if (!this.isSpawnSafe(x, z)) continue;
          const yaw = Math.atan2(-(tx - x), -(tz - z));
          spots.push({ x, z, yaw, score: this.viewScore(x, z, yaw, tx, tz) - r / 500 });
        }
      spots.sort((a, b) => b.score - a.score);
      for (const s of spots.slice(0, 12)) {
        if (s.score < 4.6) break; // no real view from here; try the next overlook
        const portal = this.arrivalPortal(s.x, s.z, s.yaw, rand);
        if (!portal) continue;
        this.extraPortals = [portal];
        this.clearings = [{ x: s.x, z: s.z, fx: -Math.sin(s.yaw), fz: -Math.cos(s.yaw), len: VIEW_CLEARING }];
        this.propCache.clear();
        this.portals.create(portal);
        this.lastViewpoint = vp.name;
        return { x: s.x, z: s.z, yaw: s.yaw, name: vp.name };
      }
    }
    return null;
  }

  findSpawn(rand) {
    const vp = this.viewpointSpawn(rand);
    if (vp) return vp;
    const half = this.hf.size * 0.35;
    for (let attempt = 0; attempt < 24; attempt++) {
      const ax = (rand() * 2 - 1) * half, az = (rand() * 2 - 1) * half;
      const s = this.spawnNear(ax, az, attempt < 14);
      if (s) return s;
    }
    return this.fallbackSpawn(rand);
  }
}
