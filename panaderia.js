import {presentationWeather} from './courtyard-weather.js';
import * as THREE from './vendor/three/build/three.module.js';
import {loadPlazaWalls} from './plaza-frontage-walls.js?v=registered';

import {courtyardPhotograph,cafeTerraces,plazaMonument} from './plaza-courtyard.js?v=local-run-1';

const presenting = new URLSearchParams(location.search).has('present');
if (presenting) document.body.classList.add('presenting');
const localRun=new URLSearchParams(location.search).get('mode')==='run';
const viewport = document.querySelector('#viewport');
const status = document.querySelector('#status');
const views = document.querySelector('#views');
const caption = document.querySelector('#view-caption');
const buttons = new Map(['courtyard','square','compare','walk','west','south','east','near','side'].map(id => [id,document.getElementById(id)]));
const record = document.querySelector('#record');

// Reference coordinates use a 950 by 632 image. The front wall is z=0.
// The central piers are surveyed at about 3.75 m centres, and the arcade
// depth is about 4.5 m. Coordinates below trace the photograph's inner arch edges.
const photoCentre = new THREE.Vector2(466,590);
const crop = {x:48,y:0,width:838,height:632};
const metresPerPixel = .049;
const focusDistance = 31;
const eye = 1.75;
const focal = focusDistance / metresPerPixel;
const walkingHorizontalFov = THREE.MathUtils.degToRad(46);
const walkStart = 13;
const walkSpeed = 2.3;
const frontY = v => (625-v) * metresPerPixel;
const frontX = u => (u-photoCentre.x)*metresPerPixel;
const camera = new THREE.PerspectiveCamera();
const scene = new THREE.Scene();
scene.background = new THREE.Color('#6b8bb6');
const pose = {x:0,z:focusDistance,yaw:0,pitch:0,stepHeight:0};
let mode = 'compare';
let recording = false;

// Image-space arch silhouettes, west to east. The central profiles retain
// their hand-traced control points from the close-up.
function arch(left,right,shoulder,crown){
  const centre=(left+right)/2,radius=(right-left)/2;
  const points=[[left,624]];
  for(let i=0;i<=16;i++){
    const angle=Math.PI*i/16;
    points.push([centre-radius*Math.cos(angle),shoulder-(shoulder-crown)*Math.sin(angle)]);
  }
  points.push([right,624]);
  return points;
}
const archProfiles = [
  arch(66,119,554,526),arch(139,191,555,527),arch(213,266,555,528),arch(287,340,557,530),
  [[364,624],[364,559],[366,552],[370,544],[376,538],[383,533],[390,531],[398,532],[406,536],[413,543],[415,552],[415,624]],
  [[440,624],[440,558],[443,549],[448,541],[454,535],[461,532],[468,531],[477,533],[484,539],[489,547],[491,557],[491,624]],
  [[516,624],[516,557],[519,547],[525,539],[533,533],[542,530],[550,532],[559,537],[565,545],[568,555],[568,624]],
  arch(593,645,557,530),arch(669,718,557,530),arch(743,792,555,529),arch(814,865,555,528)
];

// The whole roof silhouette is traced in the same photograph. The crests
// and tower bodies share the outline with the masonry below.
const roofProfile=[
  [48,255],[88,255],[99,210],[94,198],[106,193],[121,179],[128,168],[148,166],[153,150],[158,130],
  [155,123],[168,115],[188,51],[189,39],[191,38],[192,32],[183,31],[183,29],[193,30],[194,20],[188,19],[188,17],[194,18],[195,12],[191,11],[191,10],[195,10],[196,7],[198,7],[197,11],[204,12],[203,14],[197,13],[196,18],[205,19],[205,21],[196,20],[195,30],[201,31],[201,33],[195,32],[194,38],[196,42],[193,49],[196,114],[200,125],
  [194,136],[191,156],[187,173],[199,181],[209,181],[205,193],[209,211],[222,245],
  [448,245],[449,233],[454,224],[459,222],[460,215],[465,210],[471,213],[476,220],[480,225],[483,243],
  [713,244],[718,234],[728,221],[726,204],[722,194],[728,190],[726,181],[739,180],[742,167],[746,162],
  [740,150],[741,136],[733,126],[734,122],[740,115],[737,48],[735,42],[736,36],[737,31],[726,29],[726,27],[737,29],[736,20],[728,18],[728,16],[736,18],[735,12],[728,11],[728,9],[735,10],[735,6],[737,6],[737,10],[743,12],[743,14],[737,12],[738,18],[748,20],[748,22],[738,20],[739,29],[749,31],[749,33],[740,31],[741,35],[744,40],
  [742,48],[766,113],[771,119],[780,127],[775,133],[778,146],[784,160],[800,164],[812,181],[822,186],
  [830,189],[839,195],[832,204],[842,252],[886,252]
];

function mesh(geometry, material) {
  const item = new THREE.Mesh(geometry,material);
  scene.add(item);
  return item;
}

function loadTexture(loader,path,renderer) {
  return loader.loadAsync(path).then(texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return texture;
  });
}

function projectedMaterial(photo) {
  const material = new THREE.MeshBasicMaterial({map:photo,side:THREE.DoubleSide});
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 photoPoint;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>','#include <begin_vertex>\nphotoPoint=(modelMatrix*vec4(position,1.0)).xyz;'
    );
    shader.fragmentShader = 'varying vec3 photoPoint;\n' + shader.fragmentShader.replace(
      '#include <map_fragment>',`
      float distanceToPhoto=31.0-photoPoint.z;
      vec2 pixel=vec2(466.0,625.0-1.75/0.049)
        +${focal.toFixed(5)}*vec2(photoPoint.x,1.75-photoPoint.y)/distanceToPhoto;
      diffuseColor *= texture2D(map,vec2(pixel.x/950.0,1.0-pixel.y/632.0));
      `
    );
  };
  return material;
}

function buildArcade(photo,paving,stonePhoto,rearPhoto) {
  const facade = new THREE.Shape();
  const left=frontX(crop.x),right=frontX(crop.x+crop.width),width=right-left;
  const centre=(left+right)/2;
  facade.moveTo(left,0);
  for(const arch of archProfiles) {
    const [first,...curveAndEnd]=arch;
    facade.lineTo(frontX(first[0]),0);
    const curve=new THREE.SplineCurve(curveAndEnd.slice(0,-1).map(([u,v])=>new THREE.Vector2(frontX(u),frontY(v))));
    for(const point of curve.getPoints(48))facade.lineTo(point.x,point.y);
    facade.lineTo(frontX(arch.at(-1)[0]),0);
  }
  facade.lineTo(right,0);
  for(const [u,v] of roofProfile.slice().reverse())facade.lineTo(frontX(u),frontY(v));
  facade.closePath();

  const photographed = projectedMaterial(photo);
  stonePhoto.wrapS=stonePhoto.wrapT=THREE.MirroredRepeatWrapping;
  const stone = new THREE.MeshStandardMaterial({map:stonePhoto,color:'#a69a87',roughness:1,side:THREE.DoubleSide});
  stone.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 masonryPoint;\n'+shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nmasonryPoint=(modelMatrix*vec4(position,1.0)).xyz;');
    shader.fragmentShader='varying vec3 masonryPoint;\n'+shader.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\ndiffuseColor.rgb=texture2D(map,vec2((masonryPoint.x*.55+masonryPoint.z)/1.1,masonryPoint.y/2.65)).rgb*vec3(.68,.61,.51);')
      .replace('texture2D( map, vMapUv )','vec4(1.0)');
  };
  const solid = new THREE.ExtrudeGeometry(facade,{depth:.86,bevelEnabled:false});
  // The camera is in positive z, so extrusion runs into the wall.
  solid.scale(1,1,-1);
  const facadeMesh=mesh(solid,[photographed,stone]);

  // The rear wall receives the registered view through the openings. Keep a
  // separate surface for oblique views so the texture never caps the opening.
  const rear = mesh(new THREE.PlaneGeometry(width,8),photographed);
  rear.position.set(centre,4,-4.5);
  const rearMaterial=new THREE.MeshBasicMaterial({map:rearPhoto,color:'#bfb1a0',side:THREE.DoubleSide});
  const rearPanels=mesh(new THREE.PlaneGeometry(width,4.85),rearMaterial);
  rearPanels.position.set(centre,2.425,-4.48);
  const ceiling = mesh(new THREE.BoxGeometry(width,.15,4.65),
    new THREE.MeshStandardMaterial({color:'#786042',roughness:1}));
  ceiling.position.set(centre,5.15,-2.4);
  for(const x of [left,right]) {
    const side = mesh(new THREE.BoxGeometry(.18,8,4.6),stone);
    side.position.set(x,4,-2.3);
  }

  paving.wrapS = paving.wrapT = THREE.RepeatWrapping;
  paving.repeat.set(17,22);
  const floor=mesh(new THREE.PlaneGeometry(75,105),
    new THREE.MeshStandardMaterial({map:paving,roughness:1}));
  floor.rotation.x=-Math.PI/2;
  floor.position.z=38;

  // The matched photograph includes a narrow foreground strip. On approach
  // this strip fades out, leaving the separate paving surface.
  const nearFloor=mesh(new THREE.PlaneGeometry(width,11.9),photographed);
  nearFloor.rotation.x=-Math.PI/2;
  nearFloor.position.set(centre,.001,1.45);
  nearFloor.name='registered foreground';
  const shadowSource=document.createElement('canvas');
  shadowSource.width=256;shadowSource.height=256;
  const shadowInk=shadowSource.getContext('2d');
  const falloff=shadowInk.createRadialGradient(128,128,16,128,128,128);
  falloff.addColorStop(0,'rgba(24,18,14,.69)');
  falloff.addColorStop(.46,'rgba(24,18,14,.32)');
  falloff.addColorStop(1,'rgba(24,18,14,0)');
  shadowInk.fillStyle=falloff;shadowInk.fillRect(0,0,256,256);
  const shadowTexture=new THREE.CanvasTexture(shadowSource);
  shadowTexture.colorSpace=THREE.SRGBColorSpace;
  const shadowMaterial=new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false});
  const shadows=new THREE.Group();
  for(const u of [55,130,202,278,350,428,503,581,657,733,803,874]){
    const shadow=new THREE.Mesh(new THREE.PlaneGeometry(1.95,1.85),shadowMaterial);
    shadow.rotation.x=-Math.PI/2;shadow.position.set(frontX(u),.003,-.19);
    shadows.add(shadow);
  }
  scene.add(shadows);
  const sky = new THREE.HemisphereLight('#ece4da','#615549',2.1);
  scene.add(sky);
  return {floor,nearFloor,facadeMesh,photographed,stone,rearPanels,ceiling,shadows};
}

function moveToward(x,z) {
  pose.x=x;
  pose.z=z;
}

async function start() {
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  viewport.append(renderer.domElement);
  const loader=new THREE.TextureLoader();
  const [photo,paving,stonePhoto,rearPhoto]=await Promise.all([
    loadTexture(loader,'data/panaderia/gabaldon-reference.jpg',renderer),
    loadTexture(loader,'data/panaderia/paving-sample.jpg',renderer),
    loadTexture(loader,'data/panaderia/stone-return.jpg',renderer),
    loadTexture(loader,'data/panaderia/rear-windows-frontage.jpg',renderer)
  ]);
  const arcade=buildArcade(photo,paving,stonePhoto,rearPhoto);
  const plaza=await loadPlazaWalls(loader,renderer,stonePhoto,paving,photo);
  const photoFloor=plaza.getObjectByName('Plaza paving');
  const monument=await plazaMonument();
  plaza.add(cafeTerraces(),monument);
  scene.add(plaza);
  const squarePhoto=await courtyardPhotograph(await loadTexture(loader,'data/panaderia/courtyard-walk-registered.webp',renderer),photoFloor,monument,loader,renderer);

  function draw() {
    const width=viewport.clientWidth,height=viewport.clientHeight;
    if(renderer.domElement.width!==Math.floor(width*renderer.getPixelRatio())||renderer.domElement.height!==Math.floor(height*renderer.getPixelRatio()))renderer.setSize(width,height,false);
    if(mode==='square'){squarePhoto(renderer,width,height,pose);return;}
    camera.clearViewOffset();
    if(mode==='compare') {
      const principalY=625-eye/metresPerPixel;
      const fullHeight=2*principalY;
      camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(fullHeight/(2*focal)));
      camera.setViewOffset(2*photoCentre.x,fullHeight,crop.x,crop.y,crop.width,crop.height);
    } else {
      camera.aspect=width/height;
      // Keep the lens fixed as the eye moves through the scene.
      camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan((mode==='courtyard'?THREE.MathUtils.degToRad(65):walkingHorizontalFov)/2)/camera.aspect));
    }
    camera.position.set(pose.x,eye,pose.z);
    camera.rotation.set(pose.pitch,pose.yaw,0,'YXZ');
    camera.updateProjectionMatrix();
    const matched=mode==='compare';
    plaza.visible=!matched;
    arcade.floor.visible=matched;
    arcade.nearFloor.visible=matched;
    arcade.rearPanels.visible=!matched;
    arcade.facadeMesh.material[1]=matched?arcade.photographed:arcade.stone;
    arcade.ceiling.visible=!matched;
    arcade.shadows.visible=!matched;
    renderer.render(scene,camera);
  }

  const stops = {
    courtyard:{x:4,z:84,yaw:0,pitch:.13},
    square:{x:0,z:72,yaw:0,pitch:0},
    compare:{x:0,z:focusDistance,yaw:0,pitch:0},
    walk:{x:0,z:walkStart,yaw:0,pitch:.008},
    west:{x:-21,z:45,yaw:Math.PI/2,pitch:.08},
    east:{x:21,z:45,yaw:-Math.PI/2,pitch:.08},
    south:{x:0,z:47,yaw:Math.PI,pitch:.095},
    near:{x:.5,z:5.9,yaw:.04,pitch:.08},
    side:{x:2.85,z:6.25,yaw:.42,pitch:.045}
  };
  function select(next) {
    if(recording)return;
    mode=next;
    jumpVelocity=0;
    velocity.set(0,0);
    pose.stepHeight=0;
    Object.assign(pose,stops[next]);
    if (presenting && next==='square') Object.assign(pose,{x:23,z:74,yaw:.29,pitch:-.045});
    views.classList.toggle('walk',next!=='compare');
    for(const [name,button] of buttons) button.setAttribute('aria-pressed',String(name===next));
    document.querySelector('h1').textContent=next==='compare'?'Casa de la Panadería':'Plaza Mayor';
    caption.textContent=next==='compare'?'3D reconstruction · matched camera':'3D reconstruction · Plaza Mayor';
    status.textContent=next==='compare'?'The full frontage is shown from the same camera position.':'WASD to move · drag or use ←/→ to turn';
    if(next==='square'){caption.textContent='Plaza Mayor · photographed courtyard';status.textContent=localRun?'WASD run · Shift sprint · Space jump · ←/→ turn · drag to look':'WASD to walk · hold Shift to run · drag or use ←/→ for a full turn';}
    draw();
    if(next!=='compare')viewport.focus();
  }
  for(const [name,button] of buttons) button.onclick=()=>select(name);

  const velocity=new THREE.Vector2();
  const targetVelocity=new THREE.Vector2();

  let jumpVelocity=0;
  const keys=new Set();
  for(const event of ['keydown','keyup']) viewport.addEventListener(event,e=>{
    const key=e.key.toLowerCase();
    if(!(localRun && mode==='square' && key===' ') && !['w','a','s','d','shift','arrowleft','arrowright'].includes(key)||mode==='compare'||recording)return;
    e.preventDefault();

    if(key===' ' && event==='keydown' && !e.repeat && pose.stepHeight===0)jumpVelocity=4;
    if(event==='keydown')keys.add(key);else keys.delete(key);
  });
  viewport.addEventListener('blur',()=>keys.clear());
  viewport.onpointerdown=e=>{
    if(mode==='compare'||recording)return;
    viewport.focus();
    viewport.setPointerCapture(e.pointerId);
  };
  viewport.onpointermove=e=>{
    if(!viewport.hasPointerCapture(e.pointerId)||recording)return;
    pose.yaw-=e.movementX*.003;
    pose.pitch=THREE.MathUtils.clamp(pose.pitch-e.movementY*.003,-.55,.65);
    draw();
  };

  let drawRain;
  let previous=performance.now();
  function frame(now) {
    drawRain?.(now);
    const dt=Math.min(.05,(now-previous)/1000);
    previous=now;
    if((keys.size||velocity.lengthSq()>0||jumpVelocity!==0)&&mode!=='compare'&&!recording) {
      pose.yaw+=(Number(keys.has('arrowleft'))-Number(keys.has('arrowright')))*dt*1.1;
      const sideways=Number(keys.has('d'))-Number(keys.has('a'));
      const forward=Number(keys.has('w'))-Number(keys.has('s'));
      const sin=Math.sin(pose.yaw),cos=Math.cos(pose.yaw);
      targetVelocity.set(sideways*cos-forward*sin,-forward*cos-sideways*sin);
      targetVelocity.clampLength(0,1).multiplyScalar(mode==='square'?(keys.has('shift')?(localRun?12:4.4):(localRun?5.5:1.85)):walkSpeed);
      if(mode==='square'){
        const change=velocity.distanceTo(targetVelocity);
        if(change>0) velocity.lerp(targetVelocity,Math.min(1,7*dt/change));
      }else velocity.copy(targetVelocity);
      if(jumpVelocity!==0 && mode==='square'){
        jumpVelocity-=10*dt;
        pose.stepHeight=Math.max(0,pose.stepHeight+jumpVelocity*dt);
        if(pose.stepHeight===0)jumpVelocity=0;
      }
      moveToward(pose.x+velocity.x*dt,pose.z+velocity.y*dt);
      draw();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  new ResizeObserver(draw).observe(viewport);

  if(window.MediaRecorder&&renderer.domElement.captureStream) {
    record.hidden=false;
    record.onclick=()=>{
      select('walk');
      recording=true;
      record.disabled=true;
      status.textContent='Recording the frontage walk…';
      const stream=renderer.domElement.captureStream(30);
      const recorder=new MediaRecorder(stream);
      const chunks=[];
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      recorder.onstop=()=>{
        const url=URL.createObjectURL(new Blob(chunks,{type:recorder.mimeType}));
        const link=document.createElement('a');
        link.href=url;link.download='panaderia-frontage.webm';link.textContent='Download the frontage recording';
        status.replaceChildren(link);
        link.addEventListener('click',()=>setTimeout(()=>URL.revokeObjectURL(url),1000),{once:true});
        stream.getTracks().forEach(track=>track.stop());
        recording=false;record.disabled=false;
      };
      recorder.start();
      const first=performance.now();
      function approach(now) {
        const t=Math.min(1,(now-first)/20500);
        const forward=THREE.MathUtils.smoothstep(t,0,1);
        const lateral=THREE.MathUtils.smoothstep(t,0,1);
        Object.assign(pose,{x:THREE.MathUtils.lerp(frontX(166),frontX(765),lateral),z:walkStart-1.5*forward,yaw:THREE.MathUtils.lerp(-.17,.17,lateral),pitch:.09});
        draw();
        if(t<1)requestAnimationFrame(approach);else recorder.stop();
      }
      requestAnimationFrame(approach);
    };
  }
  select('square');
  if(presenting) drawRain=presentationWeather(renderer,squarePhoto,draw);
}

start().catch(error=>{
  console.error(error);
  status.textContent='The rebuild could not load. Check the local assets and WebGL support.';
});
