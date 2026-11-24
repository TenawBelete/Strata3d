/* ============================================================== strata8-water.js
   Rain that runs downhill over the REAL photographic city.
   - Terrain: the IGN 2 m terrain model (data/plaza-mayor-dem-512.f32), 352 x 352 cells of 2 m around Plaza Mayor.
   - Walls: Catastro building footprints. A building is a wall only if it stands in the year chosen in the Time Machine
     (read from window.__strata8.TM.year while TM.on), so the same storm runs differently in 1850.
   - Roofs shed their rain to the nearest open ground cell (gutters), so facades collect water as in a real street.
   - Simulation: shallow water on the GPU ("virtual pipes", Mei et al. 2007) with Manning friction, open edges, and sewer
     grates at the terrain's low points (weir law, up to 50 L/s each, assumed). Two float textures ping-pong; about 0.1 ms per step.
   - Drawing: nothing is added to the scene. The Google tile materials are patched (#ifdef WET_ON) so the REAL mesh gets wet:
     darker wet stone, glossy puddles that mirror the real buildings (a second, half-size drawing of the city from a
     camera mirrored about the water), rain-ring ripples, flow streaks along the current, and a
     waterline on facades. The Time Machine ground sheet is patched the same way when it exists.
   - Everything is a local file. Zero outside requests.
   Interface for other code:  window.__water = { on, N, stats(), advance(simSeconds), glsl (the shading function) }.
   Reads:  window.__strata8 {THREE, renderer, scene, camera, tiles, TM?}, #srain (the page's Rain dial, mm/h). */

const L = 2.0;            /* cell size, metres */
const SIM_DT = 0.5;       /* seconds of simulated time per pass pair */
let W = null;

export async function toggle(S){
  /* the page loads this file with a fresh ?v= each time it is imported, so a second press can meet a NEW copy of the module: always look at window.__water first */
  const ex = window.__water;
  if (ex && ex.ready && ex.setOn){ ex.setOn(!ex.on); return ex; }
  if (ex && ex.loading) return ex;
  if (W && W.ready){ W.setOn(!W.on); return W; }
  if (W && W.loading) return W;
  W = {loading:true, ready:false}; window.__water = W;
  try { W = await create(S); window.__water = W; } catch (e){ W = null; window.__water = null; console.error(e); const st = document.getElementById('status'); if (st) st.textContent = 'Water: ' + (e && e.message || e); throw e; }
  return W;
}
/* build the water system without switching it on (used by strata8-xr.html). opts: {reflections, worldMode, fine} */
export async function load(S, opts){
  const ex = window.__water;
  if (ex && ex.ready) return ex;
  if (W && W.ready) return W;
  W = {loading:true, ready:false}; window.__water = W;
  try { W = await create(S, Object.assign({startOff:true}, opts || {})); window.__water = W; } catch (e){ W = null; window.__water = null; throw e; }
  return W;
}

/* ------------------------------------------------------------------ shading (GLSL), shared with the tile materials */
export const WET_UNIFORMS_GLSL = `
uniform sampler2D tWV; uniform float uWetOn; uniform float uWet; uniform float uWetRainI; uniform float uWetTime; uniform float uWetHalf; uniform float uWetAdv;
uniform vec3 uWetGx; uniform vec3 uWetGy; uniform vec3 uWetCam; uniform vec3 uSkyH; uniform vec3 uSkyZ;
uniform sampler2D tRefl; uniform float uReflOn; uniform mat4 uReflVP; uniform float uWetFine;`;

export const WET_FUNCS_GLSL = `
vec2 wt_h22(vec2 p){ p = fract(p*vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.xx + p.yx)*p.xy); }
float wt_h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }
float wt_vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(wt_h21(i), wt_h21(i + vec2(1.0,0.0)), f.x), mix(wt_h21(i + vec2(0.0,1.0)), wt_h21(i + vec2(1.0,1.0)), f.x), f.y); }
/* rain rings: gradient of a field of expanding rings, 3 x 3 cells of 0.33 m, drops appear with probability ~ rain intensity */
vec3 wt_rings(vec2 xz, float t, float inten){
  vec2 p = xz*3.0, cell = floor(p), f = fract(p); vec2 grad = vec2(0.0); float ring = 0.0;
  for (int j = -1; j <= 1; j++){ for (int i = -1; i <= 1; i++){
    vec2 o = vec2(float(i), float(j)); vec2 h = wt_h22(cell + o);
    float on = step(h.x, 0.18 + 0.8*inten);
    float ph = fract(t*(0.7 + 0.6*h.y) + h.x*13.7);
    vec2 d = o + h - f; float dist = length(d); float r = ph*0.85; float x = (dist - r)/0.11; float a = (1.0 - ph); a *= a*on;
    float env = exp(-x*x); ring += env*a;
    grad += (d/(dist + 1e-4))*(-2.0*x*env*a)*(1.0/0.11)*0.11; } }
  return vec3(grad, ring); }
vec3 wt_sky(vec3 r){
  float t = clamp(r.y, 0.0, 1.0); vec3 s = mix(uSkyH, uSkyZ, pow(t, 0.55));
  float b = smoothstep(0.03, 0.40, r.y);
  return mix(vec3(0.115, 0.095, 0.08)*(0.35 + 1.4*dot(uSkyH, vec3(0.333))), s, b); }
/* col = linear colour of a real mesh fragment, e = its position in local metres (east, up, south) */
vec3 wetShade(vec3 col, vec3 e){
  if (uWetOn < 0.5) return col;
  vec3 nn = cross(dFdx(e), dFdy(e)); float nl = length(nn); vec3 n = nl > 1e-10 ? nn/nl : vec3(0.0, 1.0, 0.0);
  float up = abs(n.y);
  vec2 g = vec2(dot(uWetGx.xy, e.xz) + uWetGx.z, dot(uWetGy.xy, e.xz) + uWetGy.z);
  vec2 uv = vec2(g.x + uWetHalf, uWetHalf - g.y)/(2.0*uWetHalf);
  float inside = step(0.002, uv.x)*step(uv.x, 0.998)*step(0.002, uv.y)*step(uv.y, 0.998);
  vec4 s = texture2D(tWV, clamp(uv, 0.002, 0.998));
  float above = e.y - s.a;
  bool ground = (inside > 0.5) && up > 0.7 && above < 1.1 && above > -3.0;
  float dep = 0.0; vec2 fl = vec2(0.0);
  if (ground){ dep = max(0.0, s.r + (wt_vn(e.xz*2.3) - 0.5)*0.0045*step(0.0005, s.r)); fl = vec2(uWetGx.x*s.g + uWetGx.y*s.b, uWetGx.y*s.g - uWetGx.x*s.b); }
  float wetK = clamp(max(uWet*(ground ? 0.95 : 0.8), smoothstep(0.0, 0.003, dep)), 0.0, 1.0);
  /* wet stone goes darker and richer, but already-dark pixels (baked shadows, what is left of removed buildings) are left alone so they never turn black */
  vec3 wetc = pow(max(col, vec3(0.0)), vec3(1.0 + 0.55*wetK))*(1.0 - 0.10*wetK);
  vec3 base = mix(col, wetc, smoothstep(0.012, 0.12, dot(col, vec3(0.3333))));
  vec3 V = normalize(e - uWetCam);
  float pw = smoothstep(0.0015, 0.008, dep);   /* a film of 1.5 mm already starts to act as a mirror; 8 mm is a full puddle */
  /* where this point of the water sits in the mirrored picture of the real city (uReflVP: local metres -> mirrored camera clip space) */
  vec2 ruv = vec2(0.5); float redge = 0.0;
  if (ground && uReflOn > 0.5){
    vec4 cp = uReflVP*vec4(e, 1.0);
    if (cp.w > 0.0){ ruv = cp.xy/cp.w*0.5 + 0.5; redge = smoothstep(0.0, 0.04, ruv.x)*smoothstep(1.0, 0.96, ruv.x)*smoothstep(0.0, 0.04, ruv.y)*smoothstep(1.0, 0.96, ruv.y); }
  }
  if (ground && pw > 0.001){
    float deepT = 1.0 - exp(-dep*6.0);
    vec3 pn = vec3(0.0, 1.0, 0.0);
    vec3 rp = wt_rings(e.xz, uWetTime, uWetRainI);
    pn.xz -= rp.xy*uWetRainI*0.8*(1.0 - 0.6*deepT)*uWetFine;
    float sp = length(fl); vec2 dir = sp > 1e-3 ? fl/sp : vec2(1.0, 0.0); vec2 per = vec2(-dir.y, dir.x);
    vec2 q = vec2(dot(e.xz, dir), dot(e.xz, per));
    float adv = min(sp*uWetAdv, 2.5);
    float ph0 = fract(uWetTime*0.45), ph1 = fract(uWetTime*0.45 + 0.5);
    float n0 = wt_vn((q - vec2(adv*ph0*2.2, 0.0))*vec2(1.1, 3.6)), n1 = wt_vn((q - vec2(adv*ph1*2.2, 0.0))*vec2(1.1, 3.6));
    float fn = mix(n0, n1, abs(ph0*2.0 - 1.0));
    float fk = smoothstep(0.03, 0.30, sp)*(1.0 - 0.5*deepT);
    pn.xz += per*(fn - 0.5)*0.55*fk*uWetFine;
    pn = normalize(pn);
    vec3 R = reflect(V, pn); R.y = abs(R.y);
    vec3 refl = wt_sky(R);
    /* the real buildings, people and sky mirrored in the puddle, broken up by the rain rings and the current */
    if (redge > 0.0) refl = mix(refl, textureLod(tRefl, clamp(ruv + pn.xz*0.035, 0.001, 0.999), 0.0).rgb, redge);
    float cosv = clamp(dot(pn, -V), 0.0, 1.0);
    float F = clamp(0.06 + 0.94*pow(1.0 - cosv, 3.0) + 0.10*deepT, 0.0, 1.0);
    vec3 trans = mix(base*0.62, vec3(0.09, 0.075, 0.058), deepT);
    vec3 water = mix(trans, refl, F);
    water += vec3(0.9, 0.93, 1.0)*(fk*smoothstep(0.55, 0.9, fn)*0.16 + clamp(rp.z, 0.0, 1.0)*uWetRainI*0.12)*uWetFine;
    base = mix(base, water, pw);
  }
  if (ground && pw < 0.999){
    vec3 R0 = reflect(V, vec3(0.0, 1.0, 0.0)); R0.y = abs(R0.y); float c0 = clamp(dot(vec3(0.0, 1.0, 0.0), -V), 0.0, 1.0);
    /* wet stone: a soft, blurred mirror (the lit facades smear across the wet floor as they do on a real wet street) */
    vec3 env0 = wt_sky(R0);
    if (redge > 0.0) env0 = mix(env0, textureLod(tRefl, ruv, 2.2).rgb, redge*0.9);
    /* energy-conserving: what is reflected is not also seen as stone; strongest at grazing angles, like a real wet square */
    base = mix(base, env0, (0.03 + 0.72*pow(1.0 - c0, 4.0))*wetK*(1.0 - pw));
  }
  if ((!ground) && inside > 0.5 && up < 0.6){
    vec2 off = n.xz; float ol = length(off);
    if (ol > 1e-3){
      off /= ol; vec2 xz2 = e.xz + off*1.8;
      vec2 g2 = vec2(dot(uWetGx.xy, xz2) + uWetGx.z, dot(uWetGy.xy, xz2) + uWetGy.z);
      vec2 uv2 = vec2(g2.x + uWetHalf, uWetHalf - g2.y)/(2.0*uWetHalf);
      vec4 s2 = texture2D(tWV, clamp(uv2, 0.002, 0.998));
      float h2 = e.y - s2.a; float under = step(h2, s2.r)*smoothstep(0.02, 0.06, s2.r);
      base = mix(base, vec3(0.085, 0.075, 0.06), 0.88*under);
      base += vec3(0.5, 0.55, 0.6)*smoothstep(0.05, 0.0, abs(h2 - s2.r))*step(0.03, s2.r)*0.35;
    }
  }
  if (uWetOn > 1.5) return vec3(ground ? 1.0 : 0.0, pw, clamp(dep*10.0, 0.0, 1.0));
  return base;
}`;

/* ------------------------------------------------------------------ simulation passes (GLSL) */
const PASS_VS = 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
const COMMON_FS = `
uniform sampler2D tD; uniform sampler2D tF; uniform sampler2D tB;
uniform float uN, uDt, uG, uL, uNm, uOpen, uRain, uDrain, uDrainCap;
float hd(ivec2 q, float h, float d, int N){
  if (q.x < 0 || q.y < 0 || q.x >= N || q.y >= N) return d*uOpen;
  vec4 bq = texelFetch(tB, q, 0);
  if (bq.y > 0.5) return -1.0e3;
  return h - (bq.x + texelFetch(tD, q, 0).r);
}`;
const FLUX_FS = COMMON_FS + `
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy); int N = int(uN);
  vec4 b = texelFetch(tB, p, 0);
  if (b.y > 0.5){ gl_FragColor = vec4(0.0); return; }
  float d = texelFetch(tD, p, 0).r;
  vec4 f = texelFetch(tF, p, 0);
  float h = b.x + d;
  vec4 dh = vec4(hd(p + ivec2(-1,0), h, d, N), hd(p + ivec2(1,0), h, d, N), hd(p + ivec2(0,-1), h, d, N), hd(p + ivec2(0,1), h, d, N));
  float ds = max(d, 0.003);
  vec4 u = abs(f)/(ds*uL);
  vec4 fric = 1.0 + uDt*uG*uNm*uNm*u/pow(ds, 1.3333);
  vec4 o = max(vec4(0.0), (f + uDt*uG*dh*d)/fric);
  float sum = o.x + o.y + o.z + o.w;
  float K = min(1.0, d*uL*uL/(sum*uDt + 1.0e-12));
  gl_FragColor = o*K;
}`;
const WATER_FS = COMMON_FS + `
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy); int N = int(uN);
  vec4 b = texelFetch(tB, p, 0);
  if (b.y > 0.5){ gl_FragColor = vec4(0.0); return; }
  float d = texelFetch(tD, p, 0).r;
  vec4 f = texelFetch(tF, p, 0);
  float inflow = 0.0;
  if (p.x > 0)     inflow += texelFetch(tF, p + ivec2(-1,0), 0).y;
  if (p.x < N - 1) inflow += texelFetch(tF, p + ivec2(1,0), 0).x;
  if (p.y > 0)     inflow += texelFetch(tF, p + ivec2(0,-1), 0).w;
  if (p.y < N - 1) inflow += texelFetch(tF, p + ivec2(0,1), 0).z;
  float outf = f.x + f.y + f.z + f.w;
  d += uDt*(inflow - outf)/(uL*uL) + uDt*uRain*b.z;
  /* sewer grate: swallows more the deeper the water over it (weir law Q = Cw P d^1.5), up to what its pipe can take */
  d -= min(d, min(uDrainCap, uDrain*pow(max(d, 0.0), 1.5))*uDt*b.w);
  gl_FragColor = vec4(max(d, 0.0), 0.0, 0.0, 0.0);
}`;
const VIEW_FS = COMMON_FS + `
vec4 Fq(ivec2 q, int N){ if (q.x < 0 || q.y < 0 || q.x >= N || q.y >= N) return vec4(0.0); return texelFetch(tF, q, 0); }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy); int N = int(uN);
  vec4 b = texelFetch(tB, p, 0);
  float d = texelFetch(tD, p, 0).r;
  vec4 f = texelFetch(tF, p, 0);
  float Wx = 0.5*((Fq(p + ivec2(-1,0), N).y + f.y) - (f.x + Fq(p + ivec2(1,0), N).x));
  float Wy = 0.5*((Fq(p + ivec2(0,1), N).z + f.z) - (f.w + Fq(p + ivec2(0,-1), N).w));
  float ds = max(d, 0.004);
  vec2 u = vec2(Wx, Wy)/(uL*ds); float ul = length(u); if (ul > 2.5) u *= 2.5/ul;
  if (b.y > 0.5){ gl_FragColor = vec4(0.0, 0.0, 0.0, b.x); return; }
  gl_FragColor = vec4(d, u, b.x);
}`;

/* ------------------------------------------------------------------ build everything */
async function create(S, opts){
  opts = opts || {};
  const THREE = S.THREE, R = S.renderer, $ = id => document.getElementById(id);
  const say = t => { const e = $('status'); if (e) e.textContent = t; };
  say('Water: loading terrain and buildings…');
  const base = 'data/';
  const j = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' → ' + r.status); return r.json(); });
  const [man, pack, demBuf] = await Promise.all([j(base + 'tm-plaza-mayor.json'), j(base + 'plaza-mayor-madrid.json'),
    fetch(base + 'plaza-mayor-dem-512.f32').then(r => { if (!r.ok) throw new Error('terrain → ' + r.status); return r.arrayBuffer(); })]);
  if (!R.extensions.has('EXT_color_buffer_float')) throw new Error('this GPU cannot render to float textures');
  const items = pack.items, H = man.box.half_m, N = Math.round(2*H/L), reg = man.registration, dem = new Float32Array(demBuf);
  const th = reg.rotation_deg*Math.PI/180, C = Math.cos(th), Sn = Math.sin(th), cen = man.centre;

  /* terrain in local metres: IGN ellipsoid-corrected height minus the frame's ground height */
  function demAt(gx, gy){
    const fx = (cen.utm_x + gx - 439472.0)/2 - 0.5, fy = (4474627.5 - (cen.utm_y + gy))/2 - 0.5;
    const x0 = Math.max(0, Math.min(510, Math.floor(fx))), y0 = Math.max(0, Math.min(510, Math.floor(fy)));
    const ax = Math.max(0, Math.min(1, fx - x0)), ay = Math.max(0, Math.min(1, fy - y0));
    return dem[y0*512 + x0]*(1 - ax)*(1 - ay) + dem[y0*512 + x0 + 1]*ax*(1 - ay) + dem[(y0 + 1)*512 + x0]*(1 - ax)*ay + dem[(y0 + 1)*512 + x0 + 1]*ax*ay;
  }
  const terr = new Float32Array(N*N);
  for (let jj = 0; jj < N; jj++) for (let ii = 0; ii < N; ii++) terr[jj*N + ii] = demAt(-H + (ii + 0.5)*L, H - (jj + 0.5)*L) + reg.geoid_N_m - reg.frame_ground_ellipsoid_h_m;

  /* footprints → the year each cell becomes a wall (oldest overlapping building; undated = 0 = always) */
  const cellYear = new Uint16Array(N*N).fill(65535);
  function inside(rings, x, y){
    let ins = false;
    for (const r of rings){ const n = r.length/2; for (let a = 0, b = n - 1; a < n; b = a++){
      const xi = r[a*2], yi = r[a*2 + 1], xj = r[b*2], yj = r[b*2 + 1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi)*(y - yi)/(yj - yi) + xi)) ins = !ins; } }
    return ins;
  }
  items.forEach(b => {
    const r0 = b.g[0]; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let k = 0; k < r0.length; k += 2){ x0 = Math.min(x0, r0[k]); x1 = Math.max(x1, r0[k]); y0 = Math.min(y0, r0[k + 1]); y1 = Math.max(y1, r0[k + 1]); }
    const i0 = Math.max(0, Math.floor((x0 + H)/L)), i1 = Math.min(N - 1, Math.floor((x1 + H)/L)), j0 = Math.max(0, Math.floor((H - y1)/L)), j1 = Math.min(N - 1, Math.floor((H - y0)/L));
    const yr = b.y | 0;
    for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++){
      if (inside(b.g, -H + (ii + 0.5)*L, H - (jj + 0.5)*L)){ const k = jj*N + ii; if (yr < cellYear[k]) cellYear[k] = yr; }
    }
  });

  /* static texture: R terrain, G wall, B roof-runoff multiplier (rain landing on this open cell), A sewer inlet */
  const bData = new Float32Array(N*N*4);
  const tB = new THREE.DataTexture(bData, N, N, THREE.RGBAFormat, THREE.FloatType);
  tB.minFilter = tB.magFilter = THREE.NearestFilter; tB.generateMipmaps = false; tB.flipY = false; tB.needsUpdate = true;
  let wallsInfo = {Y:0, wallCells:0, openCells:0, lost:0, catchSum:0, buildings:0, inlets:0};
  function rebuildWalls(Y){
    const wall = new Uint8Array(N*N); let nw = 0;
    for (let k = 0; k < N*N; k++){ if (cellYear[k] <= Y){ wall[k] = 1; nw++; } }
    /* open ground split into connected pieces. Pieces of 1-3 cells shut in by buildings are gaps in the footprint
       drawing: they become part of the building. Other shut-in pieces under 100 cells (400 m2) are patios and
       lightwells: they keep their own rain and drain through their own grate, but take no roof water. */
    const comp = new Int32Array(N*N).fill(-1), csz = [], cbd = [], q = new Int32Array(N*N); let nc = 0;
    for (let k = 0; k < N*N; k++){
      if (wall[k] || comp[k] >= 0) continue; let h0 = 0, t0 = 0, sz = 0, bd = false; q[t0++] = k; comp[k] = nc;
      while (h0 < t0){ const c = q[h0++], cx = c % N, cy = (c/N) | 0; sz++; if (cx === 0 || cy === 0 || cx === N - 1 || cy === N - 1) bd = true;
        if (cx > 0 && !wall[c - 1] && comp[c - 1] < 0){ comp[c - 1] = nc; q[t0++] = c - 1; }
        if (cx < N - 1 && !wall[c + 1] && comp[c + 1] < 0){ comp[c + 1] = nc; q[t0++] = c + 1; }
        if (cy > 0 && !wall[c - N] && comp[c - N] < 0){ comp[c - N] = nc; q[t0++] = c - N; }
        if (cy < N - 1 && !wall[c + N] && comp[c + N] < 0){ comp[c + N] = nc; q[t0++] = c + N; } }
      csz.push(sz); cbd.push(bd); nc++;
    }
    let slivers = 0, patios = 0;
    for (let i = 0; i < nc; i++) if (!cbd[i] && csz[i] > 3 && csz[i] < 100) patios++;
    for (let k = 0; k < N*N; k++){ const c = comp[k]; if (c >= 0 && !cbd[c] && csz[c] <= 3){ wall[k] = 1; comp[k] = -1; nw++; slivers++; } }
    const outdoor = c => c >= 0 && (cbd[c] || csz[c] >= 100);
    /* roofs shed their rain to the nearest open cell of the street network (downpipes and eaves), never into a patio */
    const owner = new Int32Array(N*N).fill(-1); let qh = 0, qt = 0;
    for (let k = 0; k < N*N; k++) if (!wall[k] && outdoor(comp[k])){ owner[k] = k; q[qt++] = k; }
    while (qh < qt){
      const c = q[qh++], cx = c % N, cy = (c/N) | 0, o = owner[c];
      if (cx > 0 && wall[c - 1] && owner[c - 1] < 0){ owner[c - 1] = o; q[qt++] = c - 1; }
      if (cx < N - 1 && wall[c + 1] && owner[c + 1] < 0){ owner[c + 1] = o; q[qt++] = c + 1; }
      if (cy > 0 && wall[c - N] && owner[c - N] < 0){ owner[c - N] = o; q[qt++] = c - N; }
      if (cy < N - 1 && wall[c + N] && owner[c + N] < 0){ owner[c + N] = o; q[qt++] = c + N; }
    }
    const catchA = new Float32Array(N*N); let lost = 0;
    for (let k = 0; k < N*N; k++){ if (!wall[k]) catchA[k] += 1; else if (owner[k] >= 0) catchA[owner[k]] += 1; else lost++; }
    /* sewer grates (assumed layout, same rule in every year):
       1. every low point: an open cell that is the lowest cell of its own piece of ground within 4 cells (8 m);
          so every patio gets at least one;
       2. spacing: in every 24 m x 24 m square, each piece of ground with at least 12 cells there gets a grate at its
          lowest cell if it has none yet (Madrid streets carry a grate every 20-30 m). */
    const inlet = new Uint8Array(N*N); let ni = 0; const RR = 4;
    for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++){
      const c = cy*N + cx; if (wall[c]) continue; const tc = terr[c], cc0 = comp[c]; let low = true;
      for (let dy = -RR; dy <= RR && low; dy++){ const yy = cy + dy; if (yy < 0 || yy >= N) continue;
        for (let dx = -RR; dx <= RR; dx++){ const xx = cx + dx; if (xx < 0 || xx >= N) continue; const k = yy*N + xx; if (wall[k] || k === c || comp[k] !== cc0) continue;
          if (terr[k] < tc || (terr[k] === tc && k < c)){ low = false; break; } } }
      if (low){ inlet[c] = 1; ni++; }
    }
    const T = 12; let nSpace = 0;
    for (let ty = 0; ty < N; ty += T) for (let tx = 0; tx < N; tx += T){
      const m = new Map();   /* piece -> [cells here, lowest cell, has a grate] */
      for (let cy = ty; cy < Math.min(N, ty + T); cy++) for (let cx = tx; cx < Math.min(N, tx + T); cx++){
        const c = cy*N + cx; if (wall[c]) continue; const id = comp[c]; let r = m.get(id); if (!r){ r = [0, c, false]; m.set(id, r); }
        r[0]++; if (terr[c] < terr[r[1]]) r[1] = c; if (inlet[c]) r[2] = true;
      }
      m.forEach(r => { if (!r[2] && r[0] >= 12){ inlet[r[1]] = 1; ni++; nSpace++; } });
    }
    let cs = 0;
    for (let k = 0; k < N*N; k++){ bData[k*4] = terr[k]; bData[k*4 + 1] = wall[k]; bData[k*4 + 2] = wall[k] ? 0 : catchA[k]; bData[k*4 + 3] = inlet[k]; cs += bData[k*4 + 2]; }
    tB.needsUpdate = true;
    let nb = 0; items.forEach(b => { if ((b.y | 0) <= Y) nb++; });
    wallsInfo = {Y, wallCells:nw, openCells:N*N - nw, lost, catchSum:cs, buildings:nb, inlets:ni, inletsForSpacing:nSpace, patios, slivers, pieces:nc};
    return wallsInfo;
  }
  const yearNow = () => { if (typeof S.waterYear === 'function') return S.waterYear(); const T = S.TM; return (T && T.on && isFinite(T.year)) ? Math.round(T.year) : 65534; };
  rebuildWalls(yearNow());

  /* render targets */
  const f32 = {type:THREE.FloatType, format:THREE.RGBAFormat, minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthBuffer:false, stencilBuffer:false};
  const rtD = [new THREE.WebGLRenderTarget(N, N, f32), new THREE.WebGLRenderTarget(N, N, f32)];
  const rtF = [new THREE.WebGLRenderTarget(N, N, f32), new THREE.WebGLRenderTarget(N, N, f32)];
  const rtV = new THREE.WebGLRenderTarget(N, N, {type:THREE.HalfFloatType, format:THREE.RGBAFormat, minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter, depthBuffer:false, stencilBuffer:false});
  const pscene = new THREE.Scene(), pcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quad.frustumCulled = false; pscene.add(quad);
  const SU = {tD:{value:null}, tF:{value:null}, tB:{value:tB}, uN:{value:N}, uDt:{value:SIM_DT}, uG:{value:9.81}, uL:{value:L}, uNm:{value:0.03}, uOpen:{value:1.0}, uRain:{value:0}, uDrain:{value:0}, uDrainCap:{value:0}};
  const mk = fs => new THREE.ShaderMaterial({uniforms:SU, vertexShader:PASS_VS, fragmentShader:fs, depthTest:false, depthWrite:false, blending:THREE.NoBlending});
  const mFlux = mk(FLUX_FS), mWater = mk(WATER_FS), mView = mk(VIEW_FS);
  const cc = new THREE.Color();
  function run(mat, rt){
    quad.material = mat; const prev = R.getRenderTarget(), xr = R.xr.enabled; R.xr.enabled = false;
    try { R.setRenderTarget(rt); R.render(pscene, pcam); } finally { R.xr.enabled = xr; R.setRenderTarget(prev); }
  }
  function zero(rt){
    const prev = R.getRenderTarget(), pa = R.getClearAlpha(); R.getClearColor(cc); const hex = cc.getHex();
    const xr = R.xr.enabled; R.xr.enabled = false;
    try { R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(true, false, false); } finally { R.xr.enabled = xr; R.setRenderTarget(prev); R.setClearColor(hex, pa); }
  }
  let cur = 0;
  function reset(){ zero(rtD[0]); zero(rtD[1]); zero(rtF[0]); zero(rtF[1]); cur = 0; }
  reset();

  /* sewer grates (assumed, the same in every year): weir coefficient Cw 1.66 (SI), open perimeter 2 m, pipe limit 50 L/s.
     2 cm of water over a grate -> about 9 L/s, 5 cm -> 37 L/s, 7 cm or more -> 50 L/s. */
  const P = {rainMmH:0, inletCapLps:50, grateCw:1.66, gratePerimM:2.0, speed:30, drainsOn:true, open:1.0};
  function applyParams(){
    SU.uRain.value = P.rainMmH/3.6e6; SU.uOpen.value = P.open;
    SU.uDrain.value = P.drainsOn ? P.grateCw*P.gratePerimM/(L*L) : 0; SU.uDrainCap.value = P.drainsOn ? P.inletCapLps/1000/(L*L) : 0;
  }
  function step(n){
    applyParams();
    for (let s = 0; s < n; s++){
      SU.tD.value = rtD[cur].texture; SU.tF.value = rtF[cur].texture; run(mFlux, rtF[1 - cur]);
      SU.tF.value = rtF[1 - cur].texture; run(mWater, rtD[1 - cur]); cur = 1 - cur;
    }
    SU.tD.value = rtD[cur].texture; SU.tF.value = rtF[cur].texture; run(mView, rtV);
    simTime += n*SIM_DT;
  }
  let simTime = 0;

  /* readback statistics (a few times a second) */
  const rb = new Float32Array(N*N*4);
  function stats(){
    R.readRenderTargetPixels(rtD[cur], 0, 0, N, N, rb);
    let mx = 0, vol = 0, wet = 0, sum = 0, nz = 0, mi = 0, mj = 0; const wetD = [];
    for (let k = 0; k < N*N; k++){ const d = rb[k*4]; if (d > mx){ mx = d; mi = k % N; mj = (k/N) | 0; } vol += d; if (d > 0.005){ wet++; sum += d; nz++; wetD.push(d); } }
    wetD.sort((a, b) => a - b); const p99 = wetD.length ? wetD[Math.floor(0.99*(wetD.length - 1))] : 0, p50 = wetD.length ? wetD[Math.floor(0.5*(wetD.length - 1))] : 0;
    return {maxDepthM:mx, p99DepthM:p99, p50DepthM:p50, volumeM3:vol*L*L, wetAreaM2:wet*L*L, meanWetDepthM:nz ? sum/nz : 0, where:{i:mi, j:mj, gx:-H + (mi + 0.5)*L, gy:H - (mj + 0.5)*L}, nan:Number.isNaN(mx), simTimeS:simTime};
  }

  /* --------------------------------------------------- the frame (local metres: east, up, south at the data centre) */
  const M = new THREE.Matrix4(), Minv = new THREE.Matrix4();
  function ecef(latD, lonD, h){
    const a = 6378137.0, f = 1/298.257223563, e2 = f*(2 - f), la = latD*Math.PI/180, lo = lonD*Math.PI/180, sl = Math.sin(la), cl = Math.cos(la);
    const Nn = a/Math.sqrt(1 - e2*sl*sl);
    return new THREE.Vector3((Nn + h)*cl*Math.cos(lo), (Nn + h)*cl*Math.sin(lo), (Nn*(1 - e2) + h)*sl);
  }
  const ENU = new THREE.Matrix4();
  function makeFrame(){
    /* local metres (east, up, south) -> world = tiles group matrix x (east, up, south at the centre, in ECEF) */
    S.tiles.group.updateWorldMatrix(true, false);
    const gm = S.tiles.group.matrixWorld, la = cen.lat*Math.PI/180, lo = cen.lon*Math.PI/180;
    const E = new THREE.Vector3(-Math.sin(lo), Math.cos(lo), 0);
    const Nv = new THREE.Vector3(-Math.sin(la)*Math.cos(lo), -Math.sin(la)*Math.sin(lo), Math.cos(la));
    const Uv = new THREE.Vector3(Math.cos(la)*Math.cos(lo), Math.cos(la)*Math.sin(lo), Math.sin(la));
    ENU.makeBasis(E, Uv, Nv.negate()); ENU.setPosition(ecef(cen.lat, cen.lon, reg.frame_ground_ellipsoid_h_m));
    M.multiplyMatrices(gm, ENU); Minv.copy(M).invert();
  }
  makeFrame();

  /* --------------------------------------------------- shading uniforms (shared by every patched material) */
  const U = {
    tWV:{value:rtV.texture}, uWetOn:{value:0}, uWet:{value:0}, uWetRainI:{value:0}, uWetTime:{value:0}, uWetHalf:{value:H}, uWetAdv:{value:8},
    uWetView:{value:new THREE.Matrix4()}, uWetGx:{value:new THREE.Vector3(C, Sn, reg.tx_m)}, uWetGy:{value:new THREE.Vector3(Sn, -C, reg.ty_m)},
    uWetCam:{value:new THREE.Vector3()}, uSkyH:{value:new THREE.Color(0.34, 0.36, 0.40)}, uSkyZ:{value:new THREE.Color(0.17, 0.19, 0.23)},
    tRefl:{value:null}, uReflOn:{value:0}, uReflVP:{value:new THREE.Matrix4()},
    uWetWorld:{value:new THREE.Matrix4()}, uWetWorldMode:{value:opts.worldMode ? 1 : 0}, uWetFine:{value:opts.fine === undefined ? 1 : opts.fine}
  };
  const blankTex = new THREE.DataTexture(new Uint8Array(4), 1, 1); blankTex.needsUpdate = true; U.tRefl.value = blankTex;
  const TMP = new THREE.Vector3();
  function updateCamUniforms(cam){
    if (!cam.isArrayCamera) cam.updateMatrixWorld();
    U.uWetWorld.value.copy(Minv); U.uWetView.value.multiplyMatrices(Minv, cam.matrixWorld); U.uWetCam.value.copy(TMP.setFromMatrixPosition(cam.matrixWorld).applyMatrix4(Minv));
  }
  /* --------------------------------------------------- mirror pass: the real city reflected in the water
     A second camera is mirrored about a level water plane near the viewer and the scene is drawn into a half-size
     texture (sky, buildings, people, cars). The puddles look it up through uReflVP. Below 260 m above the ground only. */
  const terrAt = (x, z) => {
    const gx = C*x + Sn*z + reg.tx_m, gy = Sn*x - C*z + reg.ty_m, i = Math.floor((gx + H)/L), jj = Math.floor((H - gy)/L);
    return (i < 0 || jj < 0 || i >= N || jj >= N) ? null : terr[jj*N + i];
  };
  const RQ = {on:opts.reflections !== false, auto:true, scale:0.5, active:false, paused:'', h0:null, ema:0.016, slowFor:0, ms:0, frames:0, lastT:0, lastCam:null};
  const rtR = new THREE.WebGLRenderTarget(16, 16, {type:THREE.HalfFloatType, format:THREE.RGBAFormat, minFilter:THREE.LinearMipmapLinearFilter, magFilter:THREE.LinearFilter, generateMipmaps:true, depthBuffer:true, stencilBuffer:false});
  const vcam = new THREE.PerspectiveCamera();
  const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3();
  const _q = new THREE.Vector4(), _cp = new THREE.Vector4(), _pl = new THREE.Plane(), RL = new THREE.Matrix4(), RW = new THREE.Matrix4();
  let inRefl = false;
  function reflPlane(cam){
    /* the water level the viewer is looking at: ground under the camera and where the view ray meets it */
    _p.setFromMatrixPosition(cam.matrixWorld).applyMatrix4(Minv);
    const tg = terrAt(_p.x, _p.z); if (tg === null) return null;
    if (_p.y - tg > 260 || _p.y - tg < 0.3) return null;
    _d.set(0, 0, -1).transformDirection(cam.matrixWorld).transformDirection(Minv);
    let h = tg;
    /* the ground where the view ray lands (two refinements), which is the water the eye is on; else the ground underfoot */
    if (_d.y < -0.02){
      for (let it = 0; it < 2; it++){ const t = Math.min(350, Math.max(0, (_p.y - h)/(-_d.y))); const th = terrAt(_p.x + _d.x*t, _p.z + _d.z*t); if (th === null) break; h = th; }
    }
    RQ.h0 = (RQ.h0 === null || Math.abs(RQ.h0 - h) > 6) ? h : RQ.h0 + (h - RQ.h0)*0.12;
    return Math.min(RQ.h0, _p.y - 0.3);
  }
  function renderRefl(cam){
    const h0 = reflPlane(cam); if (h0 === null){ RQ.active = false; U.uReflOn.value = 0; return; }
    const t0 = performance.now();
    /* mirror the camera: position, view target and up all reflected about the plane y = h0 (local), done in world space */
    RL.set(1, 0, 0, 0,  0, -1, 0, 2*h0,  0, 0, 1, 0,  0, 0, 0, 1);
    RW.multiplyMatrices(M, RL).multiply(Minv);
    _w.setFromMatrixPosition(cam.matrixWorld);
    _t.set(0, 0, -1).transformDirection(cam.matrixWorld).multiplyScalar(50).add(_w).applyMatrix4(RW);
    _u.set(0, 1, 0).transformDirection(cam.matrixWorld).transformDirection(RW);
    vcam.position.copy(_w).applyMatrix4(RW); vcam.up.copy(_u); vcam.lookAt(_t);
    vcam.fov = cam.fov; vcam.aspect = cam.aspect; vcam.near = cam.near; vcam.far = cam.far;
    vcam.projectionMatrix.copy(cam.projectionMatrix); vcam.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
    vcam.updateMatrixWorld(true);
    /* oblique near plane = the water plane, so nothing below the water is drawn into the mirror */
    _n.set(0, 1, 0).transformDirection(M);
    _pl.setFromNormalAndCoplanarPoint(_n, _t.set(0, h0 - 0.05, 0).applyMatrix4(M)).applyMatrix4(vcam.matrixWorldInverse);
    _cp.set(_pl.normal.x, _pl.normal.y, _pl.normal.z, _pl.constant);
    const pm = vcam.projectionMatrix.elements;
    _q.x = (Math.sign(_cp.x) + pm[8])/pm[0]; _q.y = (Math.sign(_cp.y) + pm[9])/pm[5]; _q.z = -1.0; _q.w = (1.0 + pm[10])/pm[14];
    _cp.multiplyScalar(2.0/_cp.dot(_q));
    pm[2] = _cp.x; pm[6] = _cp.y; pm[10] = _cp.z + 1.0 - 0.003; pm[14] = _cp.w;
    /* size: a fraction of the canvas */
    const w = Math.max(64, Math.round(R.domElement.width*RQ.scale)), hh = Math.max(64, Math.round(R.domElement.height*RQ.scale));
    if (rtR.width !== w || rtR.height !== hh) rtR.setSize(w, hh);
    /* draw: no puddle reflections inside the mirror (would read the texture being drawn), no camera-attached rain */
    const hidden = []; cam.children.forEach(k => { if (k.visible){ k.visible = false; hidden.push(k); } });
    U.tRefl.value = blankTex; U.uReflOn.value = 0;
    const prevT = R.getRenderTarget(), ac = R.autoClear; R.autoClear = true;
    inRefl = true;
    try { R.setRenderTarget(rtR); R.render(S.scene, vcam); }
    finally { inRefl = false; R.setRenderTarget(prevT); R.autoClear = ac; hidden.forEach(k => { k.visible = true; }); }
    U.tRefl.value = rtR.texture; U.uReflOn.value = 1; RQ.active = true;
    U.uReflVP.value.multiplyMatrices(vcam.projectionMatrix, vcam.matrixWorldInverse).multiply(M);
    RQ.ms = RQ.ms*0.9 + (performance.now() - t0)*0.1; RQ.frames++;
  }
  const prevOBR = S.scene.onBeforeRender;
  S.scene.onBeforeRender = function(r, sc, cam){
    if (prevOBR) prevOBR.apply(this, arguments);
    if (!W || !W.on) return;
    if (!inRefl && cam && cam.isPerspectiveCamera){
      const now = performance.now();
      if (RQ.active && now - RQ.lastT < 6 && RQ.lastCam === cam){ /* this frame's mirror is already drawn (the scene was drawn twice in one frame) */ }
      else if (RQ.on && !RQ.paused && wet > 0.05){ RQ.lastT = now; RQ.lastCam = cam; try { renderRefl(cam); } catch (e){ RQ.paused = 'error'; U.uReflOn.value = 0; U.tRefl.value = blankTex; console.error('water reflections', e); } }
      else { RQ.active = false; U.uReflOn.value = 0; }
    }
    updateCamUniforms(cam);
  };

  /* --------------------------------------------------- patch the real tile materials */
  function patchMat(m){
    if (!m || m.userData.wetP || !(m.isMeshBasicMaterial || m.isMeshStandardMaterial || m.isMeshLambertMaterial)) return;
    m.userData.wetP = 1; const prev = m.onBeforeCompile;
    m.onBeforeCompile = function(sh, rd){
      if (prev) prev.call(this, sh, rd);
      for (const k in U) sh.uniforms[k] = U[k];
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n#ifdef WET_ON\nuniform mat4 uWetView; uniform mat4 uWetWorld; uniform float uWetWorldMode; varying vec3 vWetE;\n#endif')
        .replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef WET_ON\nvWetE = uWetWorldMode > 0.5 ? (uWetWorld*(modelMatrix*vec4(transformed, 1.0))).xyz : (uWetView*vec4(mvPosition.xyz, 1.0)).xyz;\n#endif');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n#ifdef WET_ON\nvarying vec3 vWetE;\n' + WET_UNIFORMS_GLSL + '\n' + WET_FUNCS_GLSL + '\n#endif')
        .replace('#include <opaque_fragment>', '#ifdef WET_ON\noutgoingLight = wetShade(outgoingLight, vWetE);\n#endif\n#include <opaque_fragment>');
    };
    m.defines = m.defines || {}; m.defines.WET_ON = ''; m.needsUpdate = true;
  }
  function patchScene(root){ root.traverse(o => { if (o.isMesh && o.material){ if (Array.isArray(o.material)) o.material.forEach(patchMat); else patchMat(o.material); } }); }
  let hooked = null;
  function hookTiles(){
    const t = S.tiles; if (!t || t === hooked) return; hooked = t;
    t.addEventListener('load-model', e => { if (e && e.scene) patchScene(e.scene); });
    t.addEventListener('tile-visibility-change', e => { if (e && e.visible && e.scene) patchScene(e.scene); });
    patchScene(t.group);
  }
  /* the Time Machine's ground sheet (a ShaderMaterial with a `vL` varying and a final `gl_FragColor = vec4(col, 1.0);`), when it exists */
  const patchedFill = new WeakSet();
  function patchFill(){
    const T = S.TM, f = T && T.fill, m = f && f.material; if (!m || patchedFill.has(m)) return; patchedFill.add(m);
    const key = 'gl_FragColor = vec4(col, 1.0);';
    if (!m.fragmentShader.includes(key) || !m.fragmentShader.includes('void main(){')) { W.fillPatched = false; return; }
    m.fragmentShader = m.fragmentShader.replace('void main(){', WET_UNIFORMS_GLSL + '\n' + WET_FUNCS_GLSL + '\nvoid main(){').replace(key, 'col = wetShade(col, vL);\n  ' + key);
    for (const k in U) if (k !== 'uWetView') m.uniforms[k] = U[k];
    m.needsUpdate = true; W.fillPatched = true;
  }

  /* --------------------------------------------------- UI */
  const css = document.createElement('style');
  css.textContent = `#wpanel{position:absolute;right:14px;top:14px;width:250px;padding:12px 14px;z-index:6;transition:opacity .6s}
  #wpanel .w-t{display:flex;justify-content:space-between;align-items:baseline;font-weight:600;font-size:14px}
  #wpanel .w-t span{font-weight:400;font-size:11.5px;color:var(--dim)}
  #wpanel .w-rd{font-size:13px;margin:8px 0 6px;color:var(--fg);line-height:1.45}
  #wpanel .w-rd i{font-style:normal;color:var(--dim)}
  #wpanel .w-row{display:flex;gap:6px;flex-wrap:wrap}
  #wpanel .w-row button{padding:5px 9px;font-size:12.5px}
  #wpanel .w-note{margin-top:8px;font-size:11px;line-height:1.4;color:var(--dim)}
  body.tour #wpanel{opacity:0;pointer-events:none}
  #wpanel .w-t{cursor:pointer}
  #wpanel.mini{width:auto;max-width:250px;padding:8px 12px}
  #wpanel.mini .w-row,#wpanel.mini .w-note,#wpanel.mini .w-l3{display:none}
  #wpanel.mini .w-rd{margin:4px 0 0;font-size:12px}
  @media (max-width:900px){ #wpanel{top:auto;right:auto;left:14px;bottom:132px;width:min(250px,calc(100% - 28px))} body.tm #wpanel{bottom:262px} }`;
  document.head.appendChild(css);
  const panel = document.createElement('div'); panel.id = 'wpanel'; panel.className = 'glass hide';
  panel.innerHTML = '<div class="w-t">Water <span id="w-sub"></span></div><div class="w-rd" id="w-rd"></div>' +
    '<div class="w-row"><button id="w-speed" title="How fast the storm is played back">Time-lapse</button><button id="w-drain" title="Sewers on or blocked">Drains</button><button id="w-empty">Empty</button>' +
    '<button id="w-refl" title="The real buildings mirrored in the puddles (a second, half-size drawing of the city near the ground)">Reflections</button></div>' +
    '<div class="w-note" id="w-note"></div>';
  document.body.appendChild(panel);
  const btn = $('water');
  const speeds = [1, 10, 30, 120];

  /* --------------------------------------------------- state + frame loop */
  const saved = {rain:null};
  let userOpen = false;
  let acc = 0, lastT = performance.now(), lastStat = 0, lastYear = -1, yearTimer = 0, sweep = 0, wet = 0, rainI = 0, lastWallInfo = wallsInfo;
  function setRain(v){ const el = $('srain'); if (!el) return; el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); }
  function colours(){
    const fog = S.scene.fog && S.scene.fog.color, bg = S.scene.background;
    if (fog){ U.uSkyH.value.copy(fog); U.uSkyH.value.multiplyScalar(1.6); }
    if (bg && bg.isColor) U.uSkyZ.value.copy(bg).multiplyScalar(1.3); else if (fog) U.uSkyZ.value.copy(fog).multiplyScalar(0.9);
  }
  function frame(t){
    requestAnimationFrame(frame);
    if (!S.driveWater) tick(t);
  }
  function tick(t){
    if (!W || !W.on) return;
    if (opts.worldMode) makeFrame();
    const raw = (t - lastT)/1000, dtR = Math.min(0.1, Math.max(0.001, raw)); lastT = t;
    /* keep it smooth: if frames get slow while the mirror is drawn, first draw it smaller, then pause it.
       Gaps over 0.4 s are a hidden or throttled tab, not a slow GPU, and are ignored. */
    if (RQ.active && RQ.auto && !RQ.paused && raw > 0 && raw < 0.4){
      RQ.ema = RQ.ema*0.95 + raw*0.05;
      if (RQ.ema > 0.036){ RQ.slowFor += raw;
        if (RQ.slowFor > 3){ RQ.slowFor = 0; RQ.ema = 0.016; if (RQ.scale > 0.34) RQ.scale = 0.33; else { RQ.paused = 'slow'; U.uReflOn.value = 0; render(); } } }
      else RQ.slowFor = Math.max(0, RQ.slowFor - raw);
    }
    panel.classList.toggle('mini', !!(S.walk && S.walk.on) && !userOpen);
    hookTiles(); if (++sweep % 30 === 0){ patchScene(S.tiles.group); patchFill(); }
    const rainEl = $('srain'), mm = rainEl ? parseFloat(rainEl.value) || 0 : 0;
    P.rainMmH = mm; rainI = Math.min(1, mm/150);
    wet += ((mm > 0 ? Math.min(1, 0.55 + mm/300*0.45) : 0) - wet)*Math.min(1, dtR*(mm > 0 ? 0.6 : 0.03));
    U.uWet.value = wet; U.uWetRainI.value = rainI*(mm > 0 ? 1 : 0); U.uWetTime.value = (t/1000) % 1000; U.uWetAdv.value = Math.min(P.speed, 8);
    colours();
    /* walls follow the Time Machine's year (debounced: rebuilding costs about 20 ms) */
    const Y = yearNow();
    if (Y !== lastYear){ lastYear = Y; clearTimeout(yearTimer); yearTimer = setTimeout(() => { lastWallInfo = rebuildWalls(yearNow()); }, 250); }
    acc += dtR*P.speed/SIM_DT; const n = Math.min(10, Math.floor(acc)); acc = Math.min(acc - n, 1);
    step(n);
    if (t - lastStat > 600){ lastStat = t; W.last = stats(); render(); }
  }
  function render(){
    const s = W.last, mm = P.rainMmH, wi = lastWallInfo;
    $('w-sub').textContent = 'time-lapse ×' + P.speed;
    const cm = v => v*100 < 10 ? (v*100).toFixed(1) : String(Math.round(v*100));
    $('w-rd').innerHTML = (mm ? 'rain <b>' + mm + '</b> mm/h' : '<i>no rain: raise the Rain dial</i>') + '<br>typical puddle <b>' + cm(s.p50DepthM) + ' cm</b> · deepest 1% <b>' + cm(s.p99DepthM) + ' cm</b>' +
      '<span class="w-l3"><br><i>wet ground</i> ' + Math.round(s.wetAreaM2).toLocaleString('en') + ' m² · <i>' + wi.buildings.toLocaleString('en') + ' buildings stand' + (wi.Y < 60000 ? ' in ' + wi.Y : '') + '</i></span>';
    $('w-drain').textContent = P.drainsOn ? 'Drains: working' : 'Drains: blocked';
    $('w-speed').textContent = '×' + P.speed;
    $('w-refl').textContent = RQ.paused === 'slow' ? 'Reflections: paused (slow)' : RQ.paused ? 'Reflections: failed' : RQ.on ? 'Reflections: on' : 'Reflections: off';
    $('w-note').textContent = '2 m grid · ' + wi.inlets + ' sewer grates (low points and about one every 24 m, assumed); each swallows more as the water deepens, up to ' + P.inletCapLps + ' L/s (assumed, same in every year) · buildings are walls · played back ×' + P.speed + ' faster than real time';
  }
  $('w-speed').addEventListener('click', () => { P.speed = speeds[(speeds.indexOf(P.speed) + 1) % speeds.length]; render(); });
  $('w-drain').addEventListener('click', () => { P.drainsOn = !P.drainsOn; render(); });
  $('w-empty').addEventListener('click', () => { reset(); });
  $('w-refl').addEventListener('click', () => {
    if (RQ.paused){ RQ.paused = ''; RQ.on = true; RQ.auto = false; RQ.scale = 0.5; }   /* the viewer asked for them: keep them even if slow */
    else RQ.on = !RQ.on;
    if (!RQ.on){ U.uReflOn.value = 0; U.tRefl.value = blankTex; }
    render();
  });
  panel.querySelector('.w-t').addEventListener('click', () => { userOpen = !userOpen; });
  requestAnimationFrame(frame);

  W = {
    ready:true, loading:false, on:false, N, L, P, U, SU, simTime:() => simTime, last:null, fillPatched:null,
    stats, step, reset, rebuildWalls, walls:() => wallsInfo, tick, opts, years:items.map(b => b.y | 0), refl:RQ, rtR, vcam, terrAt, cellYear, bData, tB, rtD, rtF, rtV, cur:() => cur, M, Minv, makeFrame, patchScene, patchFill, hookTiles,
    glsl:{uniforms:WET_UNIFORMS_GLSL, funcs:WET_FUNCS_GLSL},
    advance(simSeconds){ step(Math.max(1, Math.round(simSeconds/SIM_DT))); return stats(); },
    setOn(v){
      W.on = !!v; U.uWetOn.value = W.on ? 1 : 0; panel.classList.toggle('hide', !W.on);
      if (btn){ btn.textContent = W.on ? 'Water off' : 'Water'; btn.classList.toggle('go', !W.on); }
      if (W.on){
        makeFrame(); hookTiles(); patchFill(); lastT = performance.now(); lastYear = -1;
        const el = $('srain'); saved.rain = el ? el.value : null; if (el && !(parseFloat(el.value) > 0)) setRain(80);
        /* Water covers Plaza Mayor only: bring the camera there when it is far away */
        const c = new THREE.Vector3(0, 0, 0).applyMatrix4(M); S.camera.updateMatrixWorld();
        if (S.camera.position.distanceTo(c) > 1800 && !(S.walk && S.walk.on)){ const pb = [...document.querySelectorAll('#places button')].find(b => /Plaza Mayor/.test(b.textContent)); if (pb) pb.click(); }
        say('Water · storm over Plaza Mayor'); render();
      } else { if (saved.rain !== null) setRain(saved.rain); say('real 3D · streaming'); }
    }
  };
  W.last = stats(); W.on = false; if (!opts.startOff) W.setOn(true);
  return W;
}
