import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const view = document.querySelector('#view');
const status = document.querySelector('#status');
const route = document.querySelector('#route');
const routeControls = document.querySelector('#route-controls');
const stops = {
  front: {eye:[2,25,16], aim:[0,20,-37], label:'Plaza Mayor façade'},
  west: {eye:[-42,29,-10], aim:[-14,21,-40], label:'West tower and roof'},
  rear: {eye:[0,35,-67], aim:[-2,19,-44], label:'Rear courtyard'},
  east: {eye:[42,29,-13], aim:[14,21,-43], label:'East tower and roof'},
  roof: {eye:[1,64,-12], aim:[0,17,-47], label:'Roof and courtyards'}
};
const buttons = [...document.querySelectorAll('[data-view]')];
// Surface elevations sampled every two metres along the inspected street line.
const streetHeights = [
  .33,.33,.31,.26,.24,.23,.11,.08,.04,-.03,-.04,-.10,-.05,-.10,-.14,-.18,
  -.12,-.20,-.24,-.22,-.21,-.26,-.14,-.23,-.26,-.30,-.32,-.32,-.37,-.37,-.38,-.41,-.50
];

async function start() {
  const renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  view.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa6b9ca);
  const camera = new THREE.PerspectiveCamera(47,1,.15,200);
  const controls = new OrbitControls(camera,renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = 12;
  controls.maxDistance = 72;
  controls.maxPolarAngle = Math.PI*.53;
  const draw = () => renderer.render(scene,camera);
  controls.addEventListener('change',draw);
  const draco = new DRACOLoader().setDecoderPath('./vendor/draco/');
  try {
    const survey = await new GLTFLoader().setDRACOLoader(draco).loadAsync('data/panaderia/exterior.glb');
    scene.add(survey.scene);
  } finally {
    draco.dispose();
  }

  let onStreet = false;
  let heading=Math.PI/2+.24, pitch=.055;
  const keys=new Set();
  function drawStreet() {
    const x=Number(route.value);
    const index=(x+32)/2;
    const first=Math.min(streetHeights.length-2,Math.floor(index));
    const floor=THREE.MathUtils.lerp(streetHeights[first],streetHeights[first+1],index-first);
    camera.position.set(x,floor+1.75,-79-.18*x);
    camera.rotation.set(pitch,heading,0,'YXZ');
    draw();
  }
  function select(key) {
    onStreet=key==='street';
    controls.enabled=!onStreet;
    routeControls.hidden=!onStreet;
    keys.clear();
    for(const button of buttons)button.setAttribute('aria-pressed',String(button.dataset.view===key));
    if(onStreet) {
      status.textContent='Calle Mayor scan preview · W/S to walk along the street · Drag to look';
      drawStreet();
      view.focus();
      return;
    }
    const stop=stops[key];
    camera.position.fromArray(stop.eye);
    controls.target.fromArray(stop.aim);
    controls.update();
    status.textContent=stop.label+' · Drag to orbit · Scroll to zoom';
    draw();
  }
  for(const button of buttons){
    button.onclick=()=>select(button.dataset.view);
    button.disabled=false;
  }
  route.oninput=drawStreet;
  view.addEventListener('keydown',event=>{
    const key=event.key.toLowerCase();
    if(!onStreet||!['w','s'].includes(key))return;
    event.preventDefault();
    keys.add(key);
  });
  window.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur',()=>keys.clear());
  view.addEventListener('blur',()=>keys.clear());
  const canvas=renderer.domElement;
  canvas.addEventListener('pointerdown',event=>{
    if(!onStreet)return;
    view.focus();
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if(!onStreet||!canvas.hasPointerCapture(event.pointerId))return;
    heading-=event.movementX*.004;
    pitch=THREE.MathUtils.clamp(pitch-event.movementY*.004,-.45,.75);
    drawStreet();
  });
  let last=performance.now(), streetPosition=Number(route.value);
  route.addEventListener('input',()=>{streetPosition=Number(route.value);});
  function frame(now) {
    const dt=Math.min(.05,(now-last)/1000);
    last=now;
    if(onStreet&&keys.size) {
      streetPosition=THREE.MathUtils.clamp(streetPosition+(Number(keys.has('s'))-Number(keys.has('w')))*2.5*dt,-32,32);
      route.value=streetPosition;
      drawStreet();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  new ResizeObserver(()=>{
    renderer.setSize(view.clientWidth,view.clientHeight,false);
    camera.aspect=view.clientWidth/view.clientHeight;
    camera.updateProjectionMatrix();
    draw();
  }).observe(view);
  select('front');
}

start().catch(error=>{
  console.error(error);
  status.textContent='The exterior survey could not load. Check the local model files and WebGL support.';
});
