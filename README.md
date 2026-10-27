# Fathom World

A calm, first-person 3D exploration prototype for Fathom for Ford (see `fathom_for_ford_infinite_world_prd.md`).

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Controls: **W A S D / Arrows** move · **Mouse** look · **Shift** brisk walk · **R** respawn · **M** sound · **H** hint · **Esc** pause.

Debug URL params: `?biome=lake|alpine|forest|meadow|coast|canyon`, `?seed=123` (reproducible spawns), `?debug` (exposes `window.fathom`).

## How it works

- `src/world.js` — infinite terrain streamed in 64 m chunks around the viewer (built nearest-first on a per-frame time budget, recycled when far). Heights come from one continuous noise function per biome, so chunk edges are seamless. Props and portals are placed deterministically per chunk.
- `src/biomes.js` — six areas, each varying terrain, light, fog, water and props. Portal color picks the destination family: blue `#859FB0` → lake / alpine, green `#B7CCAC` → forest / meadow, terracotta `#DC997E` → coast / canyon.
- `src/portals.js` — extruded, soft-bevelled 3D pills (horizontal or vertical). Up close, a painted view of the destination fades in inside the pill.
- `src/atmosphere.js` — sky, clouds, fog, water, layered distant ridgelines, sun shadows.
- `src/audio.js` — synthesized ambience (wind, water, birds, pad, portal hum and transition chime).
- Spawning always lands on dry, level, clear ground facing a visible portal; there's a known-safe fallback. Portal and R transitions are locked so only one runs at a time.

## Deploy (Cloud Run)

```bash
gcloud run deploy fathom-world --source . --project vml-map-xd-ford --region us-central1 --allow-unauthenticated
```
# fathom_world
