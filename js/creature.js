// Procedural creature anatomy + skeletal rig + procedural animation.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, damp, TAU } from './util.js';
import { deriveStats, genomeColor } from './genome.js';

const skinCache = new Map();
const matCache = new Map();

function mat(key, make) {
  if (!matCache.has(key)) matCache.set(key, make());
  return matCache.get(key);
}

export function skinTexture(g) {
  const key = `${Math.round(g.hue1)}_${Math.round(g.hue2)}_${Math.round(g.saturation)}_${Math.round(g.lightness)}_${g.pattern}_${g.texture}`;
  if (skinCache.has(key)) return skinCache.get(key);
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const base = `hsl(${g.hue1}, ${g.saturation}%, ${g.lightness}%)`;
  const sec = `hsl(${g.hue2}, ${g.saturation}%, ${Math.max(16, g.lightness * 0.72)}%)`;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  if (g.pattern === 1) {
    ctx.fillStyle = sec;
    for (let i = 0; i < 6; i++) ctx.fillRect(0, i * 22 + 4, size, 7);
  } else if (g.pattern === 2) {
    ctx.fillStyle = sec;
    for (let i = 0; i < 46; i++) {
      const x = (i * 79) % size, y = (i * 47) % size, r = 2 + (i % 4);
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
  } else if (g.pattern === 3) {
    const grd = ctx.createLinearGradient(0, 0, 0, size);
    grd.addColorStop(0, sec); grd.addColorStop(0.55, base); grd.addColorStop(1, sec);
    ctx.fillStyle = grd; ctx.fillRect(0, 0, size, size);
  } else if (g.pattern === 4) {
    ctx.fillStyle = sec;
    ctx.fillRect(0, 0, size, 30);
    for (let i = 0; i < 8; i++) ctx.fillRect(i * 17, 14, 6, 34 + (i % 3) * 9);
  }
  if (g.texture === 1) {
    ctx.strokeStyle = 'rgba(10,20,14,0.22)';
    ctx.lineWidth = 1;
    for (let y = 4; y < size; y += 8) for (let x = (y / 8) % 2 ? 0 : 5; x < size; x += 10) {
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI); ctx.stroke();
    }
  } else if (g.texture === 2) {
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 90; i++) {
      const x = (i * 61) % size, y = (i * 37) % size;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 1, y + 7 + (i % 4)); ctx.stroke();
    }
  } else if (g.texture === 3) {
    ctx.strokeStyle = 'rgba(0,0,0,0.20)';
    ctx.lineWidth = 1.4;
    for (let y = 0; y < size; y += 14) {
      for (let x = (y / 14) % 2 ? 0 : 7; x < size; x += 14) {
        ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.4, 1.4);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  skinCache.set(key, tex);
  return tex;
}

function clean(g) {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo !== g) g.dispose();
  return geo;
}
function merge(list) {
  const cleaned = list.map(clean);
  return mergeGeometries(cleaned, false);
}
function ellipsoid(rx, ry, rz, seg = 14, rings = 10) {
  return new THREE.SphereGeometry(1, seg, rings).scale(rx, ry, rz);
}
function ellipsoidAt(rx, ry, rz, x, y, z, seg = 14, rings = 10) {
  return ellipsoid(rx, ry, rz, seg, rings).translate(x, y, z);
}
function cylBetween(a, b, r1, r2, radial = 7) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r2, r1, len, radial, 1, false);
  geo.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  geo.applyQuaternion(q);
  geo.translate(a.x, a.y, a.z);
  return geo;
}
function coneAt(r, h, x, y, z, dir = new THREE.Vector3(0, 1, 0), radial = 6) {
  const geo = new THREE.ConeGeometry(r, h, radial);
  geo.translate(0, h / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  geo.applyQuaternion(q);
  geo.translate(x, y, z);
  return geo;
}
function ringGeo(r1, r2, h, radial = 8) {
  return new THREE.CylinderGeometry(r2, r1, h, radial);
}

function wingGeometry(span, length) {
  const pts = [
    0, 0, 0,
    span * 0.34, 0.16, -length * 0.28,
    span, 0.08, -length * 0.5,
    span * 0.78, -0.02, -length * 1.05,
    span * 0.36, -0.04, -length * 1.2,
    0.04, 0, -length * 0.7
  ];
  const idx = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 1];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const uvs = [0, 0, 0.2, 0.2, 0.6, 0.15, 0.45, 0.8, 0.2, 0.9, 0.05, 0.55];
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export class CreatureRig {
  constructor(genome, opts = {}) {
    this.g = genome;
    this.stats = deriveStats(genome);
    this.root = new THREE.Group();
    this.visual = new THREE.Group();
    this.root.add(this.visual);
    this.phase = Math.random() * 10;
    this.t = Math.random() * 10;
    this.blink = 2 + Math.random() * 4;
    this.jawOpen = 0;
    this.legs = [];
    this.arms = [];
    this.tail = [];
    this.wings = [];
    this.eyes = [];
    this.headGroup = null;
    this.jawGroup = null;
    this.bodyMesh = null;
    this.isPlayer = !!opts.player;
    this.scale = opts.scale || 1;
    this.root.scale.setScalar(this.scale);
    this.build();
    this.setState({ speed: 0, state: 'idle' });
  }

  build() {
    const g = this.g, s = this.stats;
    const bw = g.bodyWidth * 0.52, bh = g.bodyHeight * 0.5, bl = g.bodyLength * 0.56;
    const legL = g.legLength;
    const hipY = legL * 1.02 + bh * 0.55;
    this.hipY = hipY;
    this.bodyY = hipY;
    const tex = skinTexture(g);
    const bodyMat = mat(`body_${g.hue1}_${g.hue2}_${g.saturation}_${g.lightness}_${g.pattern}_${g.texture}`, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.74, metalness: 0.04 }));
    const secMat = mat(`sec_${Math.round(g.hue2)}_${Math.round(g.saturation)}_${Math.round(g.lightness)}`, () => new THREE.MeshStandardMaterial({ color: genomeColor(g, true), roughness: 0.62, metalness: 0.08 }));
    const boneMat = mat('bone', () => new THREE.MeshStandardMaterial({ color: 0xe9e4ce, roughness: 0.5 }));
    const clawMat = mat('claw', () => new THREE.MeshStandardMaterial({ color: 0x22261f, roughness: 0.35, metalness: 0.15 }));
    const eyeMat = mat('eye', () => new THREE.MeshStandardMaterial({ color: 0xf9f5d4, emissive: 0xffcf6c, emissiveIntensity: 0.45, roughness: 0.2 }));
    const pupilMat = mat('pupil', () => new THREE.MeshStandardMaterial({ color: 0x0a0d0b, roughness: 0.15 }));
    const mouthMat = mat('mouth', () => new THREE.MeshStandardMaterial({ color: 0x4a1418, roughness: 0.7 }));
    this.mats = { bodyMat, secMat, boneMat, clawMat, eyeMat, pupilMat, mouthMat };

    // ---- torso
    const bodyParts = [];
    bodyParts.push(ellipsoidAt(bw, bh, bl, 0, hipY, 0, 16, 12));
    bodyParts.push(ellipsoidAt(bw * 0.86, bh * 0.72, bl * 0.46, 0, hipY - bh * 0.28, bl * 0.36));
    bodyParts.push(ellipsoidAt(bw * 0.9, bh * 0.82, bl * 0.4, 0, hipY + bh * 0.1, -bl * 0.55));
    bodyParts.push(ellipsoidAt(bw * 0.62, bh * 0.55, bl * 0.3, 0, hipY - bh * 0.1, bl * 0.72));
    const headBase = new THREE.Vector3(0, hipY + g.neckLength * 0.42 + bh * 0.18, bl * 0.8 + g.neckLength * 0.22);
    bodyParts.push(cylBetween(new THREE.Vector3(0, hipY + bh * 0.12, bl * 0.55), headBase, bw * 0.42, bw * 0.26 + g.headSize * 0.1, 8));
    // hips
    for (let side = -1; side <= 1; side += 2) {
      bodyParts.push(ellipsoidAt(bw * 0.28, bh * 0.36, bh * 0.4, side * bw * 0.55, hipY - bh * 0.34, bl * 0.3, 8, 6));
      bodyParts.push(ellipsoidAt(bw * 0.26, bh * 0.32, bh * 0.36, side * bw * 0.55, hipY - bh * 0.3, -bl * 0.52, 8, 6));
    }
    const bodyGeo = merge(bodyParts);
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
    this.visual.add(bodyMesh);
    this.bodyMesh = bodyMesh;

    // ---- secondary body: armor plates + dorsal spikes
    const secParts = [];
    if (g.armor > 0.12) {
      const n = 5;
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1) - 0.5) * 2;
        const plate = ellipsoid(bw * (0.62 - Math.abs(t) * 0.15), bh * 0.16, bl * 0.19, 8, 6);
        plate.rotateX(-0.08);
        plate.translate(0, hipY + bh * (0.82 + Math.sin(i * 1.2) * 0.05), t * bl * 0.55);
        secParts.push(plate);
      }
    }
    if (g.spikeSize > 0.1) {
      const n = Math.round(2 + g.spikeSize * 4);
      for (let i = 0; i < n; i++) {
        const z = (i / Math.max(1, n - 1) - 0.5) * bl * 1.3;
        const h = (0.12 + g.spikeSize * 0.3) * (0.8 + (i % 2) * 0.3);
        const dir = new THREE.Vector3(0, 1, -0.55);
        secParts.push(coneAt(bw * 0.08, h, 0, hipY + bh * 0.82, z, dir, 5));
      }
    }
    if (secParts.length) {
      const secMesh = new THREE.Mesh(merge(secParts), secMat);
      secMesh.castShadow = true;
      this.visual.add(secMesh);
    }

    // ---- head
    const head = new THREE.Group();
    head.position.copy(headBase);
    this.visual.add(head);
    this.headGroup = head;
    const hs = g.headSize;
    const headParts = [];
    headParts.push(ellipsoidAt(hs * 0.46, hs * 0.4, hs * 0.52, 0, 0, hs * 0.1, 14, 10));
    headParts.push(ellipsoidAt(hs * 0.55, hs * 0.3, hs * (0.35 + g.snoutLength * 0.35), 0, -hs * 0.05, hs * (0.52 + g.snoutLength * 0.1), 12, 8));
    headParts.push(ellipsoidAt(hs * 0.35, hs * 0.18, hs * 0.22, 0, hs * 0.24, -hs * 0.12, 8, 6));
    const headMesh = new THREE.Mesh(merge(headParts), bodyMat);
    headMesh.castShadow = true;
    head.add(headMesh);

    // upper teeth
    if (g.teethSize > 0.25) {
      const teeth = [];
      const n = Math.round(4 + g.teethSize * 4);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1) - 0.5) * hs * 0.62;
        teeth.push(coneAt(hs * 0.035 + g.teethSize * 0.02, hs * (0.1 + g.teethSize * 0.13), x, -hs * 0.18, hs * (0.55 + g.snoutLength * 0.22), new THREE.Vector3(0, -1, 0.15), 4));
      }
      const upperTeeth = new THREE.Mesh(merge(teeth), boneMat);
      head.add(upperTeeth);
    }
    // horns
    if (g.hornSize > 0.08) {
      const horns = [];
      for (let side = -1; side <= 1; side += 2) {
        const base = new THREE.Vector3(side * hs * 0.3, hs * 0.28, -hs * 0.02);
        const tip = new THREE.Vector3(side * hs * (0.45 + g.hornSize * 0.3), hs * (0.55 + g.hornSize * 0.55), -hs * (0.3 + g.hornSize * 0.5));
        horns.push(coneAt(hs * (0.055 + g.hornSize * 0.045), base.distanceTo(tip), base.x, base.y, base.z, tip.clone().sub(base), 6));
      }
      const hornMesh = new THREE.Mesh(merge(horns), boneMat);
      hornMesh.castShadow = true;
      head.add(hornMesh);
    }
    // eyes
    const eyeCount = g.eyeSize > 1.45 ? 4 : 2;
    for (let e = 0; e < eyeCount; e++) {
      const side = e % 2 === 0 ? -1 : 1;
      const row = e < 2 ? 0 : 1;
      const eye = new THREE.Group();
      eye.position.set(side * hs * 0.3, hs * (0.10 + row * 0.14), hs * (0.38 + row * 0.03));
      const r = hs * (0.085 + g.eyeSize * 0.045);
      const white = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), eyeMat);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.46, 8, 6), pupilMat);
      pupil.position.set(side * r * 0.05, 0, r * 0.72);
      pupil.scale.z = 0.42;
      eye.add(white, pupil);
      head.add(eye);
      this.eyes.push({ group: eye, white, pupil });
    }
    // jaw
    const jaw = new THREE.Group();
    jaw.position.set(0, -hs * 0.18, hs * 0.08);
    head.add(jaw);
    this.jawGroup = jaw;
    const jawParts = [];
    jawParts.push(ellipsoidAt(hs * 0.42, hs * 0.15, hs * (0.35 + g.snoutLength * 0.28), 0, -hs * 0.02, hs * (0.3 + g.snoutLength * 0.15), 12, 8));
    jawParts.push(ellipsoidAt(hs * 0.28, hs * 0.2, hs * 0.22, 0, -hs * 0.08, hs * 0.08, 8, 6));
    const jawMesh = new THREE.Mesh(merge(jawParts), bodyMat);
    jawMesh.castShadow = true;
    jaw.add(jawMesh);
    if (g.teethSize > 0.25) {
      const teeth = [];
      const n = Math.round(4 + g.teethSize * 4);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1) - 0.5) * hs * 0.58;
        teeth.push(coneAt(hs * 0.032 + g.teethSize * 0.018, hs * (0.09 + g.teethSize * 0.11), x, hs * 0.08, hs * (0.3 + g.snoutLength * 0.2), new THREE.Vector3(0, 1, 0.1), 4));
      }
      jaw.add(new THREE.Mesh(merge(teeth), boneMat));
    }
    // mouth cavity
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(hs * 0.22, 8, 6), mouthMat);
    mouth.scale.set(1.4, 0.5, 1.1);
    mouth.position.set(0, -hs * 0.12, hs * 0.28);
    head.add(mouth);

    // ---- legs
    const pairCount = Math.round(g.legCount / 2);
    const upperLen = legL * 0.55, lowerLen = legL * 0.5;
    const lw = g.legThickness * 0.1 + 0.035;
    for (let p = 0; p < pairCount; p++) {
      const t = pairCount === 1 ? 0 : (p / (pairCount - 1) - 0.5) * 2;
      const z = pairCount === 1 ? -bl * 0.45 : t * bl * 0.62;
      for (let side = -1; side <= 1; side += 2) {
        const hip = new THREE.Group();
        hip.position.set(side * bw * 0.58, hipY - bh * 0.42, z);
        this.visual.add(hip);
        const upperParts = [cylBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -upperLen, 0), lw * 1.15, lw * 0.85, 7)];
        upperParts.push(ellipsoidAt(lw * 1.3, lw * 1.3, lw * 1.3, 0, 0, 0, 8, 6));
        const upperMesh = new THREE.Mesh(merge(upperParts), bodyMat);
        upperMesh.castShadow = true;
        hip.add(upperMesh);
        const knee = new THREE.Group();
        knee.position.y = -upperLen;
        hip.add(knee);
        const lowerParts = [cylBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -lowerLen, 0), lw * 0.82, lw * 0.56, 6)];
        const foot = ellipsoid(lw * 1.4, lw * 0.7, lw * 2.0, 8, 5);
        foot.translate(0, -lowerLen, lw * 0.5);
        lowerParts.push(foot);
        const lowerMesh = new THREE.Mesh(merge(lowerParts), bodyMat);
        lowerMesh.castShadow = true;
        knee.add(lowerMesh);
        if (g.clawSize > 0.15) {
          const claws = [];
          for (let c = -1; c <= 1; c++) {
            claws.push(coneAt(lw * 0.35, g.clawSize * 0.22, c * lw * 0.7, -lowerLen + 0.01, lw * 1.3, new THREE.Vector3(0, -0.45, 1), 4));
          }
          knee.add(new THREE.Mesh(merge(claws), clawMat));
        }
        this.legs.push({ hip, knee, baseZ: z, side, pair: p, injured: false });
      }
    }

    // ---- arms
    if (g.armLength > 0.16) {
      for (let side = -1; side <= 1; side += 2) {
        const arm = new THREE.Group();
        arm.position.set(side * bw * 0.72, hipY + bh * 0.18, bl * 0.48);
        this.visual.add(arm);
        const upper = new THREE.Mesh(cylBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * 0.04, -g.armLength * 0.5, 0.04), lw * 0.85, lw * 0.65, 6), bodyMat);
        upper.castShadow = true;
        arm.add(upper);
        const elbow = new THREE.Group();
        elbow.position.set(side * 0.04, -g.armLength * 0.5, 0.04);
        arm.add(elbow);
        const lower = new THREE.Mesh(cylBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -g.armLength * 0.44, 0.06), lw * 0.62, lw * 0.42, 6), bodyMat);
        elbow.add(lower);
        if (g.clawSize > 0.2) {
          const claws = [];
          for (let c = -1; c <= 1; c++) claws.push(coneAt(lw * 0.3, g.clawSize * 0.24, c * lw * 0.55, -g.armLength * 0.44, 0.06, new THREE.Vector3(0, -0.3, 1), 4));
          elbow.add(new THREE.Mesh(merge(claws), clawMat));
        }
        this.arms.push({ arm, elbow, side });
      }
    }

    // ---- tail
    if (g.tailLength > 0.12) {
      const segs = 4;
      const segLen = g.tailLength * 0.32 + 0.06;
      let parent = new THREE.Group();
      parent.position.set(0, hipY + bh * 0.12, -bl * 0.88);
      parent.rotation.x = 0.18;
      this.visual.add(parent);
      for (let i = 0; i < segs; i++) {
        const seg = new THREE.Group();
        if (i > 0) seg.position.z = -segLen;
        const r = lw * (1.15 - i * 0.18);
        const geo = merge([
          new THREE.CylinderGeometry(r * 0.7, r, segLen, 6).rotateX(Math.PI / 2).translate(0, 0, -segLen / 2),
          bellySphere(r, segLen)
        ]);
        const m = new THREE.Mesh(geo, i % 2 === 0 ? bodyMat : secMat);
        m.castShadow = true;
        seg.add(m);
        parent.add(seg);
        this.tail.push(seg);
        parent = seg;
      }
      const tip = new THREE.Mesh(coneAt(lw * 0.35, g.tailLength * 0.16 + 0.05, 0, 0, -segLen, new THREE.Vector3(0, 0, -1), 5), secMat);
      parent.add(tip);
    }

    // ---- wings
    if (g.wings) {
      for (let side = -1; side <= 1; side += 2) {
        const wing = new THREE.Group();
        wing.position.set(side * bw * 0.48, hipY + bh * 0.28, bl * 0.05);
        wing.scale.x = side;
        this.visual.add(wing);
        const span = g.wingSpan * 1.5 + 0.4;
        const membrane = new THREE.Mesh(wingGeometry(span, bl * 1.15), mat(`wing_${g.hue1}_${g.hue2}_${g.saturation}`, () => new THREE.MeshStandardMaterial({
          color: genomeColor(g), transparent: true, opacity: 0.72, side: THREE.DoubleSide, roughness: 0.8, depthWrite: false
        })));
        membrane.castShadow = true;
        wing.add(membrane);
        const bones = [];
        bones.push(cylBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(span * 0.9, 0.08, -bl * 0.5), 0.035, 0.02, 5));
        bones.push(cylBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(span * 0.42, 0.1, -bl * 1.0), 0.03, 0.018, 5));
        wing.add(new THREE.Mesh(merge(bones), secMat));
        this.wings.push(wing);
      }
    }

    this.root.userData.rig = this;
  }

  setState(st) {
    this.state = { ...(this.state || {}), ...st };
  }

  setInjury(part) {
    if (part === 'leg' && this.legs.length) {
      const leg = this.legs[Math.floor(Math.random() * this.legs.length)];
      leg.injured = true;
    }
    if (part === 'eye' && this.eyes.length) this.eyes[Math.floor(Math.random() * this.eyes.length)].injured = true;
    if (part === 'jaw') this.jawInjured = true;
  }

  update(dt) {
    const st = this.state || {};
    this.t += dt;
    const speed = st.speed || 0;
    const moving = speed > 0.12;
    const flying = st.flying;
    const swimming = st.swimming;
    const sleeping = st.state === 'sleep';
    const dead = st.dead;
    const attacking = st.state === 'attack';
    const eating = st.state === 'eat' || st.state === 'graze';
    const hurt = st.hurt || 0;
    const fear = st.fear || 0;
    const strideRate = clamp(speed * 1.5 + 1.1, 1.1, 8.5);
    if (moving && !sleeping) this.phase += dt * strideRate * (flying ? 0.7 : 1);
    else this.phase += dt * 0.35;
    const amp = moving ? clamp(0.32 + speed * 0.075, 0.3, 0.8) : 0.03;
    const bob = moving ? Math.abs(Math.sin(this.phase)) * 0.045 * clamp(speed * 0.35, 0.3, 1.5) : Math.sin(this.t * 1.5) * 0.012;

    if (!dead) {
      this.visual.position.y = damp(this.visual.position.y, sleeping ? -this.g.legLength * 0.34 : bob, 12, dt);
      const leanTarget = flying ? -0.16 : swimming ? 0.05 : sleeping ? -0.05 : moving ? clamp(speed * 0.02, 0, 0.14) : 0;
      this.visual.rotation.x = damp(this.visual.rotation.x, leanTarget, 5, dt);
      this.visual.rotation.z = damp(this.visual.rotation.z, moving ? Math.sin(this.phase) * 0.035 + (st.injuredLeg ? 0.05 : 0) : 0, 6, dt);
      this.visual.rotation.y = damp(this.visual.rotation.y, st.turn ? clamp(st.turn * -0.2, -0.35, 0.35) : 0, 6, dt);
      if (fear > 0.5 && !sleeping) {
        this.visual.position.x = (Math.random() - 0.5) * 0.012 * fear;
      } else this.visual.position.x = damp(this.visual.position.x, 0, 14, dt);
    } else {
      this.visual.rotation.z = damp(this.visual.rotation.z, Math.PI * 0.48, 4, dt);
      this.visual.position.y = damp(this.visual.position.y, 0.08, 6, dt);
    }

    const phase = this.phase;
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i];
      const off = (leg.pair + (leg.side > 0 ? 1 : 0)) % 2 === 0 ? 0 : Math.PI;
      let swing = Math.sin(phase + off) * amp;
      let bend = Math.max(0, Math.sin(phase + off + 1.15)) * amp * 1.6;
      let sideSwing = 0;
      if (swimming) { swing = Math.sin(this.t * 2 + i) * 0.22; bend = 0.75; }
      if (flying) { swing = -0.55 + Math.sin(this.t * 2.5 + i) * 0.08; bend = 0.9; }
      if (sleeping) { swing = leg.side > 0 ? 0.9 : 0.7; bend = 1.65; sideSwing = leg.side * 0.25; }
      if (dead) { swing = 0.2; bend = 0.2; }
      if (leg.injured) { swing *= 0.35; bend += 0.35; }
      if (!moving && !sleeping && !flying && !swimming) { swing = 0.03; bend = 0.12; }
      leg.hip.rotation.x = damp(leg.hip.rotation.x, -swing * 0.6, 18, dt);
      leg.hip.rotation.z = damp(leg.hip.rotation.z, sideSwing + (leg.side > 0 ? -0.09 : 0.09), 10, dt);
      leg.knee.rotation.x = damp(leg.knee.rotation.x, bend * 0.7, 18, dt);
    }
    for (const a of this.arms) {
      const swing = Math.sin(phase + (a.side > 0 ? 0 : Math.PI)) * amp * 0.75;
      a.arm.rotation.x = damp(a.arm.rotation.x, moving ? -swing : 0.14, 10, dt);
      a.elbow.rotation.x = damp(a.elbow.rotation.x, 0.3 + Math.max(0, -swing) * 0.5, 10, dt);
      a.arm.rotation.z = damp(a.arm.rotation.z, a.side * 0.18, 6, dt);
    }
    for (let i = 0; i < this.tail.length; i++) {
      const seg = this.tail[i];
      const sway = Math.sin(phase * 0.8 - i * 0.55) * (moving ? 0.16 : 0.05) * (swimming ? 1.9 : 1);
      seg.rotation.y = damp(seg.rotation.y, sway, 10, dt);
      seg.rotation.x = damp(seg.rotation.x, swimming ? Math.sin(phase - i * 0.6) * 0.2 : (sleeping ? 0.25 : 0.03), 8, dt);
    }
    if (this.wings.length) {
      const flapRate = flying ? 7.5 : 1.4;
      const flap = flying ? Math.sin(this.t * flapRate) * 0.72 : Math.sin(this.t * 1.1) * 0.04;
      for (const wing of this.wings) {
        wing.rotation.z = damp(wing.rotation.z, (flying ? 0.18 + flap : 0.32) * (wing.scale.x > 0 ? 1 : 1), 8, dt);
        wing.rotation.y = damp(wing.rotation.y, flying ? 0.05 : 0.5, 5, dt);
      }
    }
    // head look / jaw / blink
    if (this.headGroup) {
      let pitch = 0, yaw = 0;
      if (eating) pitch = 0.55 + Math.sin(this.t * 7) * 0.08;
      else if (sleeping) pitch = 0.5;
      else if (attacking) pitch = -0.18;
      else if (st.roar) pitch = -0.45;
      else if (flying) pitch = -0.05;
      if (st.lookYaw) yaw = clamp(st.lookYaw, -0.5, 0.5);
      this.headGroup.rotation.x = damp(this.headGroup.rotation.x, pitch, 8, dt);
      this.headGroup.rotation.y = damp(this.headGroup.rotation.y, yaw + Math.sin(this.t * 0.4) * 0.04, 4, dt);
    }
    let jawTarget = 0.04 + Math.sin(this.t * 1.6) * 0.02;
    if (eating) jawTarget = 0.25 + Math.abs(Math.sin(this.t * 8)) * 0.55;
    if (attacking) jawTarget = 0.7;
    if (st.roar) jawTarget = 0.85;
    if (sleeping) jawTarget = 0.02;
    if (this.jawInjured) jawTarget *= 0.35;
    if (this.jawGroup) this.jawGroup.rotation.x = damp(this.jawGroup.rotation.x, jawTarget, 12, dt);

    this.blink -= dt;
    if (this.blink < 0) this.blink = 2 + Math.random() * 5;
    const blink = this.blink < 0.13 ? 0.15 : 1;
    for (const e of this.eyes) {
      e.white.scale.y = damp(e.white.scale.y, blink, 25, dt);
      e.pupil.scale.y = damp(e.pupil.scale.y, blink * 0.42, 25, dt);
      if (e.injured) e.white.material = this.mats.pupilMat;
    }
    const breathe = 1 + Math.sin(this.t * 1.8) * 0.012;
    if (this.bodyMesh) this.bodyMesh.scale.set(1, breathe, 1);
  }

  setScale(v) {
    this.scale = v;
    this.root.scale.setScalar(v);
  }

  dispose() {
    this.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
    });
    this.root.removeFromParent();
  }
}

function bellySphere(r, len) {
  return new THREE.SphereGeometry(r * 0.85, 6, 5).scale(1, 1, len * 0.6);
}
