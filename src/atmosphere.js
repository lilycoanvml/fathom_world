import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { makeNoise } from './noise.js';

const skyFragment = /* glsl */ `
  uniform vec3 uZenith;
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
    for (int i = 0; i < 5; i++) { s += a * vn(p); p *= 2.03; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float el = d.y;
    vec3 col = mix(uHorizon, uZenith, pow(clamp(el, 0.0, 1.0), 0.5));
    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunCol * (pow(sd, 900.0) * 6.0 + pow(sd, 24.0) * 0.22 + pow(sd, 4.0) * 0.1);
    if (el > 0.0 && uClouds > 0.0) {
      vec2 uv = d.xz / (el + 0.15) * 1.3 + vec2(uTime * 0.005, uTime * 0.002);
      float n = fbm(uv);
      float th = 0.66 - uClouds * 0.2;
      float c = smoothstep(th, th + 0.2, n) * smoothstep(0.0, 0.2, el);
      vec3 cloud = mix(uHorizon, vec3(1.0), 0.55) * (0.82 + 0.25 * fbm(uv * 2.0 + 5.0));
      cloud += uSunCol * pow(sd, 6.0) * 0.5;
      col = mix(col, cloud, c * 0.85);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const skyVertex = /* glsl */ `
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

    vec2 wave(vec2 p, vec2 dir, float freq, float speed, float amp) {
      return dir * cos(dot(p, dir) * freq + uTime * speed) * freq * amp;
    }

    void main() {
      vec2 p = vWorld.xz;
      vec2 g = wave(p, normalize(vec2(1.0, 0.3)), 0.35, 1.0, 0.03)
             + wave(p, normalize(vec2(-0.4, 1.0)), 0.62, 1.4, 0.018)
             + wave(p, normalize(vec2(0.7, -0.8)), 1.3, 2.0, 0.008)
             + wave(p, normalize(vec2(-1.0, -0.2)), 2.7, 2.8, 0.004)
             + wave(p, normalize(vec2(0.3, 1.0)), 5.3, 3.6, 0.0018);
      g *= uRough;
      // Rings spreading out from the viewer while wading.
      vec2 rp = p - uPlayer.xz;
      float rd = length(rp);
      g += (rp / max(rd, 0.001)) * cos(rd * 5.0 - uTime * 5.0) * exp(-rd * 0.45) * 0.12 * uWade;

      vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
      vec3 toFrag = vWorld - cameraPosition;
      float dist = length(toFrag);
      vec3 v = toFrag / dist;
      vec3 r = reflect(v, n);
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-v, n), 0.0), 5.0);

      // Mirror reflection of the real scene, gently distorted by the ripples.
      vec2 ruv = vUv.xy / vUv.w + n.xz * 0.035;
      vec3 refl = texture2D(tDiffuse, ruv).rgb;
      vec3 sky = mix(uHorizon, uZenith, pow(clamp(r.y, 0.0, 1.0), 0.5));
      refl = mix(refl, sky, 0.08);

      vec3 base = mix(uShallow, uDeep, 0.35 + 0.65 * smoothstep(0.0, 1.0, 1.0 - abs(v.y)));
      vec3 col = mix(base, refl, clamp(fres * uReflect + 0.18, 0.0, 1.0));
      col += uSunCol * pow(max(dot(r, uSunDir), 0.0), 350.0) * 3.0;
      float fogF = smoothstep(uFogNear, uFogFar, dist);
      col = mix(col, uFogColor, fogF);
      float alpha = mix(0.62, 0.97, fres);
      alpha = mix(alpha, 1.0, fogF);
      gl_FragColor = vec4(col, alpha);
    }
  `,
};

// Height mist + fog for the scene's own materials (terrain, props, grass).
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
      .replace('#include <common>', '#include <common>\nvarying vec3 vMistWorld;\nuniform float uMistDensity;\nuniform float uMistBase;\nuniform float uMistFalloff;')
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
          float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
          float mistH = exp(-max(vMistWorld.y - uMistBase, 0.0) / uMistFalloff);
          float mist = uMistDensity * mistH * smoothstep(3.0, 70.0, vFogDepth);
          fogFactor = clamp(fogFactor + mist * (1.0 - fogFactor), 0.0, 1.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
        #endif`,
      );
  };
}

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
      uFogFar: { value: 400 },
      uWaterLevel: { value: -1e4 },
      uMistDensity: { value: 0 },
      uMistBase: { value: 0 },
      uMistFalloff: { value: 10 },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uPlayer: { value: new THREE.Vector3() },
      uWade: { value: 0 },
    };
    const S = this.shared;

    scene.fog = new THREE.Fog(0xffffff, 100, 400);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(3000, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        uniforms: { uZenith: S.uZenith, uHorizon: S.uHorizon, uSunCol: S.uSunCol, uSunDir: S.uSunDir, uTime: S.uTime, uClouds: { value: 0 } },
      }),
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 1; sc.far = 500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    scene.add(this.sun);
    scene.add(this.sun.target);

    const scale = 0.4;
    this.water = new Reflector(new THREE.PlaneGeometry(5000, 5000), {
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

    this.silhouettes = new THREE.Group();
    scene.add(this.silhouettes);
  }

  apply(biome) {
    const S = this.shared;
    S.uZenith.value.set(biome.sky.zenith);
    S.uHorizon.value.set(biome.sky.horizon);
    S.uSunCol.value.set(biome.sky.sun);
    S.uSunDir.value.copy(sunDirection(biome.sky));
    S.uFogColor.value.set(biome.sky.horizon);
    S.uFogNear.value = biome.fog.near;
    S.uFogFar.value = biome.fog.far;
    this.sky.material.uniforms.uClouds.value = biome.sky.clouds;

    this.scene.fog.color.set(biome.sky.horizon);
    this.scene.fog.near = biome.fog.near;
    this.scene.fog.far = biome.fog.far;
    this.renderer.toneMappingExposure = biome.exposure;

    this.sun.color.set(biome.sky.sun);
    this.sun.intensity = biome.light.sun;
    this.hemi.color.set(biome.light.hemiSky);
    this.hemi.groundColor.set(biome.light.hemiGround);
    this.hemi.intensity = biome.light.hemi;

    this.water.visible = !!biome.water;
    if (biome.water) {
      const u = this.waterMat.uniforms;
      u.uShallow.value.set(biome.water.shallow);
      u.uDeep.value.set(biome.water.deep);
      u.uReflect.value = biome.water.reflect;
      u.uRough.value = biome.water.rough;
      this.water.position.y = biome.water.level;
    }
    S.uWaterLevel.value = biome.water ? biome.water.level : -1e4;
    const mist = biome.mist ?? { density: 0, base: 0, falloff: 10 };
    S.uMistDensity.value = mist.density;
    S.uMistBase.value = mist.base;
    S.uMistFalloff.value = mist.falloff;
    this.buildSilhouettes(biome);
  }

  // Layered distant ridgelines that travel with the viewer, like real horizons.
  buildSilhouettes(biome) {
    for (const m of this.silhouettes.children) {
      m.geometry.dispose();
      m.material.dispose();
    }
    this.silhouettes.clear();
    const N = makeNoise(biome.seed + 500);
    const fog = new THREE.Color(biome.sky.horizon);
    const snow = new THREE.Color('#eef2f6');
    const SEGS = 720;
    biome.silhouettes.forEach((layer, li) => {
      const pos = [];
      const colors = [];
      const idx = [];
      const body = new THREE.Color(layer.color).lerp(fog, layer.haze);
      const snowCol = snow.clone().lerp(fog, layer.haze * 0.5);
      const snowLine = layer.snow ? layer.h[0] + layer.snow * (layer.h[1] - layer.h[0]) : Infinity;
      const ROWS = [0, 0.45, 0.7, 0.85, 1];
      const R = ROWS.length;
      for (let i = 0; i <= SEGS; i++) {
        const a = (i / SEGS) * Math.PI * 2;
        const cx = Math.cos(a), sz = Math.sin(a);
        let n = (N.fbm(cx * layer.freq + li * 9, sz * layer.freq - li * 5, 6) + 1) / 2;
        n = Math.min(1, Math.max(0, (n - 0.2) / 0.6));
        if (layer.mesa) n = Math.round(n * 5) / 5 + N.fbm(cx * 40, sz * 40, 2) * 0.01;
        if (layer.stacks) n = Math.pow(n, 2.5);
        const top = Math.max(0, layer.h[0] + n * (layer.h[1] - layer.h[0]));
        const x = cx * layer.radius, z = sz * layer.radius;
        ROWS.forEach((f, ri) => {
          const y = top * f;
          pos.push(x, y, z);
          // Snow covers everything above a shared altitude, so caps join up.
          const c = ri === 0 ? fog : y > snowLine ? snowCol : body;
          colors.push(c.r, c.g, c.b);
        });
        if (i < SEGS) {
          const b = i * R;
          for (let r = 0; r < R - 1; r++) idx.push(b + r, b + R + r, b + r + 1, b + r + 1, b + R + r, b + R + r + 1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
      mesh.userData.base = layer.base;
      mesh.frustumCulled = false;
      this.silhouettes.add(mesh);
    });
  }

  resize(w, h) {
    const scale = 0.4;
    this.water.getRenderTarget().setSize(Math.round(w * scale), Math.round(h * scale));
  }

  update(camera, t) {
    this.shared.uTime.value = t;
    const p = camera.position;
    this.sky.position.copy(p);
    for (const m of this.silhouettes.children) m.position.set(p.x, p.y + m.userData.base, p.z);
    this.water.position.x = Math.round(p.x / 50) * 50;
    this.water.position.z = Math.round(p.z / 50) * 50;
    // Shadow camera follows the viewer, snapped to texels to avoid shimmer.
    const dir = this.shared.uSunDir.value;
    const snap = 160 / 2048;
    const tx = Math.round(p.x / snap) * snap, tz = Math.round(p.z / snap) * snap;
    this.sun.target.position.set(tx, p.y, tz);
    this.sun.position.set(tx + dir.x * 200, p.y + dir.y * 200, tz + dir.z * 200);
  }
}
