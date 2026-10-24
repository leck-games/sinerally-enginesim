// Screenshot the diagram for each preset: node tools/shots-presets.cjs [baseUrl]
const path = require('path');
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch (e) { puppeteer = require('/workspace/scratch/ptest/node_modules/puppeteer-core'); }
const base = process.argv[2] || 'http://127.0.0.1:18923/';
const keys = (process.argv[3] || 'muscleV8,flatV8,inline6,boxer4,inline4,v12,dirtbike,twoStroke,rotary,vtwin,v10odd').split(',');
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage(); await p.setViewport({ width: 1100, height: 700 });
  for (const k of keys) {
    await p.goto(base + '?autostart=1&preset=' + k, { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 900));
    await p.screenshot({ path: path.join(__dirname, '..', 'shots', 'preset-' + k + '.png'), clip: { x: 0, y: 40, width: 680, height: 520 } });
  }
  await b.close();
})();
