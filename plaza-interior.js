import {buildPlazaRoad} from './plaza-road.js?v=market-villa-1';
// Elevations rectified from Impressions from Everywhere's Madrid walking tour
// (CC Attribution, https://youtu.be/nf77WWWmvBI, Plaza Mayor chapter).
export async function buildPlazaInterior(T,loader,renderer){
  const group=new T.Group();
  const response=await fetch('data/panaderia/plaza-openings.json');
  if(!response.ok)throw new Error('Plaza Mayor arcade profiles are unavailable');
  const profiles=await response.json();
  async function load(path){
    const texture=await loader.loadAsync(path);
    texture.colorSpace=T.SRGBColorSpace;
    texture.anisotropy=renderer.capabilities.getMaxAnisotropy();
    return texture;
  }
  const [stone,arches]=await Promise.all([load('data/panaderia/stone-return.jpg'),load('data/plaza-interior/north-arcades.webp')]);
  stone.wrapS=stone.wrapT=T.RepeatWrapping;
  const jamb=new T.MeshBasicMaterial({map:stone,color:0xb4ada5,side:T.DoubleSide});
  const walls=[
    ['north',-61,0,122,0],['east',61,0,92,-Math.PI/2],
    ['south',61,92,122,Math.PI],['west',-61,92,92,Math.PI/2]
  ];
  await Promise.all(walls.map(async ([side,x,z,length,yaw])=>{
    const [upper,front,back]=await Promise.all([
      load('data/plaza-interior/'+side+'.webp'),
      load('data/panaderia/plaza-'+side+'-frontage.jpg'),
      load('data/panaderia/plaza-'+side+'-arcade.jpg')
    ]);
    const wall=new T.Group();
    wall.position.set(x,0,z);wall.rotation.y=yaw;
    group.add(wall);
    const opening=profiles[side].openings.map(([l,r,top,shoulder])=>({
      l:l/1525*length,r:r/1525*length,
      top:(160-top)*.0396,spring:shoulder===undefined?null:(160-shoulder)*.0396
    }));
    if(side==='north'){
      // Eleven bays visible between the two towers of the Casa de la Panadería.
      for(const [left,right] of [[22,79],[105,146],[172,216],[243,286],[312,357],[382,425],[452,494],[522,563],[592,633],[662,704],[731,780]]){
        opening.push({l:length/3*(1+left/800),r:length/3*(1+right/800),top:3.9,spring:2.9});
      }
    }
    // The captured entrance occupies metres 25–33 along the south wall.
    const bays=opening.filter(b=>side!=='south'||b.r<=25||b.l>=33);
    if(side==='south')bays.push({l:25,r:33,top:6.2,spring:null});
    const outline=new T.Shape();outline.moveTo(0,0);
    let end=0;
    for(const b of bays.sort((a,b)=>a.l-b.l)){
      if(b.l<end)continue;
      outline.lineTo(b.l,0);
      if(b.spring===null){
        outline.lineTo(b.l,b.top);outline.lineTo(b.r,b.top);
      }else{
        for(let j=0;j<=18;j++){
          const angle=j*Math.PI/18;
          outline.lineTo((b.l+b.r)/2-(b.r-b.l)/2*Math.cos(angle),b.spring+(b.top-b.spring)*Math.sin(angle));
        }
      }
      outline.lineTo(b.r,0);end=b.r;
    }
    outline.lineTo(length,0);outline.lineTo(length,19.15);outline.lineTo(0,19.15);outline.closePath();
    const geometry=new T.ExtrudeGeometry(outline,{depth:.65,bevelEnabled:false});
    const pos=geometry.attributes.position,norm=geometry.attributes.normal,uv=geometry.attributes.uv;
    for(let i=0;i<pos.count;i++){
      if(Math.abs(norm.getZ(i))>.9)uv.setXY(i,pos.getX(i)/length,pos.getY(i));
      else uv.setXY(i,(pos.getX(i)+pos.getZ(i))*.6,(pos.getY(i)+pos.getZ(i))*.6);
    }
    const facing=new T.MeshBasicMaterial({map:front,side:T.DoubleSide});
    facing.onBeforeCompile=s=>{
      s.uniforms.videoWall={value:upper};
      s.uniforms.arcadePhoto={value:arches};
      s.fragmentShader='uniform sampler2D videoWall; uniform sampler2D arcadePhoto;\n'+s.fragmentShader.replace('#include <map_fragment>',`
        vec3 base=texture2D(map,vec2(vMapUv.x,vMapUv.y/29.23)).rgb;
        ${side==='north'?'if(vMapUv.x>=1./3. && vMapUv.x<=2./3.)base=texture2D(arcadePhoto,vec2(vMapUv.x*3.-1.,clamp(vMapUv.y/4.85,0.,1.))).rgb;':''}
        vec3 filmed=texture2D(videoWall,vec2(vMapUv.x,clamp((vMapUv.y-4.8)/14.35,0.,1.))).rgb;
        diffuseColor.rgb*=mix(base,filmed,smoothstep(4.65,4.95,vMapUv.y));`);
    };
    wall.add(new T.Mesh(geometry,[facing,jamb]));
    facing.customProgramCacheKey=()=>side;
    const rear=new T.MeshBasicMaterial({map:back,color:0xbcb5ac,side:T.DoubleSide});
    if(side==='north'){
      const insideMaterial=new T.MeshBasicMaterial({map:arches});
      const centers=[50,125,194,264,334,403,473,542,612,683,755];
      centers.forEach((center,i)=>{
        const left=i?(centers[i-1]+center)/2:0;
        const right=i<10?(centers[i+1]+center)/2:800;
        const g=new T.PlaneGeometry((right-left)*length/2400,4.8);
        const uv=g.attributes.uv;
        for(let j=0;j<uv.count;j++)uv.setXY(j,(center-12+24*uv.getX(j))/800,.21+.48*uv.getY(j));
        const door=new T.Mesh(g,insideMaterial);
        door.position.set(length/3*(1+(left+right)/1600),2.4,-2.9);
        wall.add(door);
      });
    }
    for(const [start,finish] of side==='south'?[[0,25],[33,length]]:side==='north'?[[0,191/1525*length],[259/1525*length,length]]:side==='west'?[[0,1273/1525*length],[1382/1525*length,length]]:[[0,length]]){
      const width=finish-start,g=new T.PlaneGeometry(width,8);
      const u=g.attributes.uv;
      for(let i=0;i<u.count;i++)u.setX(i,(start+u.getX(i)*width)/length);
      const face=new T.Mesh(g,rear);face.position.set((start+finish)/2,4,-3.2);wall.add(face);
      const soffit=new T.Mesh(new T.BoxGeometry(width,.14,3.85),jamb);
      soffit.position.set((start+finish)/2,5.8,-1.28);wall.add(soffit);
    }
  }));
  group.add(await buildPlazaRoad(T,loader,renderer));
  return group;
}
