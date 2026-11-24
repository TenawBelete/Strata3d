import {buildMarketRoute} from './market-route.js';
// Calle de Ciudad Rodrigo, as seen on the walk from Plaza Mayor toward
// Mercado de San Miguel. The source is credited with the plaza imagery.
export const roadCenterZ=92*(1-1327.5/1525);
export const roadLength=34;

export async function buildPlazaRoad(T,loader,renderer){
  const group=new T.Group();
  group.position.set(-61,0,roadCenterZ);
  group.rotation.y=Math.PI/2;
  const names=['granite','street-stone','side-paving','balcony','cornice','shop','junction','opposite','red-corner','sign'];
  const materials=Object.fromEntries(await Promise.all(names.map(async name=>{
    const texture=await loader.loadAsync('data/plaza-road/'+name+'.webp');
    texture.colorSpace=T.SRGBColorSpace;
    texture.anisotropy=renderer.capabilities.getMaxAnisotropy();
    return [name,new T.MeshBasicMaterial({map:texture,side:T.DoubleSide})];
  })));
  materials.granite.color.setHex(0xbab4ac);
  const unit=new T.BoxGeometry(1,1,1);
  const batches=new Map();
  function block(material,x,y,z,w,h,d){
    if(!batches.has(material))batches.set(material,[]);
    const matrix=new T.Matrix4().makeScale(w,h,d);
    matrix.setPosition(x,y,z);batches.get(material).push(matrix);
  }
  function paving(material,center,width,length,repeatX,repeatY){
    const map=materials[material].map.clone();
    map.wrapS=map.wrapT=T.MirroredRepeatWrapping;map.repeat.set(repeatX,repeatY);
    const ground=new T.Mesh(new T.PlaneGeometry(width,length),new T.MeshBasicMaterial({map}));
    ground.rotation.x=-Math.PI/2;ground.position.set(center,.012,-length/2);
    group.add(ground);
  }
  paving('street-stone',0,5.8,roadLength+6,3,27);
  const apron=new T.Mesh(new T.PlaneGeometry(55,30),materials['street-stone'].clone());
  apron.material.map=apron.material.map.clone();apron.material.map.wrapS=apron.material.map.wrapT=T.MirroredRepeatWrapping;
  apron.material.map.repeat.set(26,22);apron.rotation.x=-Math.PI/2;apron.position.set(0,0,-47);
  group.add(apron);
  const view=new T.Mesh(new T.PlaneGeometry(16,16),materials.junction);
  view.position.set(3.5,7.95,-58);group.add(view);
  const shadow=new T.MeshBasicMaterial({color:0x45403a});
  for(const side of [-1,1]){
    paving('side-paving',side*5.05,4.3,roadLength+1,3,23);
    for(let i=0;i<9;i++){
      const z=-2.5-i*3.7;
      block(materials.granite,side*3.65,2.2,z,.72,4.4,.74);
      block(materials.granite,side*3.65,.21,z,.9,.42,.92);
      block(materials.granite,side*3.65,4.34,z,.93,.31,.95);
      block(materials.cornice,side*3.82,4.79,z,.98,.65,3.71);
      block(shadow,side*5.35,4.52,z,3.6,.18,3.71);
      block(materials.shop,side*6.92,2.2,z,.36,4.4,3.68);
      // The camera sees the first balcony along the colonnade in a grazing view.
      block(materials.balcony,side*4.12,7.45,z,.56,4.68,3.71);
      block(materials.balcony,side*4.13,11.35,z,.54,3.12,3.71);
    }
  }
  for(const [material,matrices] of batches){
    const mesh=new T.InstancedMesh(unit,material,matrices.length);
    matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));group.add(mesh);
  }
  const sign=new T.Mesh(new T.PlaneGeometry(.62,1.05),materials.sign);
  sign.position.set(3.01,.54,-11);sign.rotation.y=-.35;group.add(sign);
  const bollard=new T.SphereGeometry(.65,28,16,0,Math.PI*2,0,Math.PI/2);
  for(const x of [-1.6,1.6]){
    const cap=new T.Mesh(bollard,new T.MeshBasicMaterial({color:0x585555,map:materials.granite.map}));
    cap.position.set(x,.025,-26.3);group.add(cap);
  }
  // Separate planes across the junction preserve the gap into the next street.
  for(const [material,x,z,width,height,angle] of [
    ['opposite',-9.3,-49,21,13.5,-.08],['red-corner',10,-47,6.8,13,-.45]
  ]){
    const building=new T.Mesh(new T.BoxGeometry(width,height,3.5),materials[material]);
    building.position.set(x,height/2,z);building.rotation.y=angle;group.add(building);
  }
  group.add(await buildMarketRoute(T,loader,renderer));
  return group;
}
