import {buildPlazaInterior} from './plaza-interior.js?v=siete-1';
import {buildEntrance} from './plaza-entrance.js';
import {courtyardPhotograph,plazaMonument,cafeTerraces} from './plaza-courtyard.js?v=run-1';
import {loadPlazaPaving} from './plaza-frontage-walls.js?v=run-1';

export async function loadPlazaRunVisuals(THREE, renderer) {
  const loader=new THREE.TextureLoader();
  const [photo,paving,monument]=await Promise.all([
    loader.loadAsync('data/panaderia/courtyard-walk-registered.webp'),
    loader.loadAsync('data/panaderia/paving-sample.jpg'),
    plazaMonument()
  ]);
  for(const texture of [photo,paving]){
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=renderer.capabilities.getMaxAnisotropy();
  }
  const floor=await loadPlazaPaving(loader,renderer,paving);
  const courtyard=await courtyardPhotograph(photo,floor,monument,loader,renderer);
  const entrance=await buildEntrance(THREE,loader,renderer);
  courtyard.visuals.add(entrance);
  entrance.visible=false;
  const rear=courtyard.visuals.children.find(mesh=>mesh.isMesh && mesh.position.z===92);
  const floorMesh=courtyard.visuals.getObjectByName('Plaza paving');
  const originalFloor=floorMesh.material;
  const filmedFloor=originalFloor.clone();
  const [interior,cobbles]=await Promise.all([
    buildPlazaInterior(THREE,loader,renderer),loader.loadAsync('data/plaza-interior/cobbles.jpg')
  ]);
  cobbles.colorSpace=THREE.SRGBColorSpace;
  cobbles.wrapS=cobbles.wrapT=THREE.MirroredRepeatWrapping;
  cobbles.anisotropy=renderer.capabilities.getMaxAnisotropy();
  filmedFloor.onBeforeCompile=shader=>{
    originalFloor.onBeforeCompile(shader,renderer);
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif(abs(pavingPoint.x-32.)<4. && pavingPoint.z>=92.) discard;');
    shader.uniforms.filmedStone={value:cobbles};
    shader.fragmentShader='uniform sampler2D filmedStone;\n'+shader.fragmentShader.replace('diffuseColor.rgb=mix(paved,paved*stoneContrast,coverage);',`
      vec3 stone=texture2D(filmedStone,pavingPoint.xz/.96).rgb;
      float shade=dot(regional,vec3(.25,.65,.10));
      vec3 tint=mix(vec3(.70,.72,.73),vec3(1.18,.97,.90),smoothstep(.22,.45,shade));
      tint=mix(tint,vec3(1.55,1.47,1.34),smoothstep(.47,.75,shade));
      diffuseColor.rgb=stone*tint*mix(.8,1.,smoothstep(.2,3.,border));`);
  };
  const terraces=cafeTerraces();
  // Photographs already contain daylight. Keep the terrace furniture in that
  // same exposure regardless of the Earth scene's artificial lighting.
  terraces.traverse(mesh=>{
    if(mesh.isMesh)mesh.material=new THREE.MeshBasicMaterial({color:mesh.material.color,side:THREE.DoubleSide});
  });
  interior.add(terraces);
  const roofs=courtyard.visuals.children.filter(mesh=>mesh.isMesh && mesh!==floorMesh && mesh.geometry.attributes.position.count>=4 && (mesh===rear || Math.abs(mesh.position.x)===61 || mesh.geometry.type==='BufferGeometry'));
  const roofMaterials=roofs.map(mesh=>{
    const original=mesh.material,roof=original.clone();
    roof.onBeforeCompile=s=>{
      s.vertexShader='varying float plazaHeight;\n'+s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nplazaHeight=position.y+'+mesh.position.y.toFixed(3)+';');
      s.fragmentShader='varying float plazaHeight;\n'+s.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(plazaHeight<19.05)discard;');
    };
    return {mesh,original,roof};
  });
  courtyard.visuals.add(interior);
  courtyard.setEntrance=enabled=>{
    entrance.visible=interior.visible=enabled;
    floorMesh.material=enabled?filmedFloor:originalFloor;
    for(const {mesh,original,roof} of roofMaterials)mesh.material=enabled?roof:original;
    courtyard.grade.refresh();
  };
  courtyard.setEntrance(false);
  return courtyard;
}
