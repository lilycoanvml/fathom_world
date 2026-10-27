import * as THREE from 'three';

const EYE = 1.7;
const WALK = 4.2;
const BRISK = 8.5;
const RADIUS = 0.4;
const MAX_WADE = 1.1; // deepest water you can walk into, in meters

export class Player {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2();
    this.yaw = 0;
    this.pitch = 0;
    this.eyeY = 0;
    this.wade = 0; // 0 dry .. 1 at max depth
    this.speed = 0;
    this.keys = new Set();
    this.enabled = false;
    camera.rotation.order = 'YXZ';

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * 0.0021;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0021, -1.35, 1.35);
    });
  }

  setKey(code, down) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  teleport(x, z, yaw, world) {
    this.pos.set(x, world.ground(x, z), z);
    this.vel.set(0, 0);
    this.yaw = yaw;
    this.pitch = -0.04;
    this.eyeY = this.pos.y + EYE;
    this.keys.clear();
    this.apply();
  }

  update(dt, world) {
    const k = this.keys;
    let fx = 0, fz = 0;
    if (this.enabled) {
      if (k.has('KeyW') || k.has('ArrowUp')) fz += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) fz -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
    }
    const len = Math.hypot(fx, fz) || 1;
    let speed = k.has('ShiftLeft') || k.has('ShiftRight') ? BRISK : WALK;
    // Water drags at your legs: slower the deeper you wade.
    speed *= 1 - 0.55 * this.wade;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const tx = ((fx * c - fz * s) / len) * speed;
    const tz = ((-fx * s - fz * c) / len) * speed;
    // Eased acceleration and a softer glide to a stop.
    const moving = fx !== 0 || fz !== 0;
    const ease = 1 - Math.exp(-dt * (moving ? 5 : 3.5));
    this.vel.x += (tx - this.vel.x) * ease;
    this.vel.y += (tz - this.vel.y) * ease;

    let nx = this.pos.x + this.vel.x * dt;
    let nz = this.pos.z + this.vel.y * dt;
    [nx, nz] = world.collide(nx, nz, RADIUS);
    // Deeper water gently holds you back; slide along the depth limit instead of stopping dead.
    const depth = (x, z) => world.waterLevel - world.height(x, z);
    if (depth(nx, nz) > MAX_WADE && depth(nx, nz) > depth(this.pos.x, this.pos.z)) {
      if (depth(nx, this.pos.z) <= MAX_WADE) nz = this.pos.z;
      else if (depth(this.pos.x, nz) <= MAX_WADE) nx = this.pos.x;
      else { nx = this.pos.x; nz = this.pos.z; }
      this.vel.multiplyScalar(0.5);
    }
    this.speed = Math.hypot(nx - this.pos.x, nz - this.pos.z) / Math.max(dt, 1e-4);
    this.pos.x = nx;
    this.pos.z = nz;
    const terrain = world.height(nx, nz);
    // Feet follow the lake or sea bed, but never sink deeper than the wading limit.
    this.pos.y = Math.max(terrain, world.waterLevel - MAX_WADE);
    this.wade = THREE.MathUtils.clamp((world.waterLevel - this.pos.y) / MAX_WADE, 0, 1);

    const target = this.pos.y + EYE;
    this.eyeY += (target - this.eyeY) * (1 - Math.exp(-dt * 6));
    this.eyeY = Math.max(this.eyeY, this.pos.y + EYE * 0.75);
    this.apply();
  }

  apply() {
    this.camera.position.set(this.pos.x, this.eyeY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
