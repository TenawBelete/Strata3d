/* strata-perf.js: a small smoothness meter for the Strata pages.
   Shown when the page address ends with ?fps (for example http://localhost:8000/strata8.html?fps), or with Shift+F.
   Green: 50 frames per second or more (smooth). Yellow: 30-49 (fine for a demo). Red: under 30 (feels jerky).
   It only measures; it changes nothing on the page. During an AR/VR session the browser pauses it. */
(function(){
  var on = /[?&]fps\b/.test(location.search);
  var el = document.createElement('div');
  el.id = 'perfmeter';
  el.style.cssText = 'position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:60;pointer-events:none;' +
    'font:600 12px/1.3 ui-monospace,Menlo,monospace;background:rgba(0,0,0,.72);padding:4px 10px;border-radius:8px;' +
    'white-space:nowrap;display:' + (on ? 'block' : 'none');
  el.textContent = 'measuring…';
  document.body.appendChild(el);
  var t0 = performance.now(), last = t0, frames = 0, times = [];
  function tick(t){
    requestAnimationFrame(tick);
    var dt = t - last; last = t;
    if (!on) return;
    frames++; times.push(dt);
    if (t - t0 >= 1000){
      var fps = frames*1000/(t - t0);
      times.sort(function(a, b){ return a - b; });
      var slow = times[Math.min(times.length - 1, Math.floor(times.length*0.95))] || 0;
      var mem = performance.memory ? ' · ' + Math.round(performance.memory.usedJSHeapSize/1048576) + ' MB' : '';
      el.textContent = Math.round(fps) + ' fps · slowest frames ' + Math.round(slow) + ' ms' + mem;
      el.style.color = fps >= 50 ? '#9fe6c8' : fps >= 30 ? '#ffd58a' : '#ff9a8a';
      frames = 0; times = []; t0 = t;
    }
  }
  requestAnimationFrame(tick);
  addEventListener('keydown', function(e){
    if (e.shiftKey && (e.key === 'F' || e.key === 'f') && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range')){
      on = !on; el.style.display = on ? 'block' : 'none'; t0 = performance.now(); frames = 0; times = [];
    }
  });
})();
