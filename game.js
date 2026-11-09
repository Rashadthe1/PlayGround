(() => {
  const canvas = document.getElementById('arena');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = { hp: $('hpFill'), hpText: $('hpText'), stamina: $('staminaFill'), staminaText: $('staminaText'), hunger: $('hungerFill'), hungerText: $('hungerText'), dummy: $('dummyHpFill'), dummyText: $('dummyHpText'), dummyState: $('dummyState'), dummyDot: $('dummyDot'), status: $('statusText'), range: $('rangeText'), toast: $('comboToast'), impact: $('impactLabel'), ko: $('koOverlay') };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const game = {
    player: { x: -1.12, z: 0.08, hp: 100, stamina: 90, hunger: 80, attack: 0, attackType: '', dodge: 0, invuln: 0, hurt: 0, face: 1, moving: false }, attackBuffer: [],
    dummy: { x: 1.12, z: -0.02, hp: 100, attack: 0, hurt: 0, launch: 0, face: -1 },
    keys: {}, last: 0, lightCount: 0, comboAt: 0, quickHeavyUntil: 0, dummyCooldown: 1.1, hungerTick: 0, messageTimer: 0, toastTimer: 0, hitFlash: 0, gameOver: false, elapsed: 0, shake: 0, particles: []
  };
  let W = 0, H = 0, dpr = 1;
  const resize = () => { const r = canvas.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2); W = r.width; H = r.height; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  new ResizeObserver(resize).observe(canvas); resize();
  const distance = () => Math.hypot(game.dummy.x - game.player.x, game.dummy.z - game.player.z);
  const showImpact = (text, color = '#dd675f') => { ui.impact.textContent = text; ui.impact.style.color = color; ui.impact.classList.remove('show'); void ui.impact.offsetWidth; ui.impact.classList.add('show'); };
  const showToast = (main, sub = 'UPPER BODY IMPACT') => { ui.toast.querySelector('strong').textContent = main; ui.toast.querySelector('small').textContent = sub; ui.toast.classList.add('show'); game.toastTimer = .9; };
  const updateHud = () => {
    const p = game.player, d = game.dummy;
    ui.hp.style.width = `${p.hp}%`; ui.hpText.innerHTML = `${Math.ceil(p.hp)} <small>/ 100</small>`;
    ui.stamina.style.width = `${p.stamina / 90 * 100}%`; ui.staminaText.innerHTML = `${Math.ceil(p.stamina)} <small>/ 90</small>`;
    ui.hunger.style.width = `${p.hunger / 80 * 100}%`; ui.hungerText.innerHTML = `${Math.ceil(p.hunger)} <small>/ 80</small>`;
    ui.dummy.style.width = `${d.hp}%`; ui.dummyText.innerHTML = `${Math.ceil(d.hp)} <small>/ 100</small>`;
    const r = distance(); ui.range.textContent = `${r.toFixed(1)}M`;
    ui.status.textContent = p.stamina < 18 ? 'LOW STAMINA' : p.dodge > 0 ? 'EVADING' : p.attack > 0 ? 'IN ACTION' : game.keys.Shift ? 'SPRINTING' : 'READY TO SPAR';
    if (game.dummy.launch > 0) { ui.dummyState.textContent = 'AIRBORNE · LAUNCHED'; ui.dummyDot.style.background = '#e0ad55'; }
    else if (d.hp <= 0) { ui.dummyState.textContent = 'RESETTING · STAND BY'; ui.dummyDot.style.background = '#a9b1ac'; }
    else if (d.attack > 0) { ui.dummyState.textContent = 'ATTACKING · INCOMING'; ui.dummyDot.style.background = '#ed786b'; }
    else { ui.dummyState.textContent = 'ACTIVE · COUNTERING'; ui.dummyDot.style.background = '#a9d84c'; }
  };
  const spend = (n) => { if (game.player.stamina < n) { showImpact('OUT OF STAMINA', '#a88d58'); return false; } game.player.stamina -= n; return true; };
  const attack = (heavy = false) => {
    const p = game.player, d = game.dummy, now = performance.now() / 1000;
    if (game.gameOver || p.hp <= 0) return;
    if (p.attack > .05) {
      if (p.dodge <= .05 && game.attackBuffer.length < 3) game.attackBuffer.push(heavy);
      return;
    }
    if (p.dodge > .05) return;
    const launchCombo = heavy && game.lightCount >= 2 && now - game.comboAt < 1.65;
    if (!spend(heavy ? (game.quickHeavyUntil > now ? 13 : 18) : 7)) return;
    const quick = heavy && game.quickHeavyUntil > now;
    p.attack = heavy ? (quick ? .30 : .48) : .32;
    p.attackType = heavy ? (launchCombo ? 'launch' : 'heavy') : ['jab', 'jab', 'cross', 'uppercut'][game.lightCount % 4];
    p.face = d.x >= p.x ? 1 : -1;
    if (heavy) { game.lightCount = 0; game.quickHeavyUntil = 0; }
    else { game.lightCount++; game.comboAt = now; }
    const reach = heavy ? 2.5 : 2.25;
    if (distance() <= reach && d.hp > 0) {
      const crit = Math.random() < (quick ? .34 : .22);
      let damage = heavy ? (crit ? 14 : 10) : (crit ? 6 : 4);
      if (quick && heavy && !crit) damage += 2;
      if (launchCombo) damage = crit ? 14 : 10;
      d.hp = Math.max(0, d.hp - damage); d.hurt = .32; game.shake = .16; game.hitFlash = .10;
      if (launchCombo) { d.launch = .85; d.z = Math.min(d.z + .42, 1.05); d.x += p.face * .2; showToast('LAUNCH', 'COMBO STRING 01 · M1 > M1 > M2'); }
      else if (crit) showImpact(`CRITICAL · ${damage}`, '#b374ce');
      else showImpact(`${damage} DAMAGE`, heavy ? '#d9a24d' : '#dd675f');
      spawnSparks(d.x, d.z, crit ? '#c28acb' : heavy ? '#e7bd72' : '#f18b7e');
      if (d.hp <= 0) { d.launch = 0; showToast('DUMMY DOWN', 'RESETTING FOR ANOTHER ROUND'); }
    } else { showImpact('OUT OF RANGE', '#8e9993'); }
    updateHud();
  };
  const dodge = () => {
    const p = game.player;
    if (game.gameOver || p.dodge > 0 || p.attack > .12 || !spend(12)) return;
    p.dodge = game.keys.Shift ? .56 : .48; p.invuln = game.keys.Shift ? .48 : .45;
    if (game.keys.Shift) { p.x -= p.face * .75; p.z += .22; showImpact('DASH EVADE', '#8daf50'); }
    else { showImpact('SLIP', '#8daf50'); }
    p.attackType = game.keys.Shift ? 'dash' : 'slip';
    updateHud();
  };
  const spawnSparks = (x, z, color) => { for (let i = 0; i < 9; i++) game.particles.push({ x, z, vx: (Math.random() - .5) * 2.4, vz: (Math.random() - .5) * 1.4 - .15, life: .32 + Math.random() * .28, max: .6, color }); };
  const playerHurt = (damage) => { const p = game.player; p.hp = Math.max(0, p.hp - damage); p.hurt = .35; game.shake = .18; showImpact(`-${damage} HEALTH`, '#e06f68'); if (p.hp <= 0) { game.gameOver = true; ui.ko.classList.add('show'); } updateHud(); };
  const doDummyAttack = () => {
    const p = game.player, d = game.dummy;
    d.attack = .58; d.face = p.x >= d.x ? 1 : -1;
    // The counter lands near the end of the wind-up unless the player slips or dashes.
    d.attackHitAt = .34;
  };
  const reset = () => {
    Object.assign(game.player, { x: -1.12, z: .08, hp: 100, stamina: 90, hunger: 80, attack: 0, attackType: '', dodge: 0, invuln: 0, hurt: 0, face: 1 });
    Object.assign(game.dummy, { x: 1.12, z: -.02, hp: 100, attack: 0, hurt: 0, launch: 0, face: -1 });
    game.lightCount = 0; game.attackBuffer = []; game.quickHeavyUntil = 0; game.dummyCooldown = 1.1; game.gameOver = false; game.elapsed = 0; game.particles = []; ui.ko.classList.remove('show'); ui.toast.classList.remove('show'); updateHud();
  };
  const keydown = (e) => {
    const k = e.key.toLowerCase();
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    if (game.keys[e.key] || game.keys[k]) return;
    game.keys[e.key] = true; game.keys[k] = true;
    if (k === ' ' || k === 'spacebar') dodge();
    if (k === 'j' || k === 'f') attack(false);
    if (k === 'k' || k === 'r') attack(true);
  };
  window.addEventListener('keydown', keydown); window.addEventListener('keyup', e => { delete game.keys[e.key]; delete game.keys[e.key.toLowerCase()]; });
  window.addEventListener('blur', () => { game.keys = {}; });
  $('lightBtn').addEventListener('click', () => attack(false)); $('heavyBtn').addEventListener('click', () => attack(true)); $('resetBtn').addEventListener('click', reset); $('koReset').addEventListener('click', reset);
  $('touchLight').addEventListener('click', () => attack(false)); $('touchHeavy').addEventListener('click', () => attack(true)); $('touchDodge').addEventListener('pointerdown', e => { e.preventDefault(); dodge(); });
  document.querySelectorAll('[data-move]').forEach(btn => {
    const k = { up: 'w', down: 's', left: 'a', right: 'd' }[btn.dataset.move];
    btn.addEventListener('pointerdown', e => { e.preventDefault(); btn.setPointerCapture(e.pointerId); game.keys[k] = true; });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => btn.addEventListener(ev, () => { delete game.keys[k]; }));
  });
  canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') attack(false); });
  function update(dt) {
    const p = game.player, d = game.dummy; game.elapsed += dt;
    if (game.toastTimer > 0 && (game.toastTimer -= dt) <= 0) ui.toast.classList.remove('show');
    if (p.hp <= 0) return;
    const ix = (game.keys.d || game.keys.D || game.keys.ArrowRight ? 1 : 0) - (game.keys.a || game.keys.A || game.keys.ArrowLeft ? 1 : 0);
    const iz = (game.keys.s || game.keys.S || game.keys.ArrowDown ? 1 : 0) - (game.keys.w || game.keys.W || game.keys.ArrowUp ? 1 : 0);
    p.moving = (ix !== 0 || iz !== 0) && p.attack < .1 && p.dodge <= 0;
    if (p.moving) { const len = Math.hypot(ix, iz) || 1; const sprint = game.keys.Shift ? 1.65 : 1; if (sprint && game.keys.Shift) p.stamina = Math.max(0, p.stamina - dt * 8); const speed = (p.stamina <= 0 && game.keys.Shift ? .8 : 2.55) * sprint; p.x += ix / len * speed * dt; p.z += iz / len * speed * dt; if (ix) p.face = ix > 0 ? 1 : -1; }
    p.x = clamp(p.x, -3.2, 3.2); p.z = clamp(p.z, -1.05, 1.25);
    if (p.attack > 0) p.attack = Math.max(0, p.attack - dt);
    if (p.attack <= .05 && game.attackBuffer.length) attack(game.attackBuffer.shift());
    if (p.dodge > 0) p.dodge = Math.max(0, p.dodge - dt);
    if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
    if (p.hurt > 0) p.hurt -= dt;
    if (d.hurt > 0) d.hurt -= dt;
    if (d.attack > 0) {
      const before = d.attack; d.attack = Math.max(0, d.attack - dt);
      if (d.attackHitAt !== undefined && before > d.attackHitAt && d.attack <= d.attackHitAt) {
        if (distance() < 2.4) {
          if (p.invuln > 0) { p.dodge = 0; game.quickHeavyUntil = performance.now() / 1000 + .2; showImpact('SLIP · HEAVY READY', '#8daf50'); }
          else playerHurt(4 + Math.floor(Math.random() * 3));
        }
      }
      if (d.attack <= 0) { d.attackHitAt = undefined; game.dummyCooldown = 1.0 + Math.random() * .5; }
    }
    if (d.launch > 0) { d.launch = Math.max(0, d.launch - dt); d.z = Math.max(-1.1, d.z - dt * 1.2); }
    if (d.hp <= 0) { game.dummyCooldown -= dt; if (game.dummyCooldown <= 0) { d.hp = 100; d.x = clamp(p.x + (p.x < 0 ? 2.15 : -2.15), -3.0, 3.0); d.z = p.z - .05; d.attack = 0; game.dummyCooldown = 1.15; showImpact('DUMMY RESET', '#8caf55'); } }
    else if (d.attack <= 0 && d.launch <= 0 && distance() < 2.55) { game.dummyCooldown -= dt; if (game.dummyCooldown <= 0) doDummyAttack(); }
    if (game.quickHeavyUntil && performance.now() / 1000 > game.quickHeavyUntil) game.quickHeavyUntil = 0;
    game.hungerTick += dt; if (game.hungerTick > 13) { game.hungerTick = 0; p.hunger = Math.max(0, p.hunger - 1); }
    if (!p.moving && p.attack <= 0 && p.dodge <= 0) p.stamina = Math.min(90, p.stamina + dt * 13);
    game.particles = game.particles.filter(pt => { pt.x += pt.vx * dt; pt.z += pt.vz * dt; pt.life -= dt; return pt.life > 0; });
    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt);
    updateHud();
  }
  const project = (x, z) => { const horizon = H * .48; const scale = Math.min(W / 8.6, H / 5.2); return { x: W * .5 + x * scale, y: horizon + z * scale * .72, s: scale }; };
  function rounded(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.stroke()}}
  function drawFloor() {
    const horizon = H * .48; const bottom = H * 1.08;
    const grad = ctx.createLinearGradient(0,horizon,0,H); grad.addColorStop(0,'rgba(249,250,249,.1)'); grad.addColorStop(1,'rgba(226,232,226,.63)');
    ctx.fillStyle=grad;ctx.fillRect(0,horizon,W,H-horizon);
    // subtle perspective seams in the immaculate studio floor
    ctx.save();ctx.strokeStyle='rgba(137,153,142,.12)';ctx.lineWidth=1;
    for(let i=-12;i<=12;i++){ctx.beginPath();ctx.moveTo(W/2+i*7,horizon);ctx.lineTo(W/2+i*80,bottom);ctx.stroke()}
    for(let j=1;j<8;j++){const t=j/8;const y=horizon+(bottom-horizon)*t*t;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
    ctx.restore();
    const center = project(0,0);
    ctx.save();ctx.translate(center.x,center.y+12);ctx.scale(1,.22);ctx.strokeStyle='rgba(121,142,125,.22)';ctx.lineWidth=1.2;ctx.setLineDash([6,8]);ctx.beginPath();ctx.ellipse(0,0,Math.min(W*.25,210),Math.min(W*.25,210),0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    ctx.strokeStyle='rgba(150,165,151,.14)';ctx.beginPath();ctx.ellipse(0,0,Math.min(W*.31,270),Math.min(W*.31,270),0,0,Math.PI*2);ctx.stroke();ctx.restore();
  }
  function drawShadow(pos, width, opacity) { ctx.save();ctx.fillStyle=`rgba(53,66,59,${opacity})`;ctx.beginPath();ctx.ellipse(pos.x,pos.y+4,width,8,0,0,Math.PI*2);ctx.fill();ctx.restore(); }
  function drawBlock(x,y,w,h,r,fill,stroke='#26312d') { ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke(); }
  function drawFighter(entity, isPlayer) {
    const pos=project(entity.x,entity.z);const s=pos.s;const scale=clamp(s/85,.68,1.42);const bob=entity.moving ? Math.sin(game.elapsed*12)*2*scale:Math.sin(game.elapsed*2.7+(isPlayer?0:1))*1.3*scale;
    let bodyH=48*scale, bodyW=36*scale, head=24*scale, legH=27*scale, armW=12*scale, armH=30*scale;
    const top=pos.y-bodyH-legH-head*.83+bob;
    const bodyColor=isPlayer?'#badf58':'#c6cbc7', trim=isPlayer?'#607839':'#747e78', skin=isPlayer?'#e4b79b':'#d7b79f';
    let airborne= !isPlayer && entity.launch>0; if(airborne) pos.y-=Math.sin((.85-entity.launch)/.85*Math.PI)*42*scale;
    drawShadow(project(entity.x,entity.z), 28*scale, .12);
    ctx.save(); if(entity.hurt>0 && Math.floor(game.elapsed*22)%2===0) ctx.globalAlpha=.6;
    // feet + legs
    const stride=entity.moving?Math.sin(game.elapsed*13)*4*scale:0;
    drawBlock(pos.x-bodyW*.32,pos.y-legH+stride,bodyW*.27,legH,3*scale,isPlayer?'#313b37':'#67716c');
    drawBlock(pos.x+bodyW*.05,pos.y-legH-stride,bodyW*.27,legH,3*scale,isPlayer?'#313b37':'#67716c');
    drawBlock(pos.x-bodyW*.4,pos.y-3*scale,bodyW*.37,7*scale,2*scale,isPlayer?'#232d29':'#59635e');
    drawBlock(pos.x+bodyW*.01,pos.y-3*scale,bodyW*.37,7*scale,2*scale,isPlayer?'#232d29':'#59635e');
    // torso, shoulders and angular side seam
    const torsoY=pos.y-legH-bodyH+bob;
    drawBlock(pos.x-bodyW/2,torsoY,bodyW,bodyH,5*scale,bodyColor,trim);
    ctx.fillStyle=isPlayer?'rgba(255,255,255,.55)':'rgba(255,255,255,.5)';ctx.fillRect(pos.x-bodyW*.37,torsoY+5*scale,bodyW*.74,2*scale);
    // neck and square head
    drawBlock(pos.x-5*scale,torsoY-6*scale,10*scale,9*scale,2*scale,skin,'#9b7868');
    const headY=torsoY-head+3*scale;
    drawBlock(pos.x-head*.48,headY,head*.96,head*.88,5*scale,isPlayer?'#edc3a6':'#dfc2aa','#9b7868');
    // hair/cap and friendly face
    if(isPlayer){drawBlock(pos.x-head*.49,headY-1*scale,head*.98,7*scale,4*scale,'#35403b','#35403b');ctx.fillStyle='#252e2a';ctx.fillRect(pos.x+entity.face*4*scale,headY+11*scale,2.1*scale,2*scale);ctx.fillRect(pos.x-entity.face*6*scale,headY+11*scale,2.1*scale,2*scale);}
    else {drawBlock(pos.x-head*.5,headY-1*scale,head,7*scale,4*scale,'#929d96','#78837c');ctx.fillStyle='#48534e';ctx.fillRect(pos.x+entity.face*4*scale,headY+12*scale,2*scale,2*scale);ctx.fillRect(pos.x-entity.face*6*scale,headY+12*scale,2*scale,2*scale);}
    // arms animate into punch pose
    const active=entity.attack>0; const type=entity.attackType||'';let swing=0;
    if(active){const total=isPlayer?(type==='heavy'||type==='launch'?.48:.32):.58;const phase=1-entity.attack/total;swing=Math.sin(clamp(phase*1.35,0,1)*Math.PI/2);}
    let armForward=(active?swing* (type==='heavy'||type==='launch'?24:17):0)*scale*entity.face;
    if(!isPlayer && active)armForward=swing*17*scale*entity.face;
    if(isPlayer && entity.dodge>0 && type==='slip'){armForward=-entity.face*7*scale;}
    const shoulderY=torsoY+9*scale;
    drawBlock(pos.x- bodyW*.5-armW*.48,shoulderY,armW,armH,5*scale,skin,'#9b7868');
    drawBlock(pos.x+bodyW*.5-armW*.48+armForward,shoulderY+(active?-swing*7*scale:0),armW,armH,5*scale,skin,'#9b7868');
    if(active){ctx.save();ctx.globalAlpha=.3*swing;ctx.strokeStyle=isPlayer?'#a6d34c':'#db7d6e';ctx.lineWidth=9*scale;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(pos.x+entity.face*bodyW*.55,shoulderY+armH*.55);ctx.lineTo(pos.x+entity.face*(bodyW*.55+armForward*.85),shoulderY+armH*.5);ctx.stroke();ctx.restore();}
    if(isPlayer){rounded(pos.x-29*scale,top-18*scale,58*scale,14*scale,7*scale,'rgba(255,255,255,.82)','rgba(37,49,46,.08)');ctx.fillStyle='#53605a';ctx.font=`500 ${8*scale}px DM Mono, monospace`;ctx.textAlign='center';ctx.fillText('YOU',pos.x,top-8*scale);}
    else {rounded(pos.x-39*scale,top-18*scale,78*scale,14*scale,7*scale,'rgba(255,255,255,.82)','rgba(37,49,46,.08)');ctx.fillStyle='#7d8882';ctx.font=`500 ${8*scale}px DM Mono, monospace`;ctx.textAlign='center';ctx.fillText('PRACTICE DUMMY',pos.x,top-8*scale);}
    ctx.restore();
  }
  function drawParticles(){for(const pt of game.particles){const p=project(pt.x,pt.z);ctx.globalAlpha=clamp(pt.life/pt.max,0,1);ctx.fillStyle=pt.color;ctx.beginPath();ctx.arc(p.x+(1-pt.life/pt.max)*pt.vx*20,p.y-25*clamp(p.s/85,.7,1)+pt.vz*8,2.2,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1}
  function render() {
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
    const shake=game.shake>0?(Math.random()-.5)*game.shake*12:0;ctx.save();ctx.translate(shake,0);
    drawFloor(); const actors=[{e:game.player,p:project(game.player.x,game.player.z).y},{e:game.dummy,p:project(game.dummy.x,game.dummy.z).y}].sort((a,b)=>a.p-b.p);for(const a of actors)drawFighter(a.e,a.e===game.player);drawParticles();
    // luminous hit vignette
    if(game.hitFlash>0){game.hitFlash=Math.max(0,game.hitFlash-.016);ctx.fillStyle=`rgba(255,255,255,${game.hitFlash*.75})`;ctx.fillRect(0,0,W,H)}
    ctx.restore();
  }
  function frame(t){const dt=Math.min(.04,(t-game.last)/1000||0);game.last=t;update(dt);render();requestAnimationFrame(frame)}
  updateHud();requestAnimationFrame(frame);
})();