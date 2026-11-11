// Creature World — bootstrap, game loop, stage transitions, deep time and persistence.
import * as THREE from 'three';
import { World, WATER_LEVEL } from './world.js';
import { Ecosystem } from './ecosystem.js';
import { Player } from './player.js';
import { Particles } from './particles.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { CellStage } from './cell.js';
import { defaultGenome, normalizeGenome, genomeColor, makeSpeciesName } from './genome.js';
import { clamp, damp, lerp, mulberry32 } from './util.js';

const SAVE_KEY = 'creatureworld_save_v2';

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.seed = this.resolveSeed();
    this.stage = 'title';
    this.started = false;
    this.creatureStarted = false;
    this.paused = false;
    this.muted = false;
    this.eraAdvanced = false;
    this.lastDt = 0.016;
    this.shakeAmount = 0;
    this.camYaw = Math.PI;
    this.camPitch = 0.34;
    this.camZoom = 0;
    this.titleTime = 0;
    this.autosaveTimer = 0;
    this.timeScale = 1;

    this.initRenderer();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.camera.position.set(40, 26, 40);

    this.world = new World(this.scene, this.seed, 0);
    this.ecosystem = new Ecosystem(this, this.world, this.seed + 17);
    this.spawn = this.world.findSpawn();
    this.playerGenome = defaultGenome(this.seed + 101);
    this.playerGenome = normalizeGenome({ ...this.playerGenome, size: 1.0, bodyLength: 1.08, legLength: 1.05, hue1: 156, hue2: 46, pattern: 2, texture: 1, sociability: 0.68 });
    this.ecosystem.registerPlayerSpecies(this.playerGenome, 'Aetherling');
    this.player = new Player(this, this.playerGenome, this.spawn);
    this.player.spawnPoint.copy(this.player.position);
    this.particles = new Particles(this.scene);
    this.input = new Input(this.canvas);
    this.audio = new AudioEngine();
    this.ecosystem.spawnInitial(this.player.position);
    // seed the codex with nearby gentle species
    const gentle = this.ecosystem.species.filter(s => !s.playerLineage && s.diet === 'herbivore').slice(0, 2);
    for (const s of gentle) { s.discovered = true; this.player.discoveredSpecies.add(s.id); }
    this.player.discoveredBiomes.add(this.world.biomeAt(this.player.position.x, this.player.position.z));
    this.ecosystem.onEvent = (ev) => { if (['kill', 'birth', 'extinct', 'era', 'injury'].includes(ev.type) && ev.type !== 'injury') this.ui?.toast(ev.text, ev.type === 'extinct' ? 'danger' : ev.type === 'birth' ? 'birth' : 'info'); };
    this.ui = new UI(this);
    this.pendingSave = this.readSave();
    if (this.pendingSave) { const b = document.getElementById('btn-continue'); if (b) b.classList.remove('hidden'); }
    this.camYaw = this.player.heading + Math.PI;
    this.updateCamera(0.016, true);
    this.bindGlobal();
    this.setupPointerLockHint();
    this.lastFrame = performance.now();
    requestAnimationFrame(this.tick.bind(this));
    setTimeout(() => this.ui.hideLoading(), 260);
    setTimeout(() => {
      this.ui.showTitle();
      this.audioReady = false;
    }, 420);
  }

  resolveSeed() {
    const params = new URLSearchParams(location.search);
    const q = params.get('seed');
    if (q) {
      const n = parseInt(q, 16);
      if (Number.isFinite(n)) return n >>> 0;
    }
    if (window.location.protocol === 'file:') return 0x2244;
    return 0x8841;
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      if (this.cell) { this.cell.camera.aspect = window.innerWidth / window.innerHeight; this.cell.camera.updateProjectionMatrix(); }
    });
  }

  bindGlobal() {
    const cont = document.getElementById('btn-continue');
    cont?.addEventListener('click', () => this.continueGame());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && this.stage === 'title') { this.startCreatureStage(); }
    });
    this.canvas.addEventListener('pointerdown', () => {
      if (!this.audio.ctx) this.audio.init();
    });
    window.addEventListener('pointerdown', () => { if (!this.audio.ctx) this.audio.init(); }, { once: true });
  }

  setupPointerLockHint() {
    // no pointer lock: drag-to-look is more reliable on desktop and touch
  }

  startCreatureStage(fromCell = false) {
    this.audio.init();
    this.audio.setStage('creature');
    this.ui.hideTitle();
    this.ui.showHUD();
    this.stage = 'creature';
    this.started = true;
    this.creatureStarted = true;
    this.paused = false;
    this.player.rig.root.visible = true;
    this.camYaw = this.player.heading + Math.PI;
    this.camPitch = 0.34;
    this.ui.closeModal?.();
    this.ui.syncHUD();
    if (!fromCell) {
      this.ui.toast('You wake on the shore of an unknown continent', 'info');
      setTimeout(() => this.ui.toast('Survive, adapt, and seed a dynasty', 'discovery'), 1200);
    }
    this.ecosystem.emit('era', `${this.ecosystem.playerSpecies.name} takes its first steps in the world.`, this.ecosystem.playerSpecies);
  }

  startCellStage() {
    this.audio.init();
    this.audio.setStage('cell');
    this.ui.hideTitle();
    this.ui.showHUD();
    this.ui.showCellHUD();
    if (!this.cell) this.cell = new CellStage(this);
    this.cell.reset();
    this.cell.playerRig.group.visible = true;
    this.ui.hideCellReady();
    this.ui.cellHUD(this.cell);
    this.stage = 'cell';
    this.started = true;
    this.paused = false;
    this.player.rig.root.visible = false;
    this.ui.toast('Cell Stage — consume plankton, avoid larger cells', 'discovery');
  }

  returnFromCell() {
    if (!this.cell) { this.returnToTitle(); return; }
    if (this.creatureStarted) {
      this.startCreatureStage(true);
    } else {
      this.returnToTitle();
    }
  }

  evolveFromCell(choice) {
    const g = { ...this.player.genome };
    const variants = {
      predator: { diet: 'carnivore', teethSize: 1.4, jawSize: 1.35, clawSize: 1.1, hornSize: 0.3, strength: 0.8, aggression: 0.82, speed: 0.7, hue1: 6, hue2: 32, pattern: 4, texture: 1, size: 1.05 },
      grazer: { diet: 'herbivore', size: 1.32, bodyWidth: 1.08, bodyHeight: 0.95, armor: 0.55, teethSize: 0.28, jawSize: 0.95, strength: 0.55, sociability: 0.9, hue1: 92, hue2: 52, pattern: 1, texture: 2, legLength: 1.05 },
      sprinter: { diet: 'omnivore', size: 0.94, legCount: 4, legLength: 1.8, legThickness: 0.65, tailLength: 1.55, speed: 0.92, agility: 0.95, stamina: 0.9, hue1: 40, hue2: 18, pattern: 4, texture: 1, metabolism: 0.65 },
      glider: { diet: 'omnivore', wingSpan: 1.9, wings: 2, armLength: 0.7, size: 0.96, agility: 0.92, speed: 0.7, eyeSize: 1.4, hue1: 280, hue2: 188, pattern: 3, texture: 2, tailLength: 1.2, sociability: 0.52 }
    };
    Object.assign(g, variants[choice] || {});
    this.player.applyGenome(normalizeGenome(g));
    const sp = this.ecosystem.playerSpecies;
    if (sp) { sp.genome = this.player.genome; sp.diet = this.player.genome.diet; sp.color = genomeColor(sp.genome); sp.common = 'Aetherling'; }
    const spawn = this.world.findSpawn();
    this.player.position.set(spawn.x, this.world.heightAt(spawn.x, spawn.z), spawn.z);
    this.player.spawnPoint.copy(this.player.position);
    this.player.rig.root.position.copy(this.player.position);
    this.player.dna += 20;
    this.player.health = this.player.stats.maxHealth;
    this.player.stamina = this.player.stats.maxStamina;
    this.player.hunger = 25;
    this.player.thirst = 22;
    if (this.cell) this.cell.playerRig.group.visible = false;
    this.ui.hideCellReady();
    this.startCreatureStage(true);
    this.ui.toast('Metamorphosis complete. You have crawled onto land.', 'evo');
    this.ui.toast(`Body plan: ${choice.toUpperCase()} · DNA +20`, 'discovery');
    this.audio.play('evolve');
    this.particles.ring(this.player.position, 14, 0x8fffd0);
    this.camera.position.set(this.player.position.x + Math.sin(this.camYaw) * 9, this.player.position.y + 5, this.player.position.z + Math.cos(this.camYaw) * 9);
  }

  returnToTitle() {
    this.stage = 'title';
    this.started = false;
    this.paused = false;
    this.ui.showTitle();
    this.ui.hideDeath();
    this.player.rig.root.visible = true;
    this.audio.setStage('creature');
    this.camYaw = this.player.heading + Math.PI;
    if (this.cell) this.cell.playerRig.group.visible = false;
  }

  playerAction(action) {
    if (!this.started || this.paused || this.stage !== 'creature' || !this.player.alive) return;
    if (action === 'attack') this.player.attack();
    else if (action === 'roar') this.player.roar();
    else if (action === 'interact') this.player.interact();
    else if (action === 'rest') this.player.toggleRest();
    else if (action === 'jump') { this.input.pressed.add('Space'); this.audio.init(); }
    else if (action === 'sprint') { /* hold handled via keyboard */ }
    this.ui.syncHUD();
  }

  applyPlayerEvolution(genome, cost) {
    this.player.dna = Math.max(0, this.player.dna - cost);
    this.player.applyGenome(normalizeGenome(genome));
    const sp = this.ecosystem.playerSpecies;
    if (sp) { sp.genome = this.player.genome; sp.diet = this.player.genome.diet; sp.color = genomeColor(sp.genome); }
    this.ui.toast(`Evolution applied — ${cost} DNA spent`, 'evo');
    this.audio.play('evolve');
    this.ui.healFlash();
    this.particles.ring(this.player.position, 8, 0x9dffd8);
    this.ui.syncHUD();
    this.saveGame(true);
  }

  async advanceEra(years) {
    const oldYear = this.world.baseYear;
    const report = this.ecosystem.advanceEra(years, this.player);
    this.eraAdvanced = true;
    this.world.baseYear = report.toYear;
    this.world.applyEpoch(report.epoch);
    this.world.weather.timer = 0;
    this.ecosystem.repopulate(this.player.position);
    this.player.dna += 12;
    this.player.health = Math.max(this.player.health, this.player.stats.maxHealth * 0.55);
    this.ui.toast(`${report.years >= 1e6 ? (report.years / 1e6).toFixed(1) + ' million' : report.years.toLocaleString()} years pass…`, 'discovery');
    this.audio.play('era');
    this.ui.showEraReport(report);
    this.saveGame(true);
  }

  adoptEvolvedGenome(genome) {
    this.player.applyGenome(normalizeGenome(genome));
    const sp = this.ecosystem.playerSpecies;
    if (sp) { sp.genome = this.player.genome; sp.diet = this.player.genome.diet; sp.color = genomeColor(sp.genome); sp.population = Math.max(2, sp.population); }
    this.player.health = this.player.stats.maxHealth;
    this.ui.toast('You adopt the descendant form. Your lineage continues.', 'evo');
    this.audio.play('evolve');
    this.ui.healFlash();
    this.particles.ring(this.player.position, 12, 0xa8ffd8);
    this.saveGame(true);
  }

  onPlayerDeath() {
    this.ui.showDeath();
  }

  respawnPlayer() {
    this.player.respawn(this.player.spawnPoint);
    this.paused = false;
    this.ui.hideDeath();
    this.ecosystem.playerDanger = 0;
  }

  shake(v) { this.shakeAmount = Math.min(1.2, this.shakeAmount + v); }

  toggleMute() {
    this.muted = !this.muted;
    this.audio.setMuted(this.muted);
    this.ui.toast(this.muted ? 'Audio muted' : 'Audio enabled', 'info');
  }

  updateCamera(dt, snap = false) {
    if (this.stage === 'cell') return;
    const p = this.player;
    const height = p.position.y + (p.genome.size * 1.2 + 0.8) * 0.65;
    const focus = new THREE.Vector3(p.position.x, height, p.position.z);
    let desired, lookAt;
    if (this.stage === 'title' || !this.started) {
      this.titleTime += dt;
      const ang = this.titleTime * 0.055 + 2.1;
      const radius = 30 - Math.sin(this.titleTime * 0.07) * 5;
      desired = new THREE.Vector3(focus.x + Math.cos(ang) * radius, focus.y + 13 + Math.sin(this.titleTime * 0.12) * 2, focus.z + Math.sin(ang) * radius);
      lookAt = new THREE.Vector3(focus.x, focus.y + 2.5, focus.z);
      const terrain = this.world.heightAt(desired.x, desired.z);
      desired.y = Math.max(desired.y, terrain + 4);
    } else {
      const zoom = clamp(1 + this.camZoom * 0.12, 0.48, 1.85);
      const dist = (6.2 + p.genome.size * 2.6) * zoom;
      const pitch = clamp(this.camPitch, 0.1, 1.15);
      const ox = Math.sin(this.camYaw) * Math.cos(pitch) * dist;
      const oz = Math.cos(this.camYaw) * Math.cos(pitch) * dist;
      const oy = Math.sin(pitch) * dist + 1.4;
      desired = new THREE.Vector3(focus.x + ox, focus.y + oy, focus.z + oz);
      const terrain = this.world.heightAt(desired.x, desired.z);
      desired.y = Math.max(desired.y, terrain + 1.4);
      lookAt = new THREE.Vector3(focus.x + Math.sin(p.heading) * 1.2, focus.y + 0.3, focus.z + Math.cos(p.heading) * 1.2);
    }
    if (snap) this.camera.position.copy(desired);
    else {
      const rate = this.stage === 'title' ? 0.6 : 8.5;
      this.camera.position.x = damp(this.camera.position.x, desired.x, rate, dt);
      this.camera.position.y = damp(this.camera.position.y, desired.y, rate, dt);
      this.camera.position.z = damp(this.camera.position.z, desired.z, rate, dt);
    }
    const shake = this.shakeAmount;
    if (shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * shake * 0.5;
      this.camera.position.y += (Math.random() - 0.5) * shake * 0.5;
      this.camera.position.z += (Math.random() - 0.5) * shake * 0.5;
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.2);
    }
    this.camera.lookAt(lookAt);
  }

  tick(now) {
    requestAnimationFrame(this.tick.bind(this));
    const rawDt = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.lastDt = rawDt;
    const dt = this.paused ? 0 : rawDt;

    // camera look input always consumed
    if (!this.paused && this.started) {
      this.camYaw -= this.input.look.x * 0.0045;
      this.camPitch = clamp(this.camPitch + this.input.look.y * 0.0032, 0.08, 1.15);
      this.camZoom = clamp(this.camZoom + this.input.zoom * 0.6, -3, 8);
    }
    this.input.resetLook();
    this.input.zoom = 0;

    if (!this.paused) {
      if (this.stage === 'cell' && this.cell) {
        this.cell.update(dt, this.input);
        this.cell.particles?.update(dt);
      } else if (this.stage === 'creature') {
        this.player.update(dt, this.input, this.camYaw);
        this.world.update(dt, this.player.position);
        this.ecosystem.update(dt);
        this.particles.update(dt);
        if (this.player.speed > 6 && this.player.grounded && this.player.genome.size > 1.3) {
          this.particles.dust(this.player.position, this.player.speed * 0.25);
        }
        if (this.player.grounded && this.player.speed > 2 && Math.random() < dt * 10) this.particles.dust(this.player.position, this.player.speed * 0.2);
      } else if (this.stage === 'title') {
        this.world.update(dt * 0.6, this.player.position);
        this.ecosystem.update(dt * 0.5);
        this.player.rig.update(dt * 0.5);
        this.particles.update(dt);
      }
      this.updateCamera(rawDt);
      this.ui.update(rawDt);
      this.autosaveTimer += rawDt;
      if (this.autosaveTimer > 45 && this.stage === 'creature') { this.autosaveTimer = 0; this.saveGame(true); }
    }

    this.input.pressed.clear();

    if (this.stage === 'cell' && this.cell) {
      this.renderer.render(this.cell.scene, this.cell.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // ---------- persistence ----------
  snapshot() {
    const p = this.player;
    const eco = this.ecosystem;
    return {
      version: 2, seed: this.seed, stage: this.stage, eraAdvanced: this.eraAdvanced,
      player: {
        genome: p.genome, dna: p.dna, health: p.health, hunger: p.hunger, thirst: p.thirst,
        stamina: p.stamina, age: p.age, inventory: p.inventory, injuries: p.injuries,
        position: { x: p.position.x, y: p.position.y, z: p.position.z },
        discoveredBiomes: [...p.discoveredBiomes], discoveredSpecies: [...p.discoveredSpecies]
      },
      world: { baseYear: this.world.baseYear, yearFloat: this.world.yearFloat, day: this.world.day, time: this.world.time, seasonIndex: this.world.seasonIndex, epoch: this.world.epoch },
      species: eco.species.map(s => ({ ...s, genome: s.genome })),
      lineage: eco.lineage.map(n => ({ ...n, genome: n.genome }))
    };
  }

  saveGame(silent = false) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.snapshot()));
      if (!silent) this.ui?.toast('World saved locally', 'discovery');
      const b = document.getElementById('btn-continue'); if (b) b.classList.remove('hidden');
      return true;
    } catch (e) { console.warn('save failed', e); return false; }
  }

  readSave() {
    try { const raw = localStorage.getItem(SAVE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  continueGame() {
    const save = this.pendingSave || this.readSave();
    if (!save) { this.startCreatureStage(); return; }
    this.audio.init();
    const p = save.player;
    this.world.baseYear = save.world.baseYear;
    this.world.yearFloat = save.world.yearFloat || 0;
    this.world.day = save.world.day || 1;
    this.world.time = save.world.time ?? 0.3;
    this.world.seasonIndex = save.world.seasonIndex || 0;
    this.world.applyEpoch(save.world.epoch || 0);
    this.ecosystem.clearAgents();
    this.ecosystem.species = (save.species || []).map(s => ({ ...s, genome: normalizeGenome(s.genome) }));
    this.ecosystem.lineage = (save.lineage || []).map(n => ({ ...n, genome: normalizeGenome(n.genome) }));
    this.ecosystem.playerSpecies = this.ecosystem.species.find(s => s.playerLineage);
    this.player.applyGenome(normalizeGenome(p.genome));
    this.player.dna = p.dna || 0;
    this.player.health = clamp(p.health, 1, this.player.stats.maxHealth);
    this.player.hunger = p.hunger ?? 20;
    this.player.thirst = p.thirst ?? 20;
    this.player.stamina = this.player.stats.maxStamina;
    this.player.age = p.age || 2;
    this.player.inventory = p.inventory || this.player.inventory;
    this.player.injuries = p.injuries || this.player.injuries;
    this.player.position.set(p.position.x, this.world.heightAt(p.position.x, p.position.z), p.position.z);
    this.player.spawnPoint.copy(this.player.position);
    this.player.rig.root.position.copy(this.player.position);
    this.player.discoveredBiomes = new Set(p.discoveredBiomes || []);
    this.player.discoveredSpecies = new Set(p.discoveredSpecies || []);
    this.eraAdvanced = !!save.eraAdvanced;
    this.ecosystem.repopulate(this.player.position);
    this.ecosystem.playerDanger = 0;
    this.startCreatureStage(true);
    this.ui.toast('Timeline restored', 'discovery');
    this.camYaw = this.player.heading + Math.PI;
  }
}

// boot
try {
  window.creatureWorld = new Game();
} catch (err) {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) loading.innerHTML = `<div class="loading-inner"><div class="loading-title">WORLD GENERATION FAILED</div><div class="tiny">${String(err.message || err)}</div></div>`;
}
