// HUD, minimap, overlays, codex, creature editor, family tree and deep-time reports.
import * as THREE from 'three';
import { CreatureRig } from './creature.js';
import { drawSilhouette, deriveStats, GENE_LABELS, PATTERNS, TEXTURES, DIETS, genomeColor, topTraits, speciesDescription, geneticDistance, normalizeGenome, mutateGenome, makeSpeciesName, makeCommonName } from './genome.js';
import { clamp, fmt, fmtYears, timeString, TAU, pick, lerp } from './util.js';
import { fearInfo, FEAR_LEVELS } from './ecosystem.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const pct = (v) => `${clamp(v, 0, 100)}%`;

const SLIDER_GROUPS = [
  { title: 'BODY & MASS', genes: ['size', 'bodyLength', 'bodyWidth', 'bodyHeight', 'neckLength'] },
  { title: 'HEAD & SENSES', genes: ['headSize', 'snoutLength', 'eyeSize', 'teethSize', 'jawSize'] },
  { title: 'LIMBS & LOCOMOTION', genes: ['legCount', 'legLength', 'legThickness', 'armLength', 'tailLength', 'wingSpan'] },
  { title: 'DEFENSE & WEAPONS', genes: ['hornSize', 'spikeSize', 'armor', 'clawSize'] },
  { title: 'COLOUR & COVERING', genes: ['hue1', 'hue2', 'saturation', 'lightness'] },
  { title: 'TEMPERAMENT', genes: ['speed', 'strength', 'agility', 'intelligence', 'sociability', 'fearfulness', 'boldness', 'aggression'] }
];
const RANGES = {
  size: [0.55, 2.6, 0.05], bodyLength: [0.6, 2.1, 0.05], bodyWidth: [0.55, 1.8, 0.05], bodyHeight: [0.55, 1.9, 0.05],
  neckLength: [0, 1.6, 0.05], headSize: [0.45, 1.7, 0.05], snoutLength: [0.2, 1.9, 0.05], eyeSize: [0.4, 1.8, 0.05],
  legCount: [2, 6, 2], legLength: [0.35, 1.9, 0.05], legThickness: [0.4, 1.8, 0.05], armLength: [0, 1.5, 0.05],
  tailLength: [0, 2.1, 0.05], wingSpan: [0, 2.1, 0.05], hornSize: [0, 1.6, 0.05], spikeSize: [0, 1.5, 0.05],
  armor: [0, 1.4, 0.05], clawSize: [0, 1.5, 0.05], teethSize: [0.2, 1.8, 0.05], jawSize: [0.4, 1.6, 0.05],
  hue1: [0, 360, 1], hue2: [0, 360, 1], saturation: [20, 95, 1], lightness: [24, 72, 1],
  speed: [0.2, 1, 0.01], strength: [0.15, 1, 0.01], agility: [0.15, 1, 0.01], intelligence: [0.1, 1, 0.01],
  sociability: [0.05, 1, 0.01], fearfulness: [0.05, 1, 0.01], boldness: [0.05, 1, 0.01], aggression: [0.05, 1, 0.01]
};

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      loading: $('#loading'), title: $('#title-screen'), hud: $('#hud'), cellHud: $('#cell-hud'),
      modal: $('#modal-overlay'), modalBody: $('#modal-body'), modalTitle: $('#modal-title'),
      modalKicker: $('#modal-kicker'), modalPanel: $('#modal-panel'), death: $('#death-screen'),
      toasts: $('#toasts'), tags: $('#nearby-tags'), reticle: $('#selection-reticle'),
      damageVignette: $('#damage-vignette'), healVignette: $('#heal-vignette'), dmgNums: $('#damage-numbers'),
      minimap: $('#minimap'), context: $('#context-prompt'), contextLabel: $('#context-label'),
      targetPanel: $('#target-panel'), flash: $('#screen-flash')
    };
    this.modalOpen = false;
    this.modalKind = null;
    this.hudTimer = 0;
    this.tagTimer = 0;
    this.mapTimer = 0;
    this.targetTimer = 0;
    this.tagPool = [];
    this.damageNums = [];
    this.treePoints = [];
    this.selectedCodex = null;
    this.selectedEra = 1000;
    this.pendingReport = null;
    this.editor = null;
    this.dismissedTarget = null;
    this.minimapBg = null;
    this.bind();
    this.startHudLoop();
  }

  bind() {
    $('#btn-start').addEventListener('click', () => this.game.startCreatureStage());
    $('#btn-cell-start').addEventListener('click', () => this.game.startCellStage());
    $('#btn-title-help').addEventListener('click', () => this.openHelp());
    $('#modal-close').addEventListener('click', () => this.closeModal());
    this.el.modal.addEventListener('pointerdown', (e) => { if (e.target === this.el.modal) this.closeModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') { if (this.modalOpen) this.closeModal(); else if (this.game.stage === 'creature' && this.game.started) this.openMenu(); }
    });
    $$('.top-actions [data-menu]').forEach(b => b.addEventListener('click', () => {
      this.game.audio.play('open');
      const m = b.dataset.menu;
      if (m === 'codex') this.openCodex();
      if (m === 'editor') this.openEditor();
      if (m === 'family') this.openFamily();
      if (m === 'ecosystem') this.openEcosystem();
      if (m === 'inventory') this.openInventory();
      if (m === 'menu') this.openMenu();
    }));
    $$('#hud [data-action], .mobile-actions [data-action]').forEach(b => b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.game.playerAction(b.dataset.action);
    }));
    $('#btn-respawn').addEventListener('click', () => this.game.respawnPlayer());
    $('#target-close').addEventListener('click', () => { this.dismissedTarget = this.game.player?.targetAgent?.id || null; this.el.targetPanel.classList.add('hidden'); });
    $('#target-attack').addEventListener('click', () => this.game.playerAction('attack'));
    $('#target-inspect').addEventListener('click', () => { const a = this.game.player?.targetAgent; if (a) this.openInspect(a); });
    $('#btn-evolve-cell').addEventListener('click', () => this.openCellUpgrade());
    $('#btn-cell-exit').addEventListener('click', () => this.game.returnFromCell());
    $('#title-seed').textContent = this.game.seed.toString(16).toUpperCase();
    // keyboard action bindings
    window.addEventListener('keydown', (e) => {
      if (!this.game.started || this.modalOpen || this.game.paused && !this.modalOpen) return;
      const map = { KeyF: 'attack', KeyQ: 'roar', KeyE: 'interact', KeyR: 'rest', Space: 'jump' };
      if (map[e.code] && !e.repeat) this.game.playerAction(map[e.code]);
      if (e.code === 'KeyM') this.game.toggleMute();
      if (e.code === 'KeyG') this.openEditor();
      if (e.code === 'Tab') { e.preventDefault(); this.openEcosystem(); }
    });
  }

  startHudLoop() {
    const loop = () => {
      this.updateMinimap();
      this.syncHUD();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  hideLoading() { this.el.loading.classList.add('hidden'); }
  showTitle() { this.el.title.classList.remove('hidden'); this.el.hud.classList.add('hidden'); this.el.cellHud.classList.add('hidden'); this.game.started = false; }
  hideTitle() { this.el.title.classList.add('hidden'); }
  showHUD() { this.el.hud.classList.remove('hidden'); this.el.cellHud.classList.add('hidden'); }
  showCellHUD() { this.el.cellHud.classList.remove('hidden'); this.el.hud.classList.add('hidden'); }

  openModal(kind, title, kicker, body, wide = false) {
    this.modalOpen = true;
    this.modalKind = kind;
    this.el.modalTitle.textContent = title;
    this.el.modalKicker.textContent = kicker;
    this.el.modalBody.innerHTML = body;
    this.el.modal.classList.remove('hidden');
    this.el.modalPanel.classList.toggle('wide', wide);
    this.game.paused = true;
    this.game.audio.play('open');
    this.el.modalBody.scrollTop = 0;
  }

  closeModal() {
    if (!this.modalOpen) return;
    this.modalOpen = false;
    this.modalKind = null;
    this.el.modal.classList.add('hidden');
    this.stopEditor();
    if (this.game.stage === 'creature' && !this.game.player?.alive) { this.game.paused = true; return; }
    this.game.paused = false;
    this.game.audio.play('click');
  }

  toast(text, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 5) this.el.toasts.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, 3600);
  }

  damageFlash(amount) {
    this.el.damageVignette.style.opacity = Math.min(1, 0.45 + amount * 0.01);
    setTimeout(() => { this.el.damageVignette.style.opacity = 0; }, 160);
    this.el.flash.style.background = '#ff3b30';
    this.el.flash.style.opacity = 0.12;
    setTimeout(() => { this.el.flash.style.opacity = 0; }, 70);
  }

  healFlash() {
    this.el.healVignette.style.opacity = 1;
    setTimeout(() => { this.el.healVignette.style.opacity = 0; }, 450);
  }

  damageNumber(worldPos, amount) {
    if (!this.game.camera) return;
    const p = worldPos.clone(); p.y += 1.4;
    p.project(this.game.camera);
    if (p.z > 1) return;
    const x = (p.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
    const d = document.createElement('div');
    d.className = 'damage-num';
    d.textContent = `-${amount}`;
    d.style.left = x + 'px'; d.style.top = y + 'px';
    this.el.dmgNums.appendChild(d);
    setTimeout(() => d.remove(), 950);
  }

  syncHUD() {
    const g = this.game;
    if (!g.player || g.stage !== 'creature' || !g.started) return;
    const p = g.player;
    const now = performance.now();
    if (now - (this._hudAt || 0) < 120) return;
    this._hudAt = now;
    const st = p.stats;
    $('#bar-health').style.width = pct(p.health / st.maxHealth * 100);
    $('#bar-hunger').style.width = pct(p.hunger);
    $('#bar-thirst').style.width = pct(p.thirst);
    $('#bar-stamina').style.width = pct(p.stamina / st.maxStamina * 100);
    $('#val-health').textContent = Math.ceil(p.health);
    $('#val-hunger').textContent = Math.ceil(p.hunger);
    $('#val-thirst').textContent = Math.ceil(p.thirst);
    $('#val-stamina').textContent = Math.ceil(p.stamina);
    $('#age-label').textContent = `${p.age.toFixed(1)} yrs`;
    const threat = p.localThreat > 0.6 ? 'THREAT HIGH' : p.localThreat > 0.25 ? 'THREAT MODERATE' : 'THREAT LOW';
    const fl = $('#fear-label'); fl.textContent = threat;
    fl.style.color = p.localThreat > 0.6 ? 'var(--red)' : p.localThreat > 0.25 ? 'var(--amber)' : 'var(--mint)';
    const sp = g.ecosystem?.playerSpecies;
    if (sp) {
      $('#hud-species').textContent = sp.common;
      $('#hud-species-sub').textContent = `${sp.name} · Gen ${sp.generation}`;
      $('#hud-pop').textContent = `pop ${Math.max(1, Math.round(sp.population))}`;
    }
    $('#hud-dna').textContent = Math.floor(p.dna);
    $('#hud-stage').textContent = g.stage.toUpperCase();
    // portrait occasionally
    if (!this._portraitAt || now - this._portraitAt > 2500 || this._portraitGenome !== p.genome.id) {
      const c = $('#hud-portrait');
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      drawSilhouette(ctx, p.genome, c.width, c.height, { zoom: 1.1 });
      this._portraitAt = now; this._portraitGenome = p.genome.id;
    }
    const chips = $('#injury-chips');
    const injuryText = [];
    if (p.injuries.leg > 0.3) injuryText.push('LAMED LEG');
    if (p.injuries.eye > 0.3) injuryText.push('BLURRED EYE');
    if (p.injuries.jaw > 0.3) injuryText.push('BROKEN JAW');
    if (p.injuries.body > 0.3) injuryText.push('TORN FLANK');
    const newHtml = injuryText.map(t => `<span class="injury-chip">${t}</span>`).join('');
    if (chips.innerHTML !== newHtml) chips.innerHTML = newHtml;
    const hazard = g.world?.hazard;
    const hz = $('#hazard-note');
    hz.textContent = hazard ? `△ ${hazard.label}` : '';
    // objective
    const obj = this.currentObjective(p);
    $('#objective-text').textContent = obj.text;
    $('#objective-bar').style.width = pct(obj.progress * 100);
    // cooldown overlays
    if ($('#cd-attack')) $('#cd-attack').style.height = pct(p.attackCooldown / st.attackCooldown * 100);
    if ($('#cd-roar')) $('#cd-roar').style.height = pct(p.roarCooldown / 9 * 100);
    // context prompt
    const label = p.interactLabel;
    if (label && !p.resting) { this.el.context.classList.remove('hidden'); this.el.contextLabel.textContent = label.label; }
    else this.el.context.classList.add('hidden');
    // environment
    const w = g.world;
    if (w) {
      $('#env-clock').textContent = timeString(w.time);
      $('#env-day').textContent = `DAY ${w.day} · ${w.seasonNames[w.seasonIndex].toUpperCase()}`;
      $('#env-weather').textContent = w.weather.label;
      $('#env-year').textContent = `Year ${fmt(w.baseYear + w.yearFloat)}`;
      $('#minimap-label').textContent = w.biomeInfo(w.biomeAt(p.position.x, p.position.z)).label.toUpperCase();
    }
    if (this._hudDNA !== Math.floor(p.dna)) { this._hudDNA = Math.floor(p.dna); }
    this.updateTargetPanel();
  }

  currentObjective(p) {
    if (p.thirst > 68) return { text: `Find water — thirst is critical (${Math.round(p.thirst)}%)`, progress: 0.12 };
    if (p.hunger > 68) return { text: `Feed soon — hunger is critical (${Math.round(p.hunger)}%)`, progress: 0.2 };
    if (p.dna < 30) return { text: `Gather DNA by feeding and observing wildlife (${Math.floor(p.dna)}/30)`, progress: p.dna / 30 };
    if (p.discoveredSpecies.size < 3) return { text: `Record 3 species in your codex (${p.discoveredSpecies.size}/3)`, progress: p.discoveredSpecies.size / 3 };
    if (!this.game.eraAdvanced) return { text: 'You are ready for deep time. Open EVOLVE or the WORLD menu.', progress: 0.7 };
    if (p.discoveredBiomes.size < 5) return { text: `Chart 5 habitats (${p.discoveredBiomes.size}/5)`, progress: p.discoveredBiomes.size / 5 };
    return { text: 'Thrive. Evolve. Seed the future of your lineage.', progress: 1 };
  }

  updateTargetPanel() {
    const now = performance.now();
    if (now - (this._targetAt || 0) < 140) return;
    this._targetAt = now;
    const p = this.game.player;
    const a = p?.targetAgent;
    if (!a || a.id === this.dismissedTarget || !p.alive) { this.el.targetPanel.classList.add('hidden'); return; }
    this.el.targetPanel.classList.remove('hidden');
    $('#target-name').textContent = a.displayName;
    $('#target-species').textContent = `${a.species.common} · ${a.species.name} · ${a.genome.diet}`;
    const fi = fearInfo(a.fear);
    const fearEl = $('#target-fear');
    fearEl.textContent = `${fi.icon} ${fi.label.toUpperCase()} · ${(a.fear * 100).toFixed(0)}%`;
    fearEl.style.color = fi.color;
    $('#target-hp').style.width = pct(a.health / a.stats.maxHealth * 100);
    $('#target-fearbar').style.width = pct(a.fear * 100);
    $('#target-meta').innerHTML = `${a.stateLabel} · ${a.age.toFixed(1)} yrs · ${a.sex}<br>HP ${Math.ceil(a.health)}/${Math.round(a.stats.maxHealth)} · Bite ${Math.round(a.stats.bite)} · ${a.genome.size > 1.4 ? 'Large' : a.genome.size < 0.85 ? 'Small' : 'Medium'} · ${a.injuries.leg ? 'lamed ' : ''}${a.injuries.eye ? 'half-blind ' : ''}`;
    // reticle position
    if (this.game.camera) {
      const pos = a.position.clone(); pos.y += 1.2;
      pos.project(this.game.camera);
      if (pos.z < 1) {
        this.el.reticle.classList.remove('hidden');
        this.el.reticle.style.left = ((pos.x * 0.5 + 0.5) * window.innerWidth) + 'px';
        this.el.reticle.style.top = ((-pos.y * 0.5 + 0.5) * window.innerHeight) + 'px';
      } else this.el.reticle.classList.add('hidden');
    }
  }

  updateNameplates(dt) {
    if (!this.game.ecosystem || !this.game.player || this.modalOpen || this.game.stage !== 'creature') {
      this.el.tags.innerHTML = ''; this.tagPool = []; return;
    }
    this.tagTimer -= dt;
    if (this.tagTimer > 0) return;
    this.tagTimer = 0.14;
    const p = this.game.player;
    const list = this.game.ecosystem.agents
      .filter(a => !a.dead && a.position.distanceTo(p.position) < 52)
      .sort((a, b) => a.position.distanceToSquared(p.position) - b.position.distanceToSquared(p.position))
      .slice(0, 6);
    const needed = list.length;
    while (this.tagPool.length < needed) {
      const d = document.createElement('div');
      d.className = 'nameplate';
      d.innerHTML = '<div class="np-name"></div><div class="np-bar"><i></i></div><div class="np-fear"></div>';
      this.el.tags.appendChild(d);
      this.tagPool.push(d);
    }
    while (this.tagPool.length > needed) { this.tagPool.pop().remove(); }
    const v = new THREE.Vector3();
    list.forEach((a, i) => {
      const d = this.tagPool[i];
      v.copy(a.position);
      v.y += (1.6 + a.genome.size * 1.1) * a.growth;
      v.project(this.game.camera);
      if (v.z > 1) { d.style.display = 'none'; return; }
      d.style.display = 'block';
      d.style.left = ((v.x * 0.5 + 0.5) * window.innerWidth) + 'px';
      d.style.top = ((-v.y * 0.5 + 0.5) * window.innerHeight) + 'px';
      const fi = fearInfo(a.fear);
      d.querySelector('.np-name').textContent = `${a.species.common}${a.fear > 0.55 ? ' !' : ''}`;
      d.querySelector('.np-fear').textContent = fi.icon;
      d.querySelector('.np-fear').style.color = fi.color;
      const hp = d.querySelector('.np-bar i');
      hp.style.width = pct(a.health / a.stats.maxHealth * 100);
      hp.style.background = a.health < a.stats.maxHealth * 0.35 ? '#ff6f5e' : a.health < a.stats.maxHealth * 0.7 ? '#ffd170' : '#7df3bc';
      d.style.opacity = 1 - clamp((a.position.distanceTo(p.position) - 35) / 25, 0, 1);
    });
  }

  updateMinimap() {
    const g = this.game;
    if (!g.world || !g.started) return;
    const now = performance.now();
    const c = this.el.minimap;
    const ctx = c.getContext('2d');
    if (!this.minimapBg) {
      const off = document.createElement('canvas'); off.width = c.width; off.height = c.height;
      const o = off.getContext('2d');
      const size = 96;
      const step = c.width / size;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const wx = (x / size - 0.5) * 620, wz = (y / size - 0.5) * 620;
          const h = g.world.heightAt(wx, wz);
          const biome = g.world.biomeAt(wx, wz);
          const info = g.world.biomeInfo(biome);
          if (h < 0.6) o.fillStyle = `hsl(192, 45%, ${18 + (h + 10) * 0.35}%)`;
          else o.fillStyle = `hsl(${info.hue}, ${info.sat}%, ${clamp(info.light + (h - 10) * 0.25, 18, 62)}%)`;
          o.fillRect(x * step, y * step, step + 1, step + 1);
        }
      }
      const id = o.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < id.data.length; i += 4) {
        const n = ((i * 13) % 17) - 8;
        id.data[i] = clamp(id.data[i] + n, 0, 255);
        id.data[i + 1] = clamp(id.data[i + 1] + n, 0, 255);
        id.data[i + 2] = clamp(id.data[i + 2] + n, 0, 255);
      }
      o.putImageData(id, 0, 0);
      // shelters
      for (const s of g.world.shelters) {
        const px = (s.x / 620 + 0.5) * c.width, py = (s.z / 620 + 0.5) * c.height;
        o.fillStyle = 'rgba(255,209,112,.65)'; o.beginPath(); o.arc(px, py, 3, 0, TAU); o.fill();
      }
      this.minimapBg = off;
    }
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.beginPath(); ctx.arc(c.width / 2, c.height / 2, c.width / 2 - 2, 0, TAU); ctx.clip();
    ctx.drawImage(this.minimapBg, 0, 0);
    const scale = c.width / 620;
    const p = g.player;
    // agents
    if (g.ecosystem) {
      for (const a of g.ecosystem.agents) {
        if (a.dead) continue;
        const x = (a.position.x / 620 + 0.5) * c.width, y = (a.position.z / 620 + 0.5) * c.height;
        ctx.fillStyle = a.genome.diet === 'carnivore' ? 'rgba(255,111,94,.9)' : a.genome.diet === 'herbivore' ? 'rgba(160,240,180,.75)' : 'rgba(255,209,112,.8)';
        ctx.beginPath(); ctx.arc(x, y, 2.2 + a.genome.size * 0.7, 0, TAU); ctx.fill();
      }
    }
    // player
    if (p?.position) {
      const x = (p.position.x / 620 + 0.5) * c.width, y = (p.position.z / 620 + 0.5) * c.height;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(-p.heading);
      ctx.fillStyle = '#b6ffdf'; ctx.shadowColor = '#7df3bc'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
      // view cone
      ctx.save(); ctx.translate(x, y); ctx.rotate(-p.heading - Math.PI / 2);
      ctx.fillStyle = 'rgba(182,255,223,.08)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 46, -0.5, 0.5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  showDeath() {
    const p = this.game.player;
    this.el.death.classList.remove('hidden');
    this.el.death.classList.remove('hidden');
    $('#death-text').textContent = p ? `You survived ${Math.floor(p.age)} years and gathered ${Math.floor(p.dna)} DNA. Your body now feeds the ecosystem.` : 'Your body returns to the ecosystem.';
    this.game.paused = true;
  }
  hideDeath() { this.el.death.classList.add('hidden'); }

  // ================= CODEX =================
  openCodex(selectId = null) {
    const g = this.game;
    const eco = g.ecosystem;
    if (!eco) return;
    const species = [...eco.species].sort((a, b) => (b.playerLineage ? 1 : 0) - (a.playerLineage ? 1 : 0) || (b.discovered ? 1 : 0) - (a.discovered ? 1 : 0));
    const selected = species.find(s => s.id === selectId) || species.find(s => s.id === this.selectedCodex) || species[0];
    this.selectedCodex = selected?.id;
    const listHtml = species.map(s => `
      <div class="codex-item ${selected?.id === s.id ? 'active' : ''} ${s.extinct ? 'extinct' : ''}" data-codex-id="${s.id}">
        <canvas width="108" height="80" data-portrait="${s.id}"></canvas>
        <div><div class="ci-name">${s.discovered || s.playerLineage ? s.common : 'Unrecorded'}</div><div class="ci-sub">${s.discovered ? `${s.name} · ${s.diet}` : '??? · unknown'}</div></div>
        <div class="ci-status">${s.extinct ? 'EXTINCT' : s.playerLineage ? 'YOURS' : `${Math.round(s.population)}`}</div>
      </div>`).join('');
    this.openModal('codex', 'Species Codex', 'LIVING ARCHIVE', `
      <div class="codex-layout">
        <div class="codex-list" id="codex-list">${listHtml}</div>
        <div class="codex-detail" id="codex-detail"></div>
      </div>`, true);
    setTimeout(() => {
      for (const s of species) {
        const c = document.querySelector(`[data-portrait="${s.id}"]`);
        if (!c) continue;
        const ctx = c.getContext('2d');
        if (!s.discovered && !s.playerLineage) {
          ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.fillStyle = '#5e776c'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', c.width / 2, c.height / 2 + 7);
        } else drawSilhouette(ctx, s.genome, c.width, c.height);
      }
      document.querySelectorAll('[data-codex-id]').forEach(el => el.addEventListener('click', () => {
        this.selectedCodex = el.dataset.codexId;
        this.openCodex(el.dataset.codexId);
      }));
      this.renderCodexDetail(selected);
    }, 20);
  }

  renderCodexDetail(s) {
    const box = $('#codex-detail');
    if (!box || !s) return;
    if (!s.discovered && !s.playerLineage) {
      box.innerHTML = `<div class="codex-hero"><canvas width="480" height="300" id="codex-hero"></canvas><div><div class="codex-name">Unrecorded</div><div class="codex-common">???</div></div></div><p class="codex-desc">No survey data has been collected for this organism. Approach it in the world to record its anatomy and behaviour.</p>`;
      return;
    }
    const st = deriveStats(s.genome);
    const traits = topTraits(s.genome, 4);
    const injuries = '';
    const statRows = [
      ['Size', s.genome.size / 2.6], ['Speed', st.sprint / 12], ['Bite force', st.bite / 30], ['Armour', st.armorRating / 0.9],
      ['Senses', st.senses / 35], ['Stamina', st.maxStamina / 90], ['Intelligence', s.genome.intelligence], ['Sociability', s.genome.sociability],
      ['Fearfulness', s.genome.fearfulness], ['Longevity', s.genome.lifespan], ['Metabolism', s.genome.metabolism], ['Fertility', s.genome.fertility]
    ];
    box.innerHTML = `
      <div class="codex-hero"><canvas width="520" height="320" id="codex-hero"></canvas>
        <div><div class="codex-name">${s.common}</div><div class="codex-common">${s.name}${s.playerLineage ? ' · YOUR LINEAGE' : ''}</div>
        <div style="margin-top:10px;display:flex;gap:5px;flex-wrap:wrap">
          <span class="pill ${s.genome.diet === 'carnivore' ? 'red' : s.genome.diet === 'herbivore' ? 'green' : 'amber'}">${s.diet.toUpperCase()}</span>
          <span class="pill">${s.habitat}</span>
          <span class="pill">${s.extinct ? 'EXTINCT' : `POP ${Math.round(s.population)}`}</span>
          <span class="pill">GEN ${s.generation}</span>
        </div></div>
      </div>
      <p class="codex-desc">${speciesDescription(s.genome)}</p>
      <div class="section-label">BIOLOGICAL PROFILE</div>
      <div class="stat-grid">
        ${statRows.map(([k, v]) => `<div class="stat-line"><span>${k}</span><div class="stat-track"><i style="width:${pct(v * 100)}"></i></div><b>${Math.round(clamp(v, 0, 1) * 100)}</b></div>`).join('')}
      </div>
      <div class="section-label">DOMINANT ADAPTATIONS</div>
      <div class="trait-row">${traits.map(t => `<div class="trait"><i>◆</i>${t.name}</div>`).join('')}${s.genome.wings ? '<div class="trait"><i>◆</i>Powered flight</div>' : ''}${s.genome.armor > 0.8 ? '<div class="trait"><i>◆</i>Bony armour</div>' : ''}</div>
      <div class="species-actions"><button class="btn btn-ghost" id="codex-track">Track species</button><button class="btn btn-ghost" id="codex-close">Close archive</button></div>
      <div class="tiny" style="margin-top:12px">Discovered by you · recorded ${new Date().toLocaleDateString()} · ${s.originYear ? `lineage origin ${fmtYears(Math.max(0, (this.game.world.baseYear + this.game.world.yearFloat) - s.originYear))} ago` : ''}</div>`;
    const c = $('#codex-hero');
    drawSilhouette(c.getContext('2d'), s.genome, c.width, c.height, { zoom: 1.2 });
    $('#codex-track')?.addEventListener('click', () => {
      this.game.player.trackedSpecies = s;
      this.toast(`Tracking ${s.common}`, 'discovery');
      this.closeModal();
    });
    $('#codex-close')?.addEventListener('click', () => this.closeModal());
  }

  // ================= INSPECT =================
  openInspect(agent) {
    if (!agent) return;
    this.selectedCodex = agent.species.id;
    this.openCodex(agent.species.id);
  }

  // ================= EDITOR =================
  openEditor() {
    if (!this.game.player) return;
    const p = this.game.player;
    const temp = normalizeGenome({ ...p.genome });
    this.editorTemp = temp;
    const sliders = SLIDER_GROUPS.map(group => `
      <div class="slider-group"><div class="section-label">${group.title}</div>
        ${group.genes.map(key => this.sliderHtml(key, temp[key])).join('')}
        ${group.title === 'COLOUR & COVERING' ? this.colourChoices(temp) : ''}
        ${group.title === 'TEMPERAMENT' ? this.dietChoices(temp) : ''}
      </div>`).join('');
    this.openModal('editor', 'Creature Editor', 'GENETIC LABORATORY', `
      <div class="editor-layout">
        <div>
          <div class="editor-preview"><canvas id="editor-canvas"></canvas><div class="preview-badge pill green">LIVE MORPHOLOGY</div><div class="preview-meta">DRAG NOT NEEDED · SPECIMEN AUTO-ROTATES</div></div>
          <div class="editor-stats" id="editor-stats"></div>
        </div>
        <div>
          <div class="editor-sliders" id="editor-sliders">${sliders}</div>
          <div class="editor-footer">
            <div class="cost">MUTATION COST <b id="editor-cost">0</b> DNA · AVAILABLE <b id="editor-available">${Math.floor(p.dna)}</b></div>
            <div style="display:flex;gap:8px"><button class="btn btn-quiet" id="editor-reset">Reset</button><button class="btn btn-primary" id="editor-apply">Apply evolution</button></div>
          </div>
        </div>
      </div>`, true);
    setTimeout(() => this.initEditor(temp), 30);
  }

  sliderHtml(key, value) {
    const [min, max, step] = RANGES[key];
    return `<div class="slider-row"><label for="sl-${key}">${GENE_LABELS[key]}</label><input id="sl-${key}" type="range" data-gene="${key}" min="${min}" max="${max}" step="${step}" value="${value}"><output id="out-${key}">${this.fmtGene(key, value)}</output></div>`;
  }
  fmtGene(key, v) {
    if (key === 'legCount') return `${Math.round(v)}`;
    if (key === 'hue1' || key === 'hue2') return `${Math.round(v)}°`;
    if (key === 'saturation' || key === 'lightness') return `${Math.round(v)}%`;
    return Number(v).toFixed(2);
  }
  colourChoices(g) {
    return `<div class="slider-row" style="grid-template-columns:118px 1fr"><label>Pattern</label><div class="choice-row">${PATTERNS.map((p, i) => `<button class="choice ${g.pattern === i ? 'active' : ''}" data-pattern="${i}">${p}</button>`).join('')}</div></div>
    <div class="slider-row" style="grid-template-columns:118px 1fr"><label>Covering</label><div class="choice-row">${TEXTURES.map((t, i) => `<button class="choice ${g.texture === i ? 'active' : ''}" data-texture="${i}">${t}</button>`).join('')}</div></div>`;
  }
  dietChoices(g) {
    return `<div class="slider-row" style="grid-template-columns:118px 1fr"><label>Diet</label><div class="choice-row">${DIETS.map(d => `<button class="choice ${g.diet === d ? 'active' : ''}" data-diet="${d}">${d}</button>`).join('')}</div></div>`;
  }

  initEditor(temp) {
    this.stopEditor();
    const canvas = $('#editor-canvas');
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(1.6, window.devicePixelRatio));
    renderer.setSize(canvas.clientWidth || 380, canvas.clientHeight || 340, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xd8ffee, 0x18261e, 1.8));
    const key = new THREE.DirectionalLight(0xfff4d8, 3.2); key.position.set(4, 7, 6); scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fffc4, 3.0); rim.position.set(-5, 3, -4); scene.add(rim);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(4.2, 48), new THREE.MeshStandardMaterial({ color: 0x0a2018, roughness: 0.9, metalness: 0.1, transparent: true, opacity: 0.75 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.8, 2.86, 64), new THREE.MeshBasicMaterial({ color: 0x2f6d55, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; scene.add(ring);
    const camera = new THREE.PerspectiveCamera(34, (canvas.clientWidth || 380) / (canvas.clientHeight || 340), 0.1, 100);
    camera.position.set(4.2, 2.9, 5.4);
    camera.lookAt(0, 1.1, 0);
    const rig = new CreatureRig(temp, { scale: 1 });
    scene.add(rig.root);
    this.editor = { renderer, scene, camera, rig, temp, active: true, time: 0, last: performance.now() };
    const resize = () => {
      if (!this.editor) return;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    this.editor.resize = resize;
    const loop = () => {
      if (!this.editor) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.editor.last) / 1000);
      this.editor.last = now;
      this.editor.time += dt;
      this.editor.rig.root.rotation.y = Math.sin(this.editor.time * 0.45) * 0.65 + 0.3;
      this.editor.rig.update(dt);
      this.editor.renderer.render(this.editor.scene, this.editor.camera);
      this.editor.anim = requestAnimationFrame(loop);
    };
    this.editor.anim = requestAnimationFrame(loop);
    this.bindEditorControls(temp);
    this.updateEditorStats(temp);
  }

  bindEditorControls(temp) {
    const sliders = $$('#editor-sliders input[type=range]');
    sliders.forEach(inp => inp.addEventListener('input', () => {
      temp[inp.dataset.gene] = parseFloat(inp.value);
      const out = document.getElementById('out-' + inp.dataset.gene);
      if (out) out.textContent = this.fmtGene(inp.dataset.gene, temp[inp.dataset.gene]);
      this.updateEditorStats(temp);
      this.updateEditorCost(temp);
      this.scheduleEditorPreview(temp);
    }));
    $$('#editor-sliders [data-pattern]').forEach(b => b.addEventListener('click', () => {
      temp.pattern = Number(b.dataset.pattern);
      $$('#editor-sliders [data-pattern]').forEach(x => x.classList.toggle('active', x === b));
      this.scheduleEditorPreview(temp);
    }));
    $$('#editor-sliders [data-texture]').forEach(b => b.addEventListener('click', () => {
      temp.texture = Number(b.dataset.texture);
      $$('#editor-sliders [data-texture]').forEach(x => x.classList.toggle('active', x === b));
      this.scheduleEditorPreview(temp);
    }));
    $$('#editor-sliders [data-diet]').forEach(b => b.addEventListener('click', () => {
      temp.diet = b.dataset.diet;
      $$('#editor-sliders [data-diet]').forEach(x => x.classList.toggle('active', x === b));
      this.updateEditorStats(temp);
      this.updateEditorCost(temp);
    }));
    $('#editor-reset')?.addEventListener('click', () => {
      const base = { ...this.game.player.genome };
      Object.assign(temp, base);
      this.stopEditor();
      this.initEditor(temp);
      this.openEditor();
    });
    $('#editor-apply')?.addEventListener('click', () => {
      const cost = this.evolutionCost(temp);
      if (cost > this.game.player.dna) { this.toast('Not enough DNA for this morphology', 'danger'); return; }
      if (cost <= 0) { this.toast('No morphological changes to apply', 'info'); return; }
      this.game.applyPlayerEvolution(temp, cost);
      this.closeModal();
    });
    this.updateEditorCost(temp);
  }

  scheduleEditorPreview(temp) {
    if (this._editorTimer) clearTimeout(this._editorTimer);
    this._editorTimer = setTimeout(() => {
      if (!this.editor) return;
      const scene = this.editor.scene;
      const old = this.editor.rig;
      old.dispose();
      const rig = new CreatureRig(temp, { scale: 1 });
      scene.add(rig.root);
      this.editor.rig = rig;
      this.editor.temp = temp;
      this.toast('', 'info');
    }, 130);
  }

  updateEditorStats(g) {
    const box = $('#editor-stats');
    if (!box) return;
    const st = deriveStats(g);
    const rows = [
      ['Health', Math.round(st.maxHealth)], ['Speed', st.sprint.toFixed(1) + ' m/s'], ['Bite', Math.round(st.bite)], ['Armour', (st.armorRating * 100).toFixed(0) + '%'],
      ['Senses', Math.round(st.senses)], ['Jump', st.jump.toFixed(1)], ['Mass', g.size.toFixed(2)], ['Lifespan', Math.round(st.lifeSpan) + ' yrs']
    ];
    box.innerHTML = rows.map(([k, v]) => `<div class="stat-line"><span>${k}</span><b style="text-align:left;color:var(--mint)">${v}</b></div>`).join('');
    const costEl = $('#editor-cost');
    if (costEl) costEl.textContent = this.evolutionCost(g);
    const avail = $('#editor-available');
    if (avail) avail.textContent = Math.floor(this.game.player.dna);
    const apply = $('#editor-apply');
    if (apply) {
      const cost = this.evolutionCost(g);
      apply.disabled = cost <= 0 || cost > this.game.player.dna;
      apply.style.opacity = apply.disabled ? 0.4 : 1;
    }
  }

  evolutionCost(g) {
    const base = this.game.player.genome;
    let sum = 0;
    for (const [key, [min, max]] of Object.entries(RANGES)) {
      sum += Math.abs((g[key] - base[key]) / (max - min));
    }
    if (g.pattern !== base.pattern) sum += 0.35;
    if (g.texture !== base.texture) sum += 0.35;
    if (g.diet !== base.diet) sum += 1.2;
    return Math.ceil(sum * 42);
  }

  updateEditorCost(g) { this.updateEditorStats(g); }

  stopEditor() {
    if (!this.editor) return;
    this.editor.active = false;
    cancelAnimationFrame(this.editor.anim);
    window.removeEventListener('resize', this.editor.resize);
    this.editor.rig.dispose();
    this.editor.renderer.dispose();
    this.editor = null;
    if (this._editorTimer) clearTimeout(this._editorTimer);
  }

  // ================= GENETICS =================
  openGenetics() {
    const p = this.game.player;
    const g = p.genome;
    const st = p.stats;
    const sp = this.game.ecosystem.playerSpecies;
    const geneRows = [
      ['Body mass', g.size / 2.6, g.size.toFixed(2)], ['Speed', g.speed, (st.sprint * 2.4).toFixed(0) + ' km/h'],
      ['Strength', g.strength, Math.round(st.bite)], ['Armour', st.armorRating, (st.armorRating * 100).toFixed(0) + '%'],
      ['Intelligence', g.intelligence, Math.round(g.intelligence * 100)], ['Sociability', g.sociability, Math.round(g.sociability * 100)],
      ['Fear', g.fearfulness, Math.round(g.fearfulness * 100)], ['Metabolism', g.metabolism, Math.round(g.metabolism * 100)]];
    this.openModal('genetics', 'Genome & Lineage', 'Heredity', `
      <div class="genome-grid">
        <div class="genome-block">
          <div class="section-label">EXPRESSED PHENOTYPE</div>
          ${geneRows.map(([label, v, display]) => `<div class="genome-row"><span>${label}</span><div class="gt"><i style="width:${pct(v * 100)}"></i></div><b>${display}</b></div>`).join('')}
          <div class="section-label">INHERITANCE</div>
          <div class="allele-card"><h4>Lineage ${sp?.name || '—'}</h4><p>Generation <b>${sp?.generation || 1}</b> of the Aetheris line. Population ${Math.round(sp?.population || 1)}. ${sp?.generation > 1 ? 'Heritable drift has accumulated across generations.' : 'No derived alleles fixed yet.'}</p></div>
          <div class="allele-card"><h4>Mutation clock</h4><p>Offspring inherit a 22% recombination of parental alleles with a 0.22 mutation pressure. Selection acts through survival and reproduction.</p></div>
          <div class="allele-card"><h4>Current selection pressures</h4><div class="pressure-row"><span class="pressure">predation</span><span class="pressure">habitat ${this.game.world.biomeInfo(this.game.world.biomeAt(p.position.x, p.position.z)).label.toLowerCase()}</span><span class="pressure">thermoregulation</span></div></div>
        </div>
        <div style="text-align:center">
          <canvas id="genome-portrait" width="520" height="340" style="width:100%;height:240px;background:rgba(0,0,0,.14);border:1px solid var(--line);border-radius:3px"></canvas>
          <div class="section-label" style="text-align:left">REPRODUCTION</div>
          <p class="tiny" style="text-align:left">Reproduce asexually to seed a juvenile of your lineage. Costs <b style="color:var(--mint)">25 DNA</b> and 15% of current health. Offspring carry recombined traits and inherit your territory.</p>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn btn-primary" id="btn-reproduce" ${p.dna < 25 ? 'disabled style="opacity:.4"' : ''}>Reproduce · 25 DNA</button>
            <button class="btn btn-ghost" id="btn-open-editor">Open Editor</button>
          </div>
          <div class="tiny" style="text-align:left;margin-top:14px">Lifespan ${Math.round(st.lifeSpan)} yrs · Adult at ${st.adultAge.toFixed(1)} yrs · Fertility ${Math.round(g.fertility * 100)}%</div>
        </div>
      </div>`, true);
    setTimeout(() => {
      const c = $('#genome-portrait');
      if (c) drawSilhouette(c.getContext('2d'), g, c.width, c.height, { zoom: 1.15 });
      $('#btn-reproduce')?.addEventListener('click', () => {
        if (p.reproduce()) this.closeModal(); else this.toast('Cannot reproduce right now', 'danger');
      });
      $('#btn-open-editor')?.addEventListener('click', () => { this.closeModal(); setTimeout(() => this.openEditor(), 100); });
    }, 20);
  }

  // ================= FAMILY TREE =================
  openFamily() {
    const eco = this.game.ecosystem;
    const nodes = (eco.lineage || []).filter(n => n && n.id);
    this.openModal('family', 'Evolutionary Family Tree', 'DEEP LINEAGE', `
      <canvas id="family-canvas" width="1160" height="500"></canvas>
      <div class="tree-legend">
        <span><i class="legend-dot" style="background:var(--mint)"></i>Your lineage</span>
        <span><i class="legend-dot" style="background:#ff9d8f"></i>Carnivore</span>
        <span><i class="legend-dot" style="background:#a8e0b8"></i>Herbivore</span>
        <span><i class="legend-dot" style="background:var(--amber)"></i>Omnivore / scavenger</span>
        <span><i class="legend-dot" style="background:#5f7a6e"></i>Extinct branch</span>
      </div>
      <div class="tree-detail" id="tree-detail">Click any node to inspect a lineage. Node size reflects population; vertical position reflects lineage depth.</div>
      <div class="section-label">LIVE DIVERSITY</div>
      <p class="tiny">${eco.stats.speciesCount} living species · ${eco.stats.births} births observed · ${eco.stats.deaths} deaths · ${eco.stats.extinctCount} extinctions recorded. Advance an era to extend the tree.</p>`, true);
    setTimeout(() => {
      this.drawFamilyTree(nodes);
      const canvas = $('#family-canvas');
      canvas?.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width * canvas.width;
        const y = (e.clientY - rect.top) / rect.height * canvas.height;
        let best = null, bd = 18 * 18;
        for (const pt of this.treePoints) {
          const d = (pt.x - x) ** 2 + (pt.y - y) ** 2;
          if (d < bd) { bd = d; best = pt; }
        }
        if (best) this.showTreeDetail(best.node);
      });
    }, 30);
  }

  drawFamilyTree(nodes) {
    const canvas = $('#family-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!nodes.length) { ctx.fillStyle = '#6c857a'; ctx.font = '16px sans-serif'; ctx.fillText('No lineage records yet', 40, 50); return; }
    const byId = new Map();
    for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
    const list = [...byId.values()];
    const children = new Map();
    for (const n of list) {
      const pid = n.parentId;
      if (pid && byId.has(pid)) {
        if (!children.has(pid)) children.set(pid, []);
        children.get(pid).push(n);
      }
    }
    const depth = new Map();
    const calcDepth = (n, d, guard = 0) => {
      depth.set(n.id, Math.max(depth.get(n.id) || 0, d));
      for (const c of children.get(n.id) || []) {
        if (guard < 30) calcDepth(c, d + 1, guard + 1);
      }
    };
    const roots = list.filter(n => !n.parentId || !byId.has(n.parentId));
    roots.forEach(r => calcDepth(r, 0));
    // leaf x positions
    let cursor = 0;
    const xs = new Map();
    const assign = (n) => {
      const kids = children.get(n.id) || [];
      if (!kids.length) { xs.set(n.id, cursor++); return; }
      kids.forEach(assign);
      xs.set(n.id, (xs.get(kids[0].id) + xs.get(kids[kids.length - 1].id)) / 2);
    };
    roots.forEach(assign);
    const maxX = Math.max(1, cursor - 1);
    const maxDepth = Math.max(1, ...depth.values());
    const padX = 90, padY = 60;
    const W = canvas.width - padX * 2, H = canvas.height - padY * 2;
    const pos = new Map();
    for (const n of list) {
      const x = padX + (xs.get(n.id) ?? 0) / maxX * W;
      const y = padY + (depth.get(n.id) || 0) / maxDepth * H;
      pos.set(n.id, { x, y, node: n });
    }
    this.treePoints = [...pos.values()];
    // edges
    ctx.lineWidth = 1.2;
    for (const n of list) {
      const p = pos.get(n.parentId);
      const c = pos.get(n.id);
      if (!p || !c) continue;
      ctx.strokeStyle = n.extinct ? 'rgba(120,140,130,.35)' : 'rgba(125,243,188,.22)';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      const my = (p.y + c.y) / 2;
      ctx.bezierCurveTo(p.x, my, c.x, my, c.x, c.y);
      ctx.stroke();
    }
    // nodes
    for (const pt of this.treePoints) {
      const n = pt.node;
      const current = n.id === (this.game.ecosystem.playerSpecies?.lineageId) || n.id === this.game.ecosystem.playerSpecies?.id;
      let color = n.isPlayer ? '#7df3bc' : n.diet === 'carnivore' ? '#ff9d8f' : n.diet === 'herbivore' ? '#a8e0b8' : '#ffd170';
      if (n.extinct) color = '#5f7a6e';
      const r = clamp(4 + Math.sqrt(Math.max(1, n.population || 1)) * 0.85, 4, 12);
      if (current) {
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r + 6, 0, TAU);
        ctx.strokeStyle = 'rgba(182,255,223,.45)'; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, TAU);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = 'rgba(4,12,8,.8)'; ctx.lineWidth = 1.5; ctx.stroke();
      if (n.extinct) { ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.beginPath(); ctx.moveTo(pt.x - 3, pt.y - 3); ctx.lineTo(pt.x + 3, pt.y + 3); ctx.moveTo(pt.x + 3, pt.y - 3); ctx.lineTo(pt.x - 3, pt.y + 3); ctx.stroke(); }
    }
    // labels for roots/current/splits
    ctx.font = '9px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    for (const pt of this.treePoints) {
      const n = pt.node;
      if (pt.y < padY + 2 || n.isPlayer || n.id === this.game.ecosystem.playerSpecies?.lineageId || n.parentId == null) {
        ctx.fillStyle = n.extinct ? 'rgba(137,160,150,.6)' : 'rgba(224,244,233,.85)';
        ctx.fillText(n.common || n.name || '', pt.x, pt.y - 14);
      }
    }
    ctx.fillStyle = 'rgba(140,170,155,.6)';
    ctx.font = '8px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ANCESTORS', 16, 22);
    ctx.textAlign = 'right';
    ctx.fillText('DESCENDANTS', canvas.width - 16, canvas.height - 14);
  }

  showTreeDetail(node) {
    const box = $('#tree-detail');
    if (!box) return;
    const end = node.extinct ? 'EXTINCT' : 'EXTANT';
    box.innerHTML = `<b style="color:var(--mint)">${node.common || node.name}</b> <span class="muted">· ${node.name || ''} · ${node.diet} · ${end}</span><br>
      <span class="tiny">Generation ${node.generation || 1} · population ${Math.round(node.population || 0)} · habitat ${node.habitat || '—'} · emerged ${node.year ? fmt(Math.max(0, this.game.world.baseYear - node.year)) + ' yrs ago' : 'at genesis'}${node.event ? ' · ' + node.event : ''}</span>`;
  }

  // ================= ECOSYSTEM =================
  openEcosystem() {
    const eco = this.game.ecosystem;
    const world = this.game.world;
    const rep = eco.ecosystemReport();
    const totalPop = eco.species.filter(s => !s.extinct).reduce((a, s) => a + s.population, 0);
    const herbPop = eco.species.filter(s => !s.extinct && s.diet === 'herbivore').reduce((a, s) => a + s.population, 0);
    const carnPop = eco.species.filter(s => !s.extinct && s.diet === 'carnivore').reduce((a, s) => a + s.population, 0);
    const otherPop = Math.max(0, totalPop - herbPop - carnPop);
    const rows = eco.species.filter(s => s.discovered || s.playerLineage || !s.extinct).map(s => `<tr>
      <td><span class="eco-dot" style="background:${s.color}"></span><span class="sname">${s.discovered || s.playerLineage ? s.common : 'Unrecorded'}</span><br><span class="tiny">${s.name}</span></td>
      <td>${s.diet}</td><td>${s.extinct ? '—' : Math.round(s.population)}</td><td>${s.generation}</td><td>${s.habitat}</td>
      <td style="color:${s.extinct ? 'var(--red)' : 'var(--mint)'}">${s.extinct ? 'EXTINCT' : s.playerLineage ? 'YOURS' : 'THRIVING'}</td></tr>`).join('');
    const events = eco.events.slice(0, 12).map(e => `<div class="event-row type-${e.type}"><time>${fmt(e.time)}y</time><span>${e.text}</span></div>`).join('');
    this.openModal('ecosystem', 'Living Ecosystem', 'FIELD STATION', `
      <div class="eco-stats">
        <div class="eco-stat"><div class="num">${rep.species.length}</div><div class="lbl">LIVING SPECIES</div></div>
        <div class="eco-stat"><div class="num">${Math.round(totalPop)}</div><div class="lbl">TOTAL POPULATION</div></div>
        <div class="eco-stat"><div class="num">${rep.plants}</div><div class="lbl">FOOD NODES</div></div>
        <div class="eco-stat"><div class="num">${(rep.avgFear * 100).toFixed(0)}</div><div class="lbl">MEAN FEAR INDEX</div></div>
      </div>
      <div class="section-label">TROPHIC STRUCTURE</div>
      <div class="trophic"><i style="width:${herbPop / Math.max(1, totalPop) * 100}%;background:#8fe0ae"></i><i style="width:${carnPop / Math.max(1, totalPop) * 100}%;background:#ff8f80"></i><i style="width:${otherPop / Math.max(1, totalPop) * 100}%;background:#ffd170"></i></div>
      <div class="tiny" style="margin-top:5px">HERBIVORES ${Math.round(herbPop)} · CARNIVORES ${Math.round(carnPop)} · OMNIVORES / SCAVENGERS ${Math.round(otherPop)} · ${rep.carcasses} carcasses · ${rep.agents} active agents</div>
      <div class="section-label">REGISTERED POPULATIONS</div>
      <table class="eco-table"><thead><tr><th>SPECIES</th><th>DIET</th><th>POP</th><th>GEN</th><th>HABITAT</th><th>STATUS</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="section-label">ECOLOGICAL LOG</div>
      <div style="max-height:190px;overflow-y:auto">${events || '<div class="tiny">No events recorded yet. The wild is quiet.</div>'}</div>
      <div class="species-actions" style="margin-top:18px"><button class="btn btn-primary" id="eco-era">Advance Deep Time →</button><button class="btn btn-ghost" id="eco-codex">Open Codex</button></div>
      <div class="tiny" style="margin-top:12px">World conditions: ${world.weather.label} · ${world.seasonNames[world.seasonIndex]} · year ${fmt(world.baseYear + world.yearFloat)} · headcount capped at ${eco.cap} agents for field simulation.</div>`);
    setTimeout(() => {
      $('#eco-era')?.addEventListener('click', () => { this.closeModal(); setTimeout(() => this.openAdvanceEra(), 120); });
      $('#eco-codex')?.addEventListener('click', () => { this.closeModal(); setTimeout(() => this.openCodex(), 120); });
    }, 20);
  }

  // ================= INVENTORY =================
  openInventory() {
    const p = this.game.player;
    const items = [
      { key: 'berries', name: 'Glow Berries', icon: '❖', desc: 'Sweet fruit gathered from the undergrowth. Restores hunger.' },
      { key: 'meat', name: 'Raw Meat', icon: '◒', desc: 'Scavenged flesh. High nutrition, restores health.' },
      { key: 'herbs', name: 'Healing Herbs', icon: '☘', desc: 'Bitter leaves that close wounds and heal injuries.' },
      { key: 'crystal', name: 'DNA Crystal', icon: '◈', desc: 'Crystallised genetic memory. Converts to 18 DNA.' }
    ];
    this.openModal('inventory', 'Field Inventory', 'SATCHEL', `
      <div class="inv-grid">${items.map(it => `<div class="inv-item"><div class="inv-icon">${it.icon}</div><div class="inv-name">${it.name}</div><div class="inv-count">× ${p.inventory[it.key] || 0}</div><button class="inv-btn" data-use="${it.key}" ${!p.inventory[it.key] ? 'disabled' : ''}>USE</button></div>`).join('')}</div>
      <div class="section-label">RESOURCES</div>
      <div class="eco-stats">
        <div class="eco-stat"><div class="num">${Math.floor(p.dna)}</div><div class="lbl">AVAILABLE DNA</div></div>
        <div class="eco-stat"><div class="num">${p.discoveredSpecies.size}</div><div class="lbl">SPECIES RECORDED</div></div>
        <div class="eco-stat"><div class="num">${p.discoveredBiomes.size}</div><div class="lbl">HABITATS CHARTED</div></div>
        <div class="eco-stat"><div class="num">${this.game.ecosystem.stats.kills}</div><div class="lbl">OBSERVED KILLS</div></div>
      </div>
      <div class="tiny" style="margin-top:14px">Your satchel fills as you forage and hunt. Unlike food on the ground, stored food can be eaten anywhere.</div>
      <div class="section-label">BIOME RECORD</div>
      <div class="trait-row">${[...p.discoveredBiomes].map(b => `<div class="trait"><i>◆</i>${this.game.world.biomeInfo(b).label}</div>`).join('')}</div>`);
    setTimeout(() => {
      $$('#modal-body [data-use]').forEach(b => b.addEventListener('click', () => {
        p.eatInventory(b.dataset.use);
        this.openInventory();
      }));
    }, 20);
  }

  // ================= MENU =================
  openMenu() {
    const p = this.game.player;
    this.openModal('menu', 'Field Menu', 'PAUSED', `
      <div class="help-grid">
        <div class="help-block"><h3>Expedition</h3>
          <p>Day ${this.game.world.day} · ${this.game.world.seasonNames[this.game.world.seasonIndex]} · Year ${fmt(this.game.world.baseYear + this.game.world.yearFloat)}<br>${p ? `Adult ${p.age.toFixed(1)} yrs · ${Math.floor(p.dna)} DNA · ${p.discoveredSpecies.size} species recorded` : ''}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
            <button class="btn btn-primary" id="menu-resume">Resume</button>
            <button class="btn btn-ghost" id="menu-save">Save Game</button>
            <button class="btn btn-ghost" id="menu-help">How to Play</button>
          </div>
        </div>
        <div class="help-block"><h3>Systems</h3>
          <ul><li>Mutation & natural selection</li><li>Fear-driven decision making</li><li>Procedural locomotion & anatomy</li><li>Day / night, seasons & weather</li><li>Deep-time species radiation</li></ul>
          <div class="pressure-row"><span class="pressure">seed ${this.game.seed.toString(16).toUpperCase()}</span><span class="pressure">${this.game.muted ? 'AUDIO OFF' : 'AUDIO ON'}</span></div>
        </div>
      </div>
      <div class="section-label">DEEP TIME</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="menu-era">Advance an Era</button>
        <button class="btn btn-ghost" id="menu-cell">Return to Cell Stage</button>
        <button class="btn btn-ghost" id="menu-mute">${this.game.muted ? 'Unmute' : 'Mute Audio'}</button>
        <button class="btn btn-quiet" id="menu-title">Save & Exit to Title</button>
      </div>
      <div class="tiny" style="margin-top:16px">This world persists in your browser. All species, lineages and genomes are procedurally generated from seed ${this.game.seed.toString(16).toUpperCase()}.</div>`);
    setTimeout(() => {
      $('#menu-resume')?.addEventListener('click', () => this.closeModal());
      $('#menu-save')?.addEventListener('click', () => { this.game.saveGame(); this.toast('World saved', 'discovery'); });
      $('#menu-help')?.addEventListener('click', () => { this.closeModal(); setTimeout(() => this.openHelp(), 100); });
      $('#menu-era')?.addEventListener('click', () => { this.closeModal(); setTimeout(() => this.openAdvanceEra(), 120); });
      $('#menu-cell')?.addEventListener('click', () => { this.closeModal(); this.game.startCellStage(); });
      $('#menu-mute')?.addEventListener('click', () => { this.game.toggleMute(); this.openMenu(); });
      $('#menu-title')?.addEventListener('click', () => { this.game.saveGame(); this.closeModal(); this.game.returnToTitle(); });
    }, 20);
  }

  // ================= HELP =================
  openHelp() {
    this.openModal('help', 'Field Manual', 'SURVIVAL GUIDE', `
      <div class="help-grid">
        <div class="help-block"><h3>Controls</h3>
          <p><kbd>W A S D</kbd> move · <kbd>Shift</kbd> sprint<br><kbd>Drag</kbd> orbit camera · <kbd>Wheel</kbd> zoom<br><kbd>E</kbd> eat / drink / observe · <kbd>F</kbd> bite<br><kbd>Q</kbd> territorial roar · <kbd>R</kbd> rest<br><kbd>Space</kbd> jump / hold to glide (winged)<br><kbd>G</kbd> open creature editor · <kbd>M</kbd> mute</p>
          <p class="tiny">On touch devices use the left joystick, drag the world to look, and the action buttons on the right.</p>
        </div>
        <div class="help-block"><h3>Survival</h3>
          <p>Watch health, hunger, thirst and stamina. Drink at water, eat plants or carcasses. Rest at rock shelters to recover. Injuries to legs, eyes and jaws impair real movement and combat until healed.</p>
          <p class="tiny">Every creature tracks its own fear. Predators can smell weakness; prey will panic and flee. Your roar spreads terror.</p>
        </div>
        <div class="help-block"><h3>Evolution</h3>
          <p>Eat, explore and observe wildlife to earn DNA. Spend DNA in the Creature Editor to reshape your anatomy. Every edited trait changes your body mesh, stats, movement and survival.</p>
          <p class="tiny">Wild creatures breed, mutate and speciate. Use World → Advance Deep Time to simulate thousands or millions of years. Compare ancestors and descendants in the Family Tree.</p>
        </div>
        <div class="help-block"><h3>World</h3>
          <p>Seven biomes, dynamic weather, seasons, day/night, shelters and hazards. The ecosystem is simulated: herds, packs, territories, scavengers, plants and carcasses. Species can migrate, adapt or go extinct.</p>
          <p class="tiny">The cell stage is a playable prologue. Consume plankton, avoid predators and evolve onto land.</p>
        </div>
      </div>
      <div class="section-label">A NOTE ON THIS WORLD</div>
      <p class="tiny">Creature World is a systems-first prototype. Every animal you meet is an individual with a genome, age, injuries, personality and fear state. The simulation runs around you even when you stand still.</p>
      <div style="margin-top:16px"><button class="btn btn-ghost" id="help-close">Return to the wild</button></div>`);
    setTimeout(() => { $('#help-close')?.addEventListener('click', () => this.closeModal()); }, 20);
  }

  // ================= CELL UPGRADE =================
  openCellUpgrade() {
    const choices = [
      { id: 'predator', title: 'Predatory Maw', sub: 'CARNIVORE PATH', desc: 'A hinged jaw with serrated teeth. Hunt other creatures instead of grazing.', stats: ['Carnivore', 'Teeth +', 'Aggression +'], icon: '◣' },
      { id: 'grazer', title: 'Grazing Bulk', sub: 'HERBIVORE PATH', desc: 'A larger fermenting gut and broad grinding jaw. Efficient at harvesting plants.', stats: ['Herbivore', 'Health +', 'Armor +'], icon: '☘' },
      { id: 'sprinter', title: 'Land Runner', sub: 'LOCOMOTION PATH', desc: 'Long, springy limbs and light bones. Built to outrun predators across open ground.', stats: ['Speed ++', 'Legs +', 'Stamina +'], icon: '⇥' },
      { id: 'glider', title: 'Membrane Wings', sub: 'AERIAL PATH', desc: 'Skin flaps stiffened into wings. Glide above the canopy and escape ground threats.', stats: ['Flight', 'Wings', 'Senses +'], icon: '⌃' }
    ];
    this.openModal('cellupgrade', 'Choose Your Body Plan', 'METAMORPHOSIS', `
      <p class="tiny" style="margin-bottom:12px">Your cell has accumulated enough biomass to differentiate. The choice shapes your starting anatomy and ecological niche. All options can be further evolved later in the Creature Editor.</p>
      <div class="upgrade-grid">${choices.map(c => `<div class="upgrade-card" data-upgrade="${c.id}"><h3>${c.icon} ${c.title}</h3><div class="up-sub">${c.sub}</div><p>${c.desc}</p><div class="upgrade-stats">${c.stats.map(s => `<span>${s}</span>`).join('')}</div></div>`).join('')}</div>`);
    setTimeout(() => {
      $$('[data-upgrade]').forEach(el => el.addEventListener('click', () => {
        this.closeModal();
        this.game.evolveFromCell(el.dataset.upgrade);
      }));
    }, 20);
  }

  // ================= DEEP TIME =================
  openAdvanceEra() {
    const eco = this.game.ecosystem;
    const living = eco.species.filter(s => !s.extinct).length;
    this.openModal('advance', 'Advance Deep Time', 'DEEP TIME ENGINE', `
      <p class="tiny">Simulate generations of mutation, selection, speciation and extinction. Your own lineage will be carried forward and offered as a descendant form. The map's climate and palette will shift with the epoch.</p>
      <div class="era-years">
        <div class="era-card" data-years="1000"><div class="yrs">1k</div><div class="desc">A few hundred generations.<br>Minor drift.</div></div>
        <div class="era-card active" data-years="10000"><div class="yrs">10k</div><div class="desc">Local adaptation.<br>Species may split.</div></div>
        <div class="era-card" data-years="100000"><div class="yrs">100k</div><div class="desc">Radiation and<br>extinction events.</div></div>
        <div class="era-card" data-years="1000000"><div class="yrs">1M</div><div class="desc">A new epoch.<br>Massive change.</div></div>
      </div>
      <div class="era-warning">The current population of ${living} living species will be replaced by their descendants. ${eco.stats.births} observed births and ${eco.stats.deaths} deaths are recorded in the lineage archive. Your form may change dramatically.</div>
      <div class="section-label">CURRENT WORLD</div>
      <div class="eco-stats">
        <div class="eco-stat"><div class="num">${living}</div><div class="lbl">LIVING SPECIES</div></div>
        <div class="eco-stat"><div class="num">${fmt(this.game.world.baseYear + this.game.world.yearFloat)}</div><div class="lbl">CURRENT YEAR</div></div>
        <div class="eco-stat"><div class="num">${eco.lineage.length}</div><div class="lbl">LINEAGE NODES</div></div>
        <div class="eco-stat"><div class="num">${this.game.world.epoch + 1}</div><div class="lbl">CLIMATE EPOCH</div></div>
      </div>
      <div class="species-actions" style="margin-top:20px"><button class="btn btn-primary" id="era-confirm">Advance 10,000 years →</button><button class="btn btn-quiet" id="era-cancel">Cancel</button></div>`);
    setTimeout(() => {
      $$('.era-card').forEach(card => card.addEventListener('click', () => {
        $$('.era-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        this.selectedEra = Number(card.dataset.years);
        $('#era-confirm').textContent = `Advance ${fmt(this.selectedEra)} years →`;
      }));
      $('#era-confirm')?.addEventListener('click', () => {
        const years = this.selectedEra;
        this.closeModal();
        this.game.advanceEra(years);
      });
      $('#era-cancel')?.addEventListener('click', () => this.closeModal());
    }, 20);
  }

  showEraReport(report) {
    this.pendingReport = report;
    const desc = report.playerDescendant;
    const anc = report.playerAncestor;
    const duration = report.years >= 1e6 ? `${(report.years / 1e6).toFixed(1)} million years` : `${fmt(report.years)} years`;
    const ancStats = anc ? deriveStats(anc.genome) : null;
    const descStats = desc ? deriveStats(desc.genome) : null;
    const adaptCards = (report.adaptations || []).slice(0, 7).map(a => `
      <li><b>${a.species.common}</b> <span class="muted">(${a.oldName !== a.species.common ? 'formerly ' + a.oldName : 'continuing lineage'})</span><div style="margin-top:3px">${(a.changes || []).map(c => `<span class="adaptation ${c.dir === 'down' ? 'down' : ''}">${c.text}</span>`).join('')}</div></li>`).join('');
    this.openModal('report', 'Deep Time Report', `+${duration}`, `
      <div class="era-report">
        <div class="report-head"><div class="report-years">+${report.years >= 1e6 ? (report.years / 1e6).toFixed(1) + 'M' : fmt(report.years)}</div><div><div class="tiny" style="letter-spacing:.14em">YEARS SIMULATED</div><div class="muted" style="font-size:10px;margin-top:4px">${fmt(report.fromYear)} → ${fmt(report.toYear)} · climate epoch ${report.epoch + 1} · ${report.speciesCount} living species</div></div></div>
        <div class="section-label">YOUR LINEAGE</div>
        <div class="report-grid">
          <div class="compare-card"><h4>ANCESTOR · ${anc?.common || '—'}</h4><canvas width="440" height="280" id="cmp-anc"></canvas><div class="compare-stats">${ancStats ? `<span>mass ${anc.genome.size.toFixed(2)}</span><span>speed ${ancStats.sprint.toFixed(1)}</span><span>bite ${ancStats.bite.toFixed(0)}</span><span>armor ${(ancStats.armorRating * 100).toFixed(0)}%</span>` : ''}</div></div>
          <div class="compare-card" style="border-color:rgba(125,243,188,.4)"><h4>DESCENDANT · ${desc?.common || '—'}</h4><canvas width="440" height="280" id="cmp-desc"></canvas><div class="compare-stats">${descStats ? `<span>mass ${desc.genome.size.toFixed(2)}</span><span>speed ${descStats.sprint.toFixed(1)}</span><span>bite ${descStats.bite.toFixed(0)}</span><span>armor ${(descStats.armorRating * 100).toFixed(0)}%</span>` : ''}</div></div>
        </div>
        <div class="section-label">ADAPTATIONS</div>
        <ul class="report-list">${adaptCards || '<li>Little morphological change was recorded.</li>'}</ul>
        <div class="section-label">SPECIATION & EXTINCTION</div>
        <div class="report-grid">
          <div class="compare-card"><h4>NEW SPECIES · ${(report.splits || []).length}</h4>${(report.splits || []).map(s => `<div class="tiny" style="margin-bottom:6px"><b style="color:var(--mint)">${s.common}</b> · ${s.name} · ${s.diet} · pop ${s.population}</div>`).join('') || '<div class="tiny">No branching events in this interval.</div>'}</div>
          <div class="compare-card"><h4>EXTINCTIONS · ${(report.extinctions || []).length}</h4>${(report.extinctions || []).map(s => `<div class="tiny" style="margin-bottom:6px;color:#ff9d8f">${s.common} · ${s.name}</div>`).join('') || '<div class="tiny">No species lost. The ecosystem held.</div>'}</div>
        </div>
        <div class="tiny" style="margin-top:14px">The living world has been replaced by descendants. The family tree now records this era.</div>
        <div class="report-actions"><button class="btn btn-primary" id="report-adopt">Adopt descendant genome</button><button class="btn btn-ghost" id="report-keep">Keep ancestral form</button><button class="btn btn-quiet" id="report-tree">View family tree</button></div>
      </div>`, true);
    setTimeout(() => {
      const ac = $('#cmp-anc'); if (ac && anc) drawSilhouette(ac.getContext('2d'), anc.genome, ac.width, ac.height, { zoom: 1.1 });
      const dc = $('#cmp-desc'); if (dc && desc) drawSilhouette(dc.getContext('2d'), desc.genome, dc.width, dc.height, { zoom: 1.1 });
      $('#report-adopt')?.addEventListener('click', () => { if (desc) this.game.adoptEvolvedGenome(desc.genome); this.closeModal(); });
      $('#report-keep')?.addEventListener('click', () => { this.closeModal(); this.toast('Ancestral form preserved', 'info'); });
      $('#report-tree')?.addEventListener('click', () => { this.closeModal(); setTimeout(() => this.openFamily(), 120); });
    }, 30);
  }

  // ================= CELL HUD =================
  cellHUD(cell) {
    $('#cell-biomass').textContent = cell.biomass;
    $('#cell-dna').textContent = cell.dna;
    $('#cell-eaten').textContent = cell.eaten;
    const ring = $('#cell-ring');
    if (ring) ring.style.strokeDashoffset = 264 * (1 - clamp(cell.biomass / 14, 0, 1));
    const hp = $('#cell-health');
    if (hp) hp.style.width = pct(cell.health);
  }
  cellTick(cell) { if (this.game.stage === 'cell') this.cellHUD(cell); }
  cellReady(cell) {
    $('#btn-evolve-cell').classList.remove('hidden');
    this.toast('Your cell is ready to evolve!', 'evo');
    this.cellHUD(cell);
  }

  showCellTitle(cell) { this.showCellHUD(); this.cellHUD(cell); }
  hideCellReady() { $('#btn-evolve-cell').classList.add('hidden'); }

  update(dt) {
    if (!this.game.started) return;
    this.updateNameplates(dt);
    if (this.game.stage === 'creature') this.syncHUD();
  }
}
