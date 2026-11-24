import {gradeCourtyard} from './courtyard-weather.js';
import * as THREE from './vendor/three/build/three.module.js';

export async function courtyardPhotograph(texture, floor, monument, loader, renderer) {
  const scene=new THREE.Scene();
  scene.background=new THREE.Color('#5979ae');
  scene.add(floor.clone());
  const sculpture=monument.clone();
  sculpture.rotation.y=0;
  sculpture.position.set(-1.9,-2.67,29.35);
  // The survey tile includes visitors and paving outside the monument footprint.
  sculpture.updateMatrixWorld(true);
  sculpture.traverse(mesh=>{
    if(!mesh.isMesh)return;
    mesh.material=mesh.material.clone();
    const courtyardMatrix=mesh.matrixWorld.clone();
    mesh.material.onBeforeCompile=shader=>{
      shader.uniforms.courtyardMatrix={value:courtyardMatrix};
      shader.vertexShader='uniform mat4 courtyardMatrix; varying vec3 monumentPoint;\n'+shader.vertexShader.replace(
        '#include <begin_vertex>','#include <begin_vertex>\nmonumentPoint=(courtyardMatrix*vec4(position,1.)).xyz;');
      shader.fragmentShader='varying vec3 monumentPoint;\n'+shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
          if(abs(monumentPoint.x) > 2.9 || abs(monumentPoint.z-40.) > 2.35 || monumentPoint.y < .08) discard;`);
    };
    mesh.material.transparent=true;
  });
  scene.add(sculpture);
  const front=await loader.loadAsync('data/panaderia/felipe-front.webp');
  front.colorSpace=THREE.SRGBColorSpace;
  front.anisotropy=renderer.capabilities.getMaxAnisotropy();
  const portrait=new THREE.Mesh(new THREE.PlaneGeometry(8.5,11.08),
    new THREE.MeshBasicMaterial({map:front,transparent:true,depthWrite:false}));
  portrait.position.set(0,5.4,40);
  portrait.renderOrder=2;
  scene.add(portrait);
  const camera=new THREE.PerspectiveCamera();
  const eye=1.75, originZ=65, halfWidth=61, rearZ=92, joinZ=76;
  const returns=[
    ['west',rearZ-joinZ,-halfWidth,(rearZ+joinZ)/2,Math.PI/2],
    ['east',12,halfWidth,rearZ-6,-Math.PI/2],
    ['south',halfWidth*2,0,rearZ,Math.PI]
  ];
  // Compare median wall colours at matching balcony heights. Sampling several
  // pixels avoids matching a single window or railing at the join.
  function wallColour(image,u,row) {
    const canvas=document.createElement('canvas');
    canvas.width=23; canvas.height=5;
    const ctx=canvas.getContext('2d');
    ctx.drawImage(image,Math.max(0,Math.min(image.width-23,u*image.width-11)),
      row*image.height-2,23,5,0,0,23,5);
    const pixels=ctx.getImageData(0,0,23,5).data;
    return [0,1,2].map(channel=>{
      const values=[];
      for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>200)values.push(pixels[i+channel]);
      values.sort((a,b)=>a-b);
      return values[Math.floor(values.length/2)]??128;
    });
  }
  await Promise.all(returns.map(async ([side,width,x,z,yaw])=>{
    const map=await loader.loadAsync('data/panaderia/walk-'+side+'.webp?v=registered5');
    map.colorSpace=THREE.SRGBColorSpace;
    map.anisotropy=renderer.capabilities.getMaxAnisotropy();
    const wall=new THREE.Mesh(new THREE.PlaneGeometry(width,36),
      new THREE.MeshBasicMaterial({map,alphaTest:.5,side:THREE.DoubleSide}));
    // The slate ridge pitches down to the corner. Match its height at the
    // photographic join without moving the cornice or the openings below.
    if(side!=='south'){
      const geo=new THREE.PlaneGeometry(width,36,20,36);
      if(side==='east'){
        const uv=geo.attributes.uv;
        for(let i=0;i<uv.count;i++)uv.setX(i,.25+.75*uv.getX(i));
      }
      const pos=geo.attributes.position;
      for(let i=0;i<pos.count;i++){
        const u=geo.attributes.uv.getX(i),y=pos.getY(i)+18;
        const weight=side==='east'?(1-u)/.75:u;
        const rise=side==='east'?1.76:-.37;
        pos.setY(i,y-18+rise*weight*Math.max(0,y-19)/3);
      }
      const west=side==='west', referenceColumn=west?55:1050, eave=west?61:60;
      const sampleHeight=12;
      const reference=wallColour(texture.image,referenceColumn/1100,(153-sampleHeight*(153-eave)/19)/205);
      const actual=wallColour(map.image,west?.98:.27,1-sampleHeight/36);
      const gain=reference.map((value,i)=>THREE.MathUtils.clamp(((value+8)/(actual[i]+8))**2,.75,1.28));
      const colors=[];
      for(let i=0;i<pos.count;i++){
        const distance=west?width/2-pos.getX(i):pos.getX(i)+width/2;
        const influence=1-THREE.MathUtils.smoothstep(distance,0,6);
        colors.push(...gain.map(g=>1+(g-1)*influence));
      }
      geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
      wall.material.vertexColors=true;
      wall.geometry.dispose();
      wall.geometry=geo;
    }
    wall.position.set(x,18,z);
    wall.rotation.y=yaw;
    scene.add(wall);
  }));

  // Trace the two photograph corners and eaves. The panorama and the returns
  // terminate on identical vertical edges, including after camera translation.
  // Columns are in the 1100 px reference. Heights are in its 205 px frame.
  const corner=Math.atan2(halfWidth,originZ);
  const join=Math.atan2(halfWidth,originZ-joinZ);
  const columns=[
    [55,-join,61],[182,(-join-corner)/2,76],[317,-corner,94],
    [530,0,76],[746,corner,94],[882,(corner+join)/2,72],[1050,Math.atan2(halfWidth,originZ-80),60]
  ];
  const positions=[],uv=[],indices=[];
  const rows=100;
  let count=0;
  function addColumn(col,angle,eave){
    const dx=Math.sin(angle),dz=-Math.cos(angle);
    const depth=Math.min(halfWidth/Math.max(.00001,Math.abs(dx)),originZ/Math.max(.00001,-dz));
    for(let j=0;j<=rows;j++){
      const row=j/rows*153;
      const wallY=(153-row)*19/(153-eave);
      positions.push(dx*depth,wallY,originZ+dz*depth);
      uv.push(col/1100,1-row/205);
      if(count && j){
        const b=count*(rows+1)+j,a=b-rows-1;
        indices.push(a-1,a,b-1,b-1,a,b);
      }
    }
    count++;
  }
  columns.slice(1).forEach(([u1,a1,h1],i)=>{
    const [u0,a0,h0]=columns[i],steps=Math.ceil((u1-u0)/5);
    for(let k=i?1:0;k<=steps;k++){
      const t=k/steps;
      addColumn(u0+(u1-u0)*t,a0+(a1-a0)*t,h0+(h1-h0)*t);
    }
  });
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);
  const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,alphaTest:.48});
  scene.add(new THREE.Mesh(geometry,material));
  const draw=(renderer,width,height,pose)=>{
    camera.aspect=width/height;
    const vertical=Math.min(.32,Math.atan(Math.tan(.69)/camera.aspect));
    camera.position.set(pose.x,eye+pose.stepHeight,pose.z-7);
    updateMonument(camera.position);
    camera.rotation.set(.13+pose.pitch,pose.yaw,0,'YXZ');
    camera.fov=THREE.MathUtils.radToDeg(vertical*2);
    camera.updateProjectionMatrix();
    renderer.render(scene,camera);
  };
  function updateMonument(position){
    // The source photograph supplies detail along its captured sightline.
    // Other sightlines reveal the measured three-dimensional monument.
    const viewAngle=Math.atan2(Math.abs(position.x),position.z-40);
    const photoWeight=1-THREE.MathUtils.smoothstep(viewAngle,.10,.48);
    portrait.visible=photoWeight>0;
    portrait.material.opacity=photoWeight;
    sculpture.visible=photoWeight<1;
    if(sculpture.visible) sculpture.traverse(mesh=>{
      if(mesh.isMesh)mesh.material.opacity=1-photoWeight;
    });
  }
  draw.visuals=new THREE.Group();
  draw.visuals.add(...scene.children.slice());
  scene.add(draw.visuals);
  draw.grade=gradeCourtyard(THREE,draw.visuals);
  draw.updateMonument=updateMonument;
  draw.background=scene.background;
  return draw;
}
export function cafeTerraces(){
  const group=new THREE.Group();
  const metal=new THREE.MeshStandardMaterial({color:0x48433b,roughness:.79});
  const canvas=new THREE.MeshStandardMaterial({color:0xe8dfcd,roughness:1,flatShading:true,side:THREE.DoubleSide});
  const top=new THREE.ConeGeometry(2.35,.71,8);
  const pole=new THREE.CylinderGeometry(.035,.04,2.7,10);
  const table=new THREE.CylinderGeometry(.53,.53,.055,24);
  const tableLeg=new THREE.CylinderGeometry(.055,.09,.74,8);
  const seat=new THREE.CylinderGeometry(.24,.23,.06,16);
  const chairLeg=new THREE.CylinderGeometry(.018,.02,.44,6);
  const back=new THREE.BoxGeometry(.42,.28,.04);
  function place(geo,material,x,y,z,turn=0){
    const mesh=new THREE.Mesh(geo,material);
    mesh.position.set(x,y,z);mesh.rotation.y=turn;group.add(mesh);
  }
  for(const side of [-1,1]){
    for(const z of [24,29,34,53,58,63]){
      const x=side*54;
      place(top,canvas,x,2.87,z);place(pole,metal,x,1.35,z);
      for(const dz of [-1.1,1.1]){
        place(table,canvas,x,.76,z+dz);place(tableLeg,metal,x,.37,z+dz);
        for(const dir of [-1,1]){
          const cx=x+.85*dir;
          place(seat,metal,cx,.45,z+dz);
          place(back,metal,cx+.2*dir,.65,z+dz,Math.PI/2);
          for(const dx of [-.13,.13])for(const offset of [-.14,.14])
            place(chairLeg,metal,cx+dx,.22,z+dz+offset);
        }
      }
    }
  }
  // Batch the repeated furniture parts into one draw call for each geometry.
  const instances=new THREE.Group();
  const batches=new Map();
  for(const mesh of group.children){
    if(!batches.has(mesh.geometry))batches.set(mesh.geometry,[]);
    batches.get(mesh.geometry).push(mesh);
  }
  for(const [geometry,items] of batches){
    const batch=new THREE.InstancedMesh(geometry,items[0].material,items.length);
    items.forEach((mesh,i)=>{mesh.updateMatrix();batch.setMatrixAt(i,mesh.matrix);});
    instances.add(batch);
  }
  return instances;
}

export async function plazaMonument(){
  const [{GLTFLoader},{DRACOLoader}]=await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),import('three/addons/loaders/DRACOLoader.js')
  ]);
  const decoder=new DRACOLoader().setDecoderPath('./vendor/draco/');
  try {
    const {scene}=await new GLTFLoader().setDRACOLoader(decoder).loadAsync('data/panaderia/felipe-iii.glb');
    scene.rotation.y=.065;
    scene.position.set(2,-2.67,31);
    scene.traverse(mesh=>{
      if(mesh.isMesh)mesh.material=new THREE.MeshBasicMaterial({map:mesh.material.map});
    });
    return scene;
  }finally{decoder.dispose();}
}
