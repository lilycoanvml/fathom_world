import * as THREE from 'three';

// Real elevation for a region, decoded from baked Terrarium tiles (public/terrain/<key>/).
// World units are meters; x = east, z = south, origin at the centre of the near grid.

const EARTH = 40075016.686;
const cache = new Map();

async function decodeLayer(key, name, layer) {
  const size = 256 * layer.span;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const loads = [];
  for (let j = 0; j < layer.span; j++)
    for (let i = 0; i < layer.span; i++)
      loads.push(
        fetch(`${import.meta.env.BASE_URL}terrain/${key}/${name}_${i}_${j}.png`)
          .then((r) => r.blob())
          .then((b) => createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
          .then((img) => ctx.drawImage(img, i * 256, j * 256)),
      );
  await Promise.all(loads);
  const px = ctx.getImageData(0, 0, size, size).data;
  const h = new Float32Array(size * size);
  for (let k = 0; k < size * size; k++) h[k] = px[k * 4] * 256 + px[k * 4 + 1] + px[k * 4 + 2] / 256 - 32768;
  return { size, h, ...layer };
}

// Approximate distance (in pixels) from every water pixel to the nearest land pixel.
function distanceToLand(mask, n) {
  const INF = 1e9;
  const d = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) d[k] = mask[k] ? INF : 0;
  const D = 1, DD = Math.SQRT2;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      if (!d[k]) continue;
      let v = d[k];
      if (x > 0) v = Math.min(v, d[k - 1] + D);
      if (y > 0) {
        v = Math.min(v, d[k - n] + D);
        if (x > 0) v = Math.min(v, d[k - n - 1] + DD);
        if (x < n - 1) v = Math.min(v, d[k - n + 1] + DD);
      }
      d[k] = v;
    }
  for (let y = n - 1; y >= 0; y--)
    for (let x = n - 1; x >= 0; x--) {
      const k = y * n + x;
      if (!d[k]) continue;
      let v = d[k];
      if (x < n - 1) v = Math.min(v, d[k + 1] + D);
      if (y < n - 1) {
        v = Math.min(v, d[k + n] + D);
        if (x < n - 1) v = Math.min(v, d[k + n + 1] + DD);
        if (x > 0) v = Math.min(v, d[k + n - 1] + DD);
      }
      d[k] = v;
    }
  return d;
}

// Elevation models store lakes and coastal sea as flat surfaces. Give them a real bed:
// gently shelving near the shore, deepening with distance from land.
function carveWater(layer, water, mpp) {
  const { size: n, h } = layer;
  const mask = new Uint8Array(n * n);
  const queue = [];
  for (let k = 0; k < n * n; k++) {
    if (h[k] <= water.level + water.tolerance) {
      mask[k] = 1;
      queue.push(k);
    }
  }
  // Coarse source data leaves perfectly flat "shelves" a metre or two above the water.
  // Flood across flat ground connected to water; real beaches slope, so they survive.
  const flat = (k) => {
    const x = k % n, y = (k / n) | 0;
    if (x < 1 || y < 1 || x >= n - 1 || y >= n - 1) return false;
    const c = h[k];
    return Math.abs(h[k - 1] - c) < 0.35 && Math.abs(h[k + 1] - c) < 0.35 && Math.abs(h[k - n] - c) < 0.35 && Math.abs(h[k + n] - c) < 0.35;
  };
  while (queue.length) {
    const k = queue.pop();
    for (const o of [k - 1, k + 1, k - n, k + n]) {
      if (o < 0 || o >= n * n || mask[o]) continue;
      if (h[o] <= water.level + water.tolerance + 4 && flat(o)) {
        mask[o] = 1;
        queue.push(o);
      }
    }
  }
  // Low, isolated scraps of "land" offshore are data artefacts, not islands; real sea stacks stand taller.
  const seen = new Uint8Array(n * n);
  for (let s = 0; s < n * n; s++) {
    if (mask[s] || seen[s]) continue;
    const comp = [s];
    seen[s] = 1;
    let top = -Infinity, edge = false;
    for (let i = 0; i < comp.length; i++) {
      const k = comp[i];
      top = Math.max(top, h[k]);
      const x = k % n;
      if (x === 0 || x === n - 1 || k < n || k >= n * n - n) edge = true;
      for (const o of [x > 0 ? k - 1 : -1, x < n - 1 ? k + 1 : -1, k - n, k + n]) {
        if (o < 0 || o >= n * n || mask[o] || seen[o]) continue;
        seen[o] = 1;
        comp.push(o);
      }
    }
    if (comp.length < 6000 && !edge && top < water.level + 20) for (const k of comp) mask[k] = 1;
  }
  const dist = distanceToLand(mask, n);
  for (let k = 0; k < n * n; k++) {
    if (!mask[k]) continue;
    const m = dist[k] * mpp;
    const bed = water.level - 0.25 - Math.min(water.maxDepth, m * water.shelf + (m * m * water.shelf) / 400);
    h[k] = Math.min(h[k], bed);
  }
}

export class Heightfield {
  constructor(region, near, far) {
    this.region = region;
    this.near = near;
    this.far = far;
    // Web Mercator pixels are square on the ground, scaled by cos(latitude).
    this.mpp = (EARTH * Math.cos((region.lat * Math.PI) / 180)) / 2 ** near.z / 256;
    this.size = near.size * this.mpp;
    this.farScale = 2 ** (near.z - far.z);
    // Offset of the far grid's origin in near-grid pixels.
    this.farOffX = far.x0 * 256 * this.farScale - near.x0 * 256;
    this.farOffY = far.y0 * 256 * this.farScale - near.y0 * 256;
  }

  // Mirror-wrap so terrain continues seamlessly past the edge of the data.
  static mirror(u, n) {
    const p = 2 * (n - 1);
    let m = ((u % p) + p) % p;
    return m > n - 1 ? p - m : m;
  }

  static texel(layer, x, y) {
    const n = layer.size;
    const xi = Math.min(n - 1, Math.max(0, x)), yi = Math.min(n - 1, Math.max(0, y));
    return layer.h[yi * n + xi];
  }

  // Catmull-Rom bicubic sample in layer pixel space.
  static bicubic(layer, u, v) {
    const n = layer.size;
    u = Heightfield.mirror(u, n);
    v = Heightfield.mirror(v, n);
    const x = Math.floor(u), y = Math.floor(v);
    const fx = u - x, fy = v - y;
    const w = (t) => [
      ((-t + 2) * t - 1) * t * 0.5,
      ((3 * t - 5) * t * t + 2) * 0.5,
      ((-3 * t + 4) * t + 1) * t * 0.5,
      (t - 1) * t * t * 0.5,
    ];
    const wx = w(fx), wy = w(fy);
    let s = 0;
    for (let j = 0; j < 4; j++) {
      let row = 0;
      for (let i = 0; i < 4; i++) row += wx[i] * Heightfield.texel(layer, x - 1 + i, y - 1 + j);
      s += wy[j] * row;
    }
    return s;
  }

  // Elevation (m) at world position, from the detailed near grid.
  sample(x, z) {
    return Heightfield.bicubic(this.near, x / this.mpp + this.near.size / 2, z / this.mpp + this.near.size / 2);
  }

  // Elevation from the wide, coarse grid — for the distant horizon.
  sampleFar(x, z) {
    const u = (x / this.mpp + this.near.size / 2 - this.farOffX) / this.farScale;
    const v = (z / this.mpp + this.near.size / 2 - this.farOffY) / this.farScale;
    return Heightfield.bicubic(this.far, u, v);
  }

  // World-space bounds of the far grid.
  farBounds() {
    const s = this.far.size * this.farScale * this.mpp;
    const x0 = (this.farOffX - this.near.size / 2) * this.mpp;
    const z0 = (this.farOffY - this.near.size / 2) * this.mpp;
    return { x0, z0, size: s };
  }

  // Lat/lon of a world position (for the location readout).
  latLon(x, z) {
    const n = 2 ** this.near.z;
    const gx = (this.near.x0 * 256 + x / this.mpp + this.near.size / 2) / 256;
    const gy = (this.near.y0 * 256 + z / this.mpp + this.near.size / 2) / 256;
    const lon = (gx / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / n))) * 180) / Math.PI;
    return [lat, lon];
  }

  // World position of a lat/lon.
  fromLatLon(lat, lon) {
    const n = 2 ** this.near.z * 256;
    const r = (lat * Math.PI) / 180;
    const gx = ((lon + 180) / 360) * n;
    const gy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
    return [(gx - this.near.x0 * 256 - this.near.size / 2) * this.mpp, (gy - this.near.y0 * 256 - this.near.size / 2) * this.mpp];
  }

  // Water-relative height texture for shoreline foam and depth tinting in the water shader.
  depthTexture(level) {
    const n = this.near.size;
    const data = new Uint16Array(n * n);
    for (let k = 0; k < n * n; k++) data[k] = THREE.DataUtils.toHalfFloat(THREE.MathUtils.clamp(this.near.h[k] - level, -200, 200));
    const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
    tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }
}

export async function loadHeightfield(key, region) {
  if (cache.has(key)) return cache.get(key);
  const promise = (async () => {
    const meta = await fetch(`${import.meta.env.BASE_URL}terrain/${key}/meta.json`).then((r) => r.json());
    const [near, far] = await Promise.all([decodeLayer(key, 'near', meta.layers.near), decodeLayer(key, 'far', meta.layers.far)]);
    const hf = new Heightfield(region, near, far);
    if (region.water) {
      carveWater(near, region.water, hf.mpp);
      carveWater(far, region.water, hf.mpp * hf.farScale);
    }
    return hf;
  })();
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}
