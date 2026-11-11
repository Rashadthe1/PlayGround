// Pooled particle bursts and shockwave rings.
import * as THREE from 'three';

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.max = 700;
    this.pos = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.maxLife = new Float32Array(this.max);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -999;
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.34, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.rings = [];
    this.dustTimer = 0;
  }

  burst(pos, count = 6, color = new THREE.Color(0xff6a4a), speed = 1.2, life = 0.8) {
    for (let n = 0; n < count; n++) {
      const i = this.cursor++ % this.max;
      this.pos[i * 3] = pos.x + (Math.random() - 0.5) * 0.4;
      this.pos[i * 3 + 1] = pos.y + (Math.random() - 0.3) * 0.5;
      this.pos[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.4;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random());
      this.vel[i * 3] = Math.cos(a) * s;
      this.vel[i * 3 + 1] = (Math.random() * 1.8 + 0.4) * speed * 0.6;
      this.vel[i * 3 + 2] = Math.sin(a) * s;
      this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
      this.life[i] = life * (0.5 + Math.random() * 0.7);
      this.maxLife[i] = this.life[i];
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  ring(pos, radius = 20, color = 0xffe6a0) {
    const geo = new THREE.RingGeometry(0.4, 0.55, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.position.y += 0.4;
    this.scene.add(mesh);
    this.rings.push({ mesh, t: 0, radius, color });
  }

  dust(pos, speed = 1) {
    if (Math.random() > 0.4) return;
    this.dustTimer = 0.12;
    this.burst(new THREE.Vector3(pos.x, pos.y + 0.12, pos.z), 2, new THREE.Color(0x9d9070), 0.5 * speed, 0.5);
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; continue; }
      this.vel[i * 3 + 1] -= 6.5 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / 1.1;
      r.mesh.scale.setScalar(1 + k * r.radius);
      r.mesh.material.opacity = Math.max(0, 0.85 * (1 - k));
      if (k >= 1) { this.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); this.rings.splice(i, 1); }
    }
  }
}
