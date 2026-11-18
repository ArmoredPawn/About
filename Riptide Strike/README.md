# Riptide Strike

A 3-D naval combat racer for the browser. Race fast warships round a course of gates on the open sea, from a 16 m
interceptor to a 72 m strike carrier, while you fight it out with guns, naval guns, missiles and air strikes. Play
against computer ships, or with up to seven friends by sharing a four-letter room code.

- **The sea:** rolling Gerstner swell that the boats really ride (the water you see and the water they float on are
  the same waves), a physically based surface that reflects a scattered-light sky, foam on the crests, ripples, and
  foaming wakes, bow spray and haze toward the horizon.
- **Ships:** the Interceptor (16 m racing powerboat, the fastest), the Corvette (30 m stealth warship), the Destroyer
  (48 m, a 76 mm gun and launch cells for cruise missiles) and the Strike Carrier (72 m, a flight deck of strike jets).
  Bigger ships are tougher and hit harder, but are slower to get going and to turn, and ride the swell more steadily.
- **Weapons, four per ship:** a gun (12.7 mm machine gun, or a 30 mm rotary close-in gun that also shoots down
  incoming missiles and aircraft on its own); a naval gun (30, 57 or 76 mm explosive shells on a ballistic arc);
  missiles (anti-ship, or heavy cruise missiles that climb out of their cells; hold a ship ahead to lock on); and an
  air strike (a drone, or from the carrier a jet, that flies out to the target, drops its bombs and comes home).
  Weapons arm at the first gate.
- **Racing:** pass every gate in order (the next one glows); laps; standings; sink a boat and it is back three
  seconds later at its last gate, shielded for a moment. Green crates repair the hull, gold ones refill shells and
  missiles. Rocks and islands hurt.
- **Courses:** Coral Atoll (tropical lagoon, calm, high sun), Fjord Run (granite islands, choppy, overcast) and Sunset
  Harbour (golden hour, rough swell).
- **Multiplayer:** create a room, share the code or the invite link, pick boats, and the host starts the race.
  Computer racers fill the grid if the host wants them.
- **Sound:** made on the fly (engine, water, guns, explosions, the lock tone); no sound files.

## Controls

| Key | | Key | |
|---|---|---|---|
| W / ↑ | Throttle | S / ↓ | Reverse |
| A D / ← → | Steer | C | Camera (chase, high, helm) |
| Space / left click | Gun | E / right click | Naval gun |
| Q / R | Missile | F | Air strike |
| V (hold) | Look back | M | Sound on or off |
| Esc | Pause | | |

Phones and tablets get on-screen buttons.

## How multiplayer works

The host's browser runs the room: everyone connects straight to it (WebRTC data channels), and it passes each
player's position, shots and hits on to the others, and runs the computer racers. Each player's browser is in
charge of its own boat and decides what its own shots hit; the hit boat's owner takes the damage.

Firebase only introduces players to each other. The host claims a room code in Firestore (`boatRooms/{CODE}`),
a joiner leaves a connection offer under it, the host answers, and the two browsers connect directly; the
handshake documents are then deleted. There is no game server to deploy or keep awake. It uses the same Firebase
project as Deep Dive (`outlier-736d6`, set in `public/js/config.js`), through Firestore's REST API, with no login.

**One-time setup:** the project's Firestore rules must allow `boatRooms`. Both games' rules are in
`../Outlier/firestore.rules`: paste that whole file into Firebase console → Firestore Database → Rules, and
Publish.

Direct browser-to-browser connections work on most home and mobile networks. Some school and office networks
block them; the game then says so. (A TURN relay server would get round that, but isn't included.)

three.js (0.170, MIT licence) is bundled in `public/vendor/three/`, so the game doesn't depend on a CDN that a
network might block. Anything that goes wrong in the page shows an error box instead of a blank screen.

## Running it on this computer

```sh
npm run dev   # http://localhost:8080
npm test
```

The dev server serves the game and stands in for Firestore, so rooms can be tried between tabs without Firebase.
Add `?firebase` to the address to use the real Firestore instead.

## Where things are

| File | What it does |
|---|---|
| `public/js/sim/` | The race without any drawing: waves, courses, boats and weapons, the world, computer racers |
| `public/js/render/` | The 3-D scene (three.js): sky, sea, models, effects, camera |
| `public/js/net/` | Room codes (Firestore), browser-to-browser links, the room protocol |
| `public/js/hud.js`, `audio.js`, `main.js` | The HUD, the sound, and the menus and race loop |
| `scripts/serve.js` | The local dev server |
