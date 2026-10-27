import * as THREE from 'three';
import { BIOMES, GROUP_BIOMES } from './biomes.js';
import { makeNoise, hash2 } from './noise.js';
import { buildPropAssets, PROP_RADIUS } from './props.js';
import { Portals } from './portals.js';
import { addMist } from './atmosphere.js';

const CHUNK = 64;
const SEG = 32;
const RADIUS = 6; // chunks
const PORTAL_CHANCE = 0.17;
const PORTAL_CLEARING = 9;

function prepareColors(biome) {
  const g = biome.ground;
  const c = (h) => new THREE.Color(h);
  return {
    stops: g.stops.map(([h, hex]) => [h, c(hex)]),
    sand: g.sand ? c(g.sand) : null,
    rock: c(g.rock),
    alt: c(g.alt),
    snow: g.snow ? { from: g.snow.from, color: c(g.snow.color) } : null,
    strata: g.strata ? g.strata.map(c) : null,
  };
}

export class World {
  constructor(scene, shared) {
    this.scene = scene;
    this.chunks = new Map();
    this.propCache = new Map();
    this.assets = buildPropAssets(shared);
    this.portals = new Portals(scene, shared);
    this.terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    this.terrainMat.onBeforeCompile = (shader) => {
      shader.uniforms.uWaterLevel = shared.uWaterLevel;
      shader.uniforms.uTime = shared.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
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
          // Multi-scale ground detail, faded with distance to avoid shimmer.
          float camD = length(vWPos - cameraPosition);
          float n1 = tNoise(vWPos.xz * 0.06);
          float n2 = mix(tNoise(vWPos.xz * 0.45), 0.5, smoothstep(50.0, 150.0, camD));
          float n3 = mix(tNoise(vWPos.xz * 2.7), 0.5, smoothstep(8.0, 35.0, camD));
          diffuseColor.rgb *= 0.74 + 0.2 * n1 + 0.2 * n2 + 0.16 * n3;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.1, 1.04, 0.86), smoothstep(0.45, 0.8, n1));
          // Patches of bare earth.
          float dirt = smoothstep(0.66, 0.78, tNoise(vWPos.xz * 0.035 + 17.0)) * smoothstep(0.3, 0.6, n2);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.82, 0.74, 0.62), dirt * 0.7);
          // Wet ground at the waterline, and a soft lapping foam line.
          float above = vWPos.y - uWaterLevel;
          diffuseColor.rgb *= mix(1.0, 0.62, smoothstep(0.7, 0.0, above) * step(-2.0, above));
          float lap = 0.05 * sin(uTime * 0.9 + vWPos.x * 0.15 + vWPos.z * 0.1);
          float foam = smoothstep(0.16, 0.0, abs(above - lap - 0.02)) * (0.55 + 0.45 * tNoise(vWPos.xz * 1.3 + uTime * 0.3));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.9), foam * 0.75);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          // Fine surface relief from procedural bumps, fading out with distance.
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
    addMist(this.terrainMat, shared);
    this.index = this.buildIndex();
    this.tmpColor = new THREE.Color();
  }

  setBiome(key) {
    this.clear();
    this.biomeKey = key;
    this.biome = BIOMES[key];
    this.N = makeNoise(this.biome.seed);
    this.colors = prepareColors(this.biome);
    this.waterLevel = this.biome.water ? this.biome.water.level : -Infinity;
  }

  clear() {
    for (const key of [...this.chunks.keys()]) this.removeChunk(key);
    this.portals.clear();
    this.propCache.clear();
  }

  height(x, z) {
    return this.biome.height(x, z, this.N);
  }

  // Walkable surface: terrain, or the calm water surface above it.
  ground(x, z) {
    return Math.max(this.height(x, z), this.waterLevel);
  }

  slope(x, z, d = 1.5) {
    const hx = this.height(x + d, z) - this.height(x - d, z);
    const hz = this.height(x, z + d) - this.height(x, z - d);
    return Math.hypot(hx, hz) / (2 * d);
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
    // Sample the footprint: must be dry and reasonably level.
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let minH = Infinity, maxH = -Infinity;
    for (const t of [-0.5, -0.25, 0, 0.25, 0.5]) {
      const gh = this.height(x + c * w * t, z - s * w * t);
      minH = Math.min(minH, gh);
      maxH = Math.max(maxH, gh);
    }
    if (minH < this.waterLevel + 0.6) return null;
    if (maxH - minH > Math.min(2.5, h * 0.3)) return null;

    const colorIdx = Math.floor(hash2(cx, cz, seed + 7) * 3) % 3;
    const options = GROUP_BIOMES[colorIdx];
    let dest = options[hash2(cx, cz, seed + 8) < 0.5 ? 0 : 1];
    if (dest === this.biomeKey) dest = options.find((b) => b !== this.biomeKey);
    return {
      key: `${cx},${cz}`,
      x, z, yaw, w, h,
      depth: 0.9,
      baseY: minH - 0.35,
      colorIdx,
      dest,
    };
  }

  nearbyPortals(cx, cz) {
    const out = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const p = this.portalFor(cx + dx, cz + dz);
        if (p) out.push(p);
      }
    return out;
  }

  propsFor(cx, cz) {
    const key = `${cx},${cz}`;
    const cached = this.propCache.get(key);
    if (cached) return cached;
    const list = [];
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const portals = this.nearbyPortals(cx, cz);
    const seedBase = this.biome.seed * 7919;
    this.biome.props.forEach((def, ti) => {
      const sp = def.spacing;
      const seed = seedBase + ti * 101;
      for (let gz = Math.ceil(z0 / sp); gz * sp < z0 + CHUNK; gz++)
        for (let gx = Math.ceil(x0 / sp); gx * sp < x0 + CHUNK; gx++) {
          if (hash2(gx, gz, seed) > def.prob) continue;
          const x = (gx + 0.1 + hash2(gx, gz, seed + 1) * 0.8) * sp;
          const z = (gz + 0.1 + hash2(gx, gz, seed + 2) * 0.8) * sp;
          if (def.clump && this.N.fbm(x * def.clump.freq + 40, z * def.clump.freq - 40, 2) < def.clump.min) continue;
          const h = this.height(x, z);
          const minH = def.minH ?? this.waterLevel + 0.4;
          if (h < minH) continue;
          if (def.maxH !== undefined && h > def.maxH) continue;
          if (def.maxSlope !== undefined && this.slope(x, z) > def.maxSlope) continue;
          let blocked = false;
          for (const p of portals) {
            if (Math.hypot(x - p.x, z - p.z) < Math.max(p.w, p.h) / 2 + PORTAL_CLEARING) { blocked = true; break; }
          }
          if (blocked) continue;
          const s = def.scale[0] + hash2(gx, gz, seed + 3) * (def.scale[1] - def.scale[0]);
          list.push({
            type: def.type,
            x, z,
            y: h - 0.15 * s,
            s,
            rot: hash2(gx, gz, seed + 4) * Math.PI * 2,
            shade: 0.88 + hash2(gx, gz, seed + 5) * 0.2,
            tint: def.tint,
            r: PROP_RADIUS[def.type] * s,
          });
        }
    });
    if (this.propCache.size > 600) this.propCache.clear();
    this.propCache.set(key, list);
    return list;
  }

  // ---------- Chunk streaming ----------

  buildIndex() {
    const idx = [];
    const row = SEG + 1;
    for (let j = 0; j < SEG; j++)
      for (let i = 0; i < SEG; i++) {
        const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    return new Uint16Array(idx);
  }

  groundColor(x, z, h, slope, out) {
    const C = this.colors;
    const stops = C.stops;
    if (C.strata) {
      const band = h / 3.2 + this.N.fbm(x / 200, z / 200, 2) * 1.5;
      const i = ((Math.floor(band) % C.strata.length) + C.strata.length) % C.strata.length;
      out.copy(C.strata[i]).lerp(C.strata[(i + 1) % C.strata.length], band - Math.floor(band));
      out.lerp(stops[0][1], 1 - THREE.MathUtils.smoothstep(slope, 0.15, 0.5));
    } else {
      out.copy(stops[0][1]);
      for (let i = 1; i < stops.length; i++) {
        const t = THREE.MathUtils.clamp((h - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]), 0, 1);
        if (h > stops[i - 1][0]) out.lerp(stops[i][1], t);
      }
      out.lerp(C.alt, 0.35 * THREE.MathUtils.smoothstep(this.N.fbm(x / 90, z / 90, 2), -0.1, 0.5));
      out.lerp(C.rock, THREE.MathUtils.smoothstep(slope, 0.55, 0.95));
    }
    if (C.sand) out.lerp(C.sand, 1 - THREE.MathUtils.smoothstep(h, this.waterLevel + 0.6, this.waterLevel + 2.2));
    if (C.snow) {
      const line = C.snow.from + this.N.fbm(x / 60, z / 60, 2) * 8;
      out.lerp(C.snow.color, THREE.MathUtils.smoothstep(h, line, line + 4) * (1 - THREE.MathUtils.smoothstep(slope, 0.7, 1.1)));
    }
    const v = 1 + this.N.fbm(x / 14, z / 14, 2) * 0.12;
    out.multiplyScalar(v);
    return out;
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
        pos[k * 3] = i * step;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = j * step;
        nor[k * 3] = -dx * inv;
        nor[k * 3 + 1] = inv;
        nor[k * 3 + 2] = -dz * inv;
        this.groundColor(x0 + i * step, z0 + j * step, h, Math.hypot(dx, dz), c);
        colr[k * 3] = c.r;
        colr[k * 3 + 1] = c.g;
        colr[k * 3 + 2] = c.b;
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
    const instanced = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (const [type, list] of byType) {
      const im = new THREE.InstancedMesh(this.assets.geos[type], this.assets.mats[type], list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        m.compose(v.set(p.x, p.y, p.z), q, sc.set(p.s, p.s, p.s));
        im.setMatrixAt(i, m);
        im.setColorAt(i, c.set(p.tint).multiplyScalar(p.shade));
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.scene.add(im);
      instanced.push(im);
    }

    const pdef = this.portalFor(cx, cz);
    const portal = pdef ? this.portals.create(pdef) : null;
    this.chunks.set(`${cx},${cz}`, { cx, cz, mesh, instanced, props, portal });
  }

  removeChunk(key) {
    const ch = this.chunks.get(key);
    if (!ch) return;
    this.scene.remove(ch.mesh);
    ch.mesh.geometry.dispose();
    for (const im of ch.instanced) {
      this.scene.remove(im);
      im.dispose();
    }
    if (ch.portal) this.portals.remove(ch.portal.key);
    this.chunks.delete(key);
  }

  // Streams chunks around the player. budgetMs < 0 builds everything now.
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
    for (const [key, ch] of this.chunks) {
      const dx = ch.cx - pcx, dz = ch.cz - pcz;
      if (dx * dx + dz * dz > keep) this.removeChunk(key);
    }
  }

  // Pushes a point out of prop colliders. Returns the corrected [x, z].
  collide(x, z, r) {
    const pcx = Math.floor(x / CHUNK), pcz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const ch = this.chunks.get(`${pcx + dx},${pcz + dz}`);
        if (!ch) continue;
        for (const p of ch.props) {
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

  isSpawnSafe(x, z) {
    const h = this.height(x, z);
    if (h < this.waterLevel + 0.8) return false;
    if (this.slope(x, z, 3) > 0.35) return false;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        for (const p of this.propsFor(cx + dx, cz + dz)) {
          if (Math.hypot(x - p.x, z - p.z) < p.r + 2.5) return false;
        }
      }
    for (const p of this.nearbyPortals(cx, cz)) {
      if (Math.hypot(x - p.x, z - p.z) < Math.max(p.w, p.h) / 2 + 3) return false;
    }
    return true;
  }

  hasView(x, z, p) {
    // The lower third of the portal must be visible, not just its crown.
    const eye = this.ground(x, z) + 1.7;
    const target = p.baseY + p.h * 0.3;
    for (let t = 0.1; t < 0.95; t += 0.1) {
      const hx = x + (p.x - x) * t, hz = z + (p.z - z) * t;
      if (this.height(hx, hz) > eye + (target - eye) * t - 0.3) return false;
    }
    return true;
  }

  // No trees or rocks standing between the viewer and the portal.
  clearPath(x, z, p) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const pcx = Math.floor(p.x / CHUNK), pcz = Math.floor(p.z / CHUNK);
    const lx = p.x - x, lz = p.z - z;
    const len2 = lx * lx + lz * lz;
    for (let gz = Math.min(cz, pcz) - 1; gz <= Math.max(cz, pcz) + 1; gz++)
      for (let gx = Math.min(cx, pcx) - 1; gx <= Math.max(cx, pcx) + 1; gx++)
        for (const o of this.propsFor(gx, gz)) {
          const t = THREE.MathUtils.clamp(((o.x - x) * lx + (o.z - z) * lz) / len2, 0, 1);
          if (Math.hypot(x + lx * t - o.x, z + lz * t - o.z) < o.r + 1.2) return false;
        }
    return true;
  }

  // In water biomes, the opening view should include open water beyond the portal.
  seesWater(x, z, p) {
    const base = Math.atan2(p.x - x, p.z - z);
    for (const da of [0, 0.4, -0.4, 0.8, -0.8])
      for (let d = 40; d <= 200; d += 20) {
        const a = base + da;
        if (this.height(x + Math.sin(a) * d, z + Math.cos(a) * d) < this.waterLevel - 0.5) return true;
      }
    return false;
  }

  // Finds a safe point near (ax, az) that faces a portal across open ground.
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
              if (strict && (!this.clearPath(x, z, p) || (this.biome.water && !this.seesWater(x, z, p)))) continue;
              {
                return { x, z, yaw: Math.atan2(nx, nz) };
              }
            }
        }
    return null;
  }

  // Known-safe fallback: best dry, level, clear point near (ax, az).
  fallbackSpawn(ax, az, rand) {
    for (let i = 0; i < 400; i++) {
      const x = ax + (rand() - 0.5) * 600, z = az + (rand() - 0.5) * 600;
      if (this.isSpawnSafe(x, z)) return { x, z, yaw: rand() * Math.PI * 2 };
    }
    return { x: ax, z: az, yaw: 0 };
  }

  findSpawn(rand) {
    // Prefer an ideal composition; relax to merely safe before the fallback.
    for (let attempt = 0; attempt < 20; attempt++) {
      const ax = (rand() * 2 - 1) * 30000, az = (rand() * 2 - 1) * 30000;
      const s = this.spawnNear(ax, az, attempt < 12);
      if (s) return s;
    }
    return this.fallbackSpawn((rand() * 2 - 1) * 30000, (rand() * 2 - 1) * 30000, rand);
  }
}
