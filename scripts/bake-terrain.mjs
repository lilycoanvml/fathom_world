// Downloads real-world elevation tiles (AWS Terrain Tiles, Terrarium encoding) for each
// region into public/terrain/<region>/ so the app never depends on the tile service at runtime.
//
//   node scripts/bake-terrain.mjs            # all regions
//   node scripts/bake-terrain.mjs bigSur     # one region
//
// Data: Mapzen / AWS Open Data Terrain Tiles (USGS 3DEP, SRTM, GMTED2010, ETOPO1 and others).
import { mkdir, writeFile } from 'node:fs/promises';
import { REGIONS } from '../src/regions.js';

const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

function tileXY(lat, lon, z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [x, y];
}

async function fetchTile(z, x, y, out) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(TILE_URL(z, x, y));
    if (res.ok) {
      await writeFile(out, Buffer.from(await res.arrayBuffer()));
      return;
    }
  }
  throw new Error(`tile ${z}/${x}/${y} failed`);
}

async function bake(key, region) {
  const dir = new URL(`../public/terrain/${key}/`, import.meta.url);
  await mkdir(dir, { recursive: true });
  const meta = { key, layers: {} };
  for (const [name, { z, span }] of Object.entries({ near: { z: 13, span: region.span ?? 5 }, far: { z: 10, span: 3 } })) {
    const [cx, cy] = tileXY(region.lat, region.lon, z);
    const x0 = Math.floor(cx - span / 2 + 0.5), y0 = Math.floor(cy - span / 2 + 0.5);
    const jobs = [];
    for (let j = 0; j < span; j++)
      for (let i = 0; i < span; i++) jobs.push(fetchTile(z, x0 + i, y0 + j, new URL(`${name}_${i}_${j}.png`, dir)));
    await Promise.all(jobs);
    meta.layers[name] = { z, x0, y0, span };
  }
  await writeFile(new URL('meta.json', dir), JSON.stringify(meta, null, 2));
  console.log(`baked ${key}`);
}

const only = process.argv[2];
for (const [key, region] of Object.entries(REGIONS)) {
  if (!only || only === key) await bake(key, region);
}
