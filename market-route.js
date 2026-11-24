// Model-space metres from the Ciudad Rodrigo arch. The bends and lengths
// approximate the filmed walk through San Miguel and along Calle Mayor.
const stations=[[0,-38],[-30,-38],[-33,-87],[-21,-103],[-25,-169],[-29,-230]];
const halfWidth=8;
const plaza={left:-72,right:-21,near:-214,far:-254};

export function onMarketRoute(x,z){
  if(x>=plaza.left && x<=plaza.right && z>=plaza.far && z<=plaza.near)return true;
  return stations.slice(1).some(([bx,bz],i)=>{
    const [ax,az]=stations[i],dx=bx-ax,dz=bz-az;
    const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));
    return Math.hypot(x-ax-dx*t,z-az-dz*t)<=halfWidth+1;
  });
}

export async function buildMarketRoute(T,loader,renderer){
  const group=new T.Group(), names=['market-glass','market-sign','market-iron','cream','pharmacy','cafe','tavern','rose','turret','stone-house','yellow-house','museum','town-hall','villa-left','villa-end','villa-tower','cycle-mark','asphalt','square-stone'];
  const mats=Object.fromEntries(await Promise.all(names.map(async n=>{
    const map=await loader.loadAsync('data/market-route/'+n+'.webp');
    map.colorSpace=T.SRGBColorSpace;map.anisotropy=renderer.capabilities.getMaxAnisotropy();
    map.wrapS=map.wrapT=T.RepeatWrapping;
    return [n,new T.MeshBasicMaterial({map,side:T.DoubleSide})];
  })));
  const iron=new T.MeshBasicMaterial({color:0x393532}),trim=new T.MeshBasicMaterial({color:0x827363}),paint=new T.MeshBasicMaterial({color:0xd5d2c5,side:T.DoubleSide});
  function quad(points,mat,u=1,v=1){
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(points.flat(),3));
    g.setAttribute('uv',new T.Float32BufferAttribute([0,v,u,v,u,0,0,0],2));
    g.setIndex([0,1,2,0,2,3]);group.add(new T.Mesh(g,mat));
  }
  const directions=stations.slice(1).map(([x,z],i)=>new T.Vector2(x-stations[i][0],z-stations[i][1]).normalize());
  const offsets=stations.map((_,i)=>{
    const prev=directions[Math.max(0,i-1)],next=directions[Math.min(i,directions.length-1)];
    const a=new T.Vector2(-prev.y,prev.x),b=new T.Vector2(-next.y,next.x);
    const m=a.add(b).normalize();return m.multiplyScalar(1/m.dot(b));
  });
  // Adjacent ribbons share the same cross-section at every bend.
  function point(i,t,d,h){
    const [ax,az]=stations[i],[bx,bz]=stations[i+1];
    return [ax+(bx-ax)*t+d*T.MathUtils.lerp(offsets[i].x,offsets[i+1].x,t),h,
      az+(bz-az)*t+d*T.MathUtils.lerp(offsets[i].y,offsets[i+1].y,t)];
  }
  function ribbon(i,a,b,l,r,h,mat,u,v){
    quad([point(i,b,l,h),point(i,b,r,h),point(i,a,r,h),point(i,a,l,h)],mat,u,v);
  }
  function wall(i,t0,t1,d,bottom,top,mat,u=1,v=1){
    quad([point(i,t0,d,top),point(i,t1,d,top),point(i,t1,d,bottom),point(i,t0,d,bottom)],mat,u,v);
  }
  const unit=new T.BoxGeometry(1,1,1);
  function box(x,y,z,w,h,d,material,angle=0){
    const mesh=new T.Mesh(unit,material);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);mesh.rotation.y=angle;group.add(mesh);
  }
  const fronts=['rose','cream','stone-house','turret','yellow-house','museum','tavern'];
  const upper={},lower={};
  for(const name of fronts){
    const split={rose:.19,turret:.23,tavern:.22,cream:.12,'stone-house':.48,'yellow-house':.43,museum:.25}[name];
    upper[name]=mats[name].clone();upper[name].map=mats[name].map.clone();
    upper[name].map.repeat.y=1-split;upper[name].map.offset.y=split;
    lower[name]=mats[name].clone();lower[name].map=mats[name].map.clone();lower[name].map.repeat.y=split;
  }
  for(let i=0;i<directions.length;i++){
    const [ax,az]=stations[i],[bx,bz]=stations[i+1],len=Math.hypot(bx-ax,bz-az);
    const isStreet=i>=3;
    ribbon(i,0,1,-8,8,.019,isStreet?mats.asphalt:mats['square-stone'],8,len*.62);
    if(isStreet){
      for(const s of [-1,1])ribbon(i,0,1,s*4.55,s*8,.075,mats['square-stone'],2,len*.55);
      for(let k=4;k<len-2;k+=9)ribbon(i,k/len,(k+2.8)/len,-.075,.075,.028,paint,1,1);
      if(i===3)ribbon(i,.22,.29,.7,3.3,.032,mats['cycle-mark'],1,1);
    }
    for(const side of [-1,1]){
      if(i===0)continue; // The junction already supplies both corners.
      if(i===1 && side===-1){
        wall(i,0,1,-8,0,5.6,mats['market-glass'],7);wall(i,0,1,-8,5.6,7,mats['market-iron'],6);
        wall(i,0,.16,-7.9,0,2.4,mats['market-sign']);
        for(let k=0;k<=len;k+=3.5){
          const [x,,z]=point(i,k/len,-7.8,0);box(x,3,z,.20,6,.22,iron);
        }
        ribbon(i,0,1,-21,-7.6,7,mats['market-iron'],4,1);
        wall(i,0,1,-7.67,.82,1,iron);continue;
      }
      const count=Math.ceil(len/16);
      for(let j=0;j<count;j++){
        // Leave the sidewalk open where Calle Mayor meets Plaza de la Villa.
        const start=j/count,end=(j+1)/count;
        if(i===4 && side===-1 && end>.75)continue;
        const idx=(i*3+j+(side===1?2:0))%fronts.length;
        const material=mats[fronts[idx]],height=[15,18,17,20][(idx+j)%4],d=side*8;
        wall(i,start,end,d,3.4,height,upper[fronts[idx]]);
        wall(i,start,end,d+side*.32,0,3.4,i<=2?mats[['cafe','pharmacy','tavern'][j%3]]:lower[fronts[idx]]);
        ribbon(i,start,end,d-side*.23,d+side*.34,3.4,trim,1,1);
        ribbon(i,start,end,d,d+side*7,height,trim,1,1);
        for(const t of [start,end]){
          quad([point(i,t,d,height),point(i,t,d+side*7,height),point(i,t,d+side*7,0),point(i,t,d,0)],material);
        }
      }
    }
    if(isStreet)for(let k=10;k<len;k+=20){
      const [x,,z]=point(i,k/len,5.2,0);
      box(x,2.25,z,.12,4.5,.12,iron);box(x,4.7,z,.38,.55,.38,paint);box(x,5,z,.48,.09,.48,iron);
    }
  }
  // Close the short end of the market hall at the turn from Ciudad Rodrigo.
  const marketEnd=point(1,0,-8,0);
  const marketBack=point(1,0,-21,0);
  quad([[marketEnd[0],7,marketEnd[2]],[marketBack[0],7,marketBack[2]],marketBack,marketEnd],mats['market-iron']);
  const {left:L,right:R,near:N,far:F}=plaza;
  quad([[L,.022,F],[R,.022,F],[R,.022,N],[L,.022,N]],mats['square-stone'],24,20);
  function elevation(a,b,h,mat){
    quad([[a[0],h,a[1]],[b[0],h,b[1]],[b[0],0,b[1]],[a[0],0,a[1]]],mat);
  }
  elevation([L,N],[L,F],16,mats['town-hall']);
  elevation([L,F],[R,F],13,mats['villa-end']);
  elevation([L,N],[R-13,N],11,mats['villa-left']);
  box(L+7,9,F+.5,6,18,6,mats['villa-tower']);
  const roof=new T.Mesh(new T.ConeGeometry(4.5,3.1,4),trim);
  roof.rotation.y=Math.PI/4;roof.position.set(L+7,19.5,F+.5);group.add(roof);
  return group;
}
