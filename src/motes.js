import * as THREE from 'three';

const COUNT = 700;
const BOX = 44;

// Pollen and light motes drifting with the wind — a quiet hint of where to go.
export class Motes {
  constructor(scene, shared) {
    const pos = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      pos.set([Math.random() * BOX, Math.random() * 14, Math.random() * BOX], i * 3);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: shared.uTime,
        uWindDir: shared.uWindDir,
        uCam: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color('#fff6dc') },
        uOpacity: { value: 0.5 },
        uPixel: { value: window.devicePixelRatio },
      },
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float uTime;
        uniform vec2 uWindDir;
        uniform vec3 uCam;
        uniform float uPixel;
        varying float vFade;
        void main() {
          float B = ${BOX.toFixed(1)};
          vec3 p = position;
          p.xz += uWindDir * uTime * (0.6 + seed * 0.9);
          p.y += sin(uTime * 0.6 + seed * 40.0) * 0.6 + uTime * (seed - 0.5) * 0.08;
          p.x += sin(uTime * 0.8 + seed * 17.0) * 0.4;
          // Wrap into a box that travels with the camera.
          p.xz = mod(p.xz - uCam.xz + B * 0.5, B) + uCam.xz - B * 0.5;
          p.y = mod(p.y - uCam.y + 4.0, 14.0) + uCam.y - 4.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = length(p.xz - uCam.xz);
          vFade = (1.0 - smoothstep(B * 0.3, B * 0.5, d)) * smoothstep(0.5, 2.0, -mv.z);
          gl_PointSize = uPixel * (2.0 + seed * 3.0) * (12.0 / -mv.z);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vFade;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vFade * uOpacity;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setBiome(cfg) {
    this.points.visible = !!cfg;
    if (cfg) {
      this.material.uniforms.uColor.value.set(cfg.color);
      this.material.uniforms.uOpacity.value = cfg.opacity;
    }
  }

  update(camera) {
    this.material.uniforms.uCam.value.copy(camera.position);
  }
}
