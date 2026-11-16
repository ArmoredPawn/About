// Solo play's world, run off the page's main thread. A week of the simulation takes a few hundred
// milliseconds of work; done on the page, it froze the map and the panels every game week.
// Talks to LocalLink (net.js): { open: { name, state, v } }, { msg }, { leave: true } in;
// { msg } (the room's messages), { save } (the game, ready for localStorage) and { left: true } out.

import { Room } from './engine/room.js';

let room = null;
let player = null;
let version = 0;

function save() {
  if (!room?.game) return;
  try {
    const s = room.game.s;
    postMessage({ save: JSON.stringify({ v: version, saved: Date.now(), state: { ...s, fresh: [] } }) });
  } catch { /* the game still runs */ }
}

onmessage = ({ data }) => {
  if (data.open) {
    const { name, state, v } = data.open;
    version = v;
    room = new Room({
      code: 'SOLO',
      // Saved every week: turning the game into text happens here, off the page, so it costs the map nothing
      onTick: () => save(),
    });
    postMessage({ msg: { type: 'joined', code: 'SOLO', you: 'me', token: 'solo', solo: true } });
    player = room.addPlayer({ id: 'me', token: 'solo', name: name || 'You', conn: { send: (msg) => postMessage({ msg }) } });
    if (state) { room.restore(state, player); return; }
    room.settings.speed = 'normal';
    room.start();
    save();
    return;
  }
  if (data.leave) {
    save();
    room?.stopClock();
    room = null;
    postMessage({ left: true });
    return;
  }
  if (data.msg && room) {
    room.handle(player, data.msg);
    if (data.msg.type === 'cmd') save();
  }
};
