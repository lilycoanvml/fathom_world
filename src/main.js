import * as THREE from 'three';
import { BIOMES, BRAND_COLORS } from './biomes.js';
import { World } from './world.js';
import { Atmosphere } from './atmosphere.js';
import { Player } from './player.js';
import { Ambience } from './audio.js';
import { Grass } from './grass.js';
import { Motes } from './motes.js';
import { mulberry32 } from './noise.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e9);
const rand = mulberry32(seed);

// Antialiasing happens in the composer's multisampled target, not the canvas.
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio, 1.5);
let pixelRatio = Math.min(MAX_PIXEL_RATIO, 1.25);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
// Far plane reaches the real horizon (~100 km of terrain) and the sky dome.
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.8, 160000);
// Layer 1 holds near-viewer detail (grass, motes) that water reflections can skip.
camera.layers.enable(1);
const atmosphere = new Atmosphere(scene, renderer);
const world = new World(scene, atmosphere.shared, renderer);
const player = new Player(camera, renderer.domElement);
const audio = new Ambience();
const grass = new Grass(scene, atmosphere.shared);
const motes = new Motes(scene, atmosphere.shared);
grass.mesh.layers.set(1);
motes.points.layers.set(1);

// Post: MSAA scene render, restrained bloom (sun, glints), tone mapping, then a soft lens vignette.
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 }),
);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.22, 0.55, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());
composer.addPass(
  new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        c = mix(c, c * c * (3.0 - 2.0 * c), 0.18);
        float v = smoothstep(1.05, 0.35, length(vUv - 0.5) * 1.25);
        gl_FragColor = vec4(c * mix(0.82, 1.0, v), 1.0);
      }`,
  }),
);

const ui = {
  start: document.getElementById('start'),
  paused: document.getElementById('paused'),
  hint: document.getElementById('hint'),
  area: document.getElementById('area'),
  fade: document.getElementById('fade'),
  fadeText: document.getElementById('fade-text'),
  startBtn: document.getElementById('start-btn'),
  place: document.getElementById('place'),
  placeName: document.getElementById('place-name'),
  placeCoords: document.getElementById('place-coords'),
};

let started = false;
let busy = false;
let portalLockUntil = 0;
let hintTimer = 0;
let areaTimer = 0;

async function enterArea(biomeKey, spawn) {
  await world.setBiome(biomeKey);
  atmosphere.apply(world.biome, world.hf);
  const s = spawn ?? world.findSpawn(rand);
  player.teleport(s.x, s.z, s.yaw, world);
  world.update(s.x, s.z, -1);
  grass.setBiome(world.biome.grass);
  grass.update(s.x, s.z, world);
  motes.setBiome(world.biome.motes);
  audio.setBiome(world.biome.audio);
  ui.placeName.textContent = s.name ? `${s.name} · ${world.biome.place}` : world.biome.place;
  console.info(`[fathom] ${biomeKey} @ ${s.x.toFixed(1)}, ${s.z.toFixed(1)} (seed ${seed})`);
}

function showArea(biome) {
  clearTimeout(areaTimer);
  ui.area.textContent = biome.label;
  ui.area.style.background = BRAND_COLORS[biome.group];
  ui.area.classList.add('show');
  areaTimer = setTimeout(() => ui.area.classList.remove('show'), 3200);
}

function showHint(ms = 9000) {
  clearTimeout(hintTimer);
  ui.hint.classList.remove('hidden');
  hintTimer = setTimeout(() => ui.hint.classList.add('hidden'), ms);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// One relocation at a time: portal entries and R presses during a transition are ignored.
async function relocate(biomeKey) {
  if (busy) return;
  busy = true;
  player.enabled = false;
  audio.transition();
  ui.fade.style.background = BRAND_COLORS[BIOMES[biomeKey].group];
  ui.fade.style.opacity = '1';
  ui.fadeText.textContent = `Traveling to ${BIOMES[biomeKey].place}`;
  await wait(480);
  // Let the wash paint before the world rebuild.
  await new Promise(requestAnimationFrame);
  try {
    await enterArea(biomeKey);
  } catch (err) {
    console.error('[fathom] arrival failed, using fallback', err);
    await enterArea(world.biomeKey ?? 'craterLake');
  }
  composer.render();
  ui.fadeText.textContent = '';
  ui.fade.style.opacity = '0';
  showArea(world.biome);
  portalLockUntil = performance.now() + 1500;
  player.enabled = document.pointerLockElement === renderer.domElement;
  await wait(500);
  busy = false;
}

function randomOtherBiome() {
  const keys = Object.keys(BIOMES).filter((k) => k !== world.biomeKey);
  return keys[Math.floor(Math.random() * keys.length)];
}

// ---------- Input ----------

function lock() {
  renderer.domElement.requestPointerLock();
}

ui.start.addEventListener('click', () => {
  if (!ready) return;
  if (!started) {
    started = true;
    audio.start();
    ui.start.classList.add('hidden');
    showHint();
    showArea(world.biome);
  }
  lock();
});
ui.paused.addEventListener('click', lock);

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  player.enabled = locked && !busy;
  if (!locked) player.keys.clear();
  if (started) ui.paused.classList.toggle('hidden', locked);
});

const isTyping = (e) => e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));

document.addEventListener('keydown', (e) => {
  if (isTyping(e)) return;
  player.setKey(e.code, true);
  if (!started || e.repeat) return;
  if (e.code === 'KeyR') relocate(randomOtherBiome());
  if (e.code === 'KeyM') audio.toggleMute();
  if (e.code === 'KeyH') showHint(6000);
});
document.addEventListener('keyup', (e) => player.setKey(e.code, false));
window.addEventListener('blur', () => player.keys.clear());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  atmosphere.resize(window.innerWidth, window.innerHeight);
});

// ---------- Boot + loop ----------

const startBiome = BIOMES[params.get('biome')] ? params.get('biome') : 'bigSur';
let ready = false;
ui.startBtn.disabled = true;
ui.startBtn.textContent = 'Loading…';
enterArea(startBiome).then(() => {
  ready = true;
  ui.startBtn.disabled = false;
  ui.startBtn.textContent = 'Click to explore';
});

const clock = new THREE.Clock();
const toPortal = new THREE.Vector3();
const right = new THREE.Vector3();
const shared = atmosphere.shared;
let windAngle = 0;
let prefetched = null;
let placeTick = 0;

// Where you are, as real coordinates and elevation.
function updatePlace() {
  if (++placeTick % 15) return;
  const [lat, lon] = world.hf.latLon(player.pos.x, player.pos.z);
  const elev = Math.max(0, player.pos.y);
  ui.placeCoords.textContent = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'} · ${Math.round(elev * 3.281).toLocaleString()} ft`;
}

// Adaptive resolution: trade pixels for a steady frame rate on any GPU.
let frames = 0;
let frameWindow = performance.now();
function adaptResolution() {
  frames++;
  const now = performance.now();
  if (now - frameWindow < 1500) return;
  const fps = (frames * 1000) / (now - frameWindow);
  frames = 0;
  frameWindow = now;
  if (busy || document.hidden) return;
  let next = pixelRatio;
  if (fps < 48) next = Math.max(0.6, pixelRatio - 0.15);
  else if (fps > 58 && pixelRatio < MAX_PIXEL_RATIO) next = Math.min(MAX_PIXEL_RATIO, pixelRatio + 0.05);
  if (Math.abs(next - pixelRatio) < 0.01) return;
  pixelRatio = next;
  renderer.setPixelRatio(pixelRatio);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(window.innerWidth, window.innerHeight);
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (!ready) {
    composer.render();
    return;
  }
  if (!busy) {
    player.update(dt, world);
    world.update(player.pos.x, player.pos.z);
    grass.update(player.pos.x, player.pos.z, world);
  }
  const { entered, nearest, nearestD } = world.portals.update(player.pos.x, player.pos.y, player.pos.z, dt);
  if (entered && !busy && started && performance.now() > portalLockUntil) relocate(entered.dest);

  if (nearest && nearestD < 80 && nearest.dest !== prefetched) {
    prefetched = nearest.dest;
    world.prefetch(prefetched);
  }
  updatePlace();

  if (nearest) {
    toPortal.set(nearest.x - camera.position.x, 0, nearest.z - camera.position.z).normalize();
    right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    audio.setPortal(1 - THREE.MathUtils.smoothstep(nearestD, 4, 40), toPortal.dot(right));
  } else {
    audio.setPortal(0, 0);
  }
  audio.setWade(player.wade, player.speed);

  // The wind leans toward the nearest portal: gusts and pollen quietly point the way.
  const targetAngle = nearest && nearestD < 220
    ? Math.atan2(nearest.z - player.pos.z, nearest.x - player.pos.x)
    : THREE.MathUtils.degToRad(world.biome.sky.azimuth);
  let da = targetAngle - windAngle;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  windAngle += da * (1 - Math.exp(-dt * 0.4));
  shared.uWindDir.value.set(Math.cos(windAngle), Math.sin(windAngle));
  shared.uPlayer.value.copy(player.pos);
  shared.uWade.value += (Math.min(1, player.wade * 3) * Math.min(1, player.speed / 2 + 0.2) - shared.uWade.value) * Math.min(1, dt * 3);

  atmosphere.update(camera, t);
  motes.update(camera);
  composer.render();
  adaptResolution();
});

if (params.has('debug')) window.fathom = { world, player, camera, relocate, audio, composer, bloom, atmosphere, grass, renderer };
