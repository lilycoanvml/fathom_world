import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { Sky } from 'three/addons/objects/Sky.js';

// Exponential aerial perspective shared by every shader: ridges fade into the haze with distance.
const FOG_GLSL = /* glsl */ `
  float aerial(float d, float near, float range) { return 1.0 - exp(-max(d - near, 0.0) / range); }
`;

const cloudFragment = /* glsl */ `
  uniform vec3 uHorizon;
  uniform vec3 uSunCol;
  uniform vec3 uSunDir;
  uniform float uClouds;
  uniform float uTime;
  varying vec3 vDir;

  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) { s += a * vn(p); p = p * 2.03 + 1.7; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float el = d.y;
    if (el <= 0.0 || uClouds <= 0.0) discard;
    vec2 uv = d.xz / (el + 0.12) * 1.1 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(uv);
    float th = 0.64 - uClouds * 0.2;
    float c = smoothstep(th, th + 0.22, n) * smoothstep(0.0, 0.25, el);
    // Light from the sun side, soft self-shadow on the far side of each cloud.
    float shade = fbm(uv + uSunDir.xz * 0.08);
    float sd = max(dot(d, uSunDir), 0.0);
    vec3 lit = mix(vec3(1.0), uSunCol, 0.35) * (1.05 - 0.45 * smoothstep(0.4, 0.8, shade));
    vec3 col = mix(lit, uHorizon, 0.25 + 0.5 * (1.0 - smoothstep(0.0, 0.3, el)));
    col += uSunCol * pow(sd, 8.0) * 0.6;
    gl_FragColor = vec4(col, c * 0.9);
  }
`;

const cloudVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const waterShader = {
  name: 'FathomWater',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    tDepth: { value: null },
    uDepthSize: { value: 1 },
    uHasDepth: { value: 0 },
    uSurf: { value: 0 },
    uShallow: { value: new THREE.Color() },
    uDeep: { value: new THREE.Color() },
    uReflect: { value: 1 },
    uRough: { value: 1 },
    uZenith: { value: null },
    uHorizon: { value: null },
    uSunCol: { value: null },
    uSunDir: { value: null },
    uFogColor: { value: null },
    uFogNear: { value: 0 },
    uFogFar: { value: 0 },
    uTime: { value: 0 },
    uPlayer: { value: null },
    uWade: { value: 0 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform float uDepthSize;
    uniform float uHasDepth;
    uniform float uSurf;
    uniform vec3 uShallow;
    uniform vec3 uDeep;
    uniform vec3 uZenith;
    uniform vec3 uHorizon;
    uniform vec3 uSunCol;
    uniform vec3 uSunDir;
    uniform vec3 uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;
    uniform float uTime;
    uniform float uReflect;
    uniform float uRough;
    uniform vec3 uPlayer;
    uniform float uWade;
    varying vec4 vUv;
    varying vec3 vWorld;
    ${FOG_GLSL}

    float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
    }
    vec2 wave(vec2 p, vec2 dir, float freq, float speed, float amp) {
      return dir * cos(dot(p, dir) * freq + uTime * speed) * freq * amp;
    }

    void main() {
      vec2 p = vWorld.xz;
      vec3 toFrag = vWorld - cameraPosition;
      float dist = length(toFrag);
      vec3 v = toFrag / dist;

      // Real water depth from the terrain data (positive below the surface).
      float depth = 30.0;
      if (uHasDepth > 0.5) depth = -texture2D(tDepth, p / uDepthSize + 0.5).r;

      vec2 g = wave(p, normalize(vec2(1.0, 0.3)), 0.35, 1.0, 0.03)
             + wave(p, normalize(vec2(-0.4, 1.0)), 0.62, 1.4, 0.018)
             + wave(p, normalize(vec2(0.7, -0.8)), 1.3, 2.0, 0.008)
             + wave(p, normalize(vec2(-1.0, -0.2)), 2.7, 2.8, 0.004)
             + wave(p, normalize(vec2(0.3, 1.0)), 5.3, 3.6, 0.0018);
      g *= uRough * mix(1.0, 0.25, smoothstep(300.0, 3000.0, dist));
      vec2 rp = p - uPlayer.xz;
      float rd = length(rp);
      g += (rp / max(rd, 0.001)) * cos(rd * 5.0 - uTime * 5.0) * exp(-rd * 0.45) * 0.12 * uWade;

      vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
      vec3 r = reflect(v, n);
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-v, n), 0.0), 5.0);

      vec2 ruv = vUv.xy / vUv.w + n.xz * 0.035;
      vec3 refl = texture2D(tDiffuse, ruv).rgb;
      vec3 sky = mix(uHorizon, uZenith, pow(clamp(r.y, 0.0, 1.0), 0.5));
      refl = mix(refl, sky, 0.08);

      // Turquoise shallows, deep colour offshore.
      vec3 base = mix(uShallow, uDeep, smoothstep(0.5, 22.0, depth));
      base = mix(base, uDeep, 0.35 * (1.0 - abs(v.y)));
      vec3 col = mix(base, refl, clamp(fres * uReflect + 0.15, 0.0, 1.0));
      col += uSunCol * pow(max(dot(r, uSunDir), 0.0), 350.0) * 3.0;

      // Foam: a lacy line at the shore, and for the ocean, surf rolling in over the shallows.
      float lace = vn(p * 0.9 + uTime * 0.25) * 0.6 + vn(p * 2.7 - uTime * 0.3) * 0.4;
      float shore = smoothstep(0.9, 0.05, depth) * smoothstep(0.35, 0.6, lace);
      float band = sin(depth * 1.6 - uTime * 1.3 + vn(p * 0.05) * 6.0);
      float surf = uSurf * smoothstep(0.82, 0.98, band) * smoothstep(7.0, 1.0, depth) * smoothstep(0.3, 0.55, lace);
      float foam = clamp(shore + surf, 0.0, 1.0) * uHasDepth;
      col = mix(col, vec3(0.93, 0.95, 0.95), foam * 0.85);

      float fogF = aerial(dist, uFogNear, uFogFar);
      col = mix(col, uFogColor, fogF);
      float alpha = mix(0.55, 0.97, fres);
      alpha = mix(alpha * mix(0.45, 1.0, smoothstep(0.0, 3.0, depth)), 1.0, max(foam, fogF));
      gl_FragColor = vec4(col, alpha);
    }
  `,
};

// Height mist + exponential fog for the scene's own materials (terrain, vegetation, grass).
export function addMist(material, shared) {
  const prev = material.onBeforeCompile;
  // Distinct cache key, so differently patched materials never share a program.
  const key = 'mist|' + (prev ? prev.toString() : '');
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uMistDensity = shared.uMistDensity;
    shader.uniforms.uMistBase = shared.uMistBase;
    shader.uniforms.uMistFalloff = shared.uMistFalloff;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMistWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMistWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#ifdef USE_INSTANCING\nvMistWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vMistWorld;\nuniform float uMistDensity;\nuniform float uMistBase;\nuniform float uMistFalloff;\n${FOG_GLSL}`)
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
          float fogFactor = aerial(vFogDepth, fogNear, fogFar);
          float mistH = exp(-max(vMistWorld.y - uMistBase, 0.0) / uMistFalloff);
          float mist = uMistDensity * mistH * smoothstep(3.0, 90.0, vFogDepth);
          fogFactor = clamp(fogFactor + mist * (1.0 - fogFactor), 0.0, 1.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
        #endif`,
      );
  };
}

export { FOG_GLSL };

function sunDirection(sky) {
  const e = THREE.MathUtils.degToRad(sky.elevation);
  const a = THREE.MathUtils.degToRad(sky.azimuth);
  return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
}

export class Atmosphere {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.shared = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      uFogNear: { value: 100 },
      uFogFar: { value: 10000 },
      uWaterLevel: { value: -1e4 },
      uMistDensity: { value: 0 },
      uMistBase: { value: 0 },
      uMistFalloff: { value: 10 },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uPlayer: { value: new THREE.Vector3() },
      uWade: { value: 0 },
    };
    const S = this.shared;

    scene.fog = new THREE.Fog(0xffffff, 100, 10000);

    // Physically based sky (Rayleigh + Mie scattering).
    this.sky = new Sky();
    this.sky.scale.setScalar(80000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(70000, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: cloudVertex,
        fragmentShader: cloudFragment,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        uniforms: { uHorizon: S.uHorizon, uSunCol: S.uSunCol, uSunDir: S.uSunDir, uTime: S.uTime, uClouds: { value: 0 } },
      }),
    );
    this.clouds.renderOrder = -9;
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);

    // Image-based ambient light from the same sky, so shade picks up its colour.
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(900);
    this.envScene.add(this.envSky);
    this.envTarget = null;
    // A tiny cube capture of the sky, read back to find its true horizon colour for the haze.
    this.cubeTarget = new THREE.WebGLCubeRenderTarget(16, { type: THREE.HalfFloatType });
    this.cubeCam = new THREE.CubeCamera(0.1, 2000, this.cubeTarget);
    this.envScene.add(this.cubeCam);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 1; sc.far = 800;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.08;
    scene.add(this.sun);
    scene.add(this.sun.target);

    const scale = 0.4;
    this.water = new Reflector(new THREE.PlaneGeometry(240000, 240000), {
      shader: waterShader,
      textureWidth: Math.round(window.innerWidth * scale),
      textureHeight: Math.round(window.innerHeight * scale),
      clipBias: 0.02,
      multisample: 0,
    });
    this.water.rotation.x = -Math.PI / 2;
    this.waterMat = this.water.material;
    this.waterMat.transparent = true;
    this.waterMat.depthWrite = false;
    for (const k of ['uZenith', 'uHorizon', 'uSunCol', 'uSunDir', 'uFogColor', 'uFogNear', 'uFogFar', 'uTime', 'uPlayer', 'uWade'])
      this.waterMat.uniforms[k] = S[k];
    this.water.frustumCulled = false;
    this.water.renderOrder = 1;
    scene.add(this.water);
  }

  apply(biome, heightfield) {
    const S = this.shared;
    const sun = sunDirection(biome.sky);
    S.uZenith.value.set(biome.sky.zenith);
    S.uHorizon.value.set(biome.sky.horizon);
    S.uSunCol.value.set(biome.sky.sun);
    S.uSunDir.value.copy(sun);
    S.uFogColor.value.set(biome.sky.horizon);
    S.uFogNear.value = biome.fog.near;
    S.uFogFar.value = biome.fog.range;
    this.clouds.material.uniforms.uClouds.value = biome.sky.clouds;

    for (const sky of [this.sky, this.envSky]) {
      const u = sky.material.uniforms;
      u.turbidity.value = biome.sky.turbidity;
      u.rayleigh.value = biome.sky.rayleigh;
      u.mieCoefficient.value = biome.sky.mie;
      u.mieDirectionalG.value = biome.sky.mieG;
      u.sunPosition.value.copy(sun);
    }
    const art = new THREE.Color(biome.sky.horizon);
    const sampled = this.horizonColor();
    const horizon = sampled ? sampled.lerp(art, 0.2) : art;
    S.uHorizon.value.copy(horizon);
    S.uFogColor.value.copy(horizon);
    if (this.envTarget) this.envTarget.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = biome.light.env;

    this.scene.fog.color.copy(horizon);
    this.scene.fog.near = biome.fog.near;
    this.scene.fog.far = biome.fog.range;
    this.renderer.toneMappingExposure = biome.exposure;

    this.sun.color.set(biome.sky.sun);
    this.sun.intensity = biome.light.sun;

    const u = this.waterMat.uniforms;
    if (u.tDepth.value) u.tDepth.value.dispose();
    u.tDepth.value = null;
    u.uHasDepth.value = 0;
    this.water.visible = !!biome.water;
    if (biome.water) {
      u.uShallow.value.set(biome.water.shallow);
      u.uDeep.value.set(biome.water.deep);
      u.uReflect.value = biome.water.reflect;
      u.uRough.value = biome.water.rough;
      u.uSurf.value = biome.water.kind === 'ocean' ? 1 : 0;
      this.water.position.y = biome.water.level;
      if (heightfield) {
        u.tDepth.value = heightfield.depthTexture(biome.water.level);
        u.uDepthSize.value = heightfield.size;
        u.uHasDepth.value = 1;
      }
    }
    S.uWaterLevel.value = biome.water ? biome.water.level : -1e4;
    const mist = biome.mist ?? { density: 0, base: 0, falloff: 10 };
    S.uMistDensity.value = mist.density;
    S.uMistBase.value = mist.base;
    S.uMistFalloff.value = mist.falloff;
  }

  // Average sky radiance just above the horizon, away from the sun (linear HDR).
  horizonColor() {
    this.cubeCam.update(this.renderer, this.envScene);
    const buf = new Uint16Array(16 * 4);
    const sum = new THREE.Color(0, 0, 0);
    let n = 0;
    for (const face of [0, 1, 4, 5]) {
      this.renderer.readRenderTargetPixels(this.cubeTarget, 0, 7, 16, 1, buf, face);
      for (let i = 0; i < 16; i++) {
        const r = THREE.DataUtils.fromHalfFloat(buf[i * 4]);
        const g = THREE.DataUtils.fromHalfFloat(buf[i * 4 + 1]);
        const b = THREE.DataUtils.fromHalfFloat(buf[i * 4 + 2]);
        if (r + g + b > 6) continue; // skip the sun disc
        sum.r += r; sum.g += g; sum.b += b;
        n++;
      }
    }
    if (!n || sum.r + sum.g + sum.b < 0.03 * n) return null; // readback unsupported
    return sum.multiplyScalar(1 / n);
  }

  resize(w, h) {
    const scale = 0.4;
    this.water.getRenderTarget().setSize(Math.round(w * scale), Math.round(h * scale));
  }

  update(camera, t) {
    this.shared.uTime.value = t;
    const p = camera.position;
    this.sky.position.copy(p);
    this.clouds.position.copy(p);
    // Shadow camera follows the viewer, snapped to texels to avoid shimmer.
    const dir = this.shared.uSunDir.value;
    const snap = 180 / 2048;
    const tx = Math.round(p.x / snap) * snap, tz = Math.round(p.z / snap) * snap;
    this.sun.target.position.set(tx, p.y, tz);
    this.sun.position.set(tx + dir.x * 400, p.y + dir.y * 400, tz + dir.z * 400);
  }
}
