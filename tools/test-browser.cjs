// Headless Chrome test: JS errors, worklet mode, offline worklet render per preset, screenshots.
// usage: node tools/test-browser.cjs [baseUrl]
const path = require('path');
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (e) { puppeteer = require('/workspace/scratch/ptest/node_modules/puppeteer-core'); }
const base = process.argv[2] || 'http://127.0.0.1:18923/';
const shots = path.join(__dirname, '..', 'shots');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'] });
  const errors = []; let fail = false;
  const open = async (vp, url) => {
    const p = await browser.newPage();
    p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
    p.on('pageerror', e => errors.push('[pageerror] ' + e.message));
    await p.setViewport(vp); await p.goto(url, { waitUntil: 'load' }); return p;
  };
  // desktop
  const p = await open({ width: 1366, height: 820 }, base + '?autostart=1');
  await sleep(1200);
  if (!(await p.evaluate(() => !!window.__app))) { console.log('APP NOT LOADED', errors); process.exit(3); }
  const mode = await p.evaluate(() => window.__app.sim.mode);
  console.log('audio mode:', mode, 'ctx:', await p.evaluate(() => window.__app.sim.ctx.state));
  await p.keyboard.down('KeyW'); await sleep(2200);
  await p.keyboard.down('ShiftLeft'); await sleep(500);
  await p.screenshot({ path: path.join(shots, 'desktop-drive-nitro.png') });
  await p.keyboard.up('ShiftLeft'); await p.keyboard.up('KeyW');
  const tel = await p.evaluate(() => { const t = window.__app.tel; return { rpm: Math.round(t.rpm), gear: t.gear, kmh: Math.round(t.speedKmh), msgs: window.__app.sim.stats.msgs, hist: window.__app.sim.history.length, nan: window.__app.sim.stats.nan }; });
  console.log('after drive:', JSON.stringify(tel));
  if (tel.kmh < 20 || tel.msgs < 10 || tel.nan) fail = true;
  await p.evaluate(() => document.getElementById('cfg-btn').click()); await sleep(400);
  await p.screenshot({ path: path.join(shots, 'desktop-panel.png') });
  // neutral rev to limiter
  await p.keyboard.press('KeyN'); await p.keyboard.down('KeyW'); await sleep(1500);
  const lim = await p.evaluate(() => ({ rpm: Math.round(window.__app.tel.rpm), lim: window.__app.tel.limiter, gear: window.__app.tel.gear }));
  console.log('neutral rev:', JSON.stringify(lim));
  await p.screenshot({ path: path.join(shots, 'desktop-limiter.png') });
  await p.keyboard.up('KeyW');
  // offline worklet renders per preset
  const res = await p.evaluate(async () => {
    const { EngineSim } = await import('./js/engine-sim.js');
    const { PRESET_ORDER, preset } = await import('./js/engine-config.js');
    const out = {};
    for (const k of PRESET_ORDER) {
      const c = preset(k);
      const r = await EngineSim.renderOfflineWorklet({ config: c, seconds: 2, script: [
        { t: 0, rpm: c.idleRpm, throttle: 0, load: 0 }, { t: 0.5, rpm: c.idleRpm, throttle: 1, load: 1 },
        { t: 1.6, rpm: c.redline * 0.95, throttle: 1, load: 1, nitro: 1 }, { t: 1.7, rpm: c.redline * 0.9, throttle: 0, load: 0, nitro: 0 }] });
      out[k] = r.stats;
    }
    return out;
  });
  for (const [k, s] of Object.entries(res)) {
    const ok = s.nan === 0 && s.clip < 50 && s.rms > 0.02;
    if (!ok) fail = true;
    console.log(`worklet ${ok ? 'OK ' : 'BAD'} ${k.padEnd(10)} peak=${s.peak} rms=${s.rms} clip=${s.clip} nan=${s.nan}`);
  }
  // rotary: 1–16 rotors, one firing per rotor per eccentric-shaft rev, phased 360°/n; every layout reaches 16
  const rot = await p.evaluate(async () => {
    const C = await import('./js/engine-config.js'), P = await import('./js/plugin.js');
    const out = { phase: true, counts: {}, sim: null };
    for (let n = 1; n <= 16; n++) {
      const c = C.deriveEngine({ layout: 'rotary', cylinders: n });
      const fires = c.cyl.map(x => x.fire).sort((a, b) => a - b);
      if (c.cylinders !== n || c.cycle !== 360 || fires.some((f, k) => Math.abs(f - k * 360 / n) > 0.02)) out.phase = false;
    }
    for (const [l] of C.LAYOUTS) out.counts[l] = Math.max(...C.countsFor(l));
    out.schema = typeof P.configSchema.countsFor === 'function' && P.configSchema.maxCylinders;
    const sim = window.__app.sim; sim.setConfig({ layout: 'rotary', cylinders: 6, firingOrder: null, manualFire: false });
    if (!sim.motor.neutral) sim.motor.setNeutral(true);
    sim.update({ rpm: 3000, throttle: 0.3, load: 0.3, spark: 1 });
    window.__app.panel.render();
    await new Promise(r => setTimeout(r, 4000)); // let the revs settle at idle
    const rs = []; for (let i = 0; i < 12; i++) { rs.push(sim.getVisualState().rpm); await new Promise(r => setTimeout(r, 100)); }
    const vs = sim.getVisualState(), h = vs.history.filter(e => e.kind !== 2 && e.t > vs.now - 1.2 && e.t <= vs.now - 0.2);
    vs.rpm = rs.reduce((a, b) => a + b, 0) / rs.length;
    const per = {}; for (const e of h) per[e.cyl] = (per[e.cyl] || 0) + 1;
    out.sim = { rotors: sim.config.cylinders, rpm: Math.round(vs.rpm), evPerSec: h.length, perRotor: per, cfgFires: sim.config.cyl.map(c => c.fire) };
    return out;
  });
  console.log('rotary:', JSON.stringify(rot));
  { const exp = rot.sim.rotors * rot.sim.rpm / 60;
    const ok = rot.phase && rot.schema === 16 && Object.entries(rot.counts).every(([l, m]) => l === 'single' ? m === 1 : m === 16) &&
      rot.sim.rotors === 6 && Math.abs(rot.sim.evPerSec - exp) / exp < 0.2 && Object.keys(rot.sim.perRotor).length === 6;
    console.log((ok ? 'OK  ' : 'BAD ') + 'rotary 1–16 rotors phased 360/n; 6-rotor live firing ' + rot.sim.evPerSec + '/s vs expected ' + exp.toFixed(0) + '/s');
    if (!ok) fail = true; }
  await p.screenshot({ path: path.join(shots, 'desktop-rotary6.png') });
  const rot16 = await p.evaluate(async () => {
    const { EngineSim } = await import('./js/engine-sim.js'); const C = await import('./js/engine-config.js'); const o = {};
    for (const [l, n] of [['rotary', 6], ['rotary', 16], ['inline', 16], ['v', 16], ['boxer', 16]]) {
      const c = C.deriveEngine(Object.assign(C.preset('rotary'), { layout: l, cylinders: n, firingOrder: null, manualFire: false, cyl: [] }));
      const r = await EngineSim.renderOfflineWorklet({ config: c, seconds: 1.2, script: [{ t: 0, rpm: c.idleRpm, throttle: 0.2, load: 0.2 }, { t: 0.4, rpm: c.redline * 0.9, throttle: 1, load: 1 }] });
      o[l + n] = r.stats;
    }
    return o;
  });
  for (const [k, s] of Object.entries(rot16)) { const ok = s.nan === 0 && s.clip < 50 && s.rms > 0.02; if (!ok) fail = true; console.log(`worklet ${ok ? 'OK ' : 'BAD'} ${k.padEnd(10)} peak=${s.peak} rms=${s.rms} clip=${s.clip} nan=${s.nan}`); }
  // script processor fallback
  const sp = await open({ width: 900, height: 700 }, base + '?autostart=1&sp=1&preset=inline4');
  await sleep(1500);
  console.log('fallback:', JSON.stringify(await sp.evaluate(() => ({ mode: window.__app.sim.mode, msgs: window.__app.sim.stats.msgs, peak: window.__app.sim.stats.peak }))));
  // phones
  for (const [name, vp, pre] of [['iphone12-portrait', { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, 'muscleV8'],
                                 ['iphone12-landscape', { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true }, 'boxer4']]) {
    const q = await open(vp, base + '?preset=' + pre);
    await sleep(400);
    await q.screenshot({ path: path.join(shots, name + '-start.png') });
    await q.touchscreen.tap(vp.width / 2, vp.height / 2); await sleep(900);
    // hold gas via pointer events (dispatch on button)
    await q.evaluate(() => { const b = document.querySelector('.pedal.gas'); b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, bubbles: true, pointerType: 'touch' })); });
    await sleep(1800);
    await q.screenshot({ path: path.join(shots, name + '.png') });
    const t2 = await q.evaluate(() => ({ mode: window.__app.sim.mode, rpm: Math.round(window.__app.tel.rpm), gear: window.__app.tel.gear, gas: window.__app.input.gas }));
    console.log(name, JSON.stringify(t2));
    if (name.includes('portrait')) { await q.evaluate(() => document.getElementById('cfg-btn').click()); await sleep(400); await q.screenshot({ path: path.join(shots, name + '-panel.png') }); }
  }
  const real = errors.filter(e => !/AudioContext was not allowed|favicon/.test(e));
  console.log('console errors:', real.length ? real : 'none');
  if (real.some(e => /error/i.test(e))) fail = true;
  await browser.close();
  console.log(fail ? 'RESULT: FAIL' : 'RESULT: PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
