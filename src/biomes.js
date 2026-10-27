import { smoothstep } from './noise.js';

// The only colors portals may use.
export const BRAND_COLORS = ['#859FB0', '#B7CCAC', '#DC997E'];

// Portal color index -> the biomes that color leads to.
export const GROUP_BIOMES = [
  ['lake', 'alpine'], // blue: water and sky
  ['forest', 'meadow'], // green: growing things
  ['coast', 'canyon'], // terracotta: warm light and stone
];

// Each biome varies a few dimensions (terrain, light, fog, water, props) while
// sharing the same materials, portal language, and camera feel.
export const BIOMES = {
  lake: {
    label: 'Still Lake',
    motes: { color: '#fff6dc', opacity: 0.35 },
    mist: { density: 0.35, base: 1, falloff: 6 },
    grass: { color: '#8f9c5a', height: 0.55, density: 0.75, shore: 1.4 },
    group: 0,
    seed: 11,
    sky: { zenith: '#2f5f9c', horizon: '#cdd9e2', sun: '#fff1d6', elevation: 22, azimuth: 205, clouds: 0.3 },
    fog: { near: 90, far: 440 },
    exposure: 1.0,
    light: { sun: 2.6, hemi: 1.1, hemiSky: '#cfe0f0', hemiGround: '#4e5a44' },
    water: { level: 0, shallow: '#6f95ad', deep: '#1c3852', reflect: 0.9, rough: 0.6 },
    ground: {
      stops: [[0, '#6b6a4c'], [3, '#5d6e44'], [12, '#4c5f3d'], [26, '#5b6352']],
      sand: '#a99f84', rock: '#6f6c66', alt: '#6b7447',
    },
    height: (x, z, N) => N.fbm(x / 480, z / 480, 4) * 20 + N.fbm(x / 110 + 31, z / 110 - 7, 4) * 4 + 2.5,
    props: [
      { type: 'pine', spacing: 8, prob: 0.5, minH: 1.6, maxSlope: 0.5, scale: [0.8, 1.6], clump: { freq: 1 / 150, min: -0.05 }, tint: '#e6eee4' },
      { type: 'boulder', spacing: 15, prob: 0.25, minH: -1.2, maxH: 3.5, scale: [0.5, 1.6], tint: '#f2f2f0' },
    ],
    silhouettes: [
      { radius: 1550, base: -70, h: [100, 210], freq: 4, color: '#6d8299', haze: 0.55 },
      { radius: 1150, base: -70, h: [55, 105], freq: 9, color: '#3d5345', haze: 0.35 },
    ],
    audio: { wind: 0.14, water: 0.18, waterRate: 0.22, birds: 0.5, chord: [146.83, 220.0, 277.18, 329.63] },
  },

  alpine: {
    label: 'High Meadow',
    motes: { color: '#ffffff', opacity: 0.25 },
    mist: { density: 0.2, base: 25, falloff: 12 },
    grass: { color: '#a3a663', height: 0.35, density: 0.85, patch: 0.1 },
    group: 0,
    seed: 23,
    sky: { zenith: '#24569a', horizon: '#bfd1e3', sun: '#ffffff', elevation: 40, azimuth: 160, clouds: 0.5 },
    fog: { near: 120, far: 480 },
    exposure: 1.0,
    light: { sun: 3.0, hemi: 1.15, hemiSky: '#d4e3f2', hemiGround: '#5e6150' },
    water: null,
    ground: {
      stops: [[10, '#7d8a52'], [40, '#6f7c4a'], [62, '#857f6c'], [80, '#9a978d']],
      rock: '#7c7a74', alt: '#8f9157', snow: { from: 74, color: '#eef2f5' },
    },
    height: (x, z, N) => 30 + N.fbm(x / 620, z / 620, 4) * 42 + N.ridged(x / 240, z / 240, 4) * 26 + N.fbm(x / 60, z / 60, 2) * 1.5,
    props: [
      { type: 'boulder', spacing: 12, prob: 0.3, maxSlope: 0.9, scale: [0.6, 2.2], tint: '#ffffff' },
      { type: 'pine', spacing: 11, prob: 0.3, maxH: 58, maxSlope: 0.45, scale: [0.7, 1.3], clump: { freq: 1 / 110, min: 0.15 }, tint: '#dfe7df' },
      { type: 'capsule', spacing: 90, prob: 0.25, maxSlope: 0.25, scale: [0.9, 1.6], tint: '#e8e4dc' },
    ],
    silhouettes: [
      { radius: 1700, base: -110, h: [280, 600], freq: 4, color: '#5f7590', haze: 0.3, snow: 0.6 },
      { radius: 1250, base: -110, h: [140, 260], freq: 7, color: '#4d5c58', haze: 0.3, snow: 0.85 },
    ],
    audio: { wind: 0.32, water: 0.0, waterRate: 0.2, birds: 0.15, chord: [130.81, 196.0, 246.94, 293.66] },
  },

  forest: {
    label: 'Misty Pines',
    motes: { color: '#fff2c8', opacity: 0.6 },
    mist: { density: 0.55, base: -4, falloff: 10 },
    grass: { color: '#6f7d4c', height: 0.45, density: 0.45, patch: 0.15 },
    group: 1,
    seed: 37,
    sky: { zenith: '#9fb4b9', horizon: '#dbe2dc', sun: '#fff4df', elevation: 30, azimuth: 120, clouds: 0.0 },
    fog: { near: 12, far: 175 },
    exposure: 1.0,
    light: { sun: 1.7, hemi: 1.35, hemiSky: '#e3ebe6', hemiGround: '#46503f' },
    water: null,
    ground: {
      stops: [[-10, '#4f5b3c'], [8, '#56603f'], [20, '#5f6446']],
      rock: '#6a6a62', alt: '#6b6a45',
    },
    height: (x, z, N) => N.fbm(x / 380, z / 380, 4) * 22 + N.fbm(x / 90, z / 90, 3) * 5,
    props: [
      { type: 'pine', spacing: 6, prob: 0.8, maxSlope: 0.7, scale: [1.0, 2.1], clump: { freq: 1 / 70, min: -0.25 }, tint: '#c9d6cc' },
      { type: 'boulder', spacing: 20, prob: 0.25, scale: [0.5, 1.3], tint: '#c7ccc0' },
    ],
    silhouettes: [
      { radius: 1400, base: -60, h: [60, 120], freq: 6, color: '#7f938a', haze: 0.75 },
    ],
    audio: { wind: 0.2, water: 0.0, waterRate: 0.2, birds: 0.8, chord: [110.0, 164.81, 220.0, 261.63] },
  },

  meadow: {
    label: 'Open Meadow',
    motes: { color: '#fff0b8', opacity: 0.5 },
    mist: { density: 0.18, base: -2, falloff: 8 },
    grass: { color: '#c0b46a', height: 0.7, density: 0.9, patch: -0.2 },
    group: 1,
    seed: 41,
    sky: { zenith: '#4f86c0', horizon: '#e4e5d6', sun: '#fff0cf', elevation: 18, azimuth: 235, clouds: 0.45 },
    fog: { near: 110, far: 470 },
    exposure: 1.0,
    light: { sun: 2.7, hemi: 1.05, hemiSky: '#dbe6ef', hemiGround: '#5d6340' },
    water: null,
    ground: {
      stops: [[-10, '#7a8a4a'], [10, '#8b9852'], [25, '#a29f5f']],
      rock: '#8a8576', alt: '#b0a466',
    },
    height: (x, z, N) => N.fbm(x / 520, z / 520, 4) * 28 + N.fbm(x / 140, z / 140, 3) * 6 + 5,
    props: [
      { type: 'roundTree', spacing: 22, prob: 0.12, maxSlope: 0.4, scale: [0.8, 1.5], clump: { freq: 1 / 200, min: 0.0 }, tint: '#f0f2e6' },
      { type: 'boulder', spacing: 30, prob: 0.15, scale: [0.6, 1.6], tint: '#f4efe4' },
      { type: 'capsule', spacing: 70, prob: 0.3, maxSlope: 0.25, scale: [0.8, 1.5], tint: '#efe8dc' },
    ],
    silhouettes: [
      { radius: 1500, base: -60, h: [70, 140], freq: 3, color: '#8ea0b4', haze: 0.6 },
      { radius: 1100, base: -60, h: [50, 85], freq: 6, color: '#6d7a55', haze: 0.45 },
    ],
    audio: { wind: 0.22, water: 0.0, waterRate: 0.2, birds: 0.6, chord: [146.83, 185.0, 220.0, 293.66] },
  },

  coast: {
    label: 'Golden Coast',
    motes: { color: '#ffe2c0', opacity: 0.35 },
    mist: { density: 0.4, base: 0, falloff: 5 },
    grass: { color: '#a9a272', height: 0.6, density: 0.5, shore: 3.2 },
    group: 2,
    seed: 53,
    sky: { zenith: '#5d6f93', horizon: '#f0c497', sun: '#ffbe73', elevation: 7, azimuth: 250, clouds: 0.6 },
    fog: { near: 80, far: 460 },
    exposure: 1.05,
    light: { sun: 2.8, hemi: 0.9, hemiSky: '#f1d2b4', hemiGround: '#5a4c42' },
    water: { level: 0, shallow: '#6f7a7c', deep: '#243241', reflect: 0.75, rough: 0.9 },
    ground: {
      stops: [[0, '#b39a78'], [4, '#7a7650'], [14, '#6b6c48'], [30, '#6a5f52']],
      sand: '#c6aa84', rock: '#4c4542', alt: '#8a7d55',
    },
    height: (x, z, N) => {
      let h = N.fbm(x / 650, z / 650, 3) * 40 + 3 + N.fbm(x / 120, z / 120, 4) * 3;
      // Wide, gentle beaches between the waterline and the dunes.
      if (h > 0) h = h < 4 ? h * 0.45 : 1.8 + (h - 4);
      return h;
    },
    props: [
      { type: 'seastack', spacing: 45, prob: 0.35, minH: -12, maxH: -0.8, scale: [0.6, 1.4], tint: '#ffffff' },
      { type: 'boulder', spacing: 14, prob: 0.25, minH: -1.0, maxH: 2.5, scale: [0.5, 1.8], tint: '#a59a92' },
      { type: 'boulder', spacing: 18, prob: 0.2, minH: 3, maxSlope: 0.8, scale: [1.0, 2.6], tint: '#b0a497' },
    ],
    silhouettes: [
      { radius: 1500, base: -25, h: [-70, 120], freq: 3, color: '#4f4a52', haze: 0.45 },
      { radius: 1100, base: -25, h: [-80, 70], freq: 5, color: '#3b3638', haze: 0.25, stacks: true },
    ],
    audio: { wind: 0.16, water: 0.42, waterRate: 0.09, birds: 0.1, chord: [123.47, 185.0, 246.94, 311.13] },
  },

  canyon: {
    label: 'Sandstone Mesas',
    motes: { color: '#ffe0c0', opacity: 0.3 },
    mist: { density: 0.12, base: -15, falloff: 10 },
    grass: null,
    group: 2,
    seed: 67,
    sky: { zenith: '#6f88ad', horizon: '#ebc8a3', sun: '#ffd29a', elevation: 14, azimuth: 95, clouds: 0.2 },
    fog: { near: 120, far: 500 },
    exposure: 1.0,
    light: { sun: 2.9, hemi: 1.0, hemiSky: '#f0d9c0', hemiGround: '#7a5440' },
    water: null,
    ground: {
      stops: [[-20, '#d4b08a'], [10, '#c99a74']],
      rock: '#b07258', alt: '#d8b48e',
      strata: ['#c98a64', '#b8765a', '#d9a37c', '#a96d52', '#d4a888'],
    },
    height: (x, z, N) => {
      const b = N.fbm(x / 520, z / 520, 4) * 55 + N.fbm(x / 150, z / 150, 3) * 8;
      const step = 7;
      const t = b / step;
      const s = smoothstep(0.3, 0.7, t - Math.floor(t));
      return (Math.floor(t) + s) * step * 0.85 + b * 0.15 + N.fbm(x / 30, z / 30, 2) * 0.6;
    },
    props: [
      { type: 'hoodoo', spacing: 26, prob: 0.25, maxSlope: 0.4, scale: [0.8, 1.8], tint: '#ffffff' },
      { type: 'boulder', spacing: 16, prob: 0.25, scale: [0.6, 2.0], tint: '#e3a888' },
      { type: 'capsule', spacing: 80, prob: 0.25, maxSlope: 0.25, scale: [0.9, 1.5], tint: '#f0c9a8' },
    ],
    silhouettes: [
      { radius: 1600, base: -80, h: [60, 200], freq: 4, color: '#a77a6a', haze: 0.5, mesa: true },
      { radius: 1150, base: -80, h: [40, 130], freq: 7, color: '#9a5f48', haze: 0.3, mesa: true },
    ],
    audio: { wind: 0.3, water: 0.0, waterRate: 0.2, birds: 0.05, chord: [116.54, 174.61, 233.08, 277.18] },
  },
};
