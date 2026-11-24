// The corridor follows the open Calle Mayor ways in the OSM extract.
// Heights are IGN MDT02 plus the project's measured ellipsoid offset.
export async function loadCalleMayor(T,renderer,ellipsoid){
  const loader=new T.TextureLoader();
  const styles=["cream","rose","stone-house","yellow-house","tavern","museum"];
  const [route,ortho,stone,asphalt,buildings,fronts]=await Promise.all([
    fetch('data/calle-mayor/route.json').then(r=>{if(!r.ok)throw Error('Calle Mayor route unavailable');return r.json();}),
    loader.loadAsync('data/calle-mayor/surface.webp'),loader.loadAsync('data/plaza-interior/cobbles.jpg'),
    loader.loadAsync('data/market-route/asphalt.webp'),
    fetch('data/calle-mayor/buildings.json').then(r=>r.json()),
    Promise.all(styles.map(name=>loader.loadAsync('data/market-route/'+name+'.webp')))
  ]);
  for(const texture of [ortho,stone,asphalt]){
    texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=renderer.capabilities.getMaxAnisotropy();
  }
  for(const texture of [stone,asphalt])texture.wrapS=texture.wrapT=T.MirroredRepeatWrapping;
  // Same Y-up ECEF orientation as the streaming globe.
  const points=route.points.map(([lat,lon,height])=>{
    const v=new T.Vector3();ellipsoid.getCartographicToPosition(lat*Math.PI/180,lon*Math.PI/180,height,v);
    return v.set(v.x,v.z,-v.y);
  });
  const origin=points[0],total=route.points.at(-1)[3],pos=[],uv=[],detail=[],index=[];
  const roadWidth=kind=>kind==='tertiary'?4.15:kind==='residential'?3:4.6;
  const basis=points.map((p,i)=>{
    const tangent=points[Math.min(i+1,points.length-1)].clone().sub(points[Math.max(0,i-1)]).normalize();
    return tangent.cross(p.clone().normalize()).normalize(); // right of the westbound walker
  });
  for(let i=0;i<points.length;i++){
    const [,,,dist,kind]=route.points[i],w=roadWidth(kind),outer=w+(kind==='pedestrian'?1:2);
    for(const offset of [-outer,-w,0,w,outer]){
      const pt=points[i].clone().addScaledVector(basis[i],offset).sub(origin);pos.push(...pt.toArray());
      uv.push(.5-offset/22,1-dist/total);
      detail.push(offset,dist,kind==='pedestrian'?0:1,w);
    }
    if(i)for(let j=0;j<4;j++){
      const a=(i-1)*5+j,b=a+5;index.push(a,b,b+1,a,b+1,a+1);
    }
  }
  const geom=new T.BufferGeometry();
  geom.setAttribute('position',new T.Float32BufferAttribute(pos,3));geom.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  geom.setAttribute('roadDetail',new T.Float32BufferAttribute(detail,4));geom.setIndex(index);
  const material=new T.MeshBasicMaterial({map:ortho,side:T.DoubleSide});
  material.onBeforeCompile=s=>{
    s.uniforms.cobbles={value:stone};s.uniforms.asphalt={value:asphalt};
    s.vertexShader='attribute vec4 roadDetail; varying vec4 detail;\n'+s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ndetail=roadDetail;');
    s.fragmentShader='uniform sampler2D cobbles;uniform sampler2D asphalt;varying vec4 detail;\n'+s.fragmentShader.replace('#include <map_fragment>',`
      vec3 aerial=texture2D(map,vMapUv).rgb;
      float carriage=(1.-smoothstep(detail.w-.12,detail.w+.12,abs(detail.x)))*detail.z;
      vec3 filmed=mix(texture2D(cobbles,detail.xy/.96).rgb,texture2D(asphalt,detail.xy/1.5).rgb,carriage);
      diffuseColor.rgb=filmed*mix(.72,1.48,smoothstep(.07,.65,dot(aerial,vec3(.25,.65,.1))));
    `);
  };
  const surface=new T.Mesh(geom,material);surface.position.copy(origin);surface.visible=false;
  // Build the complete neighbourhood before entering Run. All geometry is
  // relative to the first station so centimetre detail survives GPU precision.
  const up=origin.clone().normalize();
  const east=new T.Vector3(-origin.z,0,origin.x).negate().normalize();
  const north=new T.Vector3().crossVectors(up,east).normalize();
  const local=points.map(p=>p.clone().sub(origin));
  const stations=local.map(p=>new T.Vector2(p.dot(east),p.dot(north)));
  function ground(x,y){
    let best=Infinity,height=0;
    for(let i=0;i<stations.length;i++){
      const d=(stations[i].x-x)**2+(stations[i].y-y)**2;
      if(d<best){best=d;height=local[i].dot(up);}
    }
    return height;
  }
  function vertex(x,y,h){return east.clone().multiplyScalar(x).addScaledVector(north,y).addScaledVector(up,h).toArray();}
  const batches=Array.from({length:styles.length+2},()=>({pos:[],uv:[]}));
  function face(batch,verts,coords,indices){
    for(const i of indices){batch.pos.push(...verts[i]);batch.uv.push(...coords[i]);}
  }
  const quad=[0,1,2,0,2,3], roof=batches[styles.length],base=batches.at(-1);
  for(const [id,[height,ring]] of buildings.entries()){
    const z=ring.map(([x,y])=>ground(x,y)),top=Math.max(...z)+height;
    for(let j=0;j<ring.length;j++){
      const k=(j+1)%ring.length,[x,y]=ring[j],[xx,yy]=ring[k],n=Math.max(1,Math.round(Math.hypot(xx-x,yy-y)/13));
      face(batches[id%styles.length],[vertex(x,y,z[j]-2),vertex(xx,yy,z[k]-2),vertex(xx,yy,top),vertex(x,y,top)],[[0,0],[n,0],[n,1],[0,1]],quad);
    }
    const tris=T.ShapeUtils.triangulateShape(ring.map(([x,y])=>new T.Vector2(x,y)),[]);
    face(roof,ring.map(([x,y])=>vertex(x,y,top)),ring.map(()=>[0,0]),tris.flat());
  }
  for(let x=-1100;x<160;x+=10)for(let y=-350;y<160;y+=10){
    const ring=[[x,y],[x+10,y],[x+10,y+10],[x,y+10]];
    face(base,ring.map(([a,b])=>vertex(a,b,ground(a,b)-.85)),ring.map(([a,b])=>[a/2,b/2]),quad);
  }
  const materials=fronts.map(map=>{
    map.colorSpace=T.SRGBColorSpace;map.wrapS=T.RepeatWrapping;map.anisotropy=renderer.capabilities.getMaxAnisotropy();
    return new T.MeshBasicMaterial({map,side:T.DoubleSide});
  });
  materials.push(new T.MeshBasicMaterial({color:0x937060,side:T.DoubleSide}),new T.MeshBasicMaterial({map:stone,side:T.DoubleSide}));
  batches.forEach((batch,i)=>{
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(batch.pos,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(batch.uv,2));surface.add(new T.Mesh(g,materials[i]));
  });
  // Register the photographed north arch to the plaza end of Siete de Julio.
  const archX=-61+225/1525*122;
  const right=east.clone().multiplyScalar(Math.cos(.065)).addScaledVector(north,-Math.sin(.065));
  const back=north.clone().multiplyScalar(-Math.cos(.065)).addScaledVector(east,-Math.sin(.065));
  function geo(lat,lon){
    const v=new T.Vector3();
    ellipsoid.getCartographicToPosition(lat*Math.PI/180,lon*Math.PI/180,0,v);
    return v.set(v.x,v.z,-v.y);
  }
  const at=geo(40.4157571,-3.707947),join=geo(40.4161249,-3.7080199);
  const near=points.reduce((a,b)=>b.distanceToSquared(join)<a.distanceToSquared(join)?b:a);
  join.normalize().multiplyScalar(near.length());
  at.normalize().multiplyScalar(join.length());
  const frame=new T.Matrix4().makeBasis(right,up,back).setPosition(at.clone().addScaledVector(right,-archX));
  const inverse=frame.clone().invert(),mouth=join.clone().applyMatrix4(inverse);
  const corridor=new T.Group();corridor.position.setFromMatrixPosition(frame).sub(origin);
  corridor.quaternion.setFromRotationMatrix(frame);surface.add(corridor);
  const path=[[archX,.8],[archX,-5.8],[mouth.x,mouth.z+4],[mouth.x,mouth.z]];
  const clipMatrix=inverse.clone().multiply(new T.Matrix4().makeTranslation(...origin.toArray()));
  for(const m of materials){
    m.onBeforeCompile=shader=>{
      shader.uniforms.plazaFrame={value:clipMatrix};
      shader.vertexShader='uniform mat4 plazaFrame;varying vec3 plazaPoint;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nplazaPoint=(plazaFrame*vec4(position,1.)).xyz;');
      shader.fragmentShader='varying vec3 plazaPoint;\n'+shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
        float x=mix(${archX.toFixed(4)},${mouth.x.toFixed(4)},clamp((plazaPoint.z+5.8)/${(mouth.z+9.8).toFixed(4)},0.,1.));
        if((abs(plazaPoint.x)<61.4 && plazaPoint.z>-.2 && plazaPoint.z<92.4) ||
           (abs(plazaPoint.x-x)<3.05 && plazaPoint.z<=.8 && plazaPoint.z>${mouth.z.toFixed(4)})) discard;`);
    };
  }
  function panel(verts,mat,u,v){
    const batch={pos:[],uv:[]};face(batch,verts,[[0,0],[u,0],[u,v],[0,v]],quad);
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(batch.pos,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(batch.uv,2));corridor.add(new T.Mesh(g,mat));
  }
  const paving=new T.MeshBasicMaterial({map:stone,side:T.DoubleSide});
  const frontsHere=[fronts[0],fronts[2]].map(map=>new T.MeshBasicMaterial({map,side:T.DoubleSide}));
  const stoneWall=new T.MeshBasicMaterial({map:stone,color:0x9e9588,side:T.DoubleSide});
  for(let i=1;i<path.length;i++){
    const [a,z]=path[i-1],[b,w]=path[i],length=Math.hypot(a-b,z-w);
    panel([[a-3,.025,z],[a+3,.025,z],[b+3,.025,w],[b-3,.025,w]],paving,5,length/.98);
    for(const side of [-1,1]){
      const l=a+3*side,r=b+3*side,h=i===1?5.9:13;
      panel([[l,0,z],[r,0,w],[r,h,w],[l,h,z]],i===1?stoneWall:frontsHere[(side+1)/2],i===1?4:Math.max(1,Math.round(length/12)),1);
    }
    if(i===1)panel([[a-3,5.9,z],[a+3,5.9,z],[b+3,5.9,w],[b-3,5.9,w]],stoneWall,4,4);
  }
  const courtyardStart=new T.Vector3(archX,0,24).applyMatrix4(frame);
  let courtyard;
  function attachCourtyard(plaza){
    courtyard=plaza.visuals;plaza.setEntrance(true);
    courtyard.position.setFromMatrixPosition(frame);courtyard.quaternion.copy(corridor.quaternion);
    courtyard.visible=true;courtyard.updateMatrixWorld(true);
    plaza.updateMonument(new T.Vector3(archX,1.75,24));
  }
  const offset=new T.Vector3(),delta=new T.Vector3(),nearest=new T.Vector3();
  function sample(p){
    const localPoint=offset.copy(p).applyMatrix4(inverse);
    if(courtyard && ((Math.abs(localPoint.x)<62 && localPoint.z>=0 && localPoint.z<93) || (localPoint.z>=mouth.z && localPoint.z<1 && Math.abs(localPoint.x-archX)<13))){
      localPoint.y=0;return localPoint.applyMatrix4(frame).length();
    }
    let min=Infinity,segment=0;
    for(let i=1;i<points.length;i++){
      delta.subVectors(points[i],points[i-1]);offset.subVectors(p,points[i-1]);
      const t=T.MathUtils.clamp(offset.dot(delta)/delta.lengthSq(),0,1);
      offset.addScaledVector(delta,-t);
      if(offset.lengthSq()<min){min=offset.lengthSq();segment=i;nearest.copy(points[i-1]).addScaledVector(delta,t);}
    }
    const right=basis[segment],width=roadWidth(route.points[segment][4]);
    const lateral=Math.abs(offset.subVectors(p,nearest).dot(right));
    if(lateral>width+2 || min>144)return null;
    return nearest.length();
  }
  function stop(){surface.visible=false;if(courtyard)courtyard.visible=false;}
  return {surface,sample,stop,attachCourtyard,courtyardStart,exit:at};
}
