// Photographic surfaces from Impressions from Everywhere, Madrid walking tour,
// 21:59–22:33, https://youtu.be/nf77WWWmvBI (Creative Commons Attribution).
export async function buildEntrance(T, loader, renderer) {
  const group = new T.Group();
  const names = ['shop','storefront','portal','pier','vault','landing','stair'];
  const materials = Object.fromEntries(await Promise.all(names.map(async name => {
    const map = await loader.loadAsync('data/entrance/' + name + '.jpg');
    map.colorSpace = T.SRGBColorSpace;
    map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return [name,new T.MeshBasicMaterial({map,side:T.DoubleSide})];
  })));
  // Local z increases along the approach away from the courtyard.
  function quad(points, material, uv=[0,1,1,1,1,0,0,0]) {
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(points.flat(),3));
    g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
    g.setIndex([0,1,2,0,2,3]);
    group.add(new T.Mesh(g,materials[material]));
  }
  quad([[-4,5,17],[-4,5,0],[-4,-.8,0],[-4,-.8,17]],'shop');
  quad([[4,5,0],[4,5,17],[4,-.8,17],[4,-.8,0]],'storefront');
  for(let z=2;z<17;z+=3) {
    quad([[-4,-.8,z],[4,-.8,z],[4,-.8,z+3],[-4,-.8,z+3]],'landing');
  }
  for(let i=0;i<5;i++){
    const z=2-i*.4, y=-.8+(i+1)*.16;
    quad([[-4,y,z],[4,y,z],[4,y-.16,z],[-4,y-.16,z]],'stair');
    quad([[-4,y,z-.4],[4,y,z-.4],[4,y,z],[-4,y,z]],'landing');
  }
  // Trace the opening in the rectified source. Build both portal ends
  // and connect their edges to give the passage physical depth.
  const opening=[[-2.42,0],[-2.42,3.15]];
  for(let i=1;i<=32;i++){
    const a=Math.PI*(1-i/32);
    opening.push([2.42*Math.cos(a),3.15+2.15*Math.sin(a)]);
  }
  opening.push([2.42,0]);
  for(const z of [0,-3.2]){
    const face=(x0,x1,y0,y1,top)=>{
      const pts=[[x0,top,z],[x1,top,z],[x1,y1,z],[x0,y0,z]];
      quad(pts,'portal',pts.flatMap(([x,y])=>[(x+4)/8,y/6.2]));
    };
    face(-4,-2.42,0,0,6.2);
    face(2.42,4,0,0,6.2);
    for(let i=2;i<opening.length-1;i++){
      const [x,y]=opening[i-1],[u,v]=opening[i];
      face(x,u,y,v,6.2);
    }
  }
  for(let i=1;i<opening.length;i++){
    const [x,y]=opening[i-1],[u,v]=opening[i];
    const pts=[[x,y,0],[x,y,-3.2],[u,v,-3.2],[u,v,0]];
    const uv=i===1||i===opening.length-1 ? pts.flatMap(([px,py,pz])=>[-pz/3.2,py/3.15]) :
      pts.flatMap(([px,py,pz])=>[-pz/3.2,(px+2.42)/4.84]);
    quad(pts,i===1||i===opening.length-1?'pier':'vault',uv);
  }
  quad([[-4,6.2,0],[4,6.2,0],[4,6.2,-3.2],[-4,6.2,-3.2]],'vault');
  quad([[-4,.004,-3.2],[4,.004,-3.2],[4,.004,0],[-4,.004,0]],'landing');
  group.position.set(32,0,92);
  return group;
}
