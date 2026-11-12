# Statecraft

A real-time geopolitics game for up to 20 leaders. Each player is handed one of the world's 50 largest economies at
random; the computer runs the other countries and about 150 smaller nations. A week passes every few seconds.

- **Economy:** taxes, six spending lines, the interest rate, debt, inflation, stimulus, rationing, elections.
- **Resources where they really are:** oil (Texas, Alberta, West Siberia, the Gulf, the North Caucasus…), gas, coal,
  iron, grain, rare earths, uranium, critical metals and Taiwan's chip fabs. A world market sets prices; shortages slow
  economies and stall armies. Capture a province and its output is yours.
- **War:** leaders form army groups and give big orders (attack a province, hold a line, land by sea). Each army's
  general picks the route, fights the battles on the way, regroups when worn out and retreats when beaten. Air
  campaigns, missile strikes, blockades, nuclear weapons, and peace treaties or armistices.
- **Diplomacy:** alliances (NATO, the EU and others exist at the start), free trade, non-aggression pacts, military
  access, resource deals, loans, aid, sanctions, tariffs, covert operations, closing straits, UN resolutions with P5 vetoes.
- **Chat:** a world channel, one-to-one messages, group chats, and a chat for every alliance.
- **Solo play** runs entirely in the browser and saves as you go.

Figures are rounded real-world values from around 2025 (IMF, IISS, SIPRI, FAS, USGS, EIA). The map is Natural Earth.

## How it fits together

| Part | Where | What it does |
|---|---|---|
| The game (`public/`) | GitHub Pages, as `statecraft.html` on the site | The interface, plus solo play |
| The engine (`public/js/engine/`) | Both | The whole simulation, shared by the server and solo play |
| Multiplayer server (`server.js`, `lib/`) | Render | Runs rooms of up to 20 and checks every command |

The engine is plain JavaScript with no dependencies, so the same code runs in the browser and on the server.

## Playing it on this computer

```sh
npm install
npm run dev   # http://localhost:3001 (multiplayer and solo)
```

`npm test` runs the tests.

## Changing the world

- Countries: `public/js/engine/data/countries.js`. Provinces and their resources: `data/regions.js`.
  Minor nations: `data/minors.js`. Starting alliances, rivalries, sanctions and straits: `data/world.js`.
- After changing provinces or their seed points, run `npm run build:map`. It rebuilds `public/data/map.json` and
  `public/js/engine/data/geo.js` (both committed) and warns about any province that ends up with no land.

## Putting multiplayer online (one time)

1. https://dashboard.render.com > **New > Blueprint**, connect the `ArmoredPawn/About` repository; it finds
   `Statecraft/render.yaml`. (Or **New > Web Service** with **Root Directory** `Statecraft`, **Build Command**
   `npm install`, **Start Command** `npm start`, **Health Check Path** `/healthz`, **Instance Type** Free, and the
   environment variable `ALLOWED_ORIGINS` = `https://armoredpawn.github.io`.)
2. Once it's live, open `https://<your-service>.onrender.com/healthz`; it should show `"ok":true`.
3. Put that address in `public/js/config.js` as `serverUrl`, commit and push.

On the free plan the server sleeps after 15 minutes without use and takes about a minute to wake; the game says so
while it waits. Games live in the server's memory, so a restart ends any game in progress. Solo play never needs the server.
