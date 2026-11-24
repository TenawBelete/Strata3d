/* ============================================================== strata8-street.js
   Real street-level photographs (Mapillary, CC BY-SA) projected onto Google's real 3D city, where the
   aerial mesh is weakest: ground floors, doors, shop windows, arcades.
   - Each photo comes with its position and its orientation (computed by Mapillary's structure-from-motion,
     OpenSfM conventions: rotation = world (east, north, up) to camera (x right, y down, z forward)).
   - The photo is projected from where it was taken onto the mesh, like a slide projector. A depth cube rendered
     from the photo's position (inverse distance, 6 faces) hides walls the photo could not see.
   - Two slots cross-fade when the best photo changes as you move.
   - Network (operating rules): nothing on page load; the photo list for an area is fetched only when the person
     presses Street / "Load photos here"; photo downloads have a settle delay (0.6 s), a cache key (photo id)
     and a hard session cap; counts are on screen. Area lists are kept for a day in localStorage.
   Interface: window.__street = {on, photos, slots, NET, U, setOn, loadArea, ...}.
   Reads: window.__strata8 {THREE, renderer, scene, camera, tiles, ray, walk, TM}. */

const TOKEN_KEY = 'strata8.mly';
const FIELDS = 'id,computed_geometry,computed_compass_angle,computed_rotation,camera_type,camera_parameters,width,height,thumb_2048_url,captured_at,creator,is_pano,quality_score';
const RANGE = 34;               /* metres: a photo paints walls up to this far from where it was taken */
const AREA_DLAT = 0.0012, AREA_DLON = 0.0016;   /* about 135 m each way; bbox well under Mapillary's 0.01 square degrees */
let ST = null;

export async function toggle(S){
  const ex = window.__street;
  if (ex && ex.ready){ ex.setOn(!ex.on); return ex; }
  if (ex && ex.loading) return ex;
  ST = {loading:true, ready:false}; window.__street = ST;
  try { ST = create(S); window.__street = ST; ST.setOn(true); }
  catch (e){ ST = null; window.__street = null; console.error(e); const st = document.getElementById('status'); if (st) st.textContent = 'Street: ' + (e && e.message || e); throw e; }
  return ST;
}

/* ------------------------------------------------------------------ shading (GLSL) */
const ST_PARS = `
uniform float uStOn, uStDepth, uStMix;
uniform vec4 uStA0, uStA1;            /* x fade, y type (0 spherical, 1 perspective, 2 fisheye), z range, w unused */
uniform mat3 uStR0, uStR1;            /* local (east, up, south) -> photo camera (x right, y down, z forward) */
uniform vec4 uStK0, uStK1;            /* focal, k1, k2 (OpenSfM, normalised by the longer side) */
uniform vec2 uStS0, uStS1;            /* longer side / width, longer side / height */
uniform mat3 uStW0, uStW1;            /* local -> scene world rotation (depth cube lookup) */
uniform sampler2D tSt0, tSt1;
uniform samplerCube tStD0, tStD1;
varying vec3 vSt0, vSt1, vStCam;
vec4 stOne(vec3 p, vec3 n, vec4 A, mat3 Rc, vec4 K, vec2 S, mat3 Wr, sampler2D T, samplerCube D){
  float dist = length(p);
  if (A.x < 0.002 || dist > A.z || dist < 0.4) return vec4(0.0);
  float face = smoothstep(0.06, 0.30, dot(n, -p/dist));
  if (face <= 0.0) return vec4(0.0);
  float inv = textureLod(D, Wr*p, 0.0).r;
  float ds = inv > 1e-5 ? 1.0/inv : 1e6;
  float vis = 1.0 - smoothstep(0.30 + 0.02*dist, 0.80 + 0.05*dist, dist - ds);
  if (vis <= 0.0) return vec4(0.0);
  vec3 c = Rc*p; vec2 uv; float inside = 1.0;
  if (A.y < 0.5){
    float lon = atan(c.x, c.z), lat = atan(-c.y, length(c.xz));
    uv = vec2(0.5 + lon/6.28318531, 0.5 + lat/3.14159265);
  } else {
    if (c.z < 0.05) return vec4(0.0);
    vec2 xn = c.xy/c.z; float r2 = dot(xn, xn); vec2 pp;
    if (A.y < 1.5){ pp = K.x*(1.0 + K.y*r2 + K.z*r2*r2)*xn; }
    else { float r = sqrt(r2), t = atan(r), td = t*(1.0 + K.y*t*t + K.z*t*t*t*t); pp = K.x*(r > 1e-6 ? td/r : 1.0)*xn; }
    uv = vec2(0.5 + pp.x*S.x, 0.5 - pp.y*S.y);
    inside = smoothstep(0.0, 0.04, uv.x)*smoothstep(1.0, 0.96, uv.x)*smoothstep(0.0, 0.04, uv.y)*smoothstep(1.0, 0.96, uv.y);
  }
  vec3 col = textureLod(T, uv, 0.0).rgb;
  float w = A.x*face*vis*inside*(1.0 - smoothstep(A.z*0.55, A.z, dist));
  return vec4(col, w);
}
vec3 stShade(vec3 col){
  if (uStOn < 0.5) return col;
  vec3 n0 = normalize(cross(dFdx(vSt0), dFdy(vSt0))), n1 = normalize(cross(dFdx(vSt1), dFdy(vSt1)));
  vec4 a = stOne(vSt0, n0, uStA0, uStR0, uStK0, uStS0, uStW0, tSt0, tStD0);
  vec4 b = stOne(vSt1, n1, uStA1, uStR1, uStK1, uStS1, uStW1, tSt1, tStD1);
  float ws = a.w + b.w;
  if (ws < 0.002) return col;
  vec3 ph = (a.rgb*a.w + b.rgb*b.w)/ws;
  float lm = dot(col, vec3(0.2126, 0.7152, 0.0722)), lp = dot(ph, vec3(0.2126, 0.7152, 0.0722));
  ph *= mix(1.0, clamp((lm + 0.03)/(lp + 0.03), 0.65, 1.5), 0.3);     /* meet the mesh's exposure part of the way */
  return mix(col, ph, clamp(min(ws, 1.0), 0.0, 1.0)*uStMix);
}`;

/* ------------------------------------------------------------------ maths */
function ecef(THREE, latD, lonD, h){
  const a = 6378137.0, f = 1/298.257223563, e2 = f*(2 - f), la = latD*Math.PI/180, lo = lonD*Math.PI/180, sl = Math.sin(la), cl = Math.cos(la);
  const Nn = a/Math.sqrt(1 - e2*sl*sl);
  return new THREE.Vector3((Nn + h)*cl*Math.cos(lo), (Nn + h)*cl*Math.sin(lo), (Nn*(1 - e2) + h)*sl);
}
function geodetic(x, y, z){                      /* ECEF -> lat, lon (degrees), ellipsoid height (m) */
  const a = 6378137.0, f = 1/298.257223563, e2 = f*(2 - f), lon = Math.atan2(y, x), p = Math.hypot(x, y);
  let lat = Math.atan2(z, p*(1 - e2)), h = 0;
  for (let i = 0; i < 6; i++){ const s = Math.sin(lat), N = a/Math.sqrt(1 - e2*s*s); h = p/Math.cos(lat) - N; lat = Math.atan2(z, p*(1 - e2*N/(N + h))); }
  return {lat:lat*180/Math.PI, lon:lon*180/Math.PI, h};
}
function rodrigues(r){                           /* axis-angle -> 3x3 rows */
  const th = Math.hypot(r[0], r[1], r[2]);
  if (th < 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const x = r[0]/th, y = r[1]/th, z = r[2]/th, c = Math.cos(th), s = Math.sin(th), C = 1 - c;
  return [[c + x*x*C, x*y*C - z*s, x*z*C + y*s], [y*x*C + z*s, c + y*y*C, y*z*C - x*s], [z*x*C - y*s, z*y*C + x*s, c + z*z*C]];
}
function compassRows(deg){                       /* level camera looking at a compass bearing */
  const a = deg*Math.PI/180, s = Math.sin(a), c = Math.cos(a);
  return [[c, -s, 0], [0, 0, -1], [s, c, 0]];   /* rows: camera x (right), y (down), z (forward) in (east, north, up) */
}

/* ------------------------------------------------------------------ build */
function create(S){
  const THREE = S.THREE, R = S.renderer, $ = id => document.getElementById(id);
  const say = t => { const e = $('status'); if (e) e.textContent = t; };
  if (!S.tiles) throw new Error('the 3D city is not loaded yet');

  /* network budget (operating rules 1, 3, 5) */
  const NET = {searches:0, photos:0, capSearches:25, capPhotos:120, gap:{graph:1500, photo:250}, last:{}, refused:0,
    claim(kind){
      const now = performance.now(), cap = kind === 'graph' ? this.capSearches : this.capPhotos, n = kind === 'graph' ? this.searches : this.photos;
      if (n >= cap){ this.refused++; return false; }
      if (this.last[kind] && now - this.last[kind] < this.gap[kind]) return false;
      this.last[kind] = now; if (kind === 'graph') this.searches++; else this.photos++; return true;
    }};

  /* ---------------------------------------------- uniforms shared by every patched tile material */
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blank.needsUpdate = true;
  const mkCube = () => { const rt = new THREE.WebGLCubeRenderTarget(256, {type:THREE.HalfFloatType, format:THREE.RGBAFormat, generateMipmaps:false, minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter});
    return {rt, cam:new THREE.CubeCamera(0.3, RANGE*1.6, rt)}; };
  const U = {uStOn:{value:0}, uStDepth:{value:0}, uStMix:{value:0.9}};
  const slots = [0, 1].map(i => {
    const c = mkCube();
    U['uStView' + i] = {value:new THREE.Matrix4()}; U['uStA' + i] = {value:new THREE.Vector4(0, 0, RANGE, 0)};
    U['uStR' + i] = {value:new THREE.Matrix3()}; U['uStK' + i] = {value:new THREE.Vector4(0.8, 0, 0, 0)}; U['uStS' + i] = {value:new THREE.Vector2(1, 1)};
    U['uStW' + i] = {value:new THREE.Matrix3()}; U['tSt' + i] = {value:blank}; U['tStD' + i] = {value:c.rt.texture};
    return {i, cube:c, photo:null, pending:null, fade:0, target:0, M:new THREE.Matrix4(), Minv:new THREE.Matrix4(), lastCube:0};
  });

  /* ---------------------------------------------- patch the real tile materials */
  function patchMat(m){
    if (!m || m.userData.stP || !(m.isMeshBasicMaterial || m.isMeshStandardMaterial || m.isMeshLambertMaterial)) return;
    m.userData.stP = 1; const prev = m.onBeforeCompile;
    m.onBeforeCompile = function(sh, rd){
      if (prev) prev.call(this, sh, rd);
      for (const k in U) sh.uniforms[k] = U[k];
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n#ifdef ST_ON\nuniform mat4 uStView0, uStView1; varying vec3 vSt0, vSt1, vStCam;\n#endif')
        .replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef ST_ON\nvStCam = mvPosition.xyz; vSt0 = (uStView0*vec4(mvPosition.xyz, 1.0)).xyz; vSt1 = (uStView1*vec4(mvPosition.xyz, 1.0)).xyz;\n#endif');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n#ifdef ST_ON\n' + ST_PARS + '\n#endif')
        .replace('#include <logdepthbuf_fragment>', '#include <logdepthbuf_fragment>\n#ifdef ST_ON\nif (uStDepth > 0.5){ gl_FragColor = vec4(1.0/max(length(vStCam), 0.01), 0.0, 0.0, 1.0); return; }\n#endif')
        .replace('#include <opaque_fragment>', '#ifdef ST_ON\noutgoingLight = stShade(outgoingLight);\n#endif\n#include <opaque_fragment>');
    };
    m.defines = m.defines || {}; m.defines.ST_ON = ''; m.needsUpdate = true;
  }
  function patchScene(root){ root.traverse(o => { if (o.isMesh && o.material){ if (Array.isArray(o.material)) o.material.forEach(patchMat); else patchMat(o.material); } }); }
  let hooked = null;
  function hookTiles(){
    const t = S.tiles; if (!t || t === hooked) return; hooked = t;
    t.addEventListener('load-model', e => { if (e && e.scene) patchScene(e.scene); });
    t.addEventListener('tile-visibility-change', e => { if (e && e.visible && e.scene) patchScene(e.scene); });
    patchScene(t.group);
  }

  /* ---------------------------------------------- frames */
  const _gi = new THREE.Matrix4(), _p = new THREE.Vector3(), _f = new THREE.Vector3();
  function frameAt(lat, lon, h, out){            /* local (east, up, south) metres -> scene world */
    S.tiles.group.updateWorldMatrix(true, false);
    const la = lat*Math.PI/180, lo = lon*Math.PI/180;
    const E = new THREE.Vector3(-Math.sin(lo), Math.cos(lo), 0);
    const N = new THREE.Vector3(-Math.sin(la)*Math.cos(lo), -Math.sin(la)*Math.sin(lo), Math.cos(la));
    const Uv = new THREE.Vector3(Math.cos(la)*Math.cos(lo), Math.cos(la)*Math.sin(lo), Math.sin(la));
    const L = new THREE.Matrix4().makeBasis(E, Uv, N.negate()).setPosition(ecef(THREE, lat, lon, h));
    return (out || new THREE.Matrix4()).multiplyMatrices(S.tiles.group.matrixWorld, L);
  }
  function camGeo(){
    S.tiles.group.updateWorldMatrix(true, false); _gi.copy(S.tiles.group.matrixWorld).invert();
    S.camera.updateMatrixWorld();
    _p.setFromMatrixPosition(S.camera.matrixWorld).applyMatrix4(_gi);
    const g = geodetic(_p.x, _p.y, _p.z);
    /* forward direction in east / north */
    _f.set(0, 0, -1).transformDirection(S.camera.matrixWorld).transformDirection(_gi);
    const la = g.lat*Math.PI/180, lo = g.lon*Math.PI/180;
    g.fe = -Math.sin(lo)*_f.x + Math.cos(lo)*_f.y;
    g.fn = -Math.sin(la)*Math.cos(lo)*_f.x - Math.sin(la)*Math.sin(lo)*_f.y + Math.cos(la)*_f.z;
    return g;
  }
  /* street floor under a point (ellipsoid height): first hit from above, then look under it (roofs, awnings, crowns) */
  function groundAt(lat, lon, hTop){
    /* start well above any street (the camera's own height is not trusted: it can be mid-flight) */
    if (!(hTop > -500 && hTop < 6000)) hTop = 3000; hTop = Math.max(hTop, 1200);
    const ray = S.ray || new THREE.Raycaster(), k = Math.cos(lat*Math.PI/180);
    function one(la, lo){
      const M = frameAt(la, lo, hTop), o = new THREE.Vector3().setFromMatrixPosition(M), d = new THREE.Vector3(0, -1, 0).transformDirection(M);
      ray.set(o, d); ray.far = hTop + 600; let h = ray.intersectObject(S.tiles.group, true);
      if (!h.length) return null;
      const a = hTop - h[0].distance;
      ray.set(h[0].point.clone().addScaledVector(d, 0.4), d); ray.far = 40; h = ray.intersectObject(S.tiles.group, true);
      if (h.length){ const b = a - 0.4 - h[0].distance; if (a - b >= 2.0 && a - b <= 30) return b; }
      return a;
    }
    /* a single ray can slip through a seam between two tiles: sample the spot and four points 0.8 m around it, keep the middle value */
    const got = [];
    for (const [de, dn] of [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]){
      const g = one(lat + dn/110540, lon + de/(111320*k)); if (g !== null) got.push(g);
      if (got.length >= 3) break;
    }
    if (!got.length) return null;
    got.sort((x, y) => x - y); return got[Math.floor(got.length/2)];
  }

  /* ---------------------------------------------- photos of an area */
  let photos = [], area = null, token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e){}
  function prep(o){
    const g = o.computed_geometry && o.computed_geometry.coordinates; if (!g) return null;
    const type = (o.camera_type === 'spherical' || o.camera_type === 'equirectangular' || o.is_pano) ? 0 : o.camera_type === 'fisheye' ? 2 : 1;
    const cp = o.camera_parameters || [];
    if (type > 0 && !(cp[0] > 0.1)) return null;
    const rows = (o.computed_rotation && o.computed_rotation.length === 3) ? rodrigues(o.computed_rotation) : (isFinite(o.computed_compass_angle) ? compassRows(o.computed_compass_angle) : null);
    if (!rows) return null;
    const bearing = (Math.atan2(rows[2][0], rows[2][1])*180/Math.PI + 360) % 360;
    return {id:o.id, lon:g[0], lat:g[1], type, f:cp[0] || 0, k1:cp[1] || 0, k2:cp[2] || 0, w:o.width || 2048, h:o.height || 1024,
      rows, bearing, tilt:Math.asin(Math.max(-1, Math.min(1, rows[2][2])))*180/Math.PI,    /* up/down angle of the lens */
      dCompass:isFinite(o.computed_compass_angle) ? (((bearing - o.computed_compass_angle + 540) % 360) - 180) : null,
      url:o.thumb_2048_url, t:o.captured_at || 0, user:o.creator && o.creator.username || '?', q:o.quality_score == null ? 0.5 : o.quality_score, ground:null};
  }
  async function loadArea(){
    if (!token){ showToken(true); return; }
    const c = camGeo(); const key = 'strata8.mly.area.' + c.lat.toFixed(3) + ',' + c.lon.toFixed(3);
    let list = null;
    try { const raw = localStorage.getItem(key); if (raw){ const j = JSON.parse(raw); if (Date.now() - j.at < 20*3600e3) list = j.list; } } catch (e){}
    if (!list){
      if (!NET.claim('graph')){ msg(NET.searches >= NET.capSearches ? 'Photo search limit for this session reached (' + NET.capSearches + ').' : 'One moment…'); render(); return; }
      const bb = [c.lon - AREA_DLON, c.lat - AREA_DLAT, c.lon + AREA_DLON, c.lat + AREA_DLAT].map(v => v.toFixed(6)).join(',');
      msg('Asking Mapillary for street photos here…'); render();
      let j;
      try {
        /* client token as a query parameter (as MapillaryJS does; no CORS preflight) */
        const r = await fetch('https://graph.mapillary.com/images?access_token=' + encodeURIComponent(token) + '&fields=' + FIELDS + '&bbox=' + bb + '&limit=2000');
        j = await r.json();
        if (!r.ok || j.error){ const m = (j && j.error && j.error.message) || ('HTTP ' + r.status); if (/token|OAuth|190|auth/i.test(m)){ showToken(true); msg('Mapillary did not accept the token: ' + m); } else msg('Mapillary: ' + m); render(); return; }
      } catch (e){ msg('Mapillary could not be reached (' + (e && e.message || e) + ')'); render(); return; }
      list = (j.data || []).map(prep).filter(Boolean);
      try { localStorage.setItem(key, JSON.stringify({at:Date.now(), list})); } catch (e){}
    }
    photos = list.map(p => Object.assign({}, p, {ground:null}));
    area = {lat:c.lat, lon:c.lon, ground:groundAt(c.lat, c.lon, c.h + 60)};
    const d = photos.map(p => p.dCompass).filter(v => v !== null).map(Math.abs).sort((a, b) => a - b);
    stats.compassMedian = d.length ? d[Math.floor(d.length/2)] : null;
    stats.panos = photos.filter(p => p.type === 0).length;
    msg(photos.length ? '' : 'No street photos here on Mapillary.'); render();
  }

  /* ---------------------------------------------- textures: cache by photo id, settle delay, cap */
  const texCache = new Map();                    /* id -> {tex, used} */
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
  function getTex(p){
    const c = texCache.get(p.id); if (c){ c.used = performance.now(); return Promise.resolve(c.tex); }
    if (!NET.claim('photo')) return Promise.resolve(null);
    return new Promise(res => {
      loader.load(p.url, tex => {
        tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
        tex.wrapS = p.type === 0 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
        texCache.set(p.id, {tex, used:performance.now()});
        if (texCache.size > 10){ let old = null; for (const [k, v] of texCache) if (!old || v.used < old[1].used) old = [k, v]; if (old && !slots.some(s => s.photo && s.photo.id === old[0])){ old[1].tex.dispose(); texCache.delete(old[0]); } }
        res(tex);
      }, undefined, () => { stats.loadErrors++; res(null); });
    });
  }

  /* ---------------------------------------------- the depth cube: what the photo's camera could see */
  const _cc = new THREE.Color();
  function renderCube(slot){
    const prevC = R.getClearColor(_cc).getHex(), prevA = R.getClearAlpha();
    slot.cube.cam.position.setFromMatrixPosition(slot.M); slot.cube.cam.updateMatrixWorld(true);
    U.uStDepth.value = 1; R.setClearColor(0x000000, 1);
    try { slot.cube.cam.update(R, S.tiles.group); }
    finally { U.uStDepth.value = 0; R.setClearColor(prevC, prevA); }
    slot.lastCube = performance.now(); stats.cubes++;
  }

  /* ---------------------------------------------- put a photo into a slot */
  const P = new THREE.Matrix3().set(1, 0, 0,  0, 0, -1,  0, 1, 0);     /* local (east, up, south) -> (east, north, up) */
  async function activate(slot, p, camH){
    slot.pending = p.id;
    if (p.ground === null){ p.ground = groundAt(p.lat, p.lon, camH + 60); if (p.ground === null) p.ground = camH - (S.walk && S.walk.on ? S.walk.h : 2); }
    const tex = await getTex(p);
    if (slot.pending !== p.id) return false;
    if (!tex){ slot.pending = null; p.bad = true; return false; }
    const hCam = p.ground + (p.type === 0 ? 2.3 : 1.8);
    frameAt(p.lat, p.lon, hCam, slot.M); slot.Minv.copy(slot.M).invert();
    const r = p.rows, Rwc = new THREE.Matrix3().set(r[0][0], r[0][1], r[0][2], r[1][0], r[1][1], r[1][2], r[2][0], r[2][1], r[2][2]);
    U['uStR' + slot.i].value.multiplyMatrices(Rwc, P);
    U['uStW' + slot.i].value.setFromMatrix4(slot.M);
    U['uStK' + slot.i].value.set(p.f, p.k1, p.k2, 0);
    const mx = Math.max(p.w, p.h); U['uStS' + slot.i].value.set(mx/p.w, mx/p.h);
    U['uStA' + slot.i].value.set(0, p.type, RANGE, 0);
    U['tSt' + slot.i].value = tex;
    renderCube(slot);
    slot.photo = p; slot.pending = null; slot.fade = 0; slot.target = 1;
    return true;
  }

  /* ---------------------------------------------- choose the best photo for where you are and look */
  let lead = 0, cand = null, candSince = 0, lastPick = 0, camAbove = 999, lastG = null, groundTry = 0, pinned = null, coverNow = 0;
  const stats = {cubes:0, loadErrors:0, compassMedian:null, panos:0, picks:0};
  function geoOffset(c, p){ const k = Math.cos(c.lat*Math.PI/180); return {e:(p.lon - c.lon)*111320*k, n:(p.lat - c.lat)*110540}; }
  /* what you are looking at: 7 rays from the eye (centre, left, right, up-left, up-right, low, far low) */
  const VIEW = [[0, 0], [-0.4, 0], [0.4, 0], [-0.28, 0.2], [0.28, 0.2], [0, -0.18], [-0.2, -0.1]];
  function viewHits(){
    const cam = S.camera, o = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld), ray = S.ray || new THREE.Raycaster(), out = [];
    for (const [x, y] of VIEW){
      const d = new THREE.Vector3(x, y, -1).normalize().transformDirection(cam.matrixWorld);
      ray.set(o, d); ray.far = RANGE*1.6; const h = ray.intersectObject(S.tiles.group, true)[0];
      if (h) out.push({p:h.point.clone(), n:h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null});
    }
    return out;
  }
  const _M = new THREE.Matrix4(), _Mi = new THREE.Matrix4(), _l = new THREE.Vector3(), _n = new THREE.Vector3(), _R3 = new THREE.Matrix3();
  /* share of the looked-at points this photo really shows (in its frame, facing it, in range) */
  function coverage(p, hits, gEll){
    if (!hits.length) return 0;
    frameAt(p.lat, p.lon, (p.ground !== null ? p.ground : gEll) + (p.type === 0 ? 2.3 : 1.8), _M); _Mi.copy(_M).invert();
    const r = p.rows; _R3.set(r[0][0], r[0][1], r[0][2], r[1][0], r[1][1], r[1][2], r[2][0], r[2][1], r[2][2]).multiply(P);
    const mx = Math.max(p.w, p.h); let ok = 0;
    for (const h of hits){
      _l.copy(h.p).applyMatrix4(_Mi); const dist = _l.length(); if (dist > RANGE || dist < 0.5) continue;
      if (h.n){ _n.copy(h.n).transformDirection(_Mi); if (_n.dot(_l)/dist > -0.08) continue; }   /* the surface must face the photo */
      if (p.type === 0){ ok++; continue; }
      const c = _l.clone().applyMatrix3(_R3); if (c.z < 0.2) continue;
      const xn = c.x/c.z, yn = c.y/c.z, r2 = xn*xn + yn*yn, k = p.type === 1 ? (1 + p.k1*r2 + p.k2*r2*r2) : 1;
      const u = 0.5 + p.f*k*xn*mx/p.w, v = 0.5 + p.f*k*yn*mx/p.h;
      if (u > 0.04 && u < 0.96 && v > 0.04 && v < 0.96) ok++;
    }
    return ok/hits.length;
  }
  function score(c, p, hits, gEll){
    const o = geoOffset(c, p), d = Math.hypot(o.e, o.n); if (d > RANGE*0.9 || p.bad) return 1e9;
    const cov = coverage(p, hits, gEll); p.cov = cov; if (cov < 0.15) return 1e9;
    const age = Math.max(0, (Date.now() - p.t)/3.15e10);
    return d*0.6 + age*0.4 - cov*30 - p.q*3 - (p.type === 0 ? 4 : 0) + Math.abs(p.tilt)*0.15;
  }
  function pick(t){
    if (!photos.length) return;
    const c = camGeo(); lastG = c;
    const g0 = (slots[lead].photo && slots[lead].photo.ground !== null) ? slots[lead].photo.ground : (area ? area.ground : null);
    if (g0 === null && area && t - groundTry > 5000){ groundTry = t; area.ground = groundAt(c.lat, c.lon, c.h + 60); }
    camAbove = (S.walk && S.walk.on) ? S.walk.h : (g0 !== null && g0 !== undefined ? c.h - g0 : camAbove);
    if (camAbove > 90){ cand = null; return; }
    const hits = viewHits(), gEll = c.h - (camAbove < 90 ? camAbove : 1.75);
    if (pinned){ const o = geoOffset(c, pinned); if (Math.hypot(o.e, o.n) < 4){ cand = null; return; } pinned = null; }
    let best = null, bs = 1e9, nCov = 0;
    for (const p of photos){ const s = score(c, p, hits, gEll); if (s < 1e8) nCov++; if (s < bs){ bs = s; best = p; } }
    coverNow = nCov;
    const cur = slots[lead].photo, cs = cur ? score(c, cur, hits, gEll) : 1e9;
    if (cur && cs > 1e8 && !best){ slots[lead].target = 0; }       /* nothing here shows what you look at: let the mesh be */
    if (cur && best && best.id === cur.id) slots[lead].target = 1;
    if (!best || (cur && best.id === cur.id) || bs > cs - 2.5){ cand = null; return; }
    if (!cand || cand.id !== best.id){ cand = best; candSince = t; return; }
    if (t - candSince < 600) return;                               /* settle: the best photo must stay best for 0.6 s */
    const other = slots[1 - lead]; if (other.pending || other.fade > 0.05) return;
    cand = null; stats.picks++;
    activate(other, best, c.h).then(ok => { if (ok){ slots[lead].target = 0; lead = other.i; render(); } });
  }

  /* ---------------------------------------------- stand where a photo was taken */
  async function standAt(p){
    const W = S.walk; if (!W || !W.on || W.mode !== 'run'){ msg('Press Run first, then this button.'); render(); return; }
    const c = camGeo();
    { const o = geoOffset(c, p); if (Math.hypot(o.e, o.n) > 400){ msg('That photo is far from you: load photos here first.'); render(); return; } }
    if (p.ground === null){ p.ground = groundAt(p.lat, p.lon, c.h + 60); if (p.ground === null){ msg('Could not find the ground there.'); render(); return; } }
    const G = new THREE.Vector3().setFromMatrixPosition(frameAt(p.lat, p.lon, p.ground));
    W.gr = W.grT = G.length(); W.vel.set(0, 0, 0); W.jo = 0; W.jv = 0;
    S.camera.position.copy(G).normalize().multiplyScalar(W.gr + W.h);
    W.yaw = p.bearing*Math.PI/180; W.pitch = Math.max(-0.6, Math.min(0.6, p.tilt*Math.PI/180));
    pinned = p; cand = null;
    const other = slots[1 - lead];
    if (other.pending){ other.pending = null; }
    if (slots[lead].photo && slots[lead].photo.id === p.id){ slots[lead].target = 1; render(); return; }
    other.fade = 0;
    const ok = await activate(other, p, c.h);
    if (ok){ slots[lead].target = 0; lead = other.i; }
    msg(''); render();
  }
  /* the next photo spot in front of you (within 35 degrees of where you look, 2.5-40 m away) */
  function photoAhead(){
    const c = camGeo(), fl = Math.hypot(c.fe, c.fn) || 1; let best = null, bs = 1e9;
    for (const p of photos){
      if (p.bad) continue; const o = geoOffset(c, p), d = Math.hypot(o.e, o.n); if (d < 2.5 || d > 40) continue;
      const cs = (o.e*c.fe + o.n*c.fn)/(d*fl); if (cs < 0.82) continue;
      const s = d*(2.2 - cs) - (p.type === 0 ? 4 : 0) + Math.max(0, (Date.now() - p.t)/3.15e10)*0.3; if (s < bs){ bs = s; best = p; }
    }
    return best;
  }
  function nearestPhoto(){
    const c = camGeo(); let best = null, bd = 1e9;
    for (const p of photos){ if (p.bad) continue; const o = geoOffset(c, p), d = Math.hypot(o.e, o.n) - (p.type === 0 ? 6 : 0); if (d < bd){ bd = d; best = p; } }
    return best;
  }

  /* ---------------------------------------------- per-frame */
  const prevOBR = S.scene.onBeforeRender;
  S.scene.onBeforeRender = function(r, sc, cam){
    if (prevOBR) prevOBR.apply(this, arguments);
    if (!ST || !ST.on || !cam) return;
    if (!cam.isArrayCamera) cam.updateMatrixWorld();
    for (const s of slots) U['uStView' + s.i].value.multiplyMatrices(s.Minv, cam.matrixWorld);
  };
  let lastT = performance.now(), sweep = 0;
  function frame(t){
    requestAnimationFrame(frame);
    if (!ST || !ST.on) return;
    const dt = Math.min(0.1, Math.max(0.001, (t - lastT)/1000)); lastT = t;
    hookTiles(); if (++sweep % 45 === 0) patchScene(S.tiles.group);
    const tmOff = !(S.TM && S.TM.on);
    for (const s of slots){
      const want = (s.photo && tmOff && camAbove <= 90) ? s.target : 0;
      s.fade += (want - s.fade)*Math.min(1, dt*2.2);
      U['uStA' + s.i].value.x = s.fade;
      if (s.photo && s.fade > 0.02 && t - s.lastCube > 2500) renderCube(s);   /* tiles keep streaming in: refresh what the photo can see */
    }
    if (t - lastPick > 300){ lastPick = t; try { pick(t); } catch (e){ console.error(e); } }
    if (t - lastUi > 700){ lastUi = t; render(); }
  }
  let lastUi = 0;

  /* ---------------------------------------------- UI */
  const css = document.createElement('style');
  css.textContent = `#spanel{position:absolute;right:14px;bottom:64px;width:272px;padding:11px 13px;z-index:6}
  #spanel .s-t{display:flex;justify-content:space-between;align-items:baseline;font-weight:600;font-size:14px}
  #spanel .s-t span{font-weight:400;font-size:11.5px;color:var(--dim)}
  #spanel .s-rd{font-size:12.5px;margin:7px 0;line-height:1.45}
  #spanel .s-row{display:flex;gap:6px;flex-wrap:wrap}
  #spanel .s-row button{padding:5px 9px;font-size:12.5px}
  #spanel .s-small{margin-top:7px;font-size:11px;line-height:1.4;color:var(--dim)}
  #spanel .s-small a, #s-pipcap a{color:var(--accent)}
  #spanel input{width:100%;margin:6px 0;background:rgba(0,0,0,.4);border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:7px 9px;font:inherit}
  #s-pipbox{position:absolute;right:14px;top:120px;width:300px;padding:6px;z-index:6}
  #s-pipbox img{display:block;width:100%;border-radius:9px}
  #s-pipcap{font-size:11px;color:var(--dim);padding:5px 3px 1px;line-height:1.35}
  body.tour #spanel, body.tour #s-pipbox{opacity:0;pointer-events:none}`;
  document.head.appendChild(css);
  const panel = document.createElement('div'); panel.id = 'spanel'; panel.className = 'glass hide';
  panel.innerHTML = '<div class="s-t">Street photos <span>Mapillary</span></div>' +
    '<div id="s-tok" class="hide"><div class="s-small" style="margin-top:4px">Paste your Mapillary client token (starts with MLY|). It stays in this browser. <a href="https://www.mapillary.com/dashboard/developers" target="_blank" rel="noopener">Get one</a></div>' +
    '<input id="s-tokin" type="password" autocomplete="off" placeholder="MLY|…"><div class="s-row"><button id="s-toksave" class="go">Save and load photos</button></div></div>' +
    '<div class="s-rd" id="s-rd"></div>' +
    '<div class="s-row"><button id="s-stand" class="go" title="Run mode: put your eyes where the nearest photo was taken, looking the same way. From there the photo fits the walls exactly.">Stand where a photo was taken</button><button id="s-next" class="go" title="Hop to the next photo spot in front of you">Next photo ahead</button></div>' +
    '<div class="s-row" style="margin-top:6px"><button id="s-load">Load photos here</button><button id="s-pip">Original photo</button><button id="s-mix">Blend 90%</button></div>' +
    '<div class="s-small" id="s-cred"></div><div class="s-small" id="s-net"></div>';
  document.body.appendChild(panel);
  const pip = document.createElement('div'); pip.id = 's-pipbox'; pip.className = 'glass hide';
  pip.innerHTML = '<img id="s-img" crossorigin="anonymous" alt="Street photo"><div id="s-pipcap"></div>'; document.body.appendChild(pip);
  let pipOn = false, note = '';
  const msg = t => { note = t; };
  function showToken(v){ $('s-tok').classList.toggle('hide', !v); if (v) setTimeout(() => { const i = $('s-tokin'); if (i) i.focus(); }, 50); }
  const btn = $('street');
  function render(){
    const a = slots[lead].photo, n = photos.length;
    let rd;
    if (note) rd = note;
    else if (!token) rd = 'Needs your Mapillary token (free).';
    else if (!area) rd = 'Press <b>Load photos here</b>.';
    else if (!n) rd = 'No street photos here on Mapillary.';
    else if (camAbove > 90) rd = '<b>' + n + '</b> photos here (' + stats.panos + ' 360°). Fly low or Run to see them on the walls.';
    else if (!a || slots[lead].target === 0) rd = '<b>' + n + '</b> photos here, but none shows the walls you are looking at. Turn, walk, or press <b>Stand where a photo was taken</b>.';
    else { const d = lastG ? Math.round(Math.hypot(geoOffset(lastG, a).e, geoOffset(lastG, a).n)) : '?';
      rd = 'Real photo on the walls: taken <b>' + d + ' m</b> from you' + (a.type === 0 ? ' (360°)' : '') + ', ' + new Date(a.t).getFullYear() + '. ' + (d > 3 ? 'The closer you stand to where it was taken, the better it fits.' : 'You are standing where it was taken.'); }
    if (S.TM && S.TM.on && a) rd += '<br><i style="color:var(--dim)">Hidden while the Time Machine is on (the photos are recent).</i>';
    $('s-rd').innerHTML = rd;
    $('s-cred').innerHTML = a ? 'Images from Mapillary, CC BY-SA, by <a href="https://www.mapillary.com/app/?pKey=' + a.id + '" target="_blank" rel="noopener">@' + a.user.replace(/[<>&"]/g, '') + '</a>' : 'Images from Mapillary, CC BY-SA';
    $('s-net').textContent = 'Mapillary this session: ' + NET.searches + ' search' + (NET.searches === 1 ? '' : 'es') + ', ' + NET.photos + ' photos (limits ' + NET.capSearches + ' / ' + NET.capPhotos + ')';
    $('s-pip').textContent = pipOn ? 'Hide original' : 'Original photo';
    $('s-mix').textContent = 'Blend ' + Math.round(U.uStMix.value*100) + '%';
    const far = area && lastG && Math.hypot(geoOffset(lastG, area).e, geoOffset(lastG, area).n) > 110;
    $('s-load').classList.toggle('go', !!token && (!area || far));
    pip.classList.toggle('hide', !(pipOn && a && ST.on));
    if (pipOn && a){ const img = $('s-img'); if (img.dataset.id !== a.id){ img.dataset.id = a.id; img.src = a.url; }
      $('s-pipcap').innerHTML = (a.type === 0 ? '360° photo' : 'Photo') + ', ' + new Date(a.t).toLocaleDateString('en-GB', {month:'short', year:'numeric'}) +
        ' · by <a href="https://www.mapillary.com/app/?pKey=' + a.id + '" target="_blank" rel="noopener">@' + a.user.replace(/[<>&"]/g, '') + '</a> on Mapillary, CC BY-SA'; }
  }
  $('s-load').addEventListener('click', () => { note = ''; loadArea(); });
  $('s-pip').addEventListener('click', () => { pipOn = !pipOn; render(); });
  $('s-next').addEventListener('click', () => { const p = photoAhead(); if (p) standAt(p); else { msg(photos.length ? 'No photo spot ahead within 40 m: turn a little.' : 'Load photos first.'); render(); } });
  $('s-stand').addEventListener('click', () => { const p = nearestPhoto(); if (p) standAt(p); else { msg(photos.length ? 'No photo near you.' : 'Load photos first.'); render(); } });
  $('s-mix').addEventListener('click', () => { const v = [0.9, 0.7, 0.5, 1.0]; U.uStMix.value = v[(v.indexOf(U.uStMix.value) + 1) % v.length]; render(); });
  $('s-toksave').addEventListener('click', () => {
    const v = $('s-tokin').value.trim(); if (!v) return;
    token = v; try { localStorage.setItem(TOKEN_KEY, v); } catch (e){}
    $('s-tokin').value = ''; showToken(false); note = ''; loadArea();
  });
  requestAnimationFrame(frame);

  const api = {
    ready:true, loading:false, on:false, U, slots, NET, stats, RANGE,
    get photos(){ return photos; }, get area(){ return area; }, get lead(){ return lead; }, get camAbove(){ return camAbove; },
    loadArea, frameAt, groundAt, camGeo, renderCube, patchScene, prep, render, standAt, nearestPhoto, photoAhead, viewHits, coverage, get coverNow(){ return coverNow; },
    setOn(v){
      api.on = !!v; U.uStOn.value = api.on ? 1 : 0; panel.classList.toggle('hide', !api.on);
      if (btn){ btn.textContent = api.on ? 'Street off' : 'Street'; btn.classList.toggle('go', !api.on); }
      if (api.on){ hookTiles(); lastT = performance.now(); if (!token) showToken(true); else if (!area) loadArea(); say('Street photos · Mapillary'); }
      else { pip.classList.add('hide'); say('real 3D · streaming'); }
      render();
    }
  };
  return api;
}
