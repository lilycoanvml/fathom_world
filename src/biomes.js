// Each area is a real place: terrain comes from elevation data (see regions.js and
// scripts/bake-terrain.mjs); this file art-directs light, color, water and ecology.
import { REGIONS } from './regions.js';

// The only colors portals may use.
export const BRAND_COLORS = ['#859FB0', '#B7CCAC', '#DC997E'];

// Portal color index -> the areas that color leads to.
export const GROUP_BIOMES = [
  ['craterLake', 'maroonBells'], // blue: deep water and high peaks
  ['mtHood', 'rowena'], // green: Oregon forests and meadows
  ['bigSur', 'pointReyes'], // terracotta: golden California coast
];

const AREAS = {
  craterLake: {
    label: 'Crater Lake',
    group: 0,
    seed: 11,
    water: { level: 1882.5, tolerance: 2.2, maxDepth: 120, shelf: 0.35, shallow: '#2f86c0', deep: '#0a2a6e', reflect: 0.9, rough: 0.5, kind: 'lake' },
    sky: { zenith: '#2b5fa8', horizon: '#c6d6e6', sun: '#fff1da', elevation: 34, azimuth: 330, clouds: 0.25, turbidity: 2.2, rayleigh: 1.2, mie: 0.004, mieG: 0.8 },
    fog: { near: 150, range: 26000 },
    exposure: 0.95,
    light: { sun: 3.0, env: 0.75 },
    mist: { density: 0.25, base: 1890, falloff: 20 },
    ground: {
      stops: [[1850, '#8a8270'], [1950, '#6f7550'], [2200, '#6b6e52'], [2450, '#8a8478']],
      rock: '#5f5a55', sand: '#9b927c', alt: '#7d7a5c', canopy: '#2f3d2c',
      snow: { from: 2560, color: '#eef2f5' },
    },
    ecology: [
      { type: 'fir', elev: [1880, 2420], spacing: 8, density: 0.5, maxSlope: 0.75, mask: { freq: 1 / 160, min: -0.15 } },
      { type: 'pine', elev: [2150, 2650], spacing: 14, density: 0.25, maxSlope: 0.6 },
      { type: 'boulder', elev: [1880, 2800], spacing: 18, density: 0.2, minSlope: 0.25 },
    ],
    grass: { color: '#9a9a6a', height: 0.35, density: 0.5, patch: 0.2, shore: 1.2 },
    motes: { color: '#fff6dc', opacity: 0.3 },
    preview: { sil1: '#6d7f95', sil2: '#3b4b3c', ground: '#0a2a6e', snow: true },
    audio: { wind: 0.2, water: 0.12, waterRate: 0.22, birds: 0.35, chord: [146.83, 220.0, 277.18, 329.63] },
  },

  maroonBells: {
    label: 'Maroon Bells',
    group: 0,
    seed: 23,
    water: null,
    sky: { zenith: '#2457a4', horizon: '#c3d4e6', sun: '#ffe6c4', elevation: 16, azimuth: 75, clouds: 0.45, turbidity: 1.8, rayleigh: 1.0, mie: 0.003, mieG: 0.8 },
    fog: { near: 200, range: 30000 },
    exposure: 0.95,
    light: { sun: 3.2, env: 0.75 },
    mist: { density: 0.12, base: 2700, falloff: 60 },
    ground: {
      stops: [[2500, '#5d6b3a'], [2900, '#6c7a40'], [3300, '#7c7c4a'], [3550, '#7d6a5c'], [3900, '#7a5a52']],
      rock: '#7a4b45', alt: '#8f8a4e', canopy: '#33402a',
      snow: { from: 3780, color: '#f3f6f8' },
    },
    ecology: [
      { type: 'aspen', elev: [2550, 3150], spacing: 6, density: 0.55, maxSlope: 0.7, mask: { freq: 1 / 120, min: 0.05 } },
      { type: 'spruce', elev: [2700, 3480], spacing: 8, density: 0.45, maxSlope: 0.8, mask: { freq: 1 / 140, min: -0.1 } },
      { type: 'boulder', elev: [2900, 4300], spacing: 12, density: 0.3, minSlope: 0.3 },
    ],
    grass: { color: '#a7a35f', height: 0.4, density: 0.7, patch: 0.0 },
    motes: { color: '#ffffff', opacity: 0.25 },
    preview: { sil1: '#7a5552', sil2: '#4a5a3a', ground: '#6c7a40', snow: true },
    audio: { wind: 0.32, water: 0.04, waterRate: 0.3, birds: 0.2, chord: [130.81, 196.0, 246.94, 293.66] },
  },

  mtHood: {
    label: 'Mount Hood',
    group: 1,
    seed: 37,
    water: null,
    sky: { zenith: '#3f72b0', horizon: '#cfdbe4', sun: '#fff1d8', elevation: 38, azimuth: 15, clouds: 0.35, turbidity: 2.6, rayleigh: 1.2, mie: 0.004, mieG: 0.82 },
    fog: { near: 60, range: 24000 },
    exposure: 1.0,
    light: { sun: 2.6, env: 0.85 },
    mist: { density: 0.4, base: 900, falloff: 150 },
    ground: {
      stops: [[600, '#39452c'], [1500, '#424d2d'], [1820, '#6e7a46'], [2100, '#7a766c'], [2400, '#8a8580']],
      rock: '#67625c', alt: '#5b6538', canopy: '#26331f',
      snow: { from: 2250, color: '#eef3f6' },
    },
    ecology: [
      { type: 'fir', elev: [600, 1800], spacing: 7, density: 0.85, maxSlope: 0.9, mask: { freq: 1 / 90, min: -0.45 } },
      { type: 'fir', elev: [1750, 1980], spacing: 12, density: 0.35, maxSlope: 0.6, mask: { freq: 1 / 60, min: 0.0 } },
      { type: 'fern', elev: [600, 1700], spacing: 2.6, density: 0.55, maxSlope: 0.9, mask: { freq: 1 / 40, min: -0.2 } },
      { type: 'scrub', elev: [1500, 2000], spacing: 9, density: 0.3, maxSlope: 0.6 },
      { type: 'boulder', elev: [1700, 3000], spacing: 16, density: 0.25, minSlope: 0.2 },
    ],
    grass: { color: '#7d8a4c', height: 0.45, density: 0.6, patch: 0.1 },
    motes: { color: '#fff2c8', opacity: 0.6 },
    preview: { sil1: '#7d8e9a', sil2: '#2c3a28', ground: '#3c482d', snow: true },
    audio: { wind: 0.2, water: 0.0, waterRate: 0.2, birds: 0.8, chord: [110.0, 164.81, 220.0, 261.63] },
  },

  rowena: {
    label: 'Columbia River Gorge',
    group: 1,
    seed: 41,
    water: { level: 24.6, tolerance: 1.6, maxDepth: 25, shelf: 0.12, shallow: '#4c7c84', deep: '#1b3a48', reflect: 0.8, rough: 0.9, kind: 'river' },
    sky: { zenith: '#4c80bb', horizon: '#dfe3d8', sun: '#fff0cf', elevation: 20, azimuth: 240, clouds: 0.4, turbidity: 3.5, rayleigh: 1.4, mie: 0.005, mieG: 0.82 },
    fog: { near: 150, range: 22000 },
    exposure: 1.0,
    light: { sun: 3.0, env: 0.8 },
    mist: { density: 0.18, base: 30, falloff: 60 },
    ground: {
      stops: [[20, '#7c8350'], [120, '#9b9a5c'], [350, '#8f9157'], [700, '#7d8253']],
      rock: '#4c4743', sand: '#9b9070', alt: '#b0a466', canopy: '#3b4a2c',
    },
    ecology: [
      { type: 'oak', elev: [40, 450], spacing: 16, density: 0.3, maxSlope: 0.5, mask: { freq: 1 / 140, min: 0.05 } },
      { type: 'pine', elev: [150, 800], spacing: 18, density: 0.25, maxSlope: 0.55, mask: { freq: 1 / 200, min: 0.1 } },
      { type: 'boulder', elev: [20, 800], spacing: 14, density: 0.25, minSlope: 0.35 },
    ],
    grass: { color: '#c0b46a', height: 0.6, density: 0.85, patch: -0.15, shore: 1.5 },
    motes: { color: '#fff0b8', opacity: 0.45 },
    preview: { sil1: '#8a98a6', sil2: '#6b6f44', ground: '#1b3a48', snow: false },
    audio: { wind: 0.3, water: 0.08, waterRate: 0.2, birds: 0.6, chord: [146.83, 185.0, 220.0, 293.66] },
  },

  bigSur: {
    label: 'Big Sur',
    group: 2,
    seed: 53,
    water: { level: 0, tolerance: 1.4, maxDepth: 60, shelf: 0.06, shallow: '#2b8a8c', deep: '#0f3550', reflect: 0.75, rough: 1.2, kind: 'ocean' },
    sky: { zenith: '#5a74a0', horizon: '#f0c99c', sun: '#ffbf78', elevation: 8, azimuth: 255, clouds: 0.45, turbidity: 6, rayleigh: 2.2, mie: 0.007, mieG: 0.88 },
    fog: { near: 120, range: 16000 },
    exposure: 1.0,
    light: { sun: 3.0, env: 0.7 },
    mist: { density: 0.35, base: 0, falloff: 40 },
    ground: {
      stops: [[0, '#b39c74'], [25, '#a99757'], [300, '#9a8c55'], [900, '#6f6f4a']],
      rock: '#77706a', sand: '#cdb894', alt: '#6c6d47', canopy: '#2f3a28',
    },
    ecology: [
      { type: 'redwood', elev: [10, 700], spacing: 8, density: 0.7, maxSlope: 0.9, valley: 6, mask: { freq: 1 / 120, min: -0.2 } },
      { type: 'fern', elev: [10, 700], spacing: 3, density: 0.5, maxSlope: 0.9, valley: 5 },
      { type: 'oak', elev: [40, 900], spacing: 14, density: 0.25, maxSlope: 0.6, mask: { freq: 1 / 150, min: 0.1 } },
      { type: 'scrub', elev: [5, 1200], spacing: 7, density: 0.35, maxSlope: 0.9, mask: { freq: 1 / 90, min: 0.0 } },
      { type: 'boulder', elev: [-3, 600], spacing: 12, density: 0.25, minSlope: 0.4 },
    ],
    grass: { color: '#c9ad6a', height: 0.6, density: 0.8, patch: -0.1, shore: 3 },
    motes: { color: '#ffe2c0', opacity: 0.3 },
    preview: { sil1: '#5e5652', sil2: '#3a3634', ground: '#0f3550', snow: false },
    audio: { wind: 0.16, water: 0.45, waterRate: 0.09, birds: 0.15, chord: [123.47, 185.0, 246.94, 311.13] },
  },

  pointReyes: {
    label: 'Point Reyes',
    group: 2,
    seed: 67,
    water: { level: 0, tolerance: 0.9, maxDepth: 40, shelf: 0.05, shallow: '#3a8f8e', deep: '#163f57', reflect: 0.75, rough: 1.2, kind: 'ocean' },
    sky: { zenith: '#6e86ab', horizon: '#ecd3b4', sun: '#ffcf96', elevation: 14, azimuth: 250, clouds: 0.35, turbidity: 5, rayleigh: 2.0, mie: 0.006, mieG: 0.86 },
    fog: { near: 100, range: 12000 },
    exposure: 1.0,
    light: { sun: 3.0, env: 0.75 },
    mist: { density: 0.45, base: 0, falloff: 30 },
    ground: {
      stops: [[0, '#d0bd96'], [8, '#ad9c62'], [120, '#9a8f5a'], [350, '#76764e']],
      rock: '#c4b190', sand: '#dccaa2', alt: '#78784f', canopy: '#2e3a2a',
    },
    ecology: [
      { type: 'fir', elev: [120, 420], spacing: 9, density: 0.6, maxSlope: 0.8, mask: { freq: 1 / 140, min: -0.1 } },
      { type: 'cypress', elev: [5, 120], spacing: 30, density: 0.12, maxSlope: 0.3, mask: { freq: 1 / 300, min: 0.15 } },
      { type: 'fern', elev: [130, 420], spacing: 3, density: 0.4, maxSlope: 0.8, mask: { freq: 1 / 50, min: 0.0 } },
      { type: 'scrub', elev: [3, 300], spacing: 8, density: 0.3, maxSlope: 0.7, mask: { freq: 1 / 100, min: 0.05 } },
    ],
    grass: { color: '#c3ab6c', height: 0.55, density: 0.8, patch: -0.2, shore: 2.5 },
    motes: { color: '#ffe8c8', opacity: 0.3 },
    preview: { sil1: '#8c8576', sil2: '#5e5b46', ground: '#163f57', snow: false },
    audio: { wind: 0.22, water: 0.4, waterRate: 0.1, birds: 0.2, chord: [116.54, 174.61, 233.08, 277.18] },
  },
};

export const BIOMES = Object.fromEntries(
  Object.entries(AREAS).map(([key, a]) => [key, { ...a, key, place: REGIONS[key].name, region: { ...REGIONS[key], water: a.water } }]),
);
