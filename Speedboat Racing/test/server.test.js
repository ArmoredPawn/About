import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack, TRACKS } from '../public/js/tracks.js';
import { BoatPhysics, BOAT_MODELS } from '../public/js/physics.js';
import { createBots } from '../public/js/ai.js';
import { Obstacle } from '../public/js/obstacles.js';

test('Speedboat Physics Engine', async (t) => {
  await t.test('Boat accelerates and caps at model top speed', () => {
    const boat = new BoatPhysics({ model: 'viper' });
    assert.equal(boat.specs.id, 'viper');
    assert.equal(boat.speed, 0);

    // Apply forward throttle for 2 seconds
    const dt = 0.05;
    for (let i = 0; i < 40; i++) {
      boat.applyInput(1.0, 0, false, dt);
      boat.update(dt, null);
    }

    assert.ok(boat.speed > 300, `Speed ${boat.speed} should exceed 300 knots`);
    assert.ok(boat.speed <= boat.specs.maxSpeed + 5, `Speed should not exceed max speed`);
  });

  await t.test('Nitro boost increases velocity and consumes gauge', () => {
    const boat = new BoatPhysics({ model: 'mako' });
    boat.speed = 400;
    boat.vx = 400;
    const initialGauge = boat.boostGauge;

    boat.applyInput(1.0, 0, true, 0.1);
    boat.update(0.1, null);

    assert.equal(boat.isBoosting, true);
    assert.ok(boat.boostGauge < initialGauge, 'Boost gauge should decrease when boosting');
  });

  await t.test('Jumping off ramps imparts height and gravity lands boat', () => {
    const boat = new BoatPhysics({ model: 'phantom' });
    boat.launchRamp(1.0);

    assert.equal(boat.isAirborne, true);
    assert.ok(boat.z > 0);
    assert.ok(boat.vz > 0);

    // Simulate 2 seconds of flight and landing
    const dt = 0.05;
    for (let i = 0; i < 40; i++) {
      boat.update(dt, null);
    }

    assert.equal(boat.isAirborne, false);
    assert.equal(boat.z, 0);
  });
});

test('Track & Obstacle Generator (Lots and Lots of Obstacles)', async (t) => {
  await t.test('All 4 tracks build with proper checkpoints and bounds', () => {
    const trackIds = ['coral_atoll', 'skull_canyon', 'neon_bay', 'maelstrom_abyss'];

    trackIds.forEach(id => {
      const track = buildTrack(id, 'mayhem', 12345);
      assert.ok(track.checkpoints.length >= 10, `${id} should have at least 10 checkpoints`);
      assert.ok(track.obstacles.length > 50, `${id} in mayhem should have lots of obstacles`);
      assert.ok(track.starterGrid.length >= 8, 'Should have at least 8 starter grid positions');
    });
  });

  await t.test('Obstacle density scaling works: mayhem > high > standard', () => {
    const standard = buildTrack('coral_atoll', 'standard', 42);
    const high = buildTrack('coral_atoll', 'high', 42);
    const mayhem = buildTrack('coral_atoll', 'mayhem', 42);

    assert.ok(mayhem.obstacles.length > high.obstacles.length, 'Mayhem should have more obstacles than High');
    assert.ok(high.obstacles.length > standard.obstacles.length, 'High should have more obstacles than Standard');
    assert.ok(mayhem.obstacles.length >= 100, `Mayhem has ${mayhem.obstacles.length} obstacles (lots and lots!)`);
  });

  await t.test('Obstacle interactions: mine detonation and crate smash', () => {
    const mine = new Obstacle({ type: 'mine', x: 100, y: 100, radius: 20 });
    assert.equal(mine.active, true);
    const detonated = mine.detonate();
    assert.equal(detonated, true);
    assert.equal(mine.active, false);
    assert.equal(mine.exploded, true);

    const crate = new Obstacle({ type: 'crate', x: 200, y: 200, radius: 18 });
    assert.equal(crate.active, true);
    const smashed = crate.smash();
    assert.equal(smashed, true);
    assert.equal(crate.active, false);
  });
});

test('AI Bot Racers & Single Player Flow', async (t) => {
  await t.test('Spawns requested number of bots on grid slots', () => {
    const track = buildTrack('coral_atoll', 'mayhem', 99);
    const bots = createBots(4, track, 1);

    assert.equal(bots.length, 4);
    bots.forEach((bot, i) => {
      assert.ok(bot.name);
      assert.ok(bot.physics);
      assert.equal(bot.isBot, true);
      assert.equal(bot.physics.x, track.starterGrid[i + 1].x);
    });
  });

  await t.test('Bots update physics and follow waypoints', () => {
    const track = buildTrack('coral_atoll', 'standard', 99);
    const bot = createBots(1, track, 1)[0];
    const initialCp = bot.physics.currentCp;

    // Simulate 1.5 seconds of driving
    const dt = 0.05;
    for (let i = 0; i < 30; i++) {
      bot.update(dt, track.obstacles);
    }

    assert.ok(bot.physics.speed > 100, 'Bot should accelerate');
    assert.ok(bot.physics.progress > 0, 'Bot should make race progress');
  });
});
