// node tools/render-wavs.mjs [--all] — renders preset demo runs to samples/*.wav and prints stats
import { writeFileSync, mkdirSync } from 'node:fs';
import { EngineSim } from '../js/engine-sim.js';
import { PRESET_ORDER, preset } from '../js/engine-config.js';
const out = new URL('../samples/', import.meta.url); mkdirSync(out, { recursive: true });
const save = process.argv.includes('--save');
// scenario: idle 1s, rev in neutral? no: launch WOT 4s (shifts), nitro 1s, lift 1.5s (pops/BOV), brake
const drive = (t) => ({ gas: t > 1 && t < 6.5 ? 1 : 0, brake: t > 7.5 ? 1 : 0, nitro: t > 4.5 && t < 5.8 });
const rev = (t) => ({ gas: (t > 0.8 && t < 1.6) || (t > 2.4 && t < 4.4) ? 1 : 0 });
let bad = 0;
for (const k of PRESET_ORDER) {
  for (const [label, fn, secs, neutral] of [['drive', drive, 9, false], ['rev', rev, 5.5, true]]) {
    const r = EngineSim.renderOffline({ config: preset(k), seconds: secs, sampleRate: 44100, drive: fn, neutral });
    const ok = r.stats.nan === 0 && r.stats.clip < 50 && r.stats.rms > 0.02;
    if (!ok) bad++;
    console.log(`${ok ? 'OK ' : 'BAD'} ${k.padEnd(10)} ${label.padEnd(5)} peak=${r.stats.peak} rms=${r.stats.rms} clip=${r.stats.clip} nan=${r.stats.nan} fires=${r.fires} pops=${r.pops}`);
    if (save) writeFileSync(new URL(`${k}-${label}.wav`, out), Buffer.from(EngineSim.encodeWav(r.left, r.right, r.sampleRate)));
  }
}
process.exit(bad ? 1 : 0);
