import * as THREE from './vendor/three/build/three.module.js';

// Local layout in metres. North is the existing photo-matched wall at z=0.
export const plazaBounds = {west:-61,east:61,north:0,south:92};
const {west,east,north,south} = plazaBounds;
const walls = [
  {id:'west',start:[west,south],end:[west,north]},
  {id:'east',start:[east,north],end:[east,south]},
  {id:'south',start:[east,south],end:[west,south]},
  {id:'north',start:[west,north],end:[east,north]}
];

// The two towers on the Casa de la Carnicería follow the visible roof edge
// in Luis García's photograph. Coordinates use its 1200-pixel reference.
const southTowerEdges = [
  [198,310],[216,253],[207,244],[255,240],[264,225],[262,217],[282,205],
  [302,123],[302,114],[308,107],[312,79],[314,78],[311,113],
  [309,123],[309,208],[317,223],[319,232],[330,243],[345,254],[340,263],[352,294],[340,310],
  [898,308],[911,284],[905,281],[933,236],[930,228],[944,218],[943,210],
  [951,197],[950,105],[942,99],[946,91],[941,64],[944,63],[950,92],
  [954,100],[954,108],[978,193],[986,204],[983,212],[997,216],[1009,222],
  [1049,223],[1037,246],[1049,304]
];
const southRoof = southTowerEdges.map(([x,y])=>[.245+x/2000,Math.max(23,23+(312-.013*x-y)/18)]);

function outlineOpening(shape,length,heightScale,[left,right,top,shoulder]) {
  const x0=left/1525*length, x1=right/1525*length;
  const elevation = row => (160-row)*265/160/33*heightScale;
  shape.lineTo(x0,0);
  if(shoulder===undefined){
    shape.lineTo(x0,elevation(top));
    shape.lineTo(x1,elevation(top));
  }else{
    const mid=(x0+x1)/2, radius=(x1-x0)/2;
    const base=elevation(shoulder), crown=elevation(top);
    shape.lineTo(x0,base);
    for(let i=1;i<=24;i++){
      const angle=Math.PI*i/24;
      shape.lineTo(mid-radius*Math.cos(angle),base+(crown-base)*Math.sin(angle));
    }
  }
  shape.lineTo(x1,0);
}

function texturedWall(texture,rearTexture,stone,northPhoto,alignment,profile,range) {
  const [from,to] = range;
  const length = Math.hypot(alignment.end[0]-alignment.start[0],alignment.end[1]-alignment.start[1]);
  const heightScale=.79;
  const wall = new THREE.Shape();
  wall.moveTo(from*length,0);
  for(const edge of profile.openings){
    if(edge[0]/1525<=from || edge[1]/1525>=to)continue;
    outlineOpening(wall,length,heightScale,edge);
  }
  wall.lineTo(to*length,0);
  wall.lineTo(to*length,23*heightScale);
  if(alignment.id==='south'){
    for(const [u,y] of southRoof.slice().reverse())wall.lineTo(u*length,y*heightScale);
  }
  wall.lineTo(from*length,23*heightScale);
  wall.closePath();
  const solid = new THREE.ExtrudeGeometry(wall,{depth:.77,bevelEnabled:false});
  solid.scale(1,1,-1);
  const position=solid.attributes.position;
  // Keep the upper silhouette tight to the photo when seen from below.
  for(let i=0;i<position.count;i++){
    if(position.getY(i)>20*heightScale)position.setZ(i,position.getZ(i)*.16);
  }
  const uv=solid.attributes.uv;
  const normals=solid.attributes.normal;
  for(let i=0;i<position.count;i++){
    const x=position.getX(i), y=position.getY(i), z=position.getZ(i);
    if(Math.abs(normals.getZ(i))>.95)uv.setXY(i,x/length,y/(37*heightScale));
    else uv.setXY(i,(x+z)/1.27,(y+z*.17)/2.35);
  }
  if(alignment.id==='north'){
    // The cornice and eaves in the reference sit at image rows 500 and 290.
    for(let i=0;i<position.count;i++){
      const localX=position.getX(i)-length/2;
      const raw=position.getY(i)/heightScale;
      const rise=raw<6 ? raw/6*1.38 : raw<19 ? 1.38 : Math.max(0,1.38*(23-raw)/4);
      const influence=1-THREE.MathUtils.smoothstep(Math.abs(localX),23,57);
      position.setY(i,position.getY(i)+rise*influence);
    }
    solid.computeVertexNormals();
  }
  const colour = new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide});
  if(alignment.id==='north'){
    colour.onBeforeCompile=shader=>{
      shader.uniforms.northPhoto={value:northPhoto};
      shader.vertexShader='varying vec3 place;\n'+shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nplace=(modelMatrix*vec4(position,1.0)).xyz;');
      shader.fragmentShader='varying vec3 place; uniform sampler2D northPhoto;\n'+shader.fragmentShader.replace(
        '#include <map_fragment>',`#include <map_fragment>
        vec2 pixel=vec2(466.0,625.0)+vec2(place.x,-place.y)/.049;
        float edge=smoothstep(1.0,9.0,min(pixel.x,950.0-pixel.x));

        diffuseColor.rgb=mix(diffuseColor.rgb,texture2D(northPhoto,
          vec2(pixel.x/950.0,1.0-pixel.y/632.0)).rgb,edge);
      `);
    };
  }
  const returnStone=new THREE.MeshStandardMaterial({map:stone,color:'#858786',roughness:1,side:THREE.DoubleSide});
  if(alignment.id==='south'){
    const clipSky=`
      if(roofUv.y>20.8/37.0 && roofColour.g>.34 &&
        roofColour.g-roofColour.r>.115 && roofColour.b-roofColour.g>.027) discard;
    `;
    colour.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
        vec2 roofUv=vMapUv;
        vec3 roofColour=diffuseColor.rgb;
        ${clipSky}
      `);
    };
    returnStone.onBeforeCompile=shader=>{
      shader.uniforms.roofPhoto={value:texture};
      shader.vertexShader='varying vec2 roofUv;\n'+shader.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
          roofUv=position.xy/vec2(${length.toFixed(2)},${(37*heightScale).toFixed(4)});
        `);
      shader.fragmentShader='varying vec2 roofUv; uniform sampler2D roofPhoto;\n'+shader.fragmentShader.replace(
        '#include <map_fragment>',`#include <map_fragment>
          vec3 roofColour=texture2D(roofPhoto,roofUv).rgb;
          ${clipSky}
        `);
    };
  }
  const group=new THREE.Group();
  group.add(new THREE.Mesh(solid,[colour,returnStone]));

  // Keep the unique photographed storefront behind each opening. Recessing
  // the whole row gives the pillars and jambs visible depth while walking.
  const rearWidth=(to-from)*length;
  const rear=new THREE.PlaneGeometry(rearWidth,12*heightScale);
  const rearUv=rear.attributes.uv;
  for(let i=0;i<rearUv.count;i++){
    rearUv.setXY(i,from+rearUv.getX(i)*(to-from),rearUv.getY(i));
  }
  const backing=new THREE.Mesh(rear,new THREE.MeshBasicMaterial({map:rearTexture,color:'#a29b91'}));
  backing.position.set((from+to)*length/2,6*heightScale,-3.95);
  group.add(backing);
  for(const end of [from,to]){
    const cap=new THREE.Mesh(new THREE.BoxGeometry(.1,9,4.05),returnStone);
    cap.position.set(end*length,4.5,-2);
    group.add(cap);
  }
  const ceiling=new THREE.Mesh(new THREE.BoxGeometry(rearWidth,.13,3.83),
    new THREE.MeshStandardMaterial({color:'#594f44',roughness:1}));
  const tallestOpening=Math.max(...profile.openings.map(([, ,top])=>(160-top)*265/160/33*heightScale));
  ceiling.position.set((from+to)*length/2,tallestOpening+.12,-2.35);
  group.add(ceiling);

  const arcadeFloor=new THREE.PlaneGeometry(rearWidth,4.2);
  const floorUv=arcadeFloor.attributes.uv;
  for(let i=0;i<floorUv.count;i++)floorUv.setXY(i,floorUv.getX(i)*rearWidth/1.8,floorUv.getY(i)*2.3);
  const landing=new THREE.Mesh(arcadeFloor,new THREE.MeshBasicMaterial({map:stone,color:'#9e9285'}));
  landing.rotation.x=-Math.PI/2;
  landing.position.set((from+to)*length/2,-.005,-1.91);
  group.add(landing);
  const dx=alignment.end[0]-alignment.start[0],dz=alignment.end[1]-alignment.start[1];
  group.position.set(alignment.start[0],0,alignment.start[1]);
  group.rotation.y=-Math.atan2(dz,dx);
  return group;
}

export async function loadPlazaWalls(loader,renderer,stone,paving,northPhoto) {
  const group=new THREE.Group();
  const response=await fetch('data/panaderia/plaza-openings.json');
  if(!response.ok)throw new Error('Could not load the Plaza Mayor opening profiles');
  const profiles=await response.json();
  const results=await Promise.all(walls.map(async alignment=>{
    const prefix='data/panaderia/plaza-'+alignment.id;
    const [texture,rearTexture]=await Promise.all([
      loader.loadAsync(alignment.id==='south'?prefix+'-frontage.jpg':'data/panaderia/courtyard-'+alignment.id+'.jpg'),loader.loadAsync(prefix+'-arcade.jpg')
    ]);
    for(const map of [texture,rearTexture]){
      map.colorSpace=THREE.SRGBColorSpace;
      map.anisotropy=renderer.capabilities.getMaxAnisotropy();
    }
    return {alignment,texture,rearTexture};
  }));
  for(const {alignment,texture,rearTexture} of results){
    const intervals=alignment.id==='north'?[[0,(61-418*.049)/122],[(61+420*.049)/122,1]]:[[0,1]];
    for(const pair of intervals)group.add(texturedWall(texture,rearTexture,stone,northPhoto,alignment,profiles[alignment.id],pair));
  }
  group.add(await loadPlazaPaving(loader,renderer,paving));
  return group;
}

export async function loadPlazaPaving(loader,renderer,paving) {
  const [aerial, photographedPaving, filmedStone] = await Promise.all([
    loader.loadAsync('data/plaza-mayor-ortho-2024.jpg'),
    loader.loadAsync('data/plaza-paving-photo-2020.webp'),
    loader.loadAsync('data/plaza-interior/cobbles.jpg')
  ]);
  filmedStone.colorSpace=THREE.SRGBColorSpace;
  filmedStone.wrapS=filmedStone.wrapT=THREE.MirroredRepeatWrapping;
  filmedStone.anisotropy=renderer.capabilities.getMaxAnisotropy();
  photographedPaving.colorSpace = THREE.SRGBColorSpace;
  photographedPaving.anisotropy = renderer.capabilities.getMaxAnisotropy();
  aerial.colorSpace=THREE.SRGBColorSpace;
  aerial.anisotropy=renderer.capabilities.getMaxAnisotropy();
  const detail=paving.clone();
  detail.wrapS=detail.wrapT=THREE.MirroredRepeatWrapping;
  detail.needsUpdate=true;
  const surface=new THREE.MeshBasicMaterial({map:aerial});
  surface.onBeforeCompile=shader=>{
    shader.uniforms.pavingDetail={value:detail};
    shader.uniforms.videoGrain={value:filmedStone};
    shader.uniforms.groundPhoto={value:photographedPaving};
    shader.vertexShader='varying vec3 pavingPoint; varying vec3 pavingView;\n'+shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\npavingPoint=vec3(position.x,-.012,46.-position.y); pavingView=(modelViewMatrix*vec4(position,1.)).xyz;');
    shader.fragmentShader='varying vec3 pavingPoint; varying vec3 pavingView; uniform sampler2D pavingDetail; uniform sampler2D groundPhoto; uniform sampler2D videoGrain;\n'+shader.fragmentShader.replace(
      '#include <map_fragment>',`
      vec2 p=vec2(pavingPoint.x-.065*pavingPoint.z,pavingPoint.z-31.0+.065*pavingPoint.x);
      vec2 ortho=vec2((874.24+p.x/.11366469)/1792.0,1.0-(597.46+p.y/.11366469)/1280.0);
      vec3 regional=texture2D(map,ortho).rgb;
      vec3 detail=texture2D(pavingDetail,pavingPoint.xz/1.55).rgb;
      float pattern=smoothstep(.2,.73,dot(regional,vec3(.25,.65,.10)));
      float border=min(61.0-abs(pavingPoint.x),min(pavingPoint.z,92.0-pavingPoint.z));
      float distantDetail=mix(.20,.68,1.0-smoothstep(8.0,42.0,length(pavingView)));
      float surfaceDetail=clamp(dot(detail,vec3(.333))/.47,.66,1.35);
      vec3 paved=vec3(.315,.289,.266)
        *mix(1.0,.50+pattern*.82,smoothstep(1.0,5.5,border))
        *mix(1.0,surfaceDetail,distantDetail);
      paved*=mix(.66,1.0,smoothstep(.04,2.6,border));
      // Same 25 by 16 metre ground controls as the street survey.
      vec2 photoUV=vec2((p.x-8.0)/25.0,1.0-(p.y-23.0)/16.0);
      vec4 photo=texture2D(groundPhoto,photoUV);
      vec2 edge=min(photoUV,1.0-photoUV)*vec2(25.0,16.0);
      float coverage=smoothstep(0.0,1.25,min(edge.x,edge.y))*photo.a;
      // Retain the site lighting across captures taken under different skies.
      float photoLight=dot(photo.rgb,vec3(.2126,.7152,.0722));
      float stoneContrast=clamp(.76+.44*photoLight,.76,1.2);
      // Bring captured stone grain through the feathered photograph boundary.
      vec2 stoneUV=pavingPoint.xz/.96;
      float grain=dot(texture2D(videoGrain,stoneUV).rgb-texture2D(videoGrain,stoneUV,3.0).rgb,vec3(.2126,.7152,.0722));
      paved*=1.0+clamp(grain,-.3,.3)*.48*(1.0-smoothstep(5.,18.,length(pavingView)));
      diffuseColor.rgb=mix(paved,paved*stoneContrast,coverage);
      `);
  };
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(132,103),surface);
  floor.name='Plaza paving';
  floor.rotation.x=-Math.PI/2;
  floor.position.set(0,-.012,46);
  return floor;
}
