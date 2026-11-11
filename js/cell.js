// Cell Stage: a playable microscopic pond with feeding, predators and evolution.
import * as THREE from 'three';
import { clamp, damp, mulberry32, randRange, TAU, lerp } from './util.js';
import { normalizeGenome } from './genome.js';

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(220,255,245,0.9)');
  g.addColorStop(0.55, 'rgba(120,255,220,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

class CellRig {
  constructor(color = 0x7bf0d0, size = 1, predator = false) {
    this.group = new THREE.Group();
    this.size = size;
    this.t = Math.random() * 10;
    this.membraneMat = new THREE.MeshStandardMaterial({
      color, transparent: true, opacity: 0.62, roughness: 0.18, metalness: 0.05,
      emissive: color, emissiveIntensity: 0.22, side: THREE.DoubleSide
    });
    this.innerMat = new THREE.MeshStandardMaterial({ color: 0x0c4a48, emissive: 0x1c8b72, emissiveIntensity: 0.4, roughness: 0.5 });
    this.membrane = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), this.membraneMat);
    this.membrane.scale.set(1, 0.78, 1.15);
    this.group.add(this.membrane);
    this.nucleus = new THREE.Mesh(new THREE.SphereGeometry(0.37, 12, 8), this.innerMat);
    this.nucleus.position.set(-0.05, 0.04, 0.05);
    this.group.add(this.nucleus);
    this.vacuoles = [];
    for (let i = 0; i < 4; i++) {
      const v = new THREE.Mesh(new THREE.SphereGeometry(0.1 + Math.random() * 0.06, 8, 6), this.innerMat);
      v.position.set(randRange(Math.random, -0.5, 0.5), randRange(Math.random, -0.25, 0.25), randRange(Math.random, -0.5, 0.5));
      this.group.add(v); this.vacuoles.push(v);
    }
    this.cilia = [];
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU;
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.45, 4), this.membraneMat);
      c.position.set(Math.cos(a) * 1.02, Math.sin(a) * 0.7, 0);
      c.rotation.z = a + Math.PI / 2;
      this.group.add(c); this.cilia.push({ mesh: c, phase: a });
    }
    this.flagella = [];
    let parent = this.group;
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, 0, i === 0 ? -1.1 : -0.38);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.018, 0.4, 4).rotateX(Math.PI / 2).translate(0, 0, -0.2), this.membraneMat);
      seg.add(m); parent.add(seg); this.flagella.push(seg); parent = seg;
    }
    if (predator) {
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * TAU;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.8, 4), this.innerMat);
        spike.position.set(Math.cos(a) * 0.95, Math.sin(a) * 0.65, 0);
        spike.rotation.z = Math.PI / 2 - a;
        this.group.add(spike);
      }
    }
    const tex = glowTexture();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(3.4, 3.4, 1);
    this.group.add(glow);
    this.group.scale.setScalar(size);
  }
  update(dt, speed) {
    this.t += dt;
    this.membrane.scale.set(1 + Math.sin(this.t * 3) * 0.03, 0.78 + Math.cos(this.t * 2.4) * 0.025, 1.15);
    for (const c of this.cilia) {
      c.mesh.rotation.x = Math.sin(this.t * 10 + c.phase * 3) * 0.5 * (0.4 + speed);
    }
    for (let i = 0; i < this.flagella.length; i++) {
      this.flagella[i].rotation.y = Math.sin(this.t * 6 - i * 0.7) * 0.25;
      this.flagella[i].rotation.x = Math.sin(this.t * 5 - i * 0.5) * 0.12;
    }
    this.group.rotation.y += dt * 0.1;
  }
}

export class CellStage {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x04262c, 0.038);
    this.scene.background = new THREE.Color(0x041e24);
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 300);
    this.camera.position.set(0, 8, 13);
    this.biomass = 0;
    this.dna = 0;
    this.eaten = 0;
    this.health = 100;
    this.alive = true;
    this.time = 0;
    this.damageCooldown = 0;
    this.dashCooldown = 0;
    this.evolveAvailable = false;
    this.buildLights();
    this.buildPond();
    this.buildPlayer();
    this.buildFood();
    this.buildPredators();
    this.spawnPos = new THREE.Vector3(0, 1.1, 0);
    this.playerPos = this.spawnPos.clone();
    this.playerVel = new THREE.Vector3();
    this.heading = 0;
    this.scene.add(this.playerRig.group);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x8de8e0, 0x062a2e, 1.5));
    const dir = new THREE.DirectionalLight(0x9df5e0, 2.2);
    dir.position.set(6, 20, 4);
    this.scene.add(dir);
    this.rim = new THREE.PointLight(0x54ffd2, 20, 30);
    this.rim.position.set(0, 6, -8);
    this.scene.add(this.rim);
  }

  buildPond() {
    const floor = new THREE.Mesh(new THREE.CircleGeometry(70, 48), new THREE.MeshStandardMaterial({ color: 0x0a3c3a, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.4;
    this.scene.add(floor);
    // caustic rings
    const rng = mulberry32(8821);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x2c7d70, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 20; i++) {
      const r = randRange(rng, 1, 6);
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.9, r, 32), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(randRange(rng, -40, 40), -2.35, randRange(rng, -40, 40));
      this.scene.add(ring);
    }
    // rocks and kelp silhouettes
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x0b2d30, roughness: 0.9, flatShading: true });
    for (let i = 0; i < 18; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(randRange(rng, 0.7, 2.6), 0), rockMat);
      rock.position.set(randRange(rng, -40, 40), -2.1, randRange(rng, -40, 40));
      rock.scale.y = randRange(rng, 0.4, 1.3);
      this.scene.add(rock);
    }
    const kelpMat = new THREE.MeshStandardMaterial({ color: 0x0e4a3c, transparent: true, opacity: 0.55, side: THREE.DoubleSide, roughness: 1 });
    this.kelp = [];
    for (let i = 0; i < 26; i++) {
      const h = randRange(rng, 4, 14);
      const kelp = new THREE.Mesh(new THREE.ConeGeometry(randRange(rng, 0.3, 1.1), h, 4), kelpMat);
      kelp.position.set(randRange(rng, -38, 38), -2 + h / 2, randRange(rng, -38, 38));
      this.scene.add(kelp);
      this.kelp.push({ mesh: kelp, phase: rng() * TAU });
    }
    // light shafts
    const shaftTex = glowTexture();
    for (let i = 0; i < 10; i++) {
      const shaft = new THREE.Mesh(new THREE.PlaneGeometry(randRange(rng, 2, 7), 26), new THREE.MeshBasicMaterial({
        color: 0x74e8d0, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      }));
      shaft.position.set(randRange(rng, -30, 30), 10, randRange(rng, -30, 30));
      shaft.rotation.z = 0.12;
      this.scene.add(shaft);
    }
    // motes
    const motesGeo = new THREE.BufferGeometry();
    const motes = [];
    for (let i = 0; i < 500; i++) motes.push(randRange(rng, -45, 45), randRange(rng, -2, 20), randRange(rng, -45, 45));
    motesGeo.setAttribute('position', new THREE.Float32BufferAttribute(motes, 3));
    this.motes = new THREE.Points(motesGeo, new THREE.PointsMaterial({ color: 0x9fffe6, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.motes);
  }

  buildPlayer() {
    this.playerRig = new CellRig(0x7bf0d0, 1);
    this.playerRig.group.position.copy(new THREE.Vector3(0, 1.1, 0));
    this.playerGlow = new THREE.PointLight(0x5cffd8, 10, 16);
    this.playerRig.group.add(this.playerGlow);
  }

  buildFood() {
    this.food = [];
    this.foodGroup = new THREE.Group();
    this.scene.add(this.foodGroup);
    this.glowTex = glowTexture();
    const rng = mulberry32(6042);
    for (let i = 0; i < 46; i++) {
      const color = [0x9bffcf, 0xfff29b, 0x9befff, 0xffb3e0][i % 4];
      const group = new THREE.Group();
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.7, roughness: 0.3 }));
      group.add(core);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      sprite.scale.set(1.4, 1.4, 1);
      group.add(sprite);
      const a = rng() * TAU, r = 3 + Math.sqrt(rng()) * 34;
      group.position.set(Math.cos(a) * r, randRange(rng, 0.4, 7), Math.sin(a) * r);
      group.userData = { baseY: group.position.y, phase: rng() * TAU, eaten: false, color };
      this.foodGroup.add(group);
      this.food.push(group);
    }
  }

  buildPredators() {
    this.predators = [];
    const rng = mulberry32(771);
    for (let i = 0; i < 4; i++) {
      const rig = new CellRig(i % 2 ? 0xff7b95 : 0xd870ff, randRange(rng, 1.3, 2.2), true);
      const a = rng() * TAU, r = 10 + rng() * 22;
      const pos = new THREE.Vector3(Math.cos(a) * r, 1.1, Math.sin(a) * r);
      rig.group.position.copy(pos);
      this.scene.add(rig.group);
      this.predators.push({ rig, pos, home: pos.clone(), speed: randRange(rng, 1.2, 2.4), size: rig.size, heading: rng() * TAU, timer: 0 });
    }
  }

  reset() {
    this.biomass = 0;
    this.eaten = 0;
    this.health = 100;
    this.alive = true;
    this.dna = 0;
    this.evolveAvailable = false;
    this.playerPos.copy(this.spawnPos);
    this.playerVel.set(0, 0, 0);
    this.playerRig.group.scale.setScalar(1);
    for (const f of this.food) { f.visible = true; f.userData.eaten = false; }
    for (const p of this.predators) { p.pos.copy(p.home); p.rig.group.position.copy(p.pos); }
  }

  update(dt, input) {
    if (!this.alive) {
      this.deathTimer = (this.deathTimer || 0) + dt;
      if (this.deathTimer > 1.6) { this.deathTimer = 0; this.reset(); this.game.ui?.toast('A new cell divides — try again', 'birth'); }
      this.updateCamera(dt);
      this.playerRig.update(dt, 0);
      return;
    }
    this.time += dt;
    this.damageCooldown = Math.max(0, this.damageCooldown - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    const axis = input.axis();
    const accel = 10 + this.biomass * 0.12;
    this.playerVel.x += axis.x * accel * dt;
    this.playerVel.z += -axis.y * accel * dt;
    if (input.pressed.has('Space') && this.dashCooldown <= 0) {
      this.dashCooldown = 2.2;
      const len = Math.hypot(this.playerVel.x, this.playerVel.z) || 1;
      this.playerVel.x += (this.playerVel.x / len) * 9;
      this.playerVel.z += (this.playerVel.z / len) * 9;
      this.game.audio.play('cellEat');
      this.game.particles?.burst(this.playerPos, 8, new THREE.Color(0x7bf0d0), 1.2);
    }
    const friction = Math.exp(-2.6 * dt);
    this.playerVel.x *= friction; this.playerVel.z *= friction;
    const maxSpeed = 4.4 + this.biomass * 0.05;
    const sp = Math.hypot(this.playerVel.x, this.playerVel.z);
    if (sp > maxSpeed) { this.playerVel.x *= maxSpeed / sp; this.playerVel.z *= maxSpeed / sp; }
    this.playerPos.x += this.playerVel.x * dt;
    this.playerPos.z += this.playerVel.z * dt;
    const r = Math.hypot(this.playerPos.x, this.playerPos.z);
    if (r > 44) { this.playerPos.x *= 44 / r; this.playerPos.z *= 44 / r; }
    this.playerPos.y = 1.1 + Math.sin(this.time * 1.5) * 0.08;
    if (sp > 0.25) this.heading = Math.atan2(this.playerVel.x, this.playerVel.z);
    this.playerRig.group.position.copy(this.playerPos);
    this.playerRig.group.rotation.y = this.heading + Math.PI;
    this.playerRig.update(dt, sp * 0.3);
    const scale = 1 + this.biomass * 0.022;
    this.playerRig.group.scale.setScalar(scale);
    this.playerRig.group.children.forEach(c => { if (c.material === this.playerRig.membraneMat) {} });

    // eat plankton
    for (const f of this.food) {
      if (f.userData.eaten) continue;
      f.position.y = f.userData.baseY + Math.sin(this.time * 1.2 + f.userData.phase) * 0.3;
      f.rotation.y += dt * 0.6;
      const d = f.position.distanceTo(this.playerPos);
      if (d < 1.1 + scale * 0.6) {
        f.userData.eaten = true; f.visible = false;
        this.biomass += 1; this.eaten++; this.dna += 2;
        this.game.audio.play('cellEat');
        this.game.particles?.burst(f.position, 7, new THREE.Color(f.userData.color), 1.1);
        this.game.ui?.cellHUD(this);
        if (this.biomass >= 14 && !this.evolveAvailable) {
          this.evolveAvailable = true;
          this.game.ui?.cellReady(this);
          this.game.audio.play('evolve');
        }
      }
    }
    // predators
    for (const p of this.predators) {
      const d = p.pos.distanceTo(this.playerPos);
      const dir = new THREE.Vector3().subVectors(this.playerPos, p.pos);
      dir.y = 0;
      const dist = dir.length();
      if (dist < 1) dir.set(1, 0, 0);
      dir.normalize();
      const playerBigger = scale > p.size * 0.95;
      if (dist < 15 && playerBigger) {
        p.pos.x -= dir.x * p.speed * dt * 1.2;
        p.pos.z -= dir.z * p.speed * dt * 1.2;
      } else if (dist < 16) {
        p.pos.x += dir.x * p.speed * dt;
        p.pos.z += dir.z * p.speed * dt;
      } else {
        p.timer -= dt;
        if (p.timer <= 0) {
          p.timer = 3 + Math.random() * 5;
          p.wander = new THREE.Vector3(p.home.x + (Math.random() - 0.5) * 16, 1.1, p.home.z + (Math.random() - 0.5) * 16);
        }
        if (p.wander) {
          const wd = new THREE.Vector3().subVectors(p.wander, p.pos); wd.y = 0;
          const wl = wd.length() || 1;
          p.pos.x += wd.x / wl * p.speed * 0.45 * dt;
          p.pos.z += wd.z / wl * p.speed * 0.45 * dt;
        }
      }
      const pr = Math.hypot(p.pos.x, p.pos.z);
      if (pr > 46) { p.pos.x *= 46 / pr; p.pos.z *= 46 / pr; }
      p.pos.y = 1.1 + Math.sin(this.time + p.speed) * 0.1;
      p.rig.group.position.copy(p.pos);
      p.rig.group.rotation.y = Math.atan2(this.playerPos.x - p.pos.x, this.playerPos.z - p.pos.z);
      p.rig.update(dt, 0.4);
      if (dist < p.size * 1.15 + scale * 0.7 && this.damageCooldown <= 0) {
        if (playerBigger) {
          const idx = this.predators.indexOf(p);
          if (idx >= 0) { this.scene.remove(p.rig.group); this.predators.splice(idx, 1); }
          this.biomass += 5; this.dna += 6;
          this.game.particles?.burst(p.pos, 18, new THREE.Color(0xff7b95), 2);
          this.game.audio.play('cellEat');
          this.game.ui?.toast('You consumed a rival cell! +5 biomass', 'kill');
        } else {
          this.health -= 25;
          this.damageCooldown = 1.4;
          this.game.audio.play('hurt');
          this.game.particles?.burst(this.playerPos, 10, new THREE.Color(0xff5b6e), 1.4);
          this.game.shake(0.3);
          this.playerVel.x += dir.x * -8; this.playerVel.z += dir.z * -8;
          this.game.ui?.cellHUD(this);
          if (this.health <= 0) {
            this.alive = false;
            this.playerRig.group.visible = false;
            this.game.audio.play('death');
            this.game.ui?.toast('Your cell was consumed. Dividing anew…', 'danger');
          }
        }
      }
    }
    // motes drift
    const mp = this.motes.geometry.attributes.position;
    for (let i = 0; i < mp.count; i++) {
      let y = mp.getY(i) + dt * 0.12;
      if (y > 20) y = -2;
      mp.setY(i, y);
    }
    mp.needsUpdate = true;
    for (const k of this.kelp) k.mesh.rotation.z = Math.sin(this.time * 0.5 + k.phase) * 0.05;
    this.updateCamera(dt);
    this.game.ui?.cellTick(this);
  }

  updateCamera(dt) {
    const target = this.playerPos.clone();
    this.camera.position.x = damp(this.camera.position.x, target.x + 2.6, 2.2, dt);
    this.camera.position.z = damp(this.camera.position.z, target.z + 9.5, 2.2, dt);
    this.camera.position.y = damp(this.camera.position.y, target.y + 9.0, 2.2, dt);
    this.camera.lookAt(target.x, target.y + 0.3, target.z);
  }
}
