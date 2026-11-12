# Hydro Rush: Multiplayer Speedboat Mayhem

A top-down 2D multiplayer speedboat racing game featuring hydrodynamic water physics, wake trails, kicker jump ramps, and **lots and lots of obstacles**!

Race head-to-head with friends across local network or online by sharing a 4-letter room code, or challenge intelligent AI bot racers.

## Features

- **Single Player Mode**: Jump straight into a race anytime without needing a server or room code! Choose **Solo Time Trial** to master your racing line and practice dodging obstacles against the clock, or challenge **1 to 6 AI Bot Racers** with full race rankings and podium finish.
- **Room Code Multiplayer**: Create a room, share the 4-letter code or instant join link with friends. Up to 8 racers per room with real-time boat position, wake, boost, and obstacle synchronization.
- **Lots and Lots of Obstacles (Configurable Density)**:
  - **Sharp Rocks & Coral Reefs**: Jagged rock formations that ricochet boats and scrub off speed.
  - **Naval Mines**: Spiked floating mines with pulsing proximity lights that detonate on contact, blasting boats with smoke and spin-outs.
  - **Swirling Whirlpools**: Swirling water maelstroms that exert inward vortex gravity and spin unsuspecting racers into the abyss.
  - **Floating Wooden Crates & Driftwood Logs**: Smashes into splinter particles upon impact.
  - **Jump Kicker Ramps**: Launches your speedboat high into the air! While airborne, soar OVER mines, reefs, and crates with 3D shadow scaling!
  - **Hydro Boost Pads**: Step on neon glowing arrows for an immediate 2.5-second turbo boost.
  - **Oil Slicks / Toxic Algae**: Causes extreme loss of keel traction and wild hydroplaning drift.
  - **Patrolling Sea Hazards**: Giant kraken tentacles and reef sharks sweeping across narrow straits!
  - **Obstacle Density Modes**: *Standard*, *High*, and **MAYHEM!** (waters packed with dozens of mines, whirlpools, ramps, and hazards).
- **Speedboat Classes**:
  - **Viper GT**: High-performance catamaran with balanced speed and handling.
  - **Mako Shark**: Sleek needle hull with extreme top speed.
  - **Hydro Phantom**: Twin-engine sprint boat with snappy drifting and instant acceleration.
  - **Titan Surge**: Heavy armored hull that smashes through crates and shrugs off collisions.
- **4 Diverse Race Tracks**:
  - 🏝️ **Emerald Atoll**: Turquoise tropical lagoon with sandbar jumps and buoy slaloms.
  - 🏴‍☠️ **Skull Rock Gorge**: River canyon with tight rock cuts, floating logs, and minefields.
  - 🌃 **Cyber Marina**: Midnight bay illuminated with neon gates, oil slicks, and turbo boost pads.
  - 🌀 **The Maelstrom Abyss**: Catastrophic tempest sea with massive whirlpool vortices and kraken tentacles.
- **Dynamic AI Bot Racers**: Seamlessly fills empty grid spots with smart bots that follow waypoints, use raycast obstacle avoidance, take ramps, and fire nitro boosts.
- **Procedural Web Audio API Sound Engine**: Dual-oscillator marine engine roar, water churn, nitro whoosh, jumps, splashes, explosion rumbles, and countdown chimes.

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
The game will start at [http://localhost:3000](http://localhost:3000).

### 3. Join a Room
1. Open [http://localhost:3000](http://localhost:3000) in your browser.
2. Enter your racer name and select your hull color and boat model.
3. Click **"Create Room"** to generate a 4-letter room code (e.g. `BOAT`).
4. Other players can open the page, enter `BOAT`, and click **"Join"** (or click the **"Copy Invite Link"** button).
5. The host selects track, laps, obstacle density (e.g. *MAYHEM!*), and AI bot count, then clicks **"START RACE"**!

## Controls

| Key | Action |
| --- | --- |
| **W** / **Up Arrow** | Throttle forward |
| **S** / **Down Arrow** | Reverse / Brake |
| **A** / **Left Arrow** | Steer rudder left |
| **D** / **Right Arrow** | Steer rudder right |
| **Space** / **Shift** | Fire Nitro Boost |
