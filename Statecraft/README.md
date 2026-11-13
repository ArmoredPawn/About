# Statecraft

A real-time geopolitics game for up to 20 leaders. Each player is handed one of the world's 50 largest economies at
random; the computer runs the other countries and about 150 smaller nations. The world never pauses: a week passes
every few seconds, armies glide across the map and front lines creep through contested provinces as you watch.

- **Economy:** taxes, six spending lines, the interest rate, debt, inflation, stimulus, rationing.
- **Government:** conscription (volunteers to a total-war draft), the security forces, the press, elections, martial
  law. People protest for real reasons (school, hospital or pension cuts, prices, shortages, a war or a draft they
  don't believe in), and fear, propaganda and a recovering economy keep them home. Unanswered, protests become
  uprisings and civil war; a country in civil war makes a separate peace abroad, as Russia did at Brest-Litovsk.
- **Resources where they really are:** oil (Texas, Alberta, West Siberia, the Gulf, the North Caucasus…), gas, coal,
  iron, grain, rare earths, uranium, critical metals and Taiwan's chip fabs. Capture a province and its output, and
  its people, are yours. Empty deserts (Iran's Kavir and Lut, Arabia's Empty Quarter, the Outback, the Thar) are
  provinces of their own with little worth taking.
- **Market:** buy from the country you choose, or around sanctions through intermediaries; sell surplus or list it
  for other leaders. Every cargo sails through the real straits or goes overland, and can be seized or sunk on the
  way, with both sides told who did it. Hold a strait's shores to close it, charge a toll or attack enemy cargoes;
  patrol one with your navy to escort friends or stop everyone else.
- **War:** declare war in one click (leaving any alliance you share), draft and form an army group, then click it and
  click anywhere on the map: it goes at once, fighting through enemy ground or landing from the sea. Fronts move both
  ways. Make the case for war to the nation first and the public takes it far better. If an order can't go ahead, a
  bar at the bottom of the map says why. Armies cross other countries only with military access. Generals pick the
  route and fight; wars far from home need money, factories and troops to guard the supply lines; the dead come off
  the population. Each province shows its ground (forests, passes, marshes); ground thought impassable, like the
  Ardennes, is lightly held and an attack through it surprises the defenders. Aircraft and missiles only reach so far
  from a base. Air campaigns, missile strikes, blockades, nuclear weapons, peace treaties and armistices.
- **Computer-run countries** trade, sign deals and pacts (some secret), spy on rivals and pick their own fights with
  weak neighbours. Invaded, they mobilise, conscript, draft every reservist and call on their friends.
- **Diplomacy:** open or secret alliances, trade blocs, free trade, non-aggression pacts, military access, resource
  deals, loans, aid, sanctions, tariffs, UN resolutions with P5 vetoes.
- **Spies:** plant agents abroad; once settled in they relay armies on the move, weapons being built, secret pacts and
  war plans, and show the target's armies on your map, until counter-intelligence catches (or turns) them.
- **Research:** pay for a project and wait for it; the hardest work needs imported chips or uranium, or buy a licence
  from a country further ahead.
- **News:** everything the world has seen, searchable by country. Secret moves never appear there.
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
  Minor nations: `data/minors.js`. Starting friendships, rivalries, sanctions and straits: `data/world.js`.
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
