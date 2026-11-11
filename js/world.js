// Procedural world: terrain, biome, water, sky, weather, flora, food and shelters.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, damp, smoothstep, fbm, valueNoise, mulberry32, pick, chance, randRange, TAU } from './util.js';

export const WATER_LEVEL = 0.6;
export const WORLD_SIZE = 620;
const GRID = 200;
const HALF = WORLD_SIZE / 2;

const BIOME_INFO = {
  ocean: { label: 'Ocean', hue: 198, sat: 58, light: 31 },
  beach: { label: 'Shore', hue: 42, sat: 48, light: 58 },
  grassland: { label: 'Grassland', hue: 88, sat: 44, light: 42 },
  forest: { label: 'Forest', hue: 128, sat: 42, light: 32 },
  marsh: { label: 'Marsh', hue: 158, sat: 34, light: 29 },
  desert: { label: 'Desert', hue: 33, sat: 46, light: 52 },
  mountain: { label: 'Mountain', hue: 210, sat: 12, light: 42 }
};

function colorGeo(geo, color) {
  const c = new THREE.Color(color);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function instancedFrom(geo, material, entries, opts = {}) {
  const mesh = new THREE.InstancedMesh(geo, material, entries.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  entries.forEach((e, i) => {
    p.set(e.x, e.y, e.z);
    q.setFromEuler(new THREE.Euler(0, e.rot || 0, 0));
    const sc = e.scale || 1;
    s.set(sc * (e.sx || 1), sc * (e.sy || 1), sc * (e.sz || 1));
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (e.color) mesh.setColorAt(i, col.set(e.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = opts.shadow !== false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = opts.cull !== false;
  return mesh;
}

export class World {
  constructor(scene, seed = 424242, epoch = 0) {
    this.scene = scene;
    this.seed = seed;
    this.epoch = epoch;
    this.time = 0.28;
    this.day = 1;
    this.dayLength = 210;
    this.seasonTime = 0;
    this.seasonLength = 110;
    this.seasonNames = ['Spring', 'Summer', 'Autumn', 'Winter'];
    this.seasonIndex = 0;
    this.yearFloat = 0;
    this.baseYear = 1_000_000;
    this.focus = new THREE.Vector3();
    this.weather = { type: 'clear', intensity: 0, timer: 30, label: 'Clear', wind: 0.3 };
    this.rain = null;
    this.snow = null;
    this.flash = 0;
    this.hazard = null;
    this.biomeCache = new Map();
    this.heights = null;
    this.generateHeight();
    this.buildSky();
    this.buildLights();
    this.buildTerrain();
    this.buildWater();
    this.buildClouds();
    this.buildFoliage();
    this.buildShelters();
    this.buildPlants();
    this.buildParticles();
    this.applyEpoch(epoch);
    this.update(0.016, new THREE.Vector3(0, 0, 0));
  }

  generateHeight() {
    const n = GRID + 1;
    const heights = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = (ix / GRID - 0.5) * WORLD_SIZE;
        const z = (iz / GRID - 0.5) * WORLD_SIZE;
        const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF;
        let h = (fbm(x * 0.0042, z * 0.0042, this.seed, 5) - 0.5) * 62 + 5.5;
        h += (fbm(x * 0.013, z * 0.013, this.seed + 41, 3) - 0.5) * 10;
        h += (fbm(x * 0.031, z * 0.031, this.seed + 77, 2) - 0.5) * 2.4;
        h -= smoothstep(0.62, 1.02, edge) * 24;
        heights[iz * n + ix] = h;
      }
    }
    this.heights = heights;
    this.gridN = n;
  }

  heightAt(x, z) {
    const fx = clamp((x / WORLD_SIZE + 0.5) * GRID, 0, GRID - 0.001);
    const fz = clamp((z / WORLD_SIZE + 0.5) * GRID, 0, GRID - 0.001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const n = this.gridN;
    const h00 = this.heights[iz * n + ix];
    const h10 = this.heights[iz * n + ix + 1];
    const h01 = this.heights[(iz + 1) * n + ix];
    const h11 = this.heights[(iz + 1) * n + ix + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  slopeAt(x, z) {
    const e = 1.5;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.sqrt(dx * dx + dz * dz) / (2 * e);
  }

  moistureAt(x, z) {
    return fbm(x * 0.0075, z * 0.0075, this.seed + 9, 3);
  }

  temperatureAt(x, z) {
    const h = this.heightAt(x, z);
    const seasonMod = [0.05, 0.16, -0.02, -0.22][this.seasonIndex];
    return clamp(1 - h * 0.021 + seasonMod - this.epoch * 0.06, -0.2, 1.2);
  }

  biomeAt(x, z) {
    const key = (x >> 2) + '_' + (z >> 2);
    if (this.biomeCache.has(key)) return this.biomeCache.get(key);
    const h = this.heightAt(x, z);
    const m = this.moistureAt(x, z);
    let biome;
    if (h < WATER_LEVEL + 0.4) biome = 'ocean';
    else if (h < WATER_LEVEL + 1.4) biome = 'beach';
    else if (h > 24) biome = 'mountain';
    else if (m < 0.36) biome = 'desert';
    else if (m > 0.64 && h < 7.5) biome = 'marsh';
    else if (m > 0.53) biome = 'forest';
    else biome = 'grassland';
    this.biomeCache.set(key, biome);
    if (this.biomeCache.size > 4000) this.biomeCache.clear();
    return biome;
  }

  biomeInfo(biome) { return BIOME_INFO[biome] || BIOME_INFO.grassland; }

  buildTerrain() {
    const n = GRID + 1;
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const indexes = [];
    const color = new THREE.Color();
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const x = (ix / GRID - 0.5) * WORLD_SIZE;
        const z = (iz / GRID - 0.5) * WORLD_SIZE;
        const y = this.heights[i];
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        let biome = 'mountain';
        const m = this.moistureAt(x, z);
        if (y < WATER_LEVEL + 0.35) biome = 'ocean';
        else if (y < WATER_LEVEL + 1.3) biome = 'beach';
        else if (y > 24) biome = 'mountain';
        else if (m < 0.36) biome = 'desert';
        else if (m > 0.64 && y < 7.5) biome = 'marsh';
        else if (m > 0.53) biome = 'forest';
        else biome = 'grassland';
        const info = BIOME_INFO[biome];
        const variance = (valueNoise(x * 0.09, z * 0.09, this.seed + 5) - 0.5) * 0.12;
        const slope = this.slopeAt(x, z);
        const rocky = smoothstep(1.1, 2.6, slope);
        color.setHSL((info.hue + (biome === 'mountain' ? 0 : (valueNoise(x * 0.03, z * 0.03, 3) - 0.5) * 14)) / 360, info.sat / 100, clamp(info.light / 100 + variance - rocky * 0.08, 0.08, 0.78));
        if (biome === 'mountain') color.offsetHSL(0, 0, -rocky * 0.06);
        colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
      }
    }
    for (let iz = 0; iz < GRID; iz++) {
      for (let ix = 0; ix < GRID; ix++) {
        const a = iz * n + ix, b = a + 1, c = a + n, d = c + 1;
        indexes.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indexes);
    geo.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.01 });
    this.terrain = new THREE.Mesh(geo, material);
    this.terrain.receiveShadow = true;
    this.terrain.castShadow = false;
    this.scene.add(this.terrain);
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE * 1.5, WORLD_SIZE * 1.5, 110, 110);
    geo.rotateX(-Math.PI / 2);
    this.waterUniforms = {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x0b3b45) },
      uShallow: { value: new THREE.Color(0x2c8b8c) },
      uSun: { value: new THREE.Color(0xffe9c0) }
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
        uniform float uTime;
        varying vec3 vWorld;
        void main() {
          vec3 p = position;
          p.y += sin(p.x * 0.19 + uTime * 0.9) * 0.09 + sin(p.z * 0.23 - uTime * 0.7) * 0.07;
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform vec3 uSun;
        varying vec3 vWorld;
        void main() {
          float ripple = sin(vWorld.x * 0.45 + uTime * 1.3) * sin(vWorld.z * 0.39 - uTime * 0.9);
          float ripple2 = sin(vWorld.x * 0.11 - uTime * 0.4 + vWorld.z * 0.08) * 0.5 + 0.5;
          vec3 col = mix(uDeep, uShallow, 0.35 + ripple * 0.12 + ripple2 * 0.22);
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - abs(viewDir.y), 2.4);
          col = mix(col, vec3(0.74, 0.93, 0.93), fres * 0.45);
          col += uSun * pow(max(0.0, ripple * 0.5 + 0.5), 12.0) * 0.12;
          gl_FragColor = vec4(col, 0.86);
        }
      `
    });
    this.water = new THREE.Mesh(geo, material);
    this.water.position.y = WATER_LEVEL;
    this.water.renderOrder = 1;
    this.scene.add(this.water);

    // shore foam ring
    const foamGeo = new THREE.RingGeometry(WORLD_SIZE * 0.32, WORLD_SIZE * 0.34, 96, 1);
    foamGeo.rotateX(-Math.PI / 2);
    this.foam = new THREE.Mesh(foamGeo, new THREE.MeshBasicMaterial({ color: 0xbfe7df, transparent: true, opacity: 0.0, depthWrite: false }));
    this.foam.position.y = WATER_LEVEL + 0.02;
    this.scene.add(this.foam);
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(900, 32, 20);
    this.skyUniforms = {
      topColor: { value: new THREE.Color(0x3f78a8) },
      bottomColor: { value: new THREE.Color(0xcfe5d4) },
      sunColor: { value: new THREE.Color(0xffe6ad) },
      sunDir: { value: new THREE.Vector3(0.4, 0.7, 0.2) },
      haze: { value: 0.4 }
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 topColor; uniform vec3 bottomColor; uniform vec3 sunColor; uniform vec3 sunDir; uniform float haze;
        varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(bottomColor, topColor, pow(h, 0.65));
          float sun = max(0.0, dot(normalize(vDir), normalize(sunDir)));
          col += sunColor * pow(sun, 260.0) * 1.6;
          col += sunColor * pow(sun, 8.0) * 0.12 * haze;
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    this.sky = new THREE.Mesh(geo, material);
    this.scene.add(this.sky);

    const starGeo = new THREE.BufferGeometry();
    const starPos = [];
    const rng = mulberry32(this.seed + 91);
    for (let i = 0; i < 1100; i++) {
      const theta = rng() * TAU, phi = Math.acos(randRange(rng, -0.05, 0.98));
      const r = 760;
      starPos.push(Math.cos(theta) * Math.sin(phi) * r, Math.cos(phi) * r, Math.sin(theta) * Math.sin(phi) * r);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdcecff, size: 2.0, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: false }));
    this.scene.add(this.stars);

    const glowTexture = makeGlowTexture();
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xffe9b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sunSprite.scale.set(120, 120, 1);
    this.scene.add(this.sunSprite);
    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xdde8ff, transparent: true, depthWrite: false, opacity: 0.7 }));
    this.moonSprite.scale.set(48, 48, 1);
    this.scene.add(this.moonSprite);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3c4a2a, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0c8, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 190;
    this.sun.shadow.camera.left = -52;
    this.sun.shadow.camera.right = 52;
    this.sun.shadow.camera.top = 52;
    this.sun.shadow.camera.bottom = -52;
    this.sun.shadow.bias = -0.0007;
    this.sun.shadow.normalBias = 0.06;
    this.scene.add(this.sun);
    this.sun.target = new THREE.Object3D();
    this.scene.add(this.sun.target);
    this.fill = new THREE.DirectionalLight(0x8fcad4, 0.35);
    this.scene.add(this.fill);
    this.scene.fog = new THREE.FogExp2(0xb8d4c8, 0.0034);
  }

  buildClouds() {
    const puff = new THREE.SphereGeometry(1, 8, 6);
    const entries = [];
    const rng = mulberry32(this.seed + 301);
    const geoParts = [];
    for (let i = 0; i < 8; i++) {
      const g = puff.clone().scale(randRange(rng, 5, 14), randRange(rng, 2, 5), randRange(rng, 5, 12));
      g.translate(randRange(rng, -14, 14), randRange(rng, -1.5, 1.5), randRange(rng, -9, 9));
      geoParts.push(g);
    }
    const merged = mergeGeometries(geoParts.map(g => g.index ? g.toNonIndexed() : g));
    const material = new THREE.MeshStandardMaterial({ color: 0xf5fbff, transparent: true, opacity: 0.7, roughness: 1, depthWrite: false, flatShading: true });
    for (let i = 0; i < 26; i++) {
      entries.push({ x: randRange(rng, -HALF, HALF), y: randRange(rng, 52, 92), z: randRange(rng, -HALF, HALF), rot: rng() * TAU, scale: randRange(rng, 0.7, 1.5) });
    }
    this.cloudMesh = instancedFrom(merged, material, entries, { shadow: false, cull: false });
    this.cloudMesh.renderOrder = 2;
    this.scene.add(this.cloudMesh);
  }

  treeGeometry(variant) {
    const trunk = colorGeo(new THREE.CylinderGeometry(0.22, 0.38, 3.4, 6).translate(0, 1.7, 0), 0x5c4531);
    const parts = [trunk];
    const greens = variant === 1 ? [0x3f6b3d, 0x527c46, 0x335c37] : variant === 2 ? [0x4a5d3c, 0x5d7246, 0x3c5234] : [0x2f5d43, 0x3d704e, 0x28523b];
    const rng = mulberry32(this.seed + variant * 71);
    const n = variant === 2 ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const r = randRange(rng, 1.2, 2.2);
      const canopy = new THREE.IcosahedronGeometry(r, 0);
      canopy.scale(1, randRange(rng, 0.7, 1.1), 1);
      canopy.translate(randRange(rng, -1.1, 1.1), 3.1 + i * 0.7 + randRange(rng, -0.3, 0.3), randRange(rng, -0.9, 0.9));
      parts.push(colorGeo(canopy, greens[i % greens.length]));
    }
    const merged = mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g));
    merged.computeVertexNormals();
    return merged;
  }

  rockGeometry() {
    const parts = [];
    const rng = mulberry32(this.seed + 55);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.DodecahedronGeometry(randRange(rng, 0.7, 1.4), 0);
      g.scale(randRange(rng, 0.7, 1.3), randRange(rng, 0.5, 1.0), randRange(rng, 0.7, 1.3));
      g.rotateY(rng() * TAU);
      g.translate(randRange(rng, -0.6, 0.6), randRange(rng, 0.1, 0.6), randRange(rng, -0.6, 0.6));
      parts.push(colorGeo(g, new THREE.Color().setHSL(0.12, 0.06, randRange(rng, 0.28, 0.42))));
    }
    return mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g));
  }

  grassGeometry() {
    const parts = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.ConeGeometry(0.055, randRange(0.35, 0.8), 3);
      g.translate((i % 2 ? 0.12 : -0.1) * (i + 1) * 0.25, 0.25, (i % 3 - 1) * 0.12);
      g.rotateZ((i - 1.5) * 0.18);
      parts.push(colorGeo(g, i % 2 ? 0x6d8a3c : 0x4f7133));
    }
    return mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g));
  }

  buildFoliage() {
    const rng = mulberry32(this.seed + 1234);
    const treeEntries = [[], [], []];
    const rockEntries = [];
    const grassEntries = [];
    const bushEntries = [];
    const glowEntries = [];
    for (let i = 0; i < 1400; i++) {
      const x = randRange(rng, -HALF * 0.94, HALF * 0.94);
      const z = randRange(rng, -HALF * 0.94, HALF * 0.94);
      const h = this.heightAt(x, z);
      if (h < WATER_LEVEL + 1.2) continue;
      const biome = this.biomeAt(x, z);
      const slope = this.slopeAt(x, z);
      if (slope > 1.1) continue;
      if (biome === 'forest' && treeEntries[0].length + treeEntries[1].length + treeEntries[2].length < 300) {
        if (chance(rng, 0.55)) {
          treeEntries[Math.floor(rng() * 3)].push({ x, y: h - 0.2, z, rot: rng() * TAU, scale: randRange(rng, 0.75, 1.65), color: new THREE.Color().setHSL(0.27, 0.25, randRange(rng, 0.85, 1.1)) });
        } else bushEntries.push({ x, y: h, z, rot: rng() * TAU, scale: randRange(rng, 0.5, 1.1) });
      } else if (biome === 'grassland') {
        if (chance(rng, 0.13) && treeEntries[2].length < 100) treeEntries[2].push({ x, y: h - 0.2, z, rot: rng() * TAU, scale: randRange(rng, 0.65, 1.1) });
        else grassEntries.push({ x, y: h, z, rot: rng() * TAU, scale: randRange(rng, 0.7, 1.4) });
      } else if (biome === 'marsh') {
        if (chance(rng, 0.25)) treeEntries[1].push({ x, y: h - 0.1, z, rot: rng() * TAU, scale: randRange(rng, 0.7, 1.2) });
        else grassEntries.push({ x, y: h, z, rot: rng() * TAU, scale: randRange(rng, 0.6, 1.2), color: new THREE.Color().setHSL(0.36, 0.3, 0.65) });
        if (chance(rng, 0.08)) glowEntries.push({ x, y: h + 0.35, z, rot: rng() * TAU, scale: randRange(rng, 0.4, 0.9) });
      } else if (biome === 'desert') {
        if (chance(rng, 0.05)) rockEntries.push({ x, y: h, z, rot: rng() * TAU, scale: randRange(rng, 0.5, 1.4) });
        else if (chance(rng, 0.08)) grassEntries.push({ x, y: h, z, rot: rng() * TAU, scale: randRange(rng, 0.4, 0.7), color: new THREE.Color().setHSL(0.16, 0.4, 0.8) });
      } else if (biome === 'mountain') {
        rockEntries.push({ x, y: h, z, rot: rng() * TAU, scale: randRange(rng, 0.6, 2.2) });
      } else if (biome === 'beach') {
        if (chance(rng, 0.12)) rockEntries.push({ x, y: h, z, rot: rng() * TAU, scale: randRange(rng, 0.3, 0.8) });
      }
    }
    // extra grass near spawn basin
    for (let i = 0; i < 500; i++) {
      const x = randRange(rng, -HALF * 0.75, HALF * 0.75), z = randRange(rng, -HALF * 0.75, HALF * 0.75);
      const h = this.heightAt(x, z);
      if (h > WATER_LEVEL + 1 && this.slopeAt(x, z) < 0.9) grassEntries.push({ x, y: h, z, rot: rng() * TAU, scale: randRange(rng, 0.6, 1.3) });
    }
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    for (let v = 0; v < 3; v++) {
      if (!treeEntries[v].length) continue;
      const mesh = instancedFrom(this.treeGeometry(v), leafMat, treeEntries[v]);
      mesh.userData.type = 'tree';
      this.scene.add(mesh);
      this.treeMeshes = this.treeMeshes || [];
      this.treeMeshes.push(mesh);
    }
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    this.rockMesh = instancedFrom(this.rockGeometry(), rockMat, rockEntries);
    this.scene.add(this.rockMesh);
    const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    this.grassMesh = instancedFrom(this.grassGeometry(), grassMat, grassEntries, { shadow: false });
    this.scene.add(this.grassMesh);
    const bushGeo = new THREE.IcosahedronGeometry(1, 0).scale(1.1, 0.6, 1.1);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x3e6039, roughness: 0.95, flatShading: true });
    this.bushMesh = instancedFrom(bushGeo, bushMat, bushEntries, { shadow: false });
    this.scene.add(this.bushMesh);
    const glowGeo = new THREE.IcosahedronGeometry(0.18, 0).translate(0, 0.2, 0);
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x7ef0c0, emissive: 0x2fc98a, emissiveIntensity: 1.8, roughness: 0.4 });
    this.glowMesh = instancedFrom(glowGeo, glowMat, glowEntries, { shadow: false });
    this.scene.add(this.glowMesh);
  }

  buildShelters() {
    this.shelters = [];
    const rng = mulberry32(this.seed + 888);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4c5148, roughness: 0.96, flatShading: true });
    const darkMat = new THREE.MeshBasicMaterial({ color: 0x070b0a });
    for (let i = 0; i < 9; i++) {
      let pos = null;
      for (let tries = 0; tries < 120; tries++) {
        const x = randRange(rng, -HALF * 0.8, HALF * 0.8);
        const z = randRange(rng, -HALF * 0.8, HALF * 0.8);
        const h = this.heightAt(x, z);
        const b = this.biomeAt(x, z);
        if (h > WATER_LEVEL + 2 && this.slopeAt(x, z) < 0.6 && ['forest', 'mountain', 'grassland', 'marsh'].includes(b)) { pos = { x, y: h, z, biome: b }; break; }
      }
      if (!pos) continue;
      const g = new THREE.Group();
      g.position.set(pos.x, pos.y, pos.z);
      const rot = rng() * TAU;
      g.rotation.y = rot;
      const arch = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.82, 5, 8, Math.PI), rockMat);
      arch.position.y = 0.4;
      arch.rotation.z = 0;
      arch.castShadow = true; arch.receiveShadow = true;
      g.add(arch);
      const sideL = new THREE.Mesh(new THREE.DodecahedronGeometry(1.6, 0), rockMat);
      sideL.position.set(-2.7, 0.9, 0); sideL.scale.set(0.9, 1.5, 1.1); sideL.castShadow = true; g.add(sideL);
      const sideR = sideL.clone(); sideR.position.x = 2.7; g.add(sideR);
      const hollow = new THREE.Mesh(new THREE.CircleGeometry(1.9, 12), darkMat);
      hollow.position.set(0, 1.3, -1.1);
      hollow.rotation.y = Math.PI;
      g.add(hollow);
      this.scene.add(g);
      this.shelters.push({ ...pos, group: g, radius: 5 });
    }
  }

  buildPlants() {
    const rng = mulberry32(this.seed + 4321);
    this.plantNodes = [];
    this.plantMax = 170;
    const entries = [];
    let tries = 0;
    while (this.plantNodes.length < this.plantMax && tries++ < 4000) {
      const x = randRange(rng, -HALF * 0.92, HALF * 0.92), z = randRange(rng, -HALF * 0.92, HALF * 0.92);
      const h = this.heightAt(x, z);
      if (h < WATER_LEVEL + 0.8 || this.slopeAt(x, z) > 1.0) continue;
      const b = this.biomeAt(x, z);
      if (!['grassland', 'forest', 'marsh', 'beach'].includes(b)) continue;
      const kind = b === 'marsh' ? 'fungus' : b === 'beach' ? 'kelp' : chance(rng, 0.45) ? 'berry' : 'frond';
      const color = kind === 'berry' ? new THREE.Color().setHSL(randRange(rng, 0.9, 1.02) % 1, 0.6, 0.55) : kind === 'fungus' ? new THREE.Color(0x7fe6c7) : new THREE.Color().setHSL(0.24, 0.45, 0.48);
      const node = { id: this.plantNodes.length, x, y: h, z, kind, nutrition: 8 + rng() * 8, available: true, regrow: 0, color, index: entries.length, scale: 0.8 + rng() * 0.6 };
      this.plantNodes.push(node);
      entries.push({ x, y: h, z, rot: rng() * TAU, scale: node.scale, color });
    }
    const fruitGeo = new THREE.IcosahedronGeometry(0.22, 0).translate(0, 0.45, 0);
    const fruitMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x1d451c, emissiveIntensity: 0.35, roughness: 0.45, vertexColors: false });
    this.fruitMesh = instancedFrom(fruitGeo, fruitMat, entries, { shadow: false });
    this.scene.add(this.fruitMesh);
    const stemGeo = new THREE.CylinderGeometry(0.025, 0.04, 0.55, 4).translate(0, 0.27, 0);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f6b35, roughness: 0.9 });
    this.stemMesh = instancedFrom(stemGeo, stemMat, entries.map(e => ({ ...e, scale: e.scale * 0.8 })), { shadow: false });
    this.scene.add(this.stemMesh);
    this._plantMatrix = new THREE.Matrix4();
  }

  buildParticles() {
    const makePoints = (count, color, size, opacity) => {
      const geo = new THREE.BufferGeometry();
      const arr = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) { arr[i * 3] = (Math.random() - 0.5) * 90; arr[i * 3 + 1] = Math.random() * 40; arr[i * 3 + 2] = (Math.random() - 0.5) * 90; }
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity, depthWrite: false, sizeAttenuation: true });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      return pts;
    };
    this.rain = makePoints(2200, 0xa9d8e8, 0.10, 0.55);
    this.rain.visible = false;
    this.scene.add(this.rain);
    this.snow = makePoints(1500, 0xffffff, 0.16, 0.8);
    this.snow.visible = false;
    this.scene.add(this.snow);
    this.fireflies = makePoints(110, 0xc8ff9a, 0.16, 0.0);
    this.fireflies.visible = true;
    this.scene.add(this.fireflies);
    this.pollen = makePoints(140, 0xfff0b8, 0.075, 0.5);
    this.scene.add(this.pollen);
  }

  applyEpoch(epoch) {
    this.epoch = epoch;
    const palettes = [
      { top: 0x3f78a8, bottom: 0xcfe5d4, fog: 0xb8d4c8, water: [0x0b3b45, 0x2c8b8c] },
      { top: 0x557f96, bottom: 0xd8cfb2, fog: 0xc9c2a8, water: [0x194a52, 0x3f948d] },
      { top: 0x6b5a7a, bottom: 0xd9b7a0, fog: 0xc9a99a, water: [0x2a3c53, 0x4f8e96] },
      { top: 0x2d3e63, bottom: 0xa7c6c8, fog: 0x9cb7b7, water: [0x0a2838, 0x2d6e7c] }
    ];
    const pal = palettes[epoch % palettes.length];
    this.palette = pal;
    this.waterUniforms.uDeep.value.setHex(pal.water[0]);
    this.waterUniforms.uShallow.value.setHex(pal.water[1]);
    if (this.scene.fog) this.scene.fog.color.setHex(pal.fog);
  }

  randomLandPoint(rng, biomeList, near = null, radius = 9999) {
    for (let i = 0; i < 160; i++) {
      let x, z;
      if (near) { const a = rng() * TAU, r = Math.sqrt(rng()) * radius; x = near.x + Math.cos(a) * r; z = near.z + Math.sin(a) * r; }
      else { x = randRange(rng, -HALF * 0.92, HALF * 0.92); z = randRange(rng, -HALF * 0.92, HALF * 0.92); }
      const h = this.heightAt(x, z);
      if (h < WATER_LEVEL + 0.9 || h > 30) continue;
      const b = this.biomeAt(x, z);
      if (biomeList && !biomeList.includes(b)) continue;
      if (this.slopeAt(x, z) > 1.0) continue;
      return { x, y: h, z, biome: b };
    }
    return { x: 0, y: Math.max(WATER_LEVEL + 2, this.heightAt(0, 0)), z: 0, biome: this.biomeAt(0, 0) };
  }

  findSpawn() {
    const rng = mulberry32(this.seed + 999);
    let best = null;
    for (let i = 0; i < 400; i++) {
      const x = randRange(rng, -HALF * 0.6, HALF * 0.6), z = randRange(rng, -HALF * 0.6, HALF * 0.6);
      const h = this.heightAt(x, z);
      if (h < WATER_LEVEL + 1.4 || h > 16) continue;
      const b = this.biomeAt(x, z);
      if (!['grassland', 'forest', 'beach'].includes(b)) continue;
      if (this.slopeAt(x, z) > 0.35) continue;
      const nearWater = this.nearestWater(x, z, 55);
      if (!nearWater) continue;
      const score = -Math.abs(h - 7) - (nearWater.dist * 0.05) + (b === 'grassland' ? 2 : 0);
      if (!best || score > best.score) best = { x, y: h, z, score, biome: b };
    }
    return best || { x: 0, y: Math.max(2, this.heightAt(0, 0)), z: 0, biome: 'grassland' };
  }

  nearestWater(x, z, maxDist = 60) {
    let best = null;
    for (let r = 2; r < maxDist; r += 4) {
      for (let a = 0; a < 16; a++) {
        const ang = a / 16 * TAU;
        const sx = x + Math.cos(ang) * r, sz = z + Math.sin(ang) * r;
        if (this.heightAt(sx, sz) < WATER_LEVEL - 0.2) {
          const score = r;
          if (!best || score < best.dist) best = { x: sx, z: sz, dist: r };
        }
      }
      if (best) return best;
    }
    return null;
  }

  nearestShelter(pos) {
    let best = null, bd = Infinity;
    for (const s of this.shelters) {
      const d = (s.x - pos.x) ** 2 + (s.z - pos.z) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best ? { ...best, dist: Math.sqrt(bd) } : null;
  }

  nearestPlant(pos, radius = 7) {
    let best = null, bd = radius * radius;
    for (const p of this.plantNodes) {
      if (!p.available) continue;
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  consumePlant(node) {
    if (!node || !node.available) return 0;
    node.available = false;
    node.regrow = 50 + Math.random() * 40;
    this.updatePlantInstance(node);
    return node.nutrition;
  }

  updatePlantInstance(node) {
    const m = this._plantMatrix;
    const scale = node.available ? node.scale : 0.0001;
    m.makeScale(scale, scale, scale);
    m.setPosition(node.x, node.y, node.z);
    this.fruitMesh.setMatrixAt(node.index, m);
    this.fruitMesh.instanceMatrix.needsUpdate = true;
    this.stemMesh.setMatrixAt(node.index, m);
    this.stemMesh.instanceMatrix.needsUpdate = true;
  }

  update(dt, focus) {
    this.focus.copy(focus);
    this.time += dt / this.dayLength;
    if (this.time >= 1) { this.time -= 1; this.day++; }
    this.seasonTime += dt;
    if (this.seasonTime > this.seasonLength) {
      this.seasonTime = 0;
      this.seasonIndex = (this.seasonIndex + 1) % 4;
    }
    this.yearFloat += dt * 0.012;
    const sunAngle = (this.time - 0.25) * TAU;
    const sunY = Math.sin(sunAngle);
    const sunX = Math.cos(sunAngle) * 0.7;
    const sunZ = Math.cos(sunAngle) * 0.45;
    const dayAmt = smoothstep(-0.12, 0.22, sunY);
    const dusk = clamp(1 - Math.abs(sunY) * 3.2, 0, 1);
    const pal = this.palette;
    const top = new THREE.Color(pal.top).lerp(new THREE.Color(0x070c1c), 1 - dayAmt);
    const bottom = new THREE.Color(pal.bottom).lerp(new THREE.Color(0x111a2c), 1 - dayAmt).lerp(new THREE.Color(0xe8a06a), dusk * 0.45 * dayAmt);
    this.skyUniforms.topColor.value.copy(top);
    this.skyUniforms.bottomColor.value.copy(bottom);
    this.skyUniforms.sunDir.value.set(sunX, sunY, sunZ).normalize();
    this.skyUniforms.sunColor.value.copy(new THREE.Color(0xffcf82).lerp(new THREE.Color(0xff8c4d), dusk));
    this.stars.material.opacity = clamp(1 - dayAmt * 1.4, 0, 0.95);
    this.stars.position.copy(focus);
    this.sunSprite.position.copy(focus).add(new THREE.Vector3(sunX, sunY, sunZ).multiplyScalar(620));
    this.sunSprite.material.opacity = clamp(dayAmt * 1.6, 0, 1);
    this.sunSprite.material.color.setHex(dusk > 0.4 ? 0xffa060 : 0xfff0c0);
    this.moonSprite.position.copy(focus).add(new THREE.Vector3(-sunX, -sunY, -sunZ).multiplyScalar(620));
    this.moonSprite.material.opacity = clamp((1 - dayAmt) * 0.85, 0, 0.85);

    this.sun.position.copy(focus).add(new THREE.Vector3(sunX, Math.max(0.15, sunY), sunZ).multiplyScalar(80));
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    this.sun.intensity = 0.15 + dayAmt * 2.6;
    this.sun.color.copy(new THREE.Color(0xfff0c8).lerp(new THREE.Color(0xff9b5a), dusk * 0.7));
    this.hemi.intensity = 0.18 + dayAmt * 1.05;
    this.hemi.color.copy(new THREE.Color(0xcfe8ff).lerp(new THREE.Color(0x495377), 1 - dayAmt));
    this.fill.position.copy(focus).add(new THREE.Vector3(-40, 30, -30));

    this.waterUniforms.uTime.value += dt;
    this.waterUniforms.uSun.value.copy(this.skyUniforms.sunColor.value);
    this.water.position.y = WATER_LEVEL + Math.sin(performance.now() * 0.0006) * 0.02;

    // flora seasonal tint
    if (this.treeMeshes) {
      const tint = [new THREE.Color(0xffffff), new THREE.Color(0xeaf2c8), new THREE.Color(0xe9c08c), new THREE.Color(0xcfd8ea)][this.seasonIndex];
      for (const m of this.treeMeshes) m.material.color.copy(tint);
    }
    if (this.grassMesh) {
      const tint = [new THREE.Color(0xffffff), new THREE.Color(0xe9e6b5), new THREE.Color(0xdcc090), new THREE.Color(0xc6cddd)][this.seasonIndex];
      this.grassMesh.material.color.copy(tint);
    }
    if (this.fireflies) {
      this.fireflies.material.opacity = (1 - dayAmt) * 0.75 * (this.seasonIndex === 3 ? 0.2 : 1);
      this.fireflies.position.set(focus.x, 0, focus.z);
      const pos = this.fireflies.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        pos.setY(i, y + dt * 0.18);
        if (y > 18) pos.setY(i, this.heightAt(focus.x + pos.getX(i), focus.z + pos.getZ(i)) + 0.5 + Math.random() * 3);
      }
      pos.needsUpdate = true;
    }
    if (this.pollen) this.pollen.position.set(focus.x, 0, focus.z);
    if (this.cloudMesh) {
      this.cloudMesh.rotation.y += dt * 0.0018;
      this.cloudMesh.position.x = ((this.cloudMesh.position.x + dt * 0.8) + 200) % 100 - 50;
    }
    this.updateWeather(dt, focus, dayAmt);
    // plant regrowth
    for (const p of this.plantNodes) {
      if (!p.available) {
        p.regrow -= dt;
        if (p.regrow <= 0) { p.available = true; this.updatePlantInstance(p); }
      }
    }
    // hazard label
    const biome = this.biomeAt(focus.x, focus.z);
    if (biome === 'desert' && dayAmt > 0.5) this.hazard = { label: 'Scorching heat', drain: 'thirst', rate: 0.35 };
    else if (this.seasonIndex === 3 && sunY < 0.1) this.hazard = { label: 'Freezing night', drain: 'stamina', rate: 0.25 };
    else if (biome === 'marsh') this.hazard = { label: 'Toxic spores', drain: 'health', rate: 0.02 };
    else this.hazard = null;
    if (this.sunSprite.material.opacity < 0.05) this.sunSprite.visible = false; else this.sunSprite.visible = true;
    this.stars.visible = this.stars.material.opacity > 0.02;
  }

  updateWeather(dt, focus, dayAmt) {
    const w = this.weather;
    w.timer -= dt;
    if (w.timer <= 0) {
      w.timer = 35 + Math.random() * 60;
      const r = Math.random();
      const season = this.seasonIndex;
      if (season === 3) w.type = r < 0.48 ? 'snow' : r < 0.7 ? 'overcast' : r < 0.9 ? 'fog' : 'storm';
      else if (season === 2) w.type = r < 0.28 ? 'rain' : r < 0.5 ? 'overcast' : r < 0.64 ? 'fog' : 'clear';
      else if (season === 1) w.type = r < 0.14 ? 'storm' : r < 0.32 ? 'rain' : 'clear';
      else w.type = r < 0.3 ? 'rain' : r < 0.48 ? 'overcast' : r < 0.58 ? 'fog' : 'clear';
      w.label = { clear: 'Clear skies', overcast: 'Overcast', rain: 'Rain', storm: 'Thunderstorm', fog: 'Mist', snow: 'Snowfall' }[w.type];
      w.intensity = w.type === 'clear' ? 0 : w.type === 'overcast' ? 0.3 : w.type === 'fog' ? 0.55 : w.type === 'snow' ? 0.8 : 1;
    }
    const rainOn = w.type === 'rain' || w.type === 'storm';
    this.rain.visible = rainOn;
    this.snow.visible = w.type === 'snow';
    if (rainOn) {
      const pos = this.rain.geometry.attributes.position;
      const intensity = w.type === 'storm' ? 1 : 0.65;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - dt * (22 + (i % 7) * 2);
        if (y < -2) y = 34 + Math.random() * 10;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      this.rain.position.set(focus.x, 0, focus.z);
      this.rain.material.opacity = 0.5 * intensity;
    }
    if (w.type === 'snow') {
      const pos = this.snow.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - dt * 2.2;
        if (y < -1) y = 30 + Math.random() * 8;
        pos.setY(i, y);
        pos.setX(i, pos.getX(i) + Math.sin(performance.now() * 0.001 + i) * dt * 0.6);
        if (Math.abs(pos.getX(i)) > 45) pos.setX(i, (Math.random() - 0.5) * 90);
      }
      pos.needsUpdate = true;
      this.snow.position.set(focus.x, 0, focus.z);
    }
    if (w.type === 'storm') {
      this.flash = Math.max(0, this.flash - dt * 3.5);
      if (Math.random() < dt * 0.35) { this.flash = 1; this.lightningAt = focus.clone(); }
      if (this.flash > 0) this.hemi.intensity += this.flash * 3.2;
    } else this.flash = Math.max(0, this.flash - dt * 3);
    const fogBase = { clear: 0.0026, overcast: 0.0036, rain: 0.0055, storm: 0.0075, fog: 0.012, snow: 0.008 }[w.type] || 0.003;
    const fogColor = new THREE.Color(this.palette.fog).lerp(new THREE.Color(0x28323a), 1 - dayAmt * 0.8);
    this.scene.fog.color.copy(fogColor);
    this.scene.fog.density = damp(this.scene.fog.density, fogBase, 0.3, dt);
    this.foam.material.opacity = 0;
  }
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
