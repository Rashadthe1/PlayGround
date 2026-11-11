// Living ecosystem: individual creatures, fear, decisions, combat, feeding, breeding.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CreatureRig } from './creature.js';
import { deriveStats, mutateGenome, crossoverGenome, normalizeGenome, makeSpecies, buildStartingSpecies, genomeColor, geneticDistance } from './genome.js';
import { clamp, lerp, damp, mulberry32, randRange, chance, pick, TAU, fmt, makeSpeciesName, makeCommonName, avg } from './util.js';
import { WATER_LEVEL } from './world.js';

export const FEAR_LEVELS = [
  { max: 0.14, label: 'Calm', color: '#7fe0a8', icon: '○' },
  { max: 0.3, label: 'Alert', color: '#d8e876', icon: '◔' },
  { max: 0.48, label: 'Nervous', color: '#f0c15a', icon: '◑' },
  { max: 0.68, label: 'Frightened', color: '#f08a4b', icon: '◕' },
  { max: 0.86, label: 'Panicked', color: '#ef5b4c', icon: '●' },
  { max: 1.01, label: 'Terrorized', color: '#d92c6b', icon: '✸' }
];
export function fearInfo(v) { return FEAR_LEVELS.find(l => v < l.max) || FEAR_LEVELS[FEAR_LEVELS.length - 1]; }

const STATE_LABEL = {
  idle: 'Resting', wander: 'Roaming', graze: 'Grazing', drink: 'Drinking', hunt: 'Hunting',
  chase: 'Chasing', flee: 'Fleeing', sleep: 'Sleeping', seekShelter: 'Seeking shelter',
  mate: 'Courting', follow: 'Following parent', socialize: 'Socialising', scavenge: 'Scavenging',
  eat: 'Feeding', attack: 'Fighting', dead: 'Dead', drink: 'Drinking', protect: 'Protecting'
};

const rng = mulberry32(20261111);

export class Agent {
  constructor(eco, species, genome, pos, opts = {}) {
    this.eco = eco;
    this.game = eco.game;
    this.world = eco.world;
    this.species = species;
    this.genome = normalizeGenome(genome);
    this.stats = deriveStats(this.genome);
    this.id = 'a' + Math.floor(Math.random() * 1e9).toString(36);
    this.sex = Math.random() < 0.5 ? 'F' : 'M';
    this.age = opts.age ?? randRange(Math.random, 0.8, Math.max(1, this.stats.adultAge * 2.2));
    this.growth = opts.growth ?? clamp(0.42 + this.age / this.stats.adultAge * 0.58, 0.35, 1);
    this.health = opts.health ?? this.stats.maxHealth;
    this.stamina = this.stats.maxStamina;
    this.hunger = opts.hunger ?? randRange(Math.random, 8, 40);
    this.thirst = opts.thirst ?? randRange(Math.random, 8, 40);
    this.fatigue = randRange(Math.random, 0, 24);
    this.fear = 0;
    this.fearTarget = 0;
    this.pain = 0;
    this.memory = { pain: 0, playerTerror: 0 };
    this.state = opts.state || 'wander';
    this.stateTimer = randRange(Math.random, 1, 4);
    this.scanTimer = Math.random() * 0.4;
    this.attackTimer = 0;
    this.breedCooldown = randRange(Math.random, 8, 24);
    this.eatCooldown = 0;
    this.speed = 0;
    this.heading = Math.random() * TAU;
    this.turn = 0;
    this.position = new THREE.Vector3(pos.x, this.world.heightAt(pos.x, pos.z), pos.z);
    this.home = new THREE.Vector3(pos.x, 0, pos.z);
    this.territoryRadius = 18 + Math.random() * 38;
    this.parentId = opts.parentId || null;
    this.offspring = 0;
    this.kills = 0;
    this.attacks = 0;
    this.injuries = { leg: 0, eye: 0, jaw: 0, body: 0 };
    this.dead = false;
    this.deadTimer = 0;
    this.flying = !!this.genome.wings && species.habitat === 'mountain' && (opts.fly ?? Math.random() < 0.75);
    this.swimming = false;
    this.selected = false;
    this.target = null;
    this.threat = null;
    this.prey = null;
    this.waterPoint = null;
    this.carcass = null;
    this.plants = null;
    this.mateTarget = null;
    this.groupCenter = null;
    this.attackFlash = 0;
    this.callTimer = randRange(Math.random, 2, 12);
    this.vocal = opts.vocal || 1;
    this.scaleBase = 0.95 * Math.pow(this.genome.size, 0.84);
    this.rig = new CreatureRig(this.genome, { scale: this.scaleBase * this.growth });
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.y = this.heading;
    this.rig.root.userData.agent = this;
    if (this.flying) this.altitude = 5 + Math.random() * 4;
    this.eco.scene.add(this.rig.root);
    this.nickname = opts.nickname || (this.species.common.split(' ')[0] + ' ' + ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][Math.floor(Math.random() * 8)]);
  }

  get displayName() { return this.nickname; }
  get fearLevel() { return fearInfo(this.fear); }
  get stateLabel() { return STATE_LABEL[this.state] || this.state; }
  get isPredator() { return this.genome.diet === 'carnivore'; }
  get isPrey() { return this.genome.diet === 'herbivore'; }
  get sizeRatio() { return this.genome.size; }
  get canBreed() { return this.age >= this.stats.adultAge * 0.82 && this.health > this.stats.maxHealth * 0.55 && this.hunger < 62 && this.thirst < 65 && this.breedCooldown <= 0; }

  update(dt) {
    if (this.dead) {
      this.deadTimer -= dt;
      this.rig.update(dt);
      if (this.deadTimer <= 0 && this.rig.root.parent) {
        this.rig.dispose();
      }
      return;
    }
    this.attackFlash = Math.max(0, this.attackFlash - dt * 3);
    const yRate = 0.012; // game-years per real second
    this.age += dt * yRate;
    this.breedCooldown -= dt;
    this.eatCooldown -= dt;
    this.attackTimer -= dt;
    this.scanTimer -= dt;
    this.stateTimer -= dt;
    this.pain = Math.max(0, this.pain - dt * 0.16);
    this.memory.pain = Math.max(0, this.memory.pain - dt * 0.002);
    this.breedCooldown = Math.max(-1, this.breedCooldown);

    const sizeFactor = clamp(this.genome.size, 0.6, 2.4);
    const foodNeed = this.state === 'sleep' ? 0.35 : 1;
    this.hunger = clamp(this.hunger + dt * this.stats.metabolismRate * 1.35 * foodNeed, 0, 110);
    this.thirst = clamp(this.thirst + dt * (0.85 + this.stats.metabolismRate * 0.9) * foodNeed, 0, 110);
    if (this.state !== 'sleep') this.fatigue = clamp(this.fatigue + dt * 0.55, 0, 105);
    if (this.hunger < 25 && this.thirst < 30 && this.health > 0) this.health = clamp(this.health + dt * 0.65, 0, this.stats.maxHealth);
    if (this.hunger > 92) this.health = clamp(this.health - dt * 0.7, 0, this.stats.maxHealth);
    if (this.thirst > 94) this.health = clamp(this.health - dt * 1.1, 0, this.stats.maxHealth);
    if (this.state === 'sleep') { this.fatigue = clamp(this.fatigue - dt * 4.5, 0, 100); this.stamina = clamp(this.stamina + dt * 8, 0, this.stats.maxStamina); }
    else if (this.speed > this.stats.walk * 0.8) this.stamina = clamp(this.stamina - dt * 1.8, 0, this.stats.maxStamina);
    else this.stamina = clamp(this.stamina + dt * 1.5, 0, this.stats.maxStamina);

    if (this.scanTimer <= 0) {
      this.scanTimer = 0.28 + Math.random() * 0.26;
      this.scan();
    }
    this.updateFear(dt);
    this.decide(dt);
    this.move(dt);
    this.updateRig(dt);

    if (this.health <= 0) this.die('wounds');
    if (this.age > this.stats.lifeSpan) this.die('old age');
  }

  scan() {
    const vision = this.stats.vision * (1 - clamp(this.fear * 0.2, 0, 0.2));
    let threat = null, threatScore = 0;
    let prey = null, preyScore = -Infinity;
    let mate = null, mateDist = Infinity;
    let herdSum = new THREE.Vector3();
    let herdCount = 0;
    let groupThreat = 0;
    for (const other of this.eco.agents) {
      if (other === this || other.dead) continue;
      const dx = other.position.x - this.position.x, dz = other.position.z - this.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > vision * vision) continue;
      const d = Math.sqrt(d2);
      const same = other.species.id === this.species.id;
      if (same) {
        if (other.age < other.stats.adultAge * 0.8) herdSum.add(other.position); else herdSum.add(other.position);
        herdCount++;
        if (other.state === 'flee' && d < 14) groupThreat = Math.max(groupThreat, 0.35);
        if (!mate && other.canBreed && this.canBreed && d < 22 && other.sex !== this.sex) { mate = other; mateDist = d; }
        continue;
      }
      const otherStats = other.stats;
      const sizeDiff = other.genome.size / this.genome.size;
      const dangerous = (other.isPredator || other.genome.diet === 'omnivore' && other.genome.aggression > 0.55) && sizeDiff > 0.78;
      if (dangerous) {
        let score = (1 - d / vision) * (0.5 + Math.min(1.8, sizeDiff) * 0.65) * (0.4 + other.genome.aggression);
        if (other.state === 'hunt' || other.state === 'chase' || other.state === 'attack') score *= 1.6;
        if (other.fear > 0.4) score *= 0.7;
        if (score > threatScore) { threatScore = score; threat = other; }
      }
      const canEat = this.genome.diet === 'carnivore' || (this.genome.diet === 'omnivore' && this.hunger > 55);
      if (canEat && other.genome.size < this.genome.size * 1.04 && other.genome.size > this.genome.size * 0.28) {
        const score = (1 - d / vision) * 2 - other.genome.size * 0.6 + (other.health < other.stats.maxHealth * 0.5 ? 0.6 : 0);
        if (score > preyScore) { preyScore = score; prey = other; }
      }
    }
    // Player is a powerful, unpredictable apex presence.
    const p = this.eco.game.player;
    if (p && p.alive && p.position) {
      const dx = p.position.x - this.position.x, dz = p.position.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d < vision * 1.25) {
        const danger = p.danger || 0;
        const playerThreat = (1 - clamp(d / (vision * 1.25), 0, 1)) * (0.38 + danger * 1.55 + (p.genome.size / this.genome.size) * 0.2);
        if (playerThreat > threatScore) { threatScore = playerThreat; threat = p; }
        if ((this.genome.diet === 'carnivore' || this.genome.diet === 'omnivore' && this.hunger > 60) && danger < 0.65 && p.genome.size < this.genome.size * 1.2 && d < this.stats.huntRadius) {
          const score = (1 - d / this.stats.huntRadius) * 2.2 + (p.health < p.maxHealth * 0.5 ? 0.8 : 0);
          if (score > preyScore) { preyScore = score; prey = p; }
        }
      }
    }
    if (herdCount) this.groupCenter = herdSum.multiplyScalar(1 / herdCount);
    else this.groupCenter = null;
    this.threat = threat;
    this.threatScore = threatScore;
    this.prey = prey;
    this.mateTarget = mate;
    this.groupThreat = groupThreat;
    this.waterPoint = this.thirst > 30 || this.state === 'drink' ? this.world.nearestWater(this.position.x, this.position.z, 70) : this.waterPoint;
    this.plants = this.world.nearestPlant(this.position, 13);
    this.carcass = this.eco.nearestCarcass(this.position, 24);
    this.shelter = this.world.nearestShelter(this.position);
  }

  updateFear(dt) {
    let target = this.stats.fearBias * 0.18;
    if (this.threat) target += this.threatScore * (0.9 + this.stats.fearBias * 0.4);
    if (this.groupThreat) target += this.groupThreat;
    if (this.pain > 0) target += this.pain * 0.55;
    if (this.injuries.leg || this.injuries.body) target += 0.16;
    if (this.health < this.stats.maxHealth * 0.35) target += 0.18;
    if (this.memory.playerTerror > 0) target += this.memory.playerTerror * 0.2;
    const courage = this.genome.aggression * 0.22 + this.genome.boldness * 0.16;
    if (this.threat && this.genome.aggression > 0.7 && this.genome.size > (this.threat.genome?.size || 1) * 0.92) target *= 0.64;
    target = clamp(target - courage, 0, 1);
    const panicGain = target > this.fear ? 1.5 + this.genome.fearfulness * 1.2 : 0.45 + this.stats.fearDecay;
    this.fear = damp(this.fear, target, panicGain, dt);
    if (this.fear > 0.82) this.memory.playerTerror = clamp(this.memory.playerTerror + dt * 0.3, 0, 1);
    if (this.threat === this.eco.game.player && this.fear > 0.5) this.eco.game.playerDanger = Math.min(1, this.eco.game.playerDanger + dt * 0.06);
  }

  decide(dt) {
    if (this.dead) return;
    const threat = this.threat;
    const threatDist = threat ? Math.hypot(threat.position.x - this.position.x, threat.position.z - this.position.z) : Infinity;
    const panic = this.fear > 0.58;
    if (this.stateTimer > 0 && !['flee', 'attack', 'chase'].includes(this.state)) {
      // keep current low-priority action until its timer expires
    } else {
      this.stateTimer = 1 + Math.random() * 2.4;
      if (panic && threat && threatDist < 34) {
        this.setState(this.genome.aggression > 0.75 && this.genome.size > (threat.genome?.size || 1) * 1.02 && this.fear < 0.8 ? 'attack' : 'flee');
        this.target = threat;
      } else if (this.fatigue > 74 && this.fear < 0.35) {
        const shelter = this.world.nearestShelter(this.position);
        if (shelter && shelter.dist < 30 && this.world.temperatureAt(this.position.x, this.position.z) < 0.42) {
          this.setState('seekShelter'); this.target = shelter;
        } else this.setState('sleep');
      } else if (this.thirst > 58 && this.waterPoint) {
        this.setState('drink'); this.target = this.waterPoint;
      } else if (this.hunger > 48) {
        if (this.genome.diet === 'scavenger' && this.carcass) { this.setState('scavenge'); this.target = this.carcass; }
        else if ((this.genome.diet === 'carnivore' || this.genome.diet === 'omnivore') && this.prey) { this.setState('hunt'); this.target = this.prey; }
        else if (this.plants) { this.setState('graze'); this.target = this.plants; }
        else if (this.carcass) { this.setState('scavenge'); this.target = this.carcass; }
        else this.setState('wander');
      } else if (this.canBreed && this.mateTarget) {
        this.setState('mate'); this.target = this.mateTarget;
      } else if (this.parentId && this.eco.agents.some(a => a.id === this.parentId && !a.dead)) {
        const parent = this.eco.agents.find(a => a.id === this.parentId);
        if (parent && Math.hypot(parent.position.x - this.position.x, parent.position.z - this.position.z) < 30) { this.setState('follow'); this.target = parent; }
        else this.setState('wander');
      } else if (this.genome.sociability > 0.62 && this.groupCenter && Math.random() < 0.65) {
        this.setState('socialize'); this.target = this.groupCenter;
      } else if (this.state === 'sleep' || this.state === 'drink') {
        this.setState('wander');
      } else {
        this.setState(Math.random() < 0.52 ? 'wander' : 'idle');
      }
    }
    // persistent actions
    if (!threat || threatDist > 40) {
      if (this.state === 'flee') { this.stateTimer = 0; }
    }
    if (this.state === 'hunt' && this.prey) {
      this.target = this.prey;
      const d = Math.hypot(this.prey.position.x - this.position.x, this.prey.position.z - this.position.z);
      if (d < this.stats.reach + 1.5 && this.attackTimer <= 0) this.attack(this.prey);
      if (!this.prey || this.prey.dead) { this.stateTimer = 0; this.prey = null; }
    }
    if (this.state === 'attack' && this.target) {
      const target = this.target;
      const d = Math.hypot(target.position.x - this.position.x, target.position.z - this.position.z);
      if (d > 2.4 && d < 26) { this.state = 'chase'; }
      if (d <= this.stats.reach + 1.8 && this.attackTimer <= 0) this.attack(target);
      if (this.fear > 0.92) this.setState('flee');
      if (!target || target.dead || target.health <= 0) this.stateTimer = 0;
    }
    if (this.state === 'chase') {
      if (!this.target || this.target.dead) this.stateTimer = 0;
      else {
        const d = Math.hypot(this.target.position.x - this.position.x, this.target.position.z - this.position.z);
        if (d < this.stats.reach + 1.6 && this.attackTimer <= 0) this.attack(this.target);
        if (d > 45) { this.state = 'wander'; this.stateTimer = 0; }
      }
    }
    if (this.state === 'graze') {
      if (!this.plants || !this.plants.available) this.plants = this.world.nearestPlant(this.position, 18);
      if (this.plants) this.target = this.plants;
    }
    if (this.state === 'drink') {
      if (!this.waterPoint) this.waterPoint = this.world.nearestWater(this.position.x, this.position.z, 60);
      if (this.waterPoint) this.target = this.waterPoint;
    }
    if (this.state === 'scavenge') {
      this.carcass = this.eco.nearestCarcass(this.position, 30);
      if (this.carcass) this.target = this.carcass; else this.stateTimer = 0;
    }
    if (this.state === 'mate' && this.mateTarget) {
      const d = Math.hypot(this.mateTarget.position.x - this.position.x, this.mateTarget.position.z - this.position.z);
      this.target = this.mateTarget;
      if (d < this.stats.bodyRadius * 2 + 2 && this.breedCooldown <= 0) this.breed(this.mateTarget);
    }
    if (this.state === 'follow' && this.target && this.target.dead) this.stateTimer = 0;
  }

  setState(state) {
    if (this.state === state) { this.stateTimer = 1.5 + Math.random() * 2; return; }
    this.state = state;
    this.stateTimer = 1.2 + Math.random() * 2.8;
  }

  move(dt) {
    let desired = new THREE.Vector3();
    let targetSpeed = 1.1;
    const threat = this.threat;
    if (this.state === 'flee' && threat) {
      desired.set(this.position.x - threat.position.x, 0, this.position.z - threat.position.z);
      targetSpeed = this.stats.sprint * (0.82 + this.fear * 0.35);
      if (this.groupCenter && this.genome.sociability > 0.6) desired.addScaledVector(this.groupCenter.clone().sub(this.position), 0.25);
    } else if (['hunt', 'chase', 'attack'].includes(this.state) && this.target) {
      desired.set(this.target.position.x - this.position.x, 0, this.target.position.z - this.position.z);
      targetSpeed = this.stats.sprint * (0.82 + this.genome.aggression * 0.25);
    } else if (this.state === 'sleep') {
      targetSpeed = 0;
    } else if (this.state === 'drink') {
      if (this.waterPoint) {
        desired.set(this.waterPoint.x - this.position.x, 0, this.waterPoint.z - this.position.z);
        const d = desired.length();
        targetSpeed = d > 2.5 ? this.stats.walk * 0.85 : 0;
        if (d < 3.2) {
          this.consumeWater(dt);
          desired.set(0, 0, 0);
        }
      } else targetSpeed = 0;
    } else if (this.state === 'graze' && this.plants) {
      desired.set(this.plants.x - this.position.x, 0, this.plants.z - this.position.z);
      const d = desired.length();
      targetSpeed = d > 1.8 ? this.stats.walk * 0.9 : 0;
      if (d < 2.4) this.consumePlant(this.plants);
    } else if (this.state === 'scavenge' && this.carcass) {
      desired.set(this.carcass.position.x - this.position.x, 0, this.carcass.position.z - this.position.z);
      const d = desired.length();
      targetSpeed = d > 2 ? this.stats.walk * 1.2 : 0;
      if (d < 2.6) this.consumeCarcass(this.carcass, dt);
    } else if (this.state === 'mate' && this.target) {
      desired.set(this.target.position.x - this.position.x, 0, this.target.position.z - this.position.z);
      targetSpeed = desired.length() > 2.5 ? this.stats.walk * 0.8 : 0;
    } else if (this.state === 'seekShelter' && this.target) {
      desired.set(this.target.x - this.position.x, 0, this.target.z - this.position.z);
      const d = desired.length();
      targetSpeed = d > 2 ? this.stats.walk : 0;
      if (d < 3) { this.setState('sleep'); this.stateTimer = 10; }
    } else if ((this.state === 'socialize' || this.state === 'follow') && this.target) {
      const tx = this.target.position?.x ?? this.target.x, tz = this.target.position?.z ?? this.target.z;
      desired.set(tx - this.position.x, 0, tz - this.position.z);
      const d = desired.length();
      targetSpeed = d > 4 ? this.stats.walk * 0.9 : 0;
    } else if (this.state === 'wander') {
      if (!this._wanderTarget || this._wanderTimer <= 0 || Math.hypot(this._wanderTarget.x - this.position.x, this._wanderTarget.z - this.position.z) < 2) {
        const r = 8 + Math.random() * 22;
        const a = Math.random() * TAU;
        this._wanderTarget = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r };
        this._wanderTimer = 6 + Math.random() * 8;
      }
      this._wanderTimer -= dt;
      desired.set(this._wanderTarget.x - this.position.x, 0, this._wanderTarget.z - this.position.z);
      targetSpeed = this.stats.walk * 0.6;
    } else {
      targetSpeed = 0;
      if (this.groupCenter && this.genome.sociability > 0.6 && Math.random() < 0.02) {
        desired.set(this.groupCenter.x - this.position.x, 0, this.groupCenter.z - this.position.z);
        targetSpeed = this.stats.walk * 0.4;
      }
    }
    // separation
    for (const other of this.eco.nearbyAgents(this.position, 7)) {
      if (other === this || other.dead) continue;
      const dx = this.position.x - other.position.x, dz = this.position.z - other.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.001) continue;
      const d = Math.sqrt(d2);
      const push = (2.4 + (this.genome.size + other.genome.size) * 0.6) / d;
      if (d < 7) desired.add(new THREE.Vector3(dx / d * push, 0, dz / d * push));
    }
    const pp = this.eco.game.player;
    if (pp && pp.alive) {
      const dx = this.position.x - pp.position.x, dz = this.position.z - pp.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 4 + pp.genome.size * 1.5 && d > 0.01) desired.add(new THREE.Vector3(dx / d * 2, 0, dz / d * 2));
    }
    const nextX = this.position.x + Math.sin(this.heading) * this.speed * dt;
    const nextZ = this.position.z + Math.cos(this.heading) * this.speed * dt;
    if (this.world.slopeAt(nextX, nextZ) > 1.8 && !this.flying) targetSpeed *= 0.35;
    const terrain = this.world.heightAt(this.position.x, this.position.z);
    const waterDepth = WATER_LEVEL - terrain;
    if (waterDepth > 0.8) {
      this.swimming = true;
      if (this.state !== 'flee' && this.state !== 'drink' && waterDepth > 2.2) {
        // steer back toward land
        const w = this.world.nearestWater(this.position.x, this.position.z, 12);
        if (w) desired.set(this.position.x - w.x, 0, this.position.z - w.z);
      }
    } else this.swimming = false;
    if (this.injuries.leg) targetSpeed *= 0.62;
    if (this.fear > 0.7) targetSpeed *= 1.08;
    if (this.fatigue > 85) targetSpeed *= 0.65;
    if (this.state === 'sleep') targetSpeed = 0;
    const desiredLen = desired.length();
    if (desiredLen > 0.001) {
      desired.normalize();
      const targetHeading = Math.atan2(desired.x, desired.z);
      let delta = ((targetHeading - this.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const turnRate = (1.5 + this.stats.agility * 4.2) * (this.swimming ? 0.65 : 1);
      const turn = clamp(delta, -turnRate * dt, turnRate * dt);
      this.heading += turn;
      this.turn = damp(this.turn, turn / Math.max(dt, 0.001), 8, dt);
      this.speed = damp(this.speed, targetSpeed, 3, dt);
      this.position.x += Math.sin(this.heading) * this.speed * dt;
      this.position.z += Math.cos(this.heading) * this.speed * dt;
    } else {
      this.speed = damp(this.speed, 0, 4, dt);
      this.turn = damp(this.turn, 0, 6, dt);
    }
    const lim = 298;
    this.position.x = clamp(this.position.x, -lim, lim);
    this.position.z = clamp(this.position.z, -lim, lim);
    const h = this.world.heightAt(this.position.x, this.position.z);
    const depth = WATER_LEVEL - h;
    if (this.flying) {
      const base = Math.max(h, WATER_LEVEL);
      this.altitude = damp(this.altitude, this.state === 'flee' ? 10 : 5.5, 1.4, dt);
      this.position.y = base + this.altitude + Math.sin(performance.now() * 0.001 + this.heading) * 0.35;
      this.swimming = false;
    } else if (depth > 0.4) {
      this.position.y = WATER_LEVEL - 0.4 + Math.sin(performance.now() * 0.0012 + this.heading) * 0.06;
      this.swimming = true;
    } else {
      this.position.y = h;
      this.swimming = false;
    }
    this.rig.root.position.copy(this.position);
    // smooth clamp in water to avoid drowning
    if (this.swimming) this.fatigue = clamp(this.fatigue + dt * 0.25, 0, 100);
  }

  updateRig(dt) {
    this.rig.setState({
      speed: this.speed,
      state: this.state === 'graze' ? 'eat' : this.state === 'scavenge' ? 'eat' : this.state,
      fear: this.fear,
      turn: this.turn,
      swimming: this.swimming,
      flying: this.flying && this.state !== 'sleep',
      injuredLeg: this.injuries.leg,
      hurt: this.attackFlash
    });
    this.rig.root.rotation.y = this.heading;
    this.rig.update(dt);
    if (this.growth < 1) {
      this.growth = clamp(this.growth + dt * 0.00055, 0.35, 1);
      this.rig.setScale(this.scaleBase * this.growth);
    }
  }

  consumeWater(dt) {
    this.thirst = clamp(this.thirst - dt * 16, 0, 110);
    this.stamina = clamp(this.stamina + dt * 6, 0, this.stats.maxStamina);
  }

  consumePlant(node) {
    if (this.eatCooldown > 0 || !node || !node.available) return;
    this.eatCooldown = 1.4;
    const nut = this.world.consumePlant(node);
    this.hunger = clamp(this.hunger - nut * 0.8, 0, 110);
    this.health = clamp(this.health + num(2), 0, this.stats.maxHealth);
    this.eco.populationFood -= nut;
  }

  consumeCarcass(carcass, dt) {
    if (!carcass || carcass.consumed || this.eatCooldown > 0) return;
    this.eatCooldown = 0.9;
    const nut = Math.min(carcass.nutrition, 9);
    carcass.nutrition -= nut;
    carcass.eat(2.2);
    this.hunger = clamp(this.hunger - nut * 0.85, 0, 110);
    this.health = clamp(this.health + 1.5, 0, this.stats.maxHealth);
    if (carcass.nutrition <= 0.5) carcass.destroy();
    this.eco.emit('feed', `${this.species.common} scavenges ${carcass.sourceName}.`, this.species);
  }

  attack(target) {
    if (target.dead || this.attackTimer > 0) return;
    this.attackTimer = this.stats.attackCooldown;
    this.attacks++;
    this.attackFlash = 1;
    const dmg = this.stats.bite * (0.7 + Math.random() * 0.5) + (this.genome.clawSize > 0.5 ? this.stats.claw * 0.5 : 0);
    if (target === this.eco.game.player || target.takeDamage) {
      if (target.takeDamage) target.takeDamage(dmg, this, pick(Math.random, ['leg', 'body', 'body', 'eye', 'jaw']));
      else if (target === this.eco.game.player) {
        target.takeDamage(dmg, this);
        this.eco.game.playerDanger = Math.min(1, this.eco.game.playerDanger + 0.22);
      }
    }
    this.eco.emit('attack', `${this.species.common} bites ${target.displayName || 'the player'} for ${Math.round(dmg)} damage.`, this.species);
    this.eco.spawnHit(target.position, Math.round(dmg), this.genome.hue1);
    if (target.health <= 0) {
      this.kills++;
      this.hunger = clamp(this.hunger - 24, 0, 110);
      this.eco.emit('kill', `${this.species.common} kills ${target.displayName || 'its prey'}.`, this.species);
    }
  }

  breed(mate) {
    if (this.breedCooldown > 0 || mate.breedCooldown > 0 || this.dead || mate.dead) return;
    if (this.eco.agents.length >= this.eco.cap) return;
    this.breedCooldown = 28 + Math.random() * 35;
    mate.breedCooldown = 28 + Math.random() * 35;
    this.offspring++;
    this.eco.reproduce(this, mate);
    this.eco.emit('birth', `${this.species.common} produces offspring with ${mate.displayName}.`, this.species);
    this.eco.game.ui?.toast(`New ${this.species.common} born`, 'birth');
  }

  takeDamage(amount, attacker, part) {
    if (this.dead) return;
    const armor = clamp(this.stats.armorRating, 0, 0.75);
    const dmg = Math.max(1, amount * (1 - armor));
    this.health -= dmg;
    this.pain = clamp(this.pain + 0.18, 0, 1);
    this.attackFlash = 1;
    this.fear = clamp(this.fear + 0.45, 0, 1);
    this.memory.pain = clamp(this.memory.pain + 0.35, 0, 1);
    if (part && Math.random() < 0.28) {
      if (part === 'leg' && !this.injuries.leg) { this.injuries.leg = 1; this.rig.setInjury('leg'); this.eco.emit('injury', `${this.displayName} is lamed by a bite.`, this.species); }
      else if (part === 'eye' && !this.injuries.eye) { this.injuries.eye = 1; this.rig.setInjury('eye'); this.eco.emit('injury', `${this.displayName} loses an eye.`, this.species); }
      else if (part === 'jaw' && !this.injuries.jaw) { this.injuries.jaw = 1; this.rig.setInjury('jaw'); this.eco.emit('injury', `${this.displayName}'s jaw is broken.`, this.species); }
      else this.injuries.body++;
    }
    if (attacker && attacker !== this) {
      this.threat = attacker;
      this.threatScore = 0.9;
      if (this.genome.aggression > 0.6 && !this.dead) { this.state = 'attack'; this.target = attacker; this.stateTimer = 4; }
      else { this.state = 'flee'; this.stateTimer = 6; this.target = attacker; }
    }
    this.eco.spawnHit(this.position, Math.round(dmg), 8);
    if (this.health <= 0) this.die('killed');
  }

  die(cause) {
    if (this.dead) return;
    this.dead = true;
    this.deadTimer = 3;
    this.health = 0;
    this.speed = 0;
    this.state = 'dead';
    this.rig.setState({ state: 'dead', dead: true, speed: 0 });
    this.eco.onDeath(this, cause);
  }

  inspect() {
    return {
      name: this.displayName, species: this.species, genome: this.genome, stats: this.stats,
      health: this.health, maxHealth: this.stats.maxHealth, hunger: this.hunger, thirst: this.thirst,
      stamina: this.stamina, maxStamina: this.stats.maxStamina, fatigue: this.fatigue,
      fear: this.fear, fearLabel: this.fearLevel.label, fearColor: this.fearLevel.color,
      state: this.stateLabel, age: this.age, injuries: this.injuries, sex: this.sex,
      growth: this.growth, offspring: this.offspring, kills: this.kills,
      canBreed: this.canBreed, flying: this.flying, swimming: this.swimming
    };
  }
}

function num(n) { return n; }

export class Carcass {
  constructor(eco, pos, sourceName, nutrition, genome) {
    this.eco = eco;
    this.position = pos.clone();
    this.position.y = eco.world.heightAt(pos.x, pos.z);
    this.sourceName = sourceName;
    this.nutrition = nutrition;
    this.consumed = false;
    this.age = 0;
    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xcfc6ac, roughness: 0.7 });
    const meatMat = new THREE.MeshStandardMaterial({ color: 0x7d2b2b, roughness: 0.7 });
    const parts = [];
    const n = 5;
    for (let i = 0; i < n; i++) {
      const rib = new THREE.CylinderGeometry(0.04, 0.05, 0.8, 4);
      rib.rotateZ(Math.PI / 2);
      rib.translate((i - n / 2) * 0.18, 0.25 + Math.sin(i) * 0.08, 0);
      parts.push(rib);
    }
    parts.push(new THREE.SphereGeometry(0.3, 6, 5).scale(1.3, 0.7, 1.6).translate(0, 0.2, 0));
    const boneMesh = new THREE.Mesh(mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p)), boneMat);
    boneMesh.castShadow = true;
    boneMesh.receiveShadow = true;
    const meat = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), meatMat);
    meat.scale.set(1.4, 0.7, 1.1);
    meat.position.set(0.05, 0.2, 0.15);
    this.group.add(boneMesh, meat);
    this.group.rotation.y = Math.random() * TAU;
    eco.scene.add(this.group);
  }
  eat(amount) { this.nutrition -= amount; if (this.nutrition <= 0) this.destroy(); }
  update(dt) {
    this.age += dt;
    if (this.age > 90) this.destroy();
    if (this.age > 30) this.group.position.y -= dt * 0.004;
  }
  destroy() {
    if (this.consumed) return;
    this.consumed = true;
    this.eco.scene.remove(this.group);
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }
}

export class Ecosystem {
  constructor(game, world, seed = 1234) {
    this.game = game;
    this.scene = game.scene;
    this.world = world;
    this.seed = seed;
    this.rng = mulberry32(seed + 77);
    this.agents = [];
    this.carcasses = [];
    this.events = [];
    this.species = [];
    this.lineage = [];
    this.cap = 34;
    this.populationFood = 100;
    this.abstractTimer = 0;
    this.genesisYear = world.baseYear;
    this.onEvent = null;
    this.hitParticles = [];
    this.playerDanger = 0;
    this.stats = { births: 0, deaths: 0, kills: 0, speciesCount: 0, extinctCount: 0 };
    this.initSpecies();
  }

  initSpecies() {
    const species = buildStartingSpecies(this.rng);
    // compact species names to feel like a real survey catalogue
    for (const s of species) {
      s.originYear = this.genesisYear;
      s.lineageId = s.id;
      s.genome.id = s.id;
      this.lineage.push(this.lineageNode(s, null, this.genesisYear));
    }
    this.species = species;
  }

  registerPlayerSpecies(genome, name) {
    const g = normalizeGenome(genome);
    const sp = makeSpecies(this.rng, g, {
      name: 'Homo Aetheris', common: name || 'Aetherling', population: 1, generation: 1,
      originYear: this.world.baseYear + this.world.yearFloat, playerLineage: true, discovered: true,
      habitat: 'grassland', id: 'player_species'
    });
    sp.genome.id = sp.id;
    sp.lineageId = sp.id;
    this.playerSpecies = sp;
    this.species.unshift(sp);
    this.lineage.push(this.lineageNode(sp, null, this.world.baseYear));
    return sp;
  }

  lineageNode(sp, parentId, year) {
    return {
      id: sp.lineageId || sp.id, name: sp.name, common: sp.common, parentId: parentId || null,
      year, endYear: null, diet: sp.diet, color: sp.color, genome: sp.genome, population: sp.population,
      generation: sp.generation, extinct: false, isPlayer: !!sp.playerLineage, habitat: sp.habitat,
      event: sp.lineageEvent || ''
    };
  }

  spawnInitial(playerPos) {
    for (const sp of this.species) {
      if (sp.playerLineage) continue;
      const count = sp.population > 35 ? 5 : sp.population > 20 ? 4 : 2;
      for (let i = 0; i < count; i++) {
        this.spawnSpeciesAgent(sp, playerPos, 32 + Math.random() * 130);
      }
    }
  }

  spawnSpeciesAgent(sp, center, radius = 120) {
    if (this.agents.length >= this.cap) return null;
    const habitat = [sp.habitat, 'grassland', 'forest'].filter(Boolean);
    let pos = this.world.randomLandPoint(this.rng, habitat, center, radius);
    if (sp.genome.wings) pos = this.world.randomLandPoint(this.rng, ['mountain', 'grassland'], center, radius);
    const agent = new Agent(this, sp, mutateGenome(sp.genome, this.rng, 0.12), pos, {
      parentId: null
    });
    if (sp.diet === 'carnivore' && center) {
      const d = Math.hypot(agent.position.x - center.x, agent.position.z - center.z);
      if (d < 45) {
        agent.position.x += (agent.position.x - center.x) * 1.8;
        agent.position.z += (agent.position.z - center.z) * 1.8;
      }
    }
    this.agents.push(agent);
    return agent;
  }

  reproduce(parentA, parentB) {
    if (this.agents.length >= this.cap) return null;
    const childGenome = crossoverGenome(parentA.genome, parentB.genome, this.rng, 0.22);
    const child = new Agent(this, parentA.species, childGenome, {
      x: parentA.position.x + randRange(this.rng, -2, 2),
      z: parentA.position.z + randRange(this.rng, -2, 2)
    }, { age: 0.05, growth: 0.32, parentId: parentA.id, health: 25, hunger: 0, thirst: 0 });
    this.agents.push(child);
    parentA.species.population++;
    this.stats.births++;
    this.speciesDrift(parentA.species, childGenome);
    return child;
  }

  speciesDrift(sp, childGenome) {
    sp.generation++;
    if (this.rng() < 0.22) {
      const blended = {};
      for (const key of Object.keys(sp.genome)) {
        if (typeof sp.genome[key] === 'number') blended[key] = lerp(sp.genome[key], childGenome[key], 0.06);
      }
      blended.diet = sp.genome.diet;
      sp.genome = normalizeGenome(blended);
      sp.color = genomeColor(sp.genome);
    }
  }

  onDeath(agent, cause) {
    agent.species.population = Math.max(0, agent.species.population - 1);
    this.stats.deaths++;
    const carcass = new Carcass(this, agent.position, agent.species.common, 22 + agent.genome.size * 34, agent.genome);
    this.carcasses.push(carcass);
    if (this.carcasses.length > 9) { const old = this.carcasses.shift(); old.destroy(); }
    this.emit('death', `${agent.displayName} (${agent.species.common}) dies — ${cause}.`, agent.species);
    this.game.ui?.toast(`${agent.species.common} died`, 'death');
    if (agent.species.population <= 0) {
      agent.species.population = 0;
      this.emit('extinct', `Population of ${agent.species.name} has collapsed.`, agent.species);
    }
  }

  nearestAgent(pos, radius = 20, filter = null) {
    let best = null, bd = radius * radius;
    for (const a of this.agents) {
      if (a.dead) continue;
      if (filter && !filter(a)) continue;
      const d = (a.position.x - pos.x) ** 2 + (a.position.z - pos.z) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    return best ? { agent: best, dist: Math.sqrt(bd) } : null;
  }

  nearbyAgents(pos, radius = 8) {
    const out = [];
    const r2 = radius * radius;
    for (const a of this.agents) {
      if (a.dead) continue;
      const d = (a.position.x - pos.x) ** 2 + (a.position.z - pos.z) ** 2;
      if (d < r2) out.push(a);
    }
    return out;
  }

  nearestCarcass(pos, radius = 30) {
    let best = null, bd = radius * radius;
    for (const c of this.carcasses) {
      if (c.consumed) continue;
      const d = (c.position.x - pos.x) ** 2 + (c.position.z - pos.z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  update(dt) {
    this.playerDanger = Math.max(0, this.playerDanger - dt * 0.018);
    for (const a of this.agents) a.update(dt);
    for (const c of this.carcasses) c.update(dt);
    this.updateHits(dt);
    this.abstractTimer -= dt;
    if (this.abstractTimer <= 0) {
      this.abstractTimer = 6 + Math.random() * 6;
      this.abstractPopulation(dt);
      this.cullDistant();
    }
    this.agents = this.agents.filter(a => !a.dead || a.deadTimer > 0 || a.rig.root.parent);
    this.carcasses = this.carcasses.filter(c => !c.consumed);
    this.species.forEach(sp => { sp.population = Math.max(0, sp.population); if (sp.population <= 2 && !sp.extinct && !sp.playerLineage) { sp.extinct = true; sp.extinctYear = this.world.baseYear + this.world.yearFloat; this.stats.extinctCount++; } });
    for (const node of this.lineage) {
      if (node.endYear == null && node.id !== (this.playerSpecies?.lineageId)) {
        const sp = this.species.find(s => (s.lineageId || s.id) === node.id);
        if (sp?.extinct) node.extinct = true;
      }
    }
    this.stats.speciesCount = this.species.filter(s => !s.extinct).length;
  }

  abstractPopulation(dt) {
    const player = this.game.player;
    for (const sp of this.species) {
      if (sp.extinct || sp.playerLineage) continue;
      const agents = this.agents.filter(a => a.species === sp && !a.dead).length;
      if (agents < 4 && sp.population > 13 && Math.random() < 0.6 && this.agents.length < this.cap) {
        const pos = player ? player.position : new THREE.Vector3();
        const a = this.spawnSpeciesAgent(sp, pos, 90 + Math.random() * 110);
        if (a) sp.population++;
      }
      sp.population += (Math.random() - 0.49) * 0.8;
      if (sp.population > 160) sp.population = 160;
    }
    if (this.carcasses.length > 6) { const old = this.carcasses.shift(); old.destroy(); }
  }

  cullDistant() {
    if (!this.game.player) return;
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i];
      if (a.dead || a.species.playerLineage) continue;
      const d = a.position.distanceTo(this.game.player.position);
      if (d > 290 && this.agents.length > 22) {
        a.rig.dispose();
        this.agents.splice(i, 1);
      }
    }
  }

  spawnHit(pos, amount, hue) {
    this.game.particles?.burst(pos.clone().add(new THREE.Vector3(0, 1, 0)), amount > 10 ? 10 : 6, new THREE.Color().setHSL((hue % 360) / 360, 0.7, 0.5), 1.4);
  }

  updateHits(dt) {
    // flashes handled by particles; placeholder for future blood decals
  }

  emit(type, text, species, silent = false) {
    const ev = { id: Math.random().toString(36).slice(2), type, text, species: species?.name || null, common: species?.common || null, time: this.world.baseYear + this.world.yearFloat, day: this.world.day };
    this.events.unshift(ev);
    if (this.events.length > 80) this.events.pop();
    if (this.onEvent) this.onEvent(ev);
  }

  getSpecies(id) { return this.species.find(s => s.id === id || s.lineageId === id); }

  ecosystemReport() {
    const plants = this.world.plantNodes.filter(p => p.available).length;
    const herb = this.agents.filter(a => !a.dead && a.genome.diet === 'herbivore').length;
    const carn = this.agents.filter(a => !a.dead && a.genome.diet === 'carnivore').length;
    return {
      plants, herb, carn, carcasses: this.carcasses.length, agents: this.agents.filter(a => !a.dead).length,
      avgFear: avg(this.agents.filter(a => !a.dead).map(a => a.fear)),
      species: this.species.filter(s => !s.extinct)
    };
  }

  // ---------- Deep time ----------
  advanceEra(years, player) {
    const oldSpecies = this.species.map(s => ({ ...s, genome: { ...s.genome } }));
    const report = {
      years, fromYear: this.world.baseYear + this.world.yearFloat, toYear: this.world.baseYear + this.world.yearFloat + years,
      events: [], extinctions: [], splits: [], adaptations: [], playerAncestor: null, playerDescendant: null,
      climate: this.world.epoch
    };
    const epoch = Math.min(3, this.world.epoch + (years >= 1e6 ? 1 : years >= 1e5 ? 1 : 0));
    this.world.epoch = epoch;
    this.world.applyEpoch(epoch);
    this.world.baseYear += years;
    this.world.yearFloat = Math.max(0, this.world.yearFloat - years * 0.0001);
    const pressureCycle = [
      { predators: 0.6, competition: 0.5 },
      { cold: 0.5, scarcity: 0.6 },
      { arid: 0.7, scarcity: 0.4 },
      { predators: 0.4, competition: 0.8, cold: 0.4 }
    ][epoch];
    const gens = Math.max(2, Math.round(Math.log10(Math.max(10, years)) * 7));
    const newSpecies = [];
    for (const old of oldSpecies) {
      if (old.extinct) {
        report.extinctions.push(old);
        continue;
      }
      const isPlayer = old.playerLineage;
      let sp = { ...old, genome: { ...old.genome }, population: old.population };
      const localPressures = { ...pressureCycle };
      if (sp.habitat === 'desert') localPressures.arid = 0.9;
      if (sp.habitat === 'mountain') localPressures.cold = 0.8;
      if (sp.habitat === 'marsh') localPressures.competition = 0.7;
      const oldGenome = { ...sp.genome };
      for (let g = 0; g < gens; g++) sp.genome = mutateGenome(sp.genome, this.rng, 0.85, localPressures);
      // population dynamics across deep time
      const foodFactor = 0.55 + this.rng() * 1.25 - (localPressures.scarcity || 0) * 0.15;
      sp.population = Math.round(sp.population * foodFactor + this.rng() * 12);
      const extinct = sp.population < 9 && !isPlayer && this.rng() < 0.34;
      // lineages
      const parentNodeId = old.lineageId || old.id;
      for (const n of this.lineage) if (n.id === parentNodeId) n.endYear = report.toYear;
      if (extinct) {
        sp.extinct = true;
        sp.extinctYear = report.toYear;
        sp.population = 0;
        report.extinctions.push(sp);
        this.lineage.push(this.lineageNode({ ...sp, lineageEvent: 'extinction' }, parentNodeId, report.toYear));
        continue;
      }
      let evolved = sp;
      const split = !isPlayer && old.population > 24 && this.rng() < 0.34 && newSpecies.length < 5;
      if (split) {
        const daughterGenome = mutateGenome(sp.genome, this.rng, 1.3, localPressures);
        const daughter = makeSpecies(this.rng, daughterGenome, {
          name: makeSpeciesName(this.rng), common: makeCommonName(this.rng, daughterGenome.diet),
          population: Math.max(10, Math.round(sp.population * 0.4)), generation: 1,
          originYear: report.toYear, ancestorId: parentNodeId, habitat: pick(this.rng, ['forest', 'grassland', 'marsh', 'desert', 'mountain']),
          discovered: false, lineageEvent: 'speciation'
        });
        daughter.lineageId = 'sp_' + Math.floor(this.rng() * 1e9).toString(36);
        daughter.genome.id = daughter.lineageId;
        daughter.ancestorId = parentNodeId;
        daughter.population = Math.max(10, Math.round(daughter.population));
        newSpecies.push(daughter);
        this.lineage.push(this.lineageNode(daughter, parentNodeId, report.toYear));
        report.splits.push(daughter);
      }
      evolved = { ...sp, ancestorId: parentNodeId, originYear: report.toYear, generation: old.generation + gens };
      evolved.lineageId = 'sp_' + Math.floor(this.rng() * 1e9).toString(36);
      evolved.genome.id = evolved.lineageId;
      evolved.color = genomeColor(evolved.genome);
      evolved.diet = evolved.genome.diet;
      if (this.rng() < 0.45) {
        const oldName = evolved.common;
        evolved.common = makeCommonName(this.rng, evolved.genome.diet);
        if (this.rng() < 0.5) evolved.name = makeSpeciesName(this.rng);
        report.adaptations.push({ species: evolved, oldName, changes: this.describeChanges(oldGenome, evolved.genome) });
      } else {
        report.adaptations.push({ species: evolved, oldName: old.common, changes: this.describeChanges(oldGenome, evolved.genome) });
      }
      evolved.extinct = false;
      newSpecies.push(evolved);
      this.lineage.push(this.lineageNode(evolved, parentNodeId, report.toYear));
      if (isPlayer) {
        report.playerAncestor = old;
        report.playerDescendant = evolved;
      }
    }
    // ensure the player's lineage persists even if population crashed
    if (!report.playerDescendant) {
      const old = oldSpecies.find(s => s.playerLineage) || oldSpecies[0];
      const evolved = { ...old, genome: mutateGenome(old.genome, this.rng, 1.2, pressureCycle), population: Math.max(12, old.population), extinct: false, originYear: report.toYear, generation: old.generation + gens, lineageId: 'sp_' + Math.floor(this.rng() * 1e9).toString(36) };
      evolved.genome.id = evolved.lineageId;
      evolved.color = genomeColor(evolved.genome);
      evolved.diet = evolved.genome.diet;
      report.playerAncestor = old;
      report.playerDescendant = evolved;
      newSpecies.push(evolved);
      this.lineage.push(this.lineageNode(evolved, old.lineageId || old.id, report.toYear));
    }
    // migrate remaining living species before replacing current
    for (const s of this.species) {
      if (s.extinct) continue;
      if (!newSpecies.some(n => n.id === s.id || n.lineageId === s.lineageId)) newSpecies.push(s);
    }
    this.species = newSpecies;
    this.playerSpecies = this.species.find(s => s.playerLineage) || this.playerSpecies;
    if (this.playerSpecies) {
      this.playerSpecies.playerLineage = true;
      this.playerSpecies.population = Math.max(1, this.playerSpecies.population);
    }
    this.stats.speciesCount = this.species.filter(s => !s.extinct).length;
    report.speciesCount = this.stats.speciesCount;
    report.extinctCount = this.species.filter(s => s.extinct).length;
    report.epoch = epoch;
    report.newSpecies = newSpecies.filter(s => !oldSpecies.some(o => o.lineageId === s.lineageId));
    this.emit('era', `An era passes. ${fmt(years)} years reshape the world.`, null);
    return report;
  }

  describeChanges(a, b) {
    const out = [];
    const check = (key, label, fmtFn) => {
      const diff = b[key] - a[key];
      if (Math.abs(diff) > 0.12) out.push({ label, dir: diff > 0 ? 'up' : 'down', amount: Math.abs(diff), text: `${label} ${diff > 0 ? '+' : ''}${(diff * 100).toFixed(0)}%` });
    };
    check('size', 'body mass');
    check('speed', 'speed');
    check('armor', 'armor');
    check('teethSize', 'teeth');
    check('legLength', 'leg length');
    check('intelligence', 'intelligence');
    check('sociability', 'sociability');
    check('fearfulness', 'fear response');
    check('metabolism', 'metabolism');
    if (a.diet !== b.diet) out.push({ label: 'diet', text: `${a.diet} → ${b.diet}`, dir: 'shift' });
    if (a.wings !== b.wings) out.push({ label: 'wings', text: b.wings ? 'wings emerged' : 'wings lost', dir: 'shift' });
    if (out.length === 0) out.push({ label: 'microevolution', text: 'subtle drift in body proportions', dir: 'drift' });
    return out.slice(0, 4);
  }

  clearAgents() {
    for (const a of this.agents) { a.rig.dispose(); }
    this.agents = [];
    for (const c of this.carcasses) c.destroy();
    this.carcasses = [];
  }

  repopulate(playerPos) {
    this.clearAgents();
    for (const sp of this.species) {
      if (sp.extinct || sp.playerLineage) continue;
      const count = sp.population > 40 ? 5 : sp.population > 18 ? 4 : 2;
      for (let i = 0; i < count; i++) this.spawnSpeciesAgent(sp, playerPos, 45 + Math.random() * 150);
    }
  }
}
