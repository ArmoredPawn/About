// A quick look at whole races (not part of npm test): node test/race-check.mjs
import { World } from '../public/js/sim/world.js';
import { botBrain, botInput } from '../public/js/sim/ai.js';
const cls = ['interceptor', 'corvette', 'destroyer', 'carrier'];
for (const track of ['atoll', 'fjord', 'harbor']) {
  const w = new World({ track, laps: 2, seed: 3 });
  const brains = new Map();
  for (let i = 0; i < 8; i++) { w.addBoat({ id: 'b' + i, name: 'Bot' + i, cls: cls[i % 4], slot: i, local: true, bot: true }); brains.set('b' + i, botBrain(i, 0.8)); }
  w.startCountdown(1);
  const counts = {};
  for (let i = 0; i < 60 * 700 && w.standings().some((b) => !b.finished); i++) {
    for (const [id, br] of brains) w.setInput(id, botInput(w, w.boats.get(id), br, 1 / 60));
    w.step(1 / 60);
    for (const e of w.drain()) { const k = e.t === 'fire' || e.t === 'impact' ? `${e.t}:${e.w}` : e.t; counts[k] = (counts[k] ?? 0) + 1; }
  }
  const st = w.standings();
  console.log(track, 'islands', w.course.islands.length, 'rocks', w.course.rocks.length, '| clock', w.clock.toFixed(0), 's | finished', st.filter((b) => b.finished).length, '/', st.length);
  console.log('  ', st.map((b) => `${b.cls.slice(0, 4)} L${Math.min(b.lap, 2)} k${b.kills} d${b.deaths} ${b.finishTime?.toFixed(0) ?? '-'}`).join(' | '));
  console.log('  ', JSON.stringify(counts));
}
