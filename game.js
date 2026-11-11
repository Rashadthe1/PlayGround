import * as THREE from 'three';

const $ = (s) => document.querySelector(s);
const ui = {
  population: $('#population-stat'), biodiversity: $('#biodiversity-stat'), health: $('#health-stat'), healthFill: $('#health-fill'),
  speciesList: $('#species-list'), speciesCount: $('#species-count'), selectedName: $('#selected-name'), selectedIcon: $('#selected-icon'), selectedDesc: $('#selected-description'), selectedPop: $('#selected-pop'), selectedLife: $('#selected-life'), selectedAdapt: $('#selected-adapt'),
  day: $('#header-day'), time: $('#time-label'), timeSub: $('#time-sub'), progress: $('#timeline-progress'), marker: $('#timeline-marker'), date: $('#timeline-date'), events: $('#event-list'), toast: $('#toast'), tooltip: $('#canvas-tooltip')
};
const species = [
  {id:'mossbacks',name:'Mossbacks',kind:'GRAZER',symbol:'◒',color:'#9dbd71',dark:'#49674c',accent:'#d7df9d',description:'Slow-growing grazers that keep the forest floor clear.',population:124,lifespan:18,adapt:84,traits:{speed:34,armor:76,forage:82},shape:'round',size:1.04},
  {id:'skydarters',name:'Skydarters',kind:'POLLINATOR',symbol:'✧',color:'#e4b976',dark:'#8c684e',accent:'#f2daa2',description:'Bright-winged pollinators that thrive in warm updrafts.',population:86,lifespan:7,adapt:71,traits:{speed:82,armor:26,forage:64},shape:'wing',size:.74},
  {id:'stonehoppers',name:'Stonehoppers',kind:'SCAVENGER',symbol:'◉',color:'#83b8b0',dark:'#496d71',accent:'#c5e1ce',description:'Curious little scavengers with a knack for finding shelter.',population:38,lifespan:12,adapt:68,traits:{speed:63,armor:60,forage:48},shape:'long',size:.72}
];
let selected = species[0], day = 128, paused = false, speedIndex = 0, speedOptions = [1,2,4], health = 82, weather = 'CLEAR', soundOn = false;
let lastSim = performance.now(), toastTimer, orbiting = false, followTarget = null;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1c302c');
scene.fog = new THREE.FogExp2('#1b302c', .018);
const camera = new THREE.PerspectiveCamera(33, 1, .1, 120);
const renderer = new THREE.WebGLRenderer({antialias:true, alpha:false, powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
$('#world-canvas').appendChild(renderer.domElement);

const ambient = new THREE.HemisphereLight('#d2e8c9','#273b35',2.05); scene.add(ambient);
const sun = new THREE.DirectionalLight('#fff0cb',3.3); sun.position.set(-7,15,8); sun.castShadow=true; sun.shadow.mapSize.set(1024,1024); sun.shadow.camera.left=-16; sun.shadow.camera.right=16; sun.shadow.camera.top=16; sun.shadow.camera.bottom=-16; sun.shadow.bias=-.0003; scene.add(sun);
const fill = new THREE.DirectionalLight('#88c9bf',1.25); fill.position.set(8,7,-10); scene.add(fill);
const world = new THREE.Group(); scene.add(world);
const creatures = [], plants = [], clouds = [];
const groundMat = new THREE.MeshStandardMaterial({color:'#718765',roughness:1});
const waterMat = new THREE.MeshPhysicalMaterial({color:'#448c85',roughness:.27,metalness:.1,transparent:true,opacity:.83,clearcoat:.6,clearcoatRoughness:.2});

function makeTerrain(){
  const water = new THREE.Mesh(new THREE.CircleGeometry(12.15,96),waterMat); water.rotation.x=-Math.PI/2; water.position.y=-.15; water.receiveShadow=true; world.add(water);
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(8.7,9.3,1.35,72,4),new THREE.MeshStandardMaterial({color:'#544d3c',roughness:.95})); lower.position.y=-.55; lower.castShadow=true; lower.receiveShadow=true; world.add(lower);
  const strata = new THREE.Mesh(new THREE.CylinderGeometry(8.85,9.05,.34,72),new THREE.MeshStandardMaterial({color:'#8c7655',roughness:1})); strata.position.y=-.18; strata.castShadow=true; world.add(strata);
  const geom=new THREE.BufferGeometry(), positions=[],indices=[],n=72,rings=22;
  for(let j=0;j<=rings;j++){
    const r=8.75*j/rings;
    for(let i=0;i<=n;i++){
      const a=i/n*Math.PI*2, variation=1+.026*Math.sin(a*5)+.018*Math.cos(a*9+1.4);
      const rr=r*variation, edge=Math.max(0,1-r/8.9);
      const h=.12+Math.sin(a*3+1)*.12+Math.cos(a*5-.5)*.09+Math.sin(r*1.1+a*2)*.045+Math.pow(edge,.5)*.45;
      positions.push(Math.cos(a)*rr,h,Math.sin(a)*rr);
      if(j<rings&&i<n){const p=j*(n+1)+i;indices.push(p,p+n+1,p+1,p+1,p+n+1,p+n+2)}
    }
  }
  geom.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); geom.setIndex(indices); geom.computeVertexNormals();
  const terrain=new THREE.Mesh(geom,groundMat); terrain.receiveShadow=true; terrain.castShadow=true; world.add(terrain);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(8.65,.17,8,90),new THREE.MeshStandardMaterial({color:'#9cae76',roughness:.85})); rim.rotation.x=Math.PI/2; rim.position.y=.23; rim.castShadow=true; world.add(rim);
  const baseRing=new THREE.Mesh(new THREE.TorusGeometry(9.1,.12,8,90),new THREE.MeshStandardMaterial({color:'#b8a77c',roughness:.7,metalness:.12}));baseRing.rotation.x=Math.PI/2;baseRing.position.y=-1.05;world.add(baseRing);
  for(let i=0;i<24;i++){
    const a=i/24*Math.PI*2, r=8.95, x=Math.cos(a)*r,z=Math.sin(a)*r;
    const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(.22+Math.random()*.32,0),new THREE.MeshStandardMaterial({color:i%2?'#736e5b':'#8b8064',roughness:1})); rock.position.set(x,-.23+Math.random()*.23,z); rock.scale.set(1,.7,.85); rock.rotation.set(Math.random(),Math.random(),Math.random()); rock.castShadow=true;world.add(rock);
  }
  // Floating observatory halo
  const halo=new THREE.Mesh(new THREE.TorusGeometry(12.8,.012,4,144),new THREE.MeshBasicMaterial({color:'#8dc6a0',transparent:true,opacity:.42})); halo.rotation.x=Math.PI/2;halo.position.y=-.7;world.add(halo);
  for(let i=0;i<9;i++){
    const a=i/9*Math.PI*2;
    const dot=new THREE.Mesh(new THREE.SphereGeometry(.055,8,8),new THREE.MeshBasicMaterial({color:'#c6e8ac'}));dot.position.set(Math.cos(a)*12.8,-.69,Math.sin(a)*12.8);world.add(dot);
  }
}
function makeTree(x,z,scale=1){
  const g=new THREE.Group(), trunk=new THREE.Mesh(new THREE.CylinderGeometry(.075*scale,.14*scale,.85*scale,6),new THREE.MeshStandardMaterial({color:'#776044',roughness:1}));trunk.position.y=.46*scale;trunk.castShadow=true;g.add(trunk);
  const colors=['#4f7656','#628759','#769a60'];
  for(let i=0;i<3;i++){const crown=new THREE.Mesh(new THREE.IcosahedronGeometry((.43-i*.045)*scale,1),new THREE.MeshStandardMaterial({color:colors[(i+Math.floor(Math.random()*2))%3],roughness:.95}));crown.position.set((Math.random()-.5)*.17*scale,(.82+i*.29)*scale,(Math.random()-.5)*.15*scale);crown.scale.set(1,.92,1);crown.castShadow=true;g.add(crown)}
  g.position.set(x,0,z);g.rotation.y=Math.random()*6.28;world.add(g);plants.push({group:g,phase:Math.random()*6});return g;
}
function makeShrub(x,z,scale=1){const group=new THREE.Group();for(let i=0;i<3;i++){const leaf=new THREE.Mesh(new THREE.IcosahedronGeometry(.22*scale,1),new THREE.MeshStandardMaterial({color:i===1?'#91a968':'#75955e',roughness:1}));leaf.position.set((i-1)*.18*scale,.15*scale+Math.random()*.1,(Math.random()-.5)*.2);leaf.castShadow=true;group.add(leaf)}group.position.set(x,0,z);world.add(group);plants.push({group,phase:Math.random()*6});}
function makeWorld(){
  makeTerrain();
  const spots=[[ -5,-3,1.05],[-3.4,1.9,.8],[1.7,-4.5,.9],[4.5,-2.3,.73],[3.4,3.8,1.03],[-1.2,5,.72],[-5,2,.75],[.5,2.4,.8]];
  spots.forEach(([x,z,s],i)=>{if(i%2===0)makeTree(x,z,s);else makeShrub(x,z,s)});
  for(let i=0;i<27;i++){const a=Math.random()*Math.PI*2,r=2+Math.random()*6.4;makeShrub(Math.cos(a)*r,Math.sin(a)*r,.45+Math.random()*.5)}
  // Small crystalline spring and stepping stones
  const pool=new THREE.Mesh(new THREE.CircleGeometry(1.05,32),new THREE.MeshStandardMaterial({color:'#4ba69a',roughness:.2,metalness:.12,emissive:'#123f37',emissiveIntensity:.3}));pool.rotation.x=-Math.PI/2;pool.position.set(-.3,.22,.2);world.add(pool);
  for(let i=0;i<7;i++){const a=i/7*Math.PI*2;const stone=new THREE.Mesh(new THREE.DodecahedronGeometry(.23,0),new THREE.MeshStandardMaterial({color:'#b0a47d',roughness:.9}));stone.position.set(-.3+Math.cos(a)*1.25,.25,Math.sin(a)*1.25);stone.scale.y=.35;stone.castShadow=true;world.add(stone)}
  // A few bioluminescent flowers
  for(let i=0;i<20;i++){const a=Math.random()*6.28,r=2+Math.random()*5.8,x=Math.cos(a)*r,z=Math.sin(a)*r;const stem=new THREE.Mesh(new THREE.CylinderGeometry(.014,.02,.22,5),new THREE.MeshStandardMaterial({color:'#8ca975'}));stem.position.set(x,.12,z);world.add(stem);const bloom=new THREE.Mesh(new THREE.SphereGeometry(.08,8,8),new THREE.MeshStandardMaterial({color:i%2?'#e4be86':'#b8d7a1',emissive:i%2?'#69421d':'#31532e',emissiveIntensity:.45}));bloom.position.set(x,.26,z);world.add(bloom)}
}

const mat=(color,roughness=.7)=>new THREE.MeshStandardMaterial({color,roughness});
function makeCreature(data,index){
  const group=new THREE.Group();
  const base= new THREE.MeshStandardMaterial({color:data.color,roughness:.6});
  const dark=mat(data.dark,.76), accent=mat(data.accent,.48), black=mat('#202b27',.4), white=mat('#f3e7c7',.36);
  const bodyGeo=data.shape==='long'?new THREE.SphereGeometry(.37,14,10):new THREE.SphereGeometry(.41,14,10);
  const body=new THREE.Mesh(bodyGeo,base);body.scale.set(data.shape==='long'?1.2:1.12,.8,data.shape==='long'?.76:.93);body.position.y=.48;body.castShadow=true;group.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(data.shape==='wing'?.22:.25,12,10),base);head.position.set(.35,.62,.03);head.castShadow=true;group.add(head);
  for(const z of [-.105,.105]){const eye=new THREE.Mesh(new THREE.SphereGeometry(.052,8,8),white);eye.position.set(.48,.69,z);group.add(eye);const pupil=new THREE.Mesh(new THREE.SphereGeometry(.024,7,7),black);pupil.position.set(.51,.69,z*1.23);group.add(pupil)}
  if(data.shape==='round'){
    for(let i=0;i<4;i++){const plate=new THREE.Mesh(new THREE.SphereGeometry(.19,9,7),accent);plate.position.set(-.18+(i%2)*.28,.72+(Math.floor(i/2))*.11,(i<2?-.23:.23));plate.scale.set(1,.32,.5);group.add(plate)}
    const shell=new THREE.Mesh(new THREE.SphereGeometry(.32,12,9,0,Math.PI*2,0,Math.PI*.56),dark);shell.scale.set(1.15,.85,1);shell.position.set(-.08,.64,0);shell.castShadow=true;group.add(shell);
  } else if(data.shape==='wing'){
    for(const side of [-1,1]){const wing=new THREE.Mesh(new THREE.ConeGeometry(.18,.58,5),accent);wing.position.set(-.1,.65,side*.37);wing.rotation.z=side===1?-.7:.7;wing.rotation.x=side*.16;wing.castShadow=true;group.add(wing);const leg=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.21,5),dark);leg.position.set(-.12,.27,side*.14);leg.rotation.z=-.15;group.add(leg)}
    const antenna=new THREE.Mesh(new THREE.CylinderGeometry(.012,.018,.25,5),dark);antenna.position.set(.38,.87,0);antenna.rotation.z=-.25;group.add(antenna);
  } else {
    const tail=new THREE.Mesh(new THREE.ConeGeometry(.15,.55,7),dark);tail.position.set(-.52,.47,0);tail.rotation.z=Math.PI/2;group.add(tail);
    for(const side of [-1,1]){const fin=new THREE.Mesh(new THREE.ConeGeometry(.11,.37,5),accent);fin.position.set(-.08,.68,side*.34);fin.rotation.x=side*.8;group.add(fin)}
  }
  // Feet / legs
  if(data.shape!=='wing')for(let i=0;i<4;i++){const leg=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,.22,6),dark);leg.position.set(i<2?.21:-.23,.19,i%2===0?-.2:.2);leg.rotation.z=i<2?-.24:.24;leg.castShadow=true;group.add(leg)}
  group.scale.setScalar(data.size);
  let a=Math.random()*Math.PI*2,r=1.5+Math.random()*5.3;
  group.position.set(Math.cos(a)*r,.13,Math.sin(a)*r);group.rotation.y=Math.random()*6.28;
  world.add(group);
  const creature={group,data,phase:Math.random()*Math.PI*2,angle:a,radius:r,walk:Math.random()*6,speed:.22+Math.random()*.32,homeX:group.position.x,homeZ:group.position.z,index};creatures.push(creature);return creature;
}
function seedCreatures(){species.forEach((s,si)=>{const count=si===0?17:si===1?13:9;for(let i=0;i<count;i++)makeCreature(s,si)})}

makeWorld();seedCreatures();
const stars=new THREE.Group();scene.add(stars);
for(let i=0;i<120;i++){const a=Math.random()*6.28, y=4+Math.random()*14,r=25+Math.random()*18;const dot=new THREE.Mesh(new THREE.SphereGeometry(.025+Math.random()*.026,5,5),new THREE.MeshBasicMaterial({color:i%4===0?'#d8e6bb':'#a9c5b4',transparent:true,opacity:.3+Math.random()*.4}));dot.position.set(Math.cos(a)*r,y,Math.sin(a)*r);stars.add(dot)}

let theta=.72,phi=1.12,distance=29,target=new THREE.Vector3(0,1.15,0);
function cameraUpdate(){phi=THREE.MathUtils.clamp(phi,.38,1.48);const focus=followTarget?.group.position||target;const pos=new THREE.Vector3(focus.x+distance*Math.sin(phi)*Math.sin(theta),focus.y+distance*Math.cos(phi),focus.z+distance*Math.sin(phi)*Math.cos(theta));camera.position.copy(pos);camera.lookAt(focus.x,focus.y+.4,focus.z)}
cameraUpdate();
function resize(){const box=$('#world-canvas').getBoundingClientRect();if(!box.width||!box.height)return;camera.aspect=box.width/box.height;camera.updateProjectionMatrix();renderer.setSize(box.width,box.height,false)}
window.addEventListener('resize',resize);new ResizeObserver(resize).observe($('#world-canvas'));resize();

const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2();let downX=0,downY=0,dragged=false;
renderer.domElement.addEventListener('pointerdown',e=>{orbiting=true;dragged=false;downX=e.clientX;downY=e.clientY;renderer.domElement.setPointerCapture(e.pointerId)});
renderer.domElement.addEventListener('pointermove',e=>{
  const rect=renderer.domElement.getBoundingClientRect();pointer.x=((e.clientX-rect.left)/rect.width)*2-1;pointer.y=-((e.clientY-rect.top)/rect.height)*2+1;
  if(orbiting){const dx=e.clientX-downX,dy=e.clientY-downY;if(Math.abs(dx)+Math.abs(dy)>3)dragged=true;if(dragged){theta-=dx*.006;phi+=dy*.005;downX=e.clientX;downY=e.clientY;followTarget=null;cameraUpdate()}}
  const hits=raycaster.setFromCamera(pointer,camera);const objects=creatures.map(c=>c.group);const hit=hits.intersectObjects(objects,true)[0];if(hit){const c=creatures.find(v=>v.group===hit.object||v.group.children.includes(hit.object));if(c){ui.tooltip.style.display='block';ui.tooltip.style.left=`${e.clientX-rect.left}px`;ui.tooltip.style.top=`${e.clientY-rect.top}px`;ui.tooltip.textContent=`${c.data.name.toUpperCase()} · OBSERVE`;renderer.domElement.style.cursor='pointer';return}}
  ui.tooltip.style.display='none';renderer.domElement.style.cursor=orbiting?'grabbing':'grab';
});
renderer.domElement.addEventListener('pointerup',e=>{if(orbiting&&!dragged){const rect=renderer.domElement.getBoundingClientRect();pointer.x=((e.clientX-rect.left)/rect.width)*2-1;pointer.y=-((e.clientY-rect.top)/rect.height)*2+1;raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(creatures.map(c=>c.group),true)[0];if(hit){const c=creatures.find(v=>v.group===hit.object||v.group.children.includes(hit.object));if(c){selected=c.data;renderInspector();followTarget=c;cameraUpdate();toast(`Observing ${selected.name.toLowerCase()} in the wild`)}}}orbiting=false;renderer.domElement.style.cursor='grab'});
renderer.domElement.addEventListener('pointercancel',()=>orbiting=false);
renderer.domElement.addEventListener('wheel',e=>{distance=THREE.MathUtils.clamp(distance+e.deltaY*.018,16,42);followTarget=null;cameraUpdate();e.preventDefault()},{passive:false});

function renderInspector(){
  ui.speciesList.innerHTML='';species.forEach(s=>{const row=document.createElement('div');row.className='species-row'+(s===selected?' selected':'');row.innerHTML=`<div class="species-orb" style="background:${s.color}28;color:${s.accent}">${s.symbol}</div><div class="species-copy"><strong>${s.name}</strong><small>${s.kind}</small></div><div class="species-number">${s.population}<small>individuals</small></div>`;row.addEventListener('click',()=>{selected=s;renderInspector();const c=creatures.find(x=>x.data===s);if(c){followTarget=c;cameraUpdate()}});ui.speciesList.appendChild(row)});
  ui.speciesCount.textContent=String(species.length).padStart(2,'0');ui.selectedName.textContent=selected.name;ui.selectedIcon.textContent=selected.symbol;ui.selectedIcon.style.color=selected.accent;ui.selectedIcon.style.background=`${selected.color}45`;ui.selectedDesc.textContent=selected.description;ui.selectedPop.textContent=selected.population;ui.selectedLife.innerHTML=`${selected.lifespan} <i>yrs</i>`;ui.selectedAdapt.innerHTML=`${selected.adapt}<i>%</i>`;
  const total=species.reduce((n,s)=>n+s.population,0);ui.population.textContent=total.toLocaleString();ui.biodiversity.textContent=Math.min(99,Math.round(46+species.length*8+species.reduce((n,s)=>n+s.adapt,0)/20));ui.healthFill.style.width=`${health}%`;ui.health.textContent=health>72?'Thriving':health>45?'Recovering':'At risk';
}
function addEvent(label,text){const row=document.createElement('div');row.className='event-item';row.innerHTML=`<time>${label}</time><p>${text}</p>`;ui.events.prepend(row);while(ui.events.children.length>3)ui.events.lastElementChild.remove()}
addEvent('DAY 128','<b>Canopy bloom</b> — new growth across the eastern grove.');addEvent('DAY 124','<b>Skydarters</b> reached a new migration range.');addEvent('DAY 119','<b>Rainfall</b> replenished the spring.');
renderInspector();

function showToast(message){ui.toast.textContent=message;ui.toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>ui.toast.classList.remove('show'),2500)}
function openModal(content){$('#modal-content').innerHTML=content;$('#modal-backdrop').hidden=false}
function closeModal(){$('#modal-backdrop').hidden=true}
$('#modal-backdrop').addEventListener('click',e=>{if(e.target===$('#modal-backdrop'))closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
function editSpecies(){
  const s=selected;
  openModal(`<div class="modal-header"><div><span class="eyebrow">GENETIC STEWARDSHIP</span><h2>Shape an evolution.</h2></div><button class="modal-close" aria-label="Close">×</button></div><p class="modal-copy">Nudge <b>${s.name}</b> toward a new adaptation. Every advantage has a cost — the living world will respond over time.</p><div class="trait-row"><div class="trait-label"><span>Movement speed</span><output id="speed-value">${s.traits.speed}%</output></div><input id="trait-speed" type="range" min="10" max="100" value="${s.traits.speed}"><div class="trait-help">Faster species find food and evade danger, but burn more energy.</div></div><div class="trait-row"><div class="trait-label"><span>Natural armor</span><output id="armor-value">${s.traits.armor}%</output></div><input id="trait-armor" type="range" min="10" max="100" value="${s.traits.armor}"><div class="trait-help">A protective shell improves survival, though it may slow growth.</div></div><div class="trait-row"><div class="trait-label"><span>Foraging instinct</span><output id="forage-value">${s.traits.forage}%</output></div><input id="trait-forage" type="range" min="10" max="100" value="${s.traits.forage}"><div class="trait-help">Better foragers thrive when the habitat is under pressure.</div></div><div class="modal-footer"><button class="modal-action cancel-edit">CANCEL</button><button class="modal-action primary" id="apply-traits">APPLY CHANGES</button></div>`);
  $('#modal-content .modal-close').onclick=closeModal;$('#modal-content .cancel-edit').onclick=closeModal;
  [['speed','speed-value'],['armor','armor-value'],['forage','forage-value']].forEach(([key,out])=>$('#trait-'+key).addEventListener('input',e=>$('#'+out).textContent=e.target.value+'%'));
  $('#apply-traits').onclick=()=>{s.traits.speed=+$('#trait-speed').value;s.traits.armor=+$('#trait-armor').value;s.traits.forage=+$('#trait-forage').value;s.adapt=Math.min(99,Math.round((s.traits.speed+s.traits.armor+s.traits.forage)/3));s.lifespan=Math.max(4,Math.round(5+s.traits.armor*.18));health=Math.min(98,health+2);addEvent(`DAY ${day}`,`<b>${s.name}</b> — genetic traits adjusted by the overseer.`);renderInspector();closeModal();showToast(`${s.name}’s traits have been set in motion.`)};
}
$('#edit-selected').addEventListener('click',editSpecies);$('#edit-species-shortcut').addEventListener('click',editSpecies);
$('#observe-selected').addEventListener('click',()=>{const c=creatures.find(x=>x.data===selected);if(c){followTarget=c;cameraUpdate();showToast(`Following ${selected.name.toLowerCase()} — drag to look around`)}});
$('#focus-button').addEventListener('click',()=>{followTarget=null;theta=.72;phi=1.12;distance=29;target.set(0,1.15,0);cameraUpdate();showToast('World view centered')});
$('#camera-button').addEventListener('click',e=>{e.currentTarget.classList.toggle('active');showToast(e.currentTarget.classList.contains('active')?'Orbit camera enabled':'Orbit camera locked')});
$('#fullscreen-button').addEventListener('click',()=>{const host=$('.world-view');if(!document.fullscreenElement)host.requestFullscreen?.();else document.exitFullscreen?.()});
$('#sound-toggle').addEventListener('click',e=>{soundOn=!soundOn;e.currentTarget.style.color=soundOn?'#b9dfa2':'';showToast(soundOn?'Ambient sound enabled':'Ambient sound muted')});
$('#play-button').addEventListener('click',e=>{paused=!paused;e.currentTarget.textContent=paused?'▶':'Ⅱ';e.currentTarget.setAttribute('aria-label',paused?'Resume simulation':'Pause simulation');lastSim=performance.now();showToast(paused?'Simulation paused':'Simulation resumed')});
$('#speed-button').addEventListener('click',()=>{speedIndex=(speedIndex+1)%speedOptions.length;$('.speed-button b').textContent=speedOptions[speedIndex];showToast(`Simulation speed ×${speedOptions[speedIndex]}`)});
$('#intervene-button').addEventListener('click',()=>openModal(`<div class="modal-header"><div><span class="eyebrow">A GENTLE HAND</span><h2>Influence the world.</h2></div><button class="modal-close" aria-label="Close">×</button></div><p class="modal-copy">Your interventions shift the conditions, not the outcome. The ecosystem decides what happens next.</p><div class="modal-options"><button class="intervention-option" data-action="seed"><span class="option-icon">✿</span><span><strong>Seed the grove</strong><small>New growth and a modest population boost</small></span></button><button class="intervention-option" data-action="rain"><span class="option-icon">☂</span><span><strong>Call gentle rain</strong><small>Restore habitat health and replenish the spring</small></span></button><button class="intervention-option" data-action="meteor"><span class="option-icon">✦</span><span><strong>Send a meteor shower</strong><small>A dramatic stress test — risk and opportunity</small></span></button><button class="intervention-option" data-action="mutation"><span class="option-icon">⌘</span><span><strong>Inspire a mutation</strong><small>A small evolutionary leap for ${selected.name}</small></span></button></div>`));
$('#modal-content').addEventListener('click',e=>{if(e.target.closest('.modal-close'))closeModal();const option=e.target.closest('.intervention-option');if(!option)return;const action=option.dataset.action;
  if(action==='seed'){health=Math.min(99,health+3);species.forEach(s=>s.population+=Math.ceil(s.population*.025));for(let i=0;i<2;i++)makeCreature(selected,i);weather='BLOOM';$('#weather-icon').textContent='✿';$('#weather-label').textContent='BLOOM';addEvent(`DAY ${day}`,`<b>Seeded grove</b> — fresh growth is spreading through the biome.`);showToast('New growth is taking root.');}
  if(action==='rain'){health=Math.min(99,health+12);weather='RAIN';$('#weather-icon').textContent='☂';$('#weather-label').textContent='LIGHT RAIN';addEvent(`DAY ${day}`,`<b>Gentle rain</b> — the spring is full and the canopy is drinking.`);showToast('The habitat is recovering with the rain.');}
  if(action==='meteor'){health=Math.max(39,health-11);species.forEach(s=>s.population=Math.max(8,Math.round(s.population*(.91+Math.random()*.04))));weather='CLEAR';$('#weather-icon').textContent='☄';$('#weather-label').textContent='AFTERGLOW';addEvent(`DAY ${day}`,`<b>Meteor shower</b> — the ecosystem is adapting after a close pass.`);showToast('The world endured a sudden stress test.');}
  if(action==='mutation'){selected.adapt=Math.min(99,selected.adapt+5);selected.population+=Math.ceil(selected.population*.015);selected.traits.forage=Math.min(100,selected.traits.forage+5);addEvent(`DAY ${day}`,`<b>${selected.name}</b> — a spontaneous mutation improves foraging.`);showToast(`${selected.name} discovered a new advantage.`)}
  renderInspector();closeModal();
});
$('#help-button').addEventListener('click',()=>openModal(`<div class="modal-header"><div><span class="eyebrow">OBSERVER'S FIELD GUIDE</span><h2>Watch. Wonder. Nudge.</h2></div><button class="modal-close" aria-label="Close">×</button></div><p class="modal-copy">You are the steward of a small living world. Life moves on its own — your job is to notice what changes and decide when to lend a hand.</p><div class="help-grid"><div class="help-tile"><b>01 / OBSERVE</b><p>Drag the world to orbit. Scroll to zoom. Click a creature to follow it.</p></div><div class="help-tile"><b>02 / EVOLVE</b><p>Choose a species, then tune its traits in the genetic editor.</p></div><div class="help-tile"><b>03 / INTERVENE</b><p>Seed growth, bring rain, inspire a mutation, or challenge the ecosystem.</p></div><div class="help-tile"><b>04 / LET GO</b><p>Pause, slow down, or simply watch the world find its own balance.</p></div></div><div class="modal-footer"><button class="modal-action primary modal-close-action">BACK TO THE WORLD</button></div>`));
$('#modal-content').addEventListener('click',e=>{if(e.target.closest('.modal-close-action')||e.target.closest('.modal-close'))closeModal()});
$('#settings-button').addEventListener('click',()=>openModal(`<div class="modal-header"><div><span class="eyebrow">OBSERVATORY SETTINGS</span><h2>Your point of view.</h2></div><button class="modal-close" aria-label="Close">×</button></div><p class="modal-copy">Tune the observatory for a comfortable watch.</p><div class="trait-row"><div class="trait-label"><span>Ambient atmosphere</span><output id="ambience-value">${soundOn?'ON':'OFF'}</output></div><input id="ambience-setting" type="range" min="0" max="1" value="${soundOn?1:0}"></div><div class="trait-row"><div class="trait-label"><span>Simulation speed</span><output>×${speedOptions[speedIndex]}</output></div><p class="trait-help">Use the speed control in the timeline to cycle between ×1, ×2 and ×4.</p></div><div class="modal-footer"><button class="modal-action primary modal-close-action">DONE</button></div>`));
$('#modal-content').addEventListener('input',e=>{if(e.target.id==='ambience-setting'){soundOn=+e.target.value>0;$('#ambience-value').textContent=soundOn?'ON':'OFF';$('#sound-toggle').style.color=soundOn?'#b9dfa2':''}});

const rainDrops=[];
for(let i=0;i<75;i++){const drop=new THREE.Mesh(new THREE.CylinderGeometry(.008,.008,.22,4),new THREE.MeshBasicMaterial({color:'#b8dfdc',transparent:true,opacity:.32}));drop.visible=false;drop.position.set((Math.random()-.5)*18,Math.random()*12,(Math.random()-.5)*18);drop.rotation.x=-.15;scene.add(drop);rainDrops.push(drop)}
let simAccumulator=0,lastEventDay=day;
function stepDay(){
  day++;
  // Gentle, stochastic population drift gives the world its own momentum.
  species.forEach(s=>{const pressure=(health-60)*.0007;const delta=Math.random()<.54?1:-1;s.population=Math.max(9,Math.round(s.population*(1+pressure)+delta));if(Math.random()<.09)s.adapt=Math.min(99,s.adapt+1)});
  if(day%17===0){const s=species[Math.floor(Math.random()*species.length)];const notes=[`<b>${s.name}</b> — a small new generation joined the habitat.`,`<b>${s.name}</b> — a new foraging path was discovered.`,`<b>Seasonal shift</b> — ${s.name.toLowerCase()} are adapting to longer days.`];addEvent(`DAY ${day}`,notes[Math.floor(Math.random()*notes.length)]);}
  if(day%95===0&&weather!=='RAIN'){weather='CLEAR';$('#weather-icon').textContent='☀';$('#weather-label').textContent='CLEAR'}
  renderInspector();
}
function animate(now){
  requestAnimationFrame(animate);
  const dt=Math.min(.05,(now-lastSim)/1000);lastSim=now;
  if(!paused){simAccumulator+=dt*speedOptions[speedIndex];if(simAccumulator>2.8){simAccumulator=0;stepDay()}}
  const t=now*.001;
  for(const c of creatures){
    const speed=c.speed*(c.data.traits.speed/50);c.angle+=dt*speed*.12;
    c.radius+=Math.sin(t*.28+c.phase)*dt*.045;c.radius=THREE.MathUtils.clamp(c.radius,1.3,6.6);
    const x=Math.cos(c.angle+c.phase*.2)*c.radius+Math.sin(t*.3+c.phase)*.24;
    const z=Math.sin(c.angle+c.phase*.2)*c.radius+Math.cos(t*.25+c.phase)*.24;
    c.group.position.x=THREE.MathUtils.lerp(c.group.position.x,x,Math.min(1,dt*.65));c.group.position.z=THREE.MathUtils.lerp(c.group.position.z,z,Math.min(1,dt*.65));
    c.group.position.y=.12+Math.sin(t*2.7+c.phase)*.07;
    c.group.rotation.y=Math.atan2(Math.cos(c.angle+c.phase*.2),-Math.sin(c.angle+c.phase*.2));c.group.rotation.z=Math.sin(t*2+c.phase)*.035;
    if(c.data.shape==='wing'){const flap=Math.sin(t*12+c.phase)*.16;c.group.children.forEach(child=>{if(child.geometry.type==='ConeGeometry'&&child.geometry.parameters.height===.58)child.rotation.z=(child.position.z>0?-.7:.7)+flap})}
  }
  plants.forEach(p=>{p.group.rotation.z=Math.sin(t*.6+p.phase)*.012});
  rainDrops.forEach((d,i)=>{d.visible=weather==='RAIN';if(d.visible){d.position.y-=dt*7;if(d.position.y<-.3){d.position.y=8+Math.random()*5;d.position.x=(Math.random()-.5)*18;d.position.z=(Math.random()-.5)*18}}});
  if(weather==='RAIN'){sun.intensity=2.2}else if(sun.intensity<3.2)sun.intensity=THREE.MathUtils.lerp(sun.intensity,3.3,dt*.4);
  stars.rotation.y=Math.sin(t*.025)*.035;
  const elapsed=day-128,year=4+Math.floor(elapsed/365),doy=(108+elapsed%365+365)%365,month=Math.min(11,Math.floor(doy/30.4));
  const season=month>=2&&month<=4?'SPRING':month>=5&&month<=7?'SUMMER':month>=8&&month<=10?'AUTUMN':'WINTER';
  ui.timeSub.innerHTML=`YEAR ${String(year).padStart(2,'0')} <b>·</b> ${season}`;
  ui.day.textContent=day;ui.time.textContent=`DAY ${day}`;ui.date.textContent=`${['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][month]} ${String(doy%30+1).padStart(2,'0')}, YEAR ${String(year).padStart(2,'0')}`;
  ui.progress.style.width=`${Math.max(4,Math.min(98,(day%182)/182*100))}%`;ui.marker.style.left=ui.progress.style.width;ui.marker.querySelector('span').textContent='NOW';
  cameraUpdate();renderer.render(scene,camera);
}
requestAnimationFrame(animate);
