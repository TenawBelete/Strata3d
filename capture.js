import * as T from 'three';
import {OBJLoader} from './vendor/three/examples/jsm/loaders/OBJLoader.js';
import {MTLLoader} from './vendor/three/examples/jsm/loaders/MTLLoader.js';

async function loadCatalog(){
  const response=await fetch('./captures/release.json');
  if(!response.ok)return;
  for(const slug of await response.json()){
    const option=document.createElement('option');
    option.value=slug;
    document.querySelector('#available').append(option);
  }
}
loadCatalog().catch(()=>{ /* Direct links also work without the list. */ });

const id = new URLSearchParams(location.search).get('scene');
const status = document.querySelector('[role=status]');
if (id && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
  document.querySelector('input').value = id;
  explore().catch(error => {status.textContent = 'Could not open capture. '+error.message;});
}

async function explore(){
  status.textContent = 'Loading reconstructed geometry…';
  const base = new URL('./captures/'+id+'/',location.href);
  const response = await fetch(new URL('scene.json',base));
  if(!response.ok) throw Error('Check the scene name and build output.');
  const info = await response.json();
  const manager = new T.LoadingManager();
  manager.setURLModifier(path=>{
    const url=new URL(path,base);
    if(!url.href.startsWith(base.href))throw Error('Asset outside capture folder.');
    return url.href;
  });
  const materials=await new MTLLoader(manager).loadAsync(new URL(info.material,base).href);
  const world=await new OBJLoader(manager).setMaterials(materials).loadAsync(new URL(info.mesh,base).href);
  const canvas=document.querySelector('canvas');
  const renderer=new T.WebGLRenderer({canvas,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  const scene=new T.Scene();
  scene.background=new T.Color(0x27303a);
  // The capture's colour atlas already contains the illumination of the take.
  // Preserve its exposure and use the mesh only to change the viewpoint.
  const surfaces=new Map();
  function photographed(material){
    if(!surfaces.has(material)){
      const map=material.map;
      if(map)map.anisotropy=renderer.capabilities.getMaxAnisotropy();
      surfaces.set(material,new T.MeshBasicMaterial({map,color:material.color}));
    }
    return surfaces.get(material);
  }
  world.traverse(object=>{
    if(object.isMesh)object.material=Array.isArray(object.material)
      ? object.material.map(photographed) : photographed(object.material);
  });
  scene.add(world);
  const box=new T.Box3().setFromObject(world);
  const size=box.getSize(new T.Vector3()).length();
  const camera=new T.PerspectiveCamera(65,1,size*.0001,size*8);
  const poses=info.cameras;
  const first=new T.Vector3().fromArray(poses[0].position);
  // Monocular captures have no gravity reference. Express both geometry and
  // navigation in the opening camera frame before applying a level walk.
  const firstOrientation=new T.Quaternion().fromArray(poses[0].rotation);
  world.quaternion.copy(firstOrientation).invert();
  world.position.copy(first).negate().applyQuaternion(world.quaternion);
  const pathLength=poses.slice(1).reduce((sum,p,i)=>sum+new T.Vector3().fromArray(p.position).distanceTo(new T.Vector3().fromArray(poses[i].position)),0);
  const speed=Math.max(size*.012,pathLength/Math.max(1,info.frames/info.fps));
  const keys=new Set();
  const rotation=new T.Euler(0,0,0,'YXZ');
  let reference=0;
  const image=document.querySelector('#source');
  const compare=document.querySelector('#compare');
  function place(index){
    const pose=poses[index];
    camera.position.fromArray(pose.position).sub(first).applyQuaternion(world.quaternion);
    camera.quaternion.fromArray(pose.rotation).premultiply(world.quaternion);
    rotation.setFromQuaternion(camera.quaternion,'YXZ');
    image.hidden=true;
    compare.textContent='Show source frame';
    canvas.focus();
  }
  if(info.references?.length){
    compare.hidden=false;
    const next=document.querySelector('#next');next.hidden=false;
    next.onclick=()=>{
      reference=(reference+1)%info.references.length;
      place(info.references[reference].camera);
    };
    compare.onclick=()=>{
      if(image.hidden){
        const ref=info.references[reference];
        place(ref.camera);
        image.src=new URL(ref.image,base);
        image.hidden=false;
        compare.textContent='Show mesh';
      }else place(info.references[reference].camera);
    };
  }
  function reset(){
    reference=0;
    place(0);
  }
  document.querySelector('#reset').hidden=false;
  document.querySelector('#reset').onclick=reset;
  reset();
  canvas.onkeydown=e=>{if(['KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE','ArrowLeft','ArrowRight'].includes(e.code)){e.preventDefault();keys.add(e.code);}};
  canvas.onkeyup=e=>keys.delete(e.code);
  canvas.onblur=()=>keys.clear();
  canvas.onpointerdown=e=>{canvas.focus();canvas.setPointerCapture(e.pointerId);};
  canvas.onpointermove=e=>{if(canvas.hasPointerCapture(e.pointerId)){rotation.y-=e.movementX*.003;rotation.x=T.MathUtils.clamp(rotation.x-e.movementY*.003,-1.5,1.5);}};
  const resize=()=>{renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();};
  resize();window.addEventListener('resize',resize);
  const axis=(a,b)=>Number(keys.has(a))-Number(keys.has(b));
  const step=new T.Vector3();
  let last=performance.now();
  renderer.setAnimationLoop(now=>{
    const dt=Math.min(.05,(now-last)/1000);last=now;
    rotation.y+=dt*1.6*axis('ArrowLeft','ArrowRight');
    camera.quaternion.setFromEuler(rotation);
    step.set(axis('KeyD','KeyA'),axis('KeyE','KeyQ'),axis('KeyS','KeyW')).clampLength(0,1);
    step.applyAxisAngle(T.Object3D.DEFAULT_UP,rotation.y);
    camera.position.addScaledVector(step,speed*dt);
    renderer.render(scene,camera);
  });
  status.textContent='WASD move · drag to look · Q/E down/up · '+info.source;
}
