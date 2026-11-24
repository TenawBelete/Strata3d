// Apply the lighting after each photographic material has assembled its surface colour.
export function gradeCourtyard(THREE, group) {
  const light = {value: new THREE.Color(1, 1, 1)};
  const installed = new WeakSet();
  function refresh() {
    group.traverse(object => {
      if (!object.isMesh) return;
      for (const material of [].concat(object.material)) {
        if (installed.has(material)) continue;
        installed.add(material);
        const compile = material.onBeforeCompile;
        const key = material.customProgramCacheKey();
        material.customProgramCacheKey = () => key + '-courtyard-light';
        material.onBeforeCompile = function(shader, renderer) {
          compile.call(this, shader, renderer);
          if (shader.uniforms.courtyardLight === light) return;
          shader.uniforms.courtyardLight = light;
          shader.fragmentShader = 'uniform vec3 courtyardLight;\n' + shader.fragmentShader.replace(
            '#include <opaque_fragment>', 'outgoingLight *= courtyardLight;\n#include <opaque_fragment>');
        };
        material.needsUpdate = true;
      }
    });
  }
  refresh();
  return {light: light.value, refresh};
}

export function presentationWeather(renderer, square, draw) {
  const form = document.querySelector('#conditions');
  form.hidden = false;
  const hour = form.elements.hour, rain = form.elements.rain;
  const query = new URLSearchParams(location.search);
  hour.value = query.get('hour') ?? '12';
  rain.value = query.get('rain') ?? '0';
  let cloud = 0, generation = 0;
  const canvas = document.createElement('canvas');
  canvas.className = 'rain-layer';
  renderer.domElement.after(canvas);
  const ctx = canvas.getContext('2d');
  function update() {
    const time = Number(hour.value), wet = Number(rain.value);
    const sun = Math.max(0, Math.min(1, (Math.cos((time-13)*Math.PI/12)+.16)*2));
    const shade = 1-.27*cloud-.19*Math.min(1,wet/8);
    square.grade.light.setRGB((.075+.925*sun)*shade,(.095+.905*sun)*shade,(.16+.84*sun)*shade);
    square.background.set('#5979ae').multiply(square.grade.light);
    form.querySelector('output').value = String(Math.floor(time)).padStart(2,'0')+':'+(time%1?'30':'00')+' · '+wet+' mm/h';
    const url = new URL(location.href);
    url.searchParams.set('hour',hour.value); url.searchParams.set('rain',rain.value);
    url.searchParams.set('cloud',String(cloud));
    history.replaceState(null,'',url);
    canvas.hidden = !wet;
    draw();
  }
  cloud = Math.max(0, Math.min(1, Number(query.get('cloud')) || 0));
  form.oninput = () => { generation++; form.querySelector('small').textContent='Manual'; update(); };
  form.querySelector('button').onclick = async () => {
    const request = ++generation, label = form.querySelector('small');
    label.textContent='Loading Madrid weather…';
    try {
      const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=40.4155&longitude=-3.7074&current=rain,cloud_cover&timezone=Europe%2FMadrid',{signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw Error();
      const {current} = await response.json();
      if (request!==generation) return;
      if (!Number.isFinite(current.rain)||!Number.isFinite(current.cloud_cover)||!(current.interval>0)||!current.time?.includes('T')) throw Error();
      const [hours,minutes] = current.time.split('T')[1].split(':').map(Number);
      hour.value = hours + Math.floor(minutes/30)/2;
      rain.value = Math.min(30,current.rain*3600/current.interval); cloud=current.cloud_cover/100;
      label.textContent='Open-Meteo · '+current.time.replace('T',' ');
      update();
    } catch { if(request===generation) label.textContent='Weather unavailable · manual controls active'; }
  };
  update();
  return now => {
    if (canvas.hidden) return;
    const w=canvas.clientWidth,h=canvas.clientHeight;
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle='rgba(184,204,224,.38)';ctx.beginPath();
    const count=Math.ceil(w*h*Math.min(1,Number(rain.value)/12)/4500);
    for(let i=0;i<count;i++){
      const depth=.4+(i*37%101)/100;
      const x=(i*487.31+now*.04*depth)%w,y=(i*193.79+now*.55*depth)%h;
      ctx.moveTo(x,y);ctx.lineTo(x+depth,y+depth*10);
    }
    ctx.stroke();
  };
}
