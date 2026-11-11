// Directly controlled player creature.
import * as THREE from 'three';
import { CreatureRig } from './creature.js';
import { deriveStats, normalizeGenome, genomeColor } from './genome.js';
import { clamp, damp, lerp, TAU } from './util.js';
import { WATER_LEVEL } from './world.js';

export class Player {
  constructor(game, genome, pos) {
    this.game = game;
    this.world = game.world;
    this.genome = normalizeGenome(genome);
    this.stats = deriveStats(this.genome);
    this.id = 'player';
    this.displayName = 'You';
    this.sex = 'F';
    this.alive = true;
    this.dead = false;
    this.age = 2.1;
    this.health = this.stats.maxHealth;
    this.stamina = this.stats.maxStamina;
    this.hunger = 22;
    this.thirst = 18;
    this.fatigue = 6;
    this.dna = 0;
    this.evolutionPoints = 0;
    this.fear = 0;
    this.danger = 0;
    this.localThreat = 0;
    this.injuries = { leg: 0, eye: 0, jaw: 0, body: 0 };
    this.inventory = { berries: 3, meat: 0, herbs: 0, crystal: 0 };
    this.discoveredBiomes = new Set();
    this.discoveredSpecies = new Set();
    this.position = new THREE.Vector3(pos.x, this.world.heightAt(pos.x, pos.z), pos.z);
    this.heading = Math.PI * 0.35;
    this.velocityY = 0;
    this.airHeight = 0;
    this.grounded = true;
    this.flying = false;
    this.flightStamina = 0;
    this.swimming = false;
    this.speed = 0;
    this.turn = 0;
    this.animTimer = 0;
    this.attackTimer = 0;
    this.attackCooldown = 0;
    this.roarCooldown = 0;
    this.eatCooldown = 0;
    this.resting = false;
    this.restTime = 0;
    this.stepTimer = 0;
    this.deathTimer = 0;
    this.respawnTimer = 0;
    this.targetAgent = null;
    this.targetCarcass = null;
    this.targetPlant = null;
    this.targetWater = null;
    this.targetShelter = null;
    this.trackedSpecies = null;
    this.hurtFlash = 0;
    this.healFlash = 0;
    this.lastDamageAt = 0;
    this.scaleBase = 0.98 * Math.pow(this.genome.size, 0.84);
    this.rig = new CreatureRig(this.genome, { player: true, scale: this.scaleBase });
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.y = this.heading;
    game.scene.add(this.rig.root);
    this.spawnPoint = this.position.clone();
    this.scanTimer = 0;
  }

  get species() { return this.game.ecosystem.playerSpecies; }
  get fearLevel() { return { label: 'Calm', color: '#7fe0a8' }; }
  get maxHealth() { return this.stats.maxHealth; }

  applyGenome(g) {
    this.genome = normalizeGenome(g);
    this.stats = deriveStats(this.genome);
    this.scaleBase = 0.98 * Math.pow(this.genome.size, 0.84);
    this.rig.dispose();
    this.rig = new CreatureRig(this.genome, { player: true, scale: this.scaleBase });
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.y = this.heading;
    this.game.scene.add(this.rig.root);
    this.health = Math.min(this.stats.maxHealth, this.health + this.stats.maxHealth * 0.5);
    this.stamina = this.stats.maxStamina;
  }

  update(dt, input, camYaw) {
    if (!this.alive) {
      this.deathTimer += dt;
      this.rig.setState({ dead: true, state: 'dead', speed: 0 });
      this.rig.update(dt);
      return;
    }
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.roarCooldown = Math.max(0, this.roarCooldown - dt);
    this.eatCooldown = Math.max(0, this.eatCooldown - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    this.healFlash = Math.max(0, this.healFlash - dt * 2);
    this.danger = Math.max(0, this.danger - dt * 0.03);
    this.age += dt * 0.012;
    this.animTimer += dt;

    const metabolic = this.resting ? 0.32 : 1;
    this.hunger = clamp(this.hunger + dt * 0.34 * metabolic, 0, 110);
    this.thirst = clamp(this.thirst + dt * 0.46 * metabolic, 0, 110);
    if (this.resting) {
      this.fatigue = clamp(this.fatigue - dt * 7, 0, 100);
      this.health = clamp(this.health + dt * this.stats.maxHealth * 0.035, 0, this.stats.maxHealth);
      this.stamina = clamp(this.stamina + dt * 16, 0, this.stats.maxStamina);
      this.restTime += dt;
    } else {
      this.fatigue = clamp(this.fatigue + dt * 0.5, 0, 100);
      if (this.hunger < 55 && this.thirst < 60) this.health = clamp(this.health + dt * 0.55, 0, this.stats.maxHealth);
    }
    if (this.hunger > 96) this.health = clamp(this.health - dt * 0.8, 0, this.stats.maxHealth);
    if (this.thirst > 97) this.health = clamp(this.health - dt * 1.2, 0, this.stats.maxHealth);
    if (this.hunger > 75 && this.thirst > 75) this.fatigue = clamp(this.fatigue + dt * 0.5, 0, 100);

    // injuries recover slowly when healthy
    if (this.hunger < 50 && this.thirst < 55) {
      for (const k of Object.keys(this.injuries)) {
        if (this.injuries[k] > 0) this.injuries[k] = Math.max(0, this.injuries[k] - dt * 0.0035);
      }
    }

    const axis = input.axis();
    const forward = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const wish = forward.multiplyScalar(axis.y).add(right.multiplyScalar(axis.x));
    const wishLen = wish.length();
    const terrain = this.world.heightAt(this.position.x, this.position.z);
    const depth = WATER_LEVEL - terrain;
    this.swimming = depth > 0.9 && this.airHeight <= 0.02;
    const groundedNow = this.airHeight <= 0.02;
    this.grounded = groundedNow && !this.swimming;

    let targetSpeed = 0;
    const canSprint = input.sprint && this.stamina > 4 && this.fatigue < 92;
    const speedCap = this.swimming ? this.stats.swim : this.flying ? this.stats.fly : canSprint ? this.stats.sprint : this.stats.walk * 0.92;
    if (wishLen > 0.02) {
      wish.normalize();
      const targetHeading = Math.atan2(wish.x, wish.z);
      let delta = ((targetHeading - this.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const turnRate = (2.2 + this.stats.agility * 5.2) * (this.swimming ? 0.7 : 1);
      this.heading += clamp(delta, -turnRate * dt, turnRate * dt);
      this.turn = damp(this.turn, delta * 3, 8, dt);
      targetSpeed = speedCap;
      if (this.injuries.leg > 0.3) targetSpeed *= 0.68;
      if (this.fatigue > 82) targetSpeed *= 0.82;
      const aheadX = this.position.x + Math.sin(this.heading) * 1.4;
      const aheadZ = this.position.z + Math.cos(this.heading) * 1.4;
      const rise = this.world.heightAt(aheadX, aheadZ) - terrain;
      if (!this.swimming && !this.flying && rise > 0.35) targetSpeed *= 0.72;
      if (this.resting) { targetSpeed = 0; this.resting = false; this.game.ui?.toast('You wake up', 'info'); }
    } else {
      this.turn = damp(this.turn, 0, 6, dt);
    }
    if (this.swimming) {
      targetSpeed = Math.min(targetSpeed, this.stats.swim);
      this.stamina = clamp(this.stamina - dt * 0.9, 0, this.stats.maxStamina);
      this.flying = false;
    }
    if (this.flying) {
      this.stamina = clamp(this.stamina - dt * 1.4, 0, this.stats.maxStamina);
      if (this.stamina <= 0) this.flying = false;
    }
    this.speed = damp(this.speed, targetSpeed, 4, dt);
    if (this.speed > 0.05) {
      this.position.x += Math.sin(this.heading) * this.speed * dt;
      this.position.z += Math.cos(this.heading) * this.speed * dt;
    }
    this.position.x = clamp(this.position.x, -300, 300);
    this.position.z = clamp(this.position.z, -300, 300);

    // jump / flight / gravity
    if (input.pressed.has('Space') && this.grounded && !this.resting) {
      this.velocityY = this.stats.jump * 0.75;
      this.airHeight = 0.02;
      this.grounded = false;
      this.game.audio.play(this.genome.size > 1.6 ? 'stepBig' : 'step');
    }
    if (!this.grounded) {
      this.animTimer += 0;
      const flyingSpecies = this.genome.wings > 0;
      if (flyingSpecies && input.jump && this.stamina > 2) {
        this.velocityY = damp(this.velocityY, 3.2, 3, dt);
        this.flying = true;
      } else {
        this.velocityY -= 24 * dt;
        if (this.flying && this.velocityY < -1) this.flying = false;
      }
      this.airHeight += this.velocityY * dt;
      if (this.airHeight <= 0) {
        this.airHeight = 0; this.velocityY = 0; this.grounded = true; this.flying = false;
        if (this.speed > 3) this.game.audio.play('stepBig');
      }
    } else {
      this.airHeight = 0;
    }

    const groundY = this.world.heightAt(this.position.x, this.position.z);
    const depth2 = WATER_LEVEL - groundY;
    if (this.swimming) {
      this.position.y = WATER_LEVEL - 0.42 + Math.sin(performance.now() * 0.0014) * 0.05;
    } else {
      this.position.y = groundY + this.airHeight;
    }
    if (this.flying) this.position.y = groundY + this.airHeight + 1.2;
    if (depth2 > 5 && this.swimming) this.health = clamp(this.health - dt * 2, 0, this.stats.maxHealth);

    // footsteps
    if (this.speed > 0.7 && this.grounded) {
      this.stepTimer -= dt * (0.8 + this.speed * 0.25);
      if (this.stepTimer <= 0) {
        this.stepTimer = 1;
        this.game.audio.play(this.genome.size > 1.6 ? 'stepBig' : 'step');
      }
    }

    // scan interactions
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) { this.scanTimer = 0.18; this.scan(); }
    this.checkBiome();

    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.y = this.heading;
    this.rig.setState({
      speed: this.speed,
      state: this.resting ? 'sleep' : this.attackTimer > 0.12 ? 'attack' : this.eatCooldown > 0.6 ? 'eat' : 'idle',
      fear: this.localThreat * 0.3,
      turn: this.turn,
      swimming: this.swimming,
      flying: this.flying,
      injuredLeg: this.injuries.leg > 0.3,
      hurt: this.hurtFlash
    });
    this.rig.update(dt);

    if (this.health <= 0) this.die();
    if (this.resting && this.localThreat > 0.55) { this.resting = false; this.game.ui?.toast('Something is near — you wake!', 'danger'); }
  }

  scan() {
    const eco = this.game.ecosystem;
    if (!eco) return;
    const near = eco.nearestAgent(this.position, 34);
    if (near && near.agent !== this) this.targetAgent = near.agent; else this.targetAgent = null;
    this.targetCarcass = eco.nearestCarcass(this.position, 6.5);
    this.targetPlant = this.world.nearestPlant(this.position, 5.2);
    this.targetWater = this.world.nearestWater(this.position.x, this.position.z, 5);
    this.targetShelter = this.world.nearestShelter(this.position);
    if (this.targetShelter && this.targetShelter.dist > 7) this.targetShelter = null;
    let threat = 0;
    for (const a of eco.nearbyAgents(this.position, 18)) {
      if (a.dead) continue;
      const d = a.position.distanceTo(this.position);
      if (a.genome.diet === 'carnivore' && a.health > 0) threat = Math.max(threat, 1 - d / 18);
      if (a.state === 'hunt' || a.state === 'chase') threat = Math.max(threat, 0.65);
    }
    this.localThreat = damp(this.localThreat, threat, 2, this.game.lastDt || 0.016);
    if (this.targetAgent && !this.discoveredSpecies.has(this.targetAgent.species.id)) {
      this.discoveredSpecies.add(this.targetAgent.species.id);
      this.targetAgent.species.discovered = true;
      this.gainDNA(3);
      this.game.ui?.toast(`New species recorded: ${this.targetAgent.species.common}`, 'discovery');
    }
  }

  checkBiome() {
    const b = this.world.biomeAt(this.position.x, this.position.z);
    if (!this.discoveredBiomes.has(b)) {
      this.discoveredBiomes.add(b);
      this.gainDNA(4);
      this.game.ui?.toast(`New habitat charted: ${this.world.biomeInfo(b).label}`, 'discovery');
    }
  }

  get interactLabel() {
    if (this.targetPlant && this.targetPlant.available) return { key: 'E', label: `Eat ${this.targetPlant.kind}`, icon: 'plant' };
    if (this.targetCarcass) return { key: 'E', label: 'Scavenge remains', icon: 'meat' };
    if (this.targetWater) return { key: 'E', label: 'Drink water', icon: 'water' };
    if (this.targetShelter) return { key: 'E', label: 'Rest at shelter', icon: 'rest' };
    if (this.targetAgent) return { key: 'E', label: `Observe ${this.targetAgent.species.common}`, icon: 'scan' };
    return null;
  }

  interact() {
    if (!this.alive) return;
    if (this.targetPlant && this.targetPlant.available) {
      const n = this.world.consumePlant(this.targetPlant);
      this.hunger = clamp(this.hunger - (this.genome.diet === 'carnivore' ? n * 0.35 : n * 0.9), 0, 110);
      this.inventory.berries++;
      this.eatCooldown = 1.2;
      this.gainDNA(this.genome.diet === 'carnivore' ? 0.8 : 1.4);
      this.game.audio.play('eat');
      this.game.ui?.toast(`Ate ${this.targetPlant.kind}`, 'food');
      this.game.particles?.burst(this.targetPlant.position || new THREE.Vector3(this.targetPlant.x, this.targetPlant.y + 0.5, this.targetPlant.z), 5, new THREE.Color(0x9be37c), 0.8);
      return true;
    }
    if (this.targetCarcass && !this.targetCarcass.consumed) {
      const carcass = this.targetCarcass;
      const nut = Math.min(carcass.nutrition, 16);
      carcass.nutrition -= nut;
      carcass.eat(0);
      this.hunger = clamp(this.hunger - nut * (this.genome.diet === 'herbivore' ? 0.35 : 0.95), 0, 110);
      this.health = clamp(this.health + 6, 0, this.stats.maxHealth);
      this.inventory.meat++;
      this.gainDNA(2.5);
      this.game.audio.play('eat');
      this.game.ui?.toast('Scavenged meat', 'food');
      if (carcass.nutrition <= 0.5) carcass.destroy();
      return true;
    }
    if (this.targetWater) {
      this.thirst = clamp(this.thirst - 34, 0, 110);
      this.stamina = clamp(this.stamina + 8, 0, this.stats.maxStamina);
      this.gainDNA(0.4);
      this.game.audio.play('drink');
      this.game.ui?.toast('Drank fresh water', 'water');
      return true;
    }
    if (this.targetShelter) {
      this.resting = true;
      this.targetShelter = null;
      this.health = clamp(this.health + 10, 0, this.stats.maxHealth);
      this.game.ui?.toast('You settle into the shelter', 'rest');
      return true;
    }
    if (this.targetAgent) {
      this.discoveredSpecies.add(this.targetAgent.species.id);
      this.targetAgent.species.discovered = true;
      this.gainDNA(1);
      this.game.ui?.inspectAgent(this.targetAgent);
      return true;
    }
    return false;
  }

  attack() {
    if (!this.alive || this.attackCooldown > 0) return false;
    this.attackCooldown = this.stats.attackCooldown;
    this.attackTimer = 0.4;
    this.stamina = clamp(this.stamina - 7, 0, this.stats.maxStamina);
    this.danger = clamp(this.danger + 0.3, 0, 1);
    this.game.ecosystem.playerDanger = Math.min(1, this.game.ecosystem.playerDanger + 0.25);
    this.game.audio.play('bite');
    let best = null, bestD = this.stats.reach + 3.2;
    for (const a of this.game.ecosystem.nearbyAgents(this.position, bestD)) {
      if (a.dead) continue;
      const dx = a.position.x - this.position.x, dz = a.position.z - this.position.z;
      const d = Math.hypot(dx, dz);
      const dot = (dx * Math.sin(this.heading) + dz * Math.cos(this.heading)) / Math.max(0.001, d);
      if (d < bestD && dot > 0.15) { bestD = d; best = a; }
    }
    if (best) {
      const dmg = this.stats.bite + this.stats.claw * 0.65;
      const wasAlive = !best.dead;
      best.takeDamage(dmg, this, ['body', 'leg', 'jaw', 'eye'][Math.floor(Math.random() * 4)]);
      this.game.ui?.damageNumber(best.position, Math.round(dmg));
      this.game.shake(0.18);
      if (wasAlive && best.health <= 0) {
        this.gainDNA(14);
        this.game.ui?.toast(`Killed ${best.species.common} — DNA +14`, 'kill');
        this.game.audio.play('kill');
      }
      return true;
    }
    this.game.shake(0.05);
    return false;
  }

  roar() {
    if (!this.alive || this.roarCooldown > 0) return false;
    this.roarCooldown = 9;
    this.stamina = clamp(this.stamina - 10, 0, this.stats.maxStamina);
    this.danger = clamp(this.danger + 0.25, 0, 1);
    this.game.audio.play('roar');
    this.game.shake(0.35);
    for (const a of this.game.ecosystem.nearbyAgents(this.position, 30)) {
      if (a.dead) continue;
      a.fear = clamp(a.fear + 0.35, 0, 1);
      a.memory.playerTerror = clamp(a.memory.playerTerror + 0.3, 0, 1);
      if (a.fear > 0.55 && a.state !== 'attack') { a.state = 'flee'; a.stateTimer = 5; a.threat = this; }
    }
    this.game.ecosystem.playerDanger = Math.min(1, this.game.ecosystem.playerDanger + 0.2);
    this.game.ui?.toast('You unleash a territorial roar', 'roar');
    this.game.particles?.ring(this.position, 30);
    return true;
  }

  toggleRest() {
    if (!this.alive) return;
    this.resting = !this.resting;
    this.game.ui?.toast(this.resting ? 'Resting… press R to rise' : 'You wake', 'rest');
    if (this.resting) this.game.audio.play('open');
  }

  eatInventory(kind) {
    if (kind === 'berries' && this.inventory.berries > 0) {
      this.inventory.berries--;
      this.hunger = clamp(this.hunger - 18, 0, 110);
      this.health = clamp(this.health + 4, 0, this.stats.maxHealth);
      this.game.audio.play('eat');
      this.game.ui?.toast('Ate stored berries', 'food');
    } else if (kind === 'meat' && this.inventory.meat > 0) {
      this.inventory.meat--;
      this.hunger = clamp(this.hunger - 30, 0, 110);
      this.health = clamp(this.health + 10, 0, this.stats.maxHealth);
      this.game.audio.play('eat');
      this.game.ui?.toast('Ate stored meat', 'food');
    } else if (kind === 'herbs' && this.inventory.herbs > 0) {
      this.inventory.herbs--;
      this.health = clamp(this.health + 18, 0, this.stats.maxHealth);
      for (const k of Object.keys(this.injuries)) this.injuries[k] = Math.max(0, this.injuries[k] - 0.35);
      this.game.ui?.toast('Applied healing herbs', 'heal');
      this.game.audio.play('evolve');
    } else if (kind === 'crystal' && this.inventory.crystal > 0) {
      this.inventory.crystal--;
      this.gainDNA(18);
      this.game.ui?.toast('Channeled a DNA crystal', 'discovery');
      this.game.audio.play('evolve');
    }
  }

  gainDNA(amount) {
    this.dna += amount;
    this.evolutionPoints += amount;
    this.healFlash = Math.min(1, this.healFlash + 0.2);
    this.game.ui?.syncHUD();
  }

  takeDamage(amount, attacker, part = 'body') {
    if (!this.alive) return;
    const armor = clamp(this.stats.armorRating, 0, 0.65);
    const dmg = Math.max(1, amount * (1 - armor));
    this.health = clamp(this.health - dmg, 0, this.stats.maxHealth);
    this.hurtFlash = 1;
    this.lastDamageAt = performance.now();
    this.game.shake(0.4);
    this.game.audio.play('hurt');
    this.game.ui?.damageFlash(dmg);
    if (Math.random() < 0.3) {
      if (part === 'leg' && this.injuries.leg < 1) { this.injuries.leg = 1; this.game.ui?.toast('Your leg is injured — movement slowed', 'danger'); }
      else if (part === 'eye' && this.injuries.eye < 1) { this.injuries.eye = 1; this.game.ui?.toast('Your eye is injured — vision blurred', 'danger'); }
      else if (part === 'jaw' && this.injuries.jaw < 1) { this.injuries.jaw = 1; this.game.ui?.toast('Your jaw is injured — bite weakened', 'danger'); }
      else this.injuries.body = Math.min(1, this.injuries.body + 0.3);
    }
    if (this.resting) this.resting = false;
    if (attacker) this.danger = Math.max(this.danger, 0.2);
    if (this.health <= 0) this.die();
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.dead = true;
    this.resting = false;
    this.rig.setState({ dead: true, state: 'dead', speed: 0 });
    this.game.audio.play('death');
    this.game.onPlayerDeath();
  }

  respawn(pos) {
    this.alive = true;
    this.dead = false;
    this.health = this.stats.maxHealth * 0.7;
    this.stamina = this.stats.maxStamina * 0.6;
    this.hunger = Math.max(20, this.hunger - 30);
    this.thirst = Math.max(20, this.thirst - 30);
    this.injuries = { leg: 0, eye: 0, jaw: 0, body: 0 };
    this.resting = false;
    const p = pos || this.spawnPoint;
    this.position.set(p.x, this.world.heightAt(p.x, p.z), p.z);
    this.airHeight = 0; this.velocityY = 0; this.flying = false;
    this.rig.setState({ dead: false, state: 'idle', speed: 0 });
    this.rig.visual.rotation.z = 0;
    this.rig.dispose();
    this.rig = new CreatureRig(this.genome, { player: true, scale: this.scaleBase });
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.y = this.heading;
    this.game.scene.add(this.rig.root);
    this.game.ui?.hideDeath();
    this.game.ui?.toast('You awaken at your nest, weakened but alive', 'rest');
  }

  reproduce() {
    if (this.dna < 25) return false;
    const eco = this.game.ecosystem;
    const sp = eco.playerSpecies;
    if (!sp) return false;
    if (eco.agents.length >= eco.cap) return false;
    const mateGenome = this.genome;
    const childGenome = normalizeGenome({ ...this.genome, size: this.genome.size * 0.85 + Math.random() * 0.1 });
    // use Agent via import-free factory on ecosystem
    const child = eco.spawnPlayerOffspring(childGenome, this.position, this);
    if (!child) return false;
    this.dna -= 25;
    sp.population++;
    this.health = Math.max(1, this.health - this.stats.maxHealth * 0.15);
    this.game.ui?.toast('Your offspring hatches. Guard it well.', 'birth');
    this.game.audio.play('spawn');
    return true;
  }
}
