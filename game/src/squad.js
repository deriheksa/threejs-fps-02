// EMBERLINE — the squad: bot fighters for both teams.
// A bot is a fighter body plus a box-built soldier and a small state machine. It walks a
// lane route, holds a position, and scans for enemies on a staggered timer so four bots
// never raycast on the same frame. When it sees an enemy it reacts after a human-ish
// delay, then fires in bursts while strafing. Gunfire it hears becomes a position to hunt.
// After a plant, the nearest Ember bot walks to the site and channels a defuse; the rest
// converge on the site. Vanguard bots shadow the player and defend a planted charge.
import * as THREE from 'three';
import { makeFighter } from './fighter.js';
import { PALETTE } from './palette.js';
import { WEAPONS as ARSENAL } from './arsenal.js';

const SCAN_EVERY = 0.15;
const SIGHT_RANGE = 46;
const HEAR_RANGE = 28;
const DEFUSE_TIME = 5;

const EMBER_NAMES = ['Ash', 'Coal', 'Flint', 'Smolder'];
const VANGUARD_NAMES = ['Rook', 'Sable'];

export function makeBot(scene, arena, side, index, start, rng) {
  const isEmber = side === 'ember';
  const name = isEmber ? EMBER_NAMES[index % EMBER_NAMES.length] : VANGUARD_NAMES[index % VANGUARD_NAMES.length];
  const weaponKey = isEmber
    ? ['vk', 'hornet', 'vk', 'breacher'][index % 4]
    : ['vk', 'hornet'][index % 2];
  const weapon = ARSENAL[weaponKey];

  const fighter = makeFighter(arena.colliders, start);
  fighter.body.yaw = isEmber ? 0 : Math.PI;

  // The soldier: legs, torso, head and a gun, coloured by team. The head and torso are
  // the hit meshes; their userData tells a ray what it struck.
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: new THREE.Color(isEmber ? PALETTE.foe : PALETTE.ally), roughness: 0.8, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#211a14'), roughness: 0.7, metalness: 0.2 });
  const visor = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.3, metalness: 0.4 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.32), suit);
  torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), dark);
  head.position.y = 1.6;
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.05), visor);
  strip.position.set(0, 1.62, -0.16);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.2), dark);
  legL.position.set(-0.14, 0.35, 0);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.2), dark);
  legR.position.set(0.14, 0.35, 0);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.62), dark);
  gun.position.set(0.28, 1.15, -0.3);
  group.add(torso, head, strip, legL, legR, gun);
  group.position.copy(start);
  scene.add(group);

  const hitMeshes = [torso, head];
  torso.userData.hit = { bot: null, part: 'body' };
  head.userData.hit = { bot: null, part: 'head' };

  const bot = {
    fighter,
    mesh: group,
    hitMeshes,
    side,
    name,
    weaponKey,
    weapon,
    hp: 100,
    armor: 0,
    alive: true,
    mode: 'route',
    route: null,
    routeIndex: 0,
    holdPoint: null,
    followOffset: new THREE.Vector3(),
    target: null,
    reactAt: 0,
    burstLeft: 0,
    burstPauseUntil: 0,
    cooldown: 0,
    scanAt: rng() * SCAN_EVERY,
    strafeDir: rng() > 0.5 ? 1 : -1,
    strafeAt: 0,
    heard: null,
    defuseLeft: 0,
    flashUntil: 0,
  };
  torso.userData.hit.bot = bot;
  head.userData.hit.bot = bot;

  const eye = new THREE.Vector3();
  const eyeSelf = new THREE.Vector3();
  const eyeOther = new THREE.Vector3();
  const aimPoint = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const intent = { forward: 0, strafe: 0, jump: false, crouch: false };

  function reset(startPos) {
    bot.hp = 100;
    bot.armor = 0;
    bot.alive = true;
    bot.mode = 'route';
    bot.route = null;
    bot.routeIndex = 0;
    bot.holdPoint = null;
    bot.target = null;
    bot.reactAt = 0;
    bot.burstLeft = 0;
    bot.burstPauseUntil = 0;
    bot.cooldown = 0;
    bot.heard = null;
    bot.defuseLeft = 0;
    fighter.body.position.copy(startPos);
    fighter.body.velocity.set(0, 0, 0);
    fighter.body.yaw = isEmber ? 0 : Math.PI;
    fighter.body.pitch = 0;
    group.position.copy(startPos);
    group.rotation.set(0, fighter.body.yaw, 0);
    group.visible = true;
  }

  function damage(amount, part) {
    if (!bot.alive) return false;
    let left = amount;
    if (bot.armor > 0) {
      const soaked = Math.min(bot.armor, left * 0.5);
      bot.armor -= soaked;
      left -= soaked;
    }
    bot.hp -= left;
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      group.rotation.set(0, fighter.body.yaw, Math.PI / 2);
      group.position.y = 0.25;
      return true;
    }
    return false;
  }

  // Face a point on the ground, then walk forward toward it.
  function walkToward(point, speedScale = 1) {
    const dx = point.x - fighter.body.position.x;
    const dz = point.z - fighter.body.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return 0;
    fighter.body.yaw = Math.atan2(-dx, -dz);
    intent.forward = speedScale;
    intent.strafe = 0;
    return dist;
  }

  function scan(world) {
    bot.target = null;
    const eyePos = fighter.eyePosition(eyeSelf);
    let best = null;
    let bestDist = SIGHT_RANGE;
    for (const other of world.fighters) {
      if (!other.alive || other.side === side) continue;
      const otherEye = other.eye(eyeOther);
      const dist = eyePos.distanceTo(otherEye);
      if (dist > bestDist) continue;
      if (!world.losClear(eyePos, otherEye)) continue;
      best = other;
      bestDist = dist;
    }
    if (best) {
      bot.target = best;
      if (bot.reactAt === 0) bot.reactAt = world.time + 0.45 + rng() * 0.4;
    } else {
      bot.reactAt = 0;
    }
  }

  function shootAt(world) {
    if (!bot.target || !bot.target.alive) return;
    if (world.time < bot.reactAt) return;
    if (world.time < bot.burstPauseUntil) return;
    if (bot.cooldown > 0) return;
    const targetEye = bot.target.eye(eye);
    const from = fighter.eyePosition(new THREE.Vector3());
    const dist = from.distanceTo(targetEye);
    const goHead = rng() < 0.25;
    aimPoint.copy(targetEye);
    aimPoint.y += goHead ? 0.32 : -0.25;
    // Aim error grows with range and with how fast the target moves.
    const error = 0.05 + dist * 0.004 + bot.target.speed() * 0.012;
    aimPoint.x += (rng() * 2 - 1) * error * dist * 0.5;
    aimPoint.y += (rng() * 2 - 1) * error * dist * 0.4;
    aimPoint.z += (rng() * 2 - 1) * error * dist * 0.5;
    toTarget.copy(aimPoint).sub(from).normalize();
    world.fireShot(bot, from, toTarget, bot.weapon, goHead);
    bot.cooldown = bot.weapon.gap * (1 + rng() * 0.3);
    bot.burstLeft -= 1;
    if (bot.burstLeft <= 0) {
      bot.burstPauseUntil = world.time + 0.7 + rng() * 0.6;
      bot.burstLeft = 3 + Math.floor(rng() * 3);
    }
  }

  function update(dt, world) {
    if (!bot.alive) return;
    bot.cooldown = Math.max(0, bot.cooldown - dt);
    bot.scanAt -= dt;
    if (bot.scanAt <= 0) {
      bot.scanAt = SCAN_EVERY;
      scan(world);
    }
    // A recent gunshot nearby becomes a place to hunt.
    if (!bot.target) {
      for (const noise of world.noises) {
        if (world.time - noise.at > 1.5) continue;
        const d = fighter.body.position.distanceTo(noise.pos);
        if (d < HEAR_RANGE) {
          bot.heard = noise.pos;
          break;
        }
      }
    }

    intent.forward = 0;
    intent.strafe = 0;
    intent.jump = false;
    intent.crouch = false;

    const bomb = world.bomb;
    if (isEmber && bomb.state === 'planted') {
      // The closest Ember bot defuses; the rest push the site.
      const site = bomb.siteCenter;
      const dist = fighter.body.position.distanceTo(site);
      if (world.defuser === bot) {
        if (dist < 2.5) {
          intent.forward = 0;
          bot.defuseLeft -= dt;
          if (bot.defuseLeft <= 0) world.onDefused(bot);
        } else {
          walkToward(site);
        }
      } else if (dist > 6) {
        walkToward(site);
      } else {
        const hold = arena.holds[bomb.siteKey][botIndex(bot) % 3];
        walkToward(hold, 0.5);
      }
    } else if (bot.target) {
      // Engage: face the target, strafe, close or open the distance.
      const targetEye = bot.target.eye(eye);
      const from = fighter.eyePosition(new THREE.Vector3());
      const dx = targetEye.x - from.x;
      const dz = targetEye.z - from.z;
      fighter.body.yaw = Math.atan2(-dx, -dz);
      const dist = Math.hypot(dx, dz);
      if (world.time > bot.strafeAt) {
        bot.strafeAt = world.time + 0.8 + rng() * 0.8;
        bot.strafeDir = rng() > 0.5 ? 1 : -1;
      }
      intent.strafe = bot.strafeDir * 0.7;
      intent.forward = dist > 20 ? 0.5 : dist < 6 ? -0.4 : 0;
      if (bot.burstLeft === 0 && world.time >= bot.burstPauseUntil) {
        bot.burstLeft = 3 + Math.floor(rng() * 3);
      }
      shootAt(world);
    } else if (!isEmber && bomb.state === 'planted') {
      const site = bomb.siteCenter;
      const dist = fighter.body.position.distanceTo(site);
      if (dist > 5) walkToward(site, 0.8);
      else {
        const hold = arena.holds[bomb.siteKey][botIndex(bot) % 3];
        walkToward(hold, 0.4);
      }
    } else if (!isEmber) {
      // Vanguard bots shadow the player at an offset, and fight what they see.
      const anchor = world.player.fighter.body.position;
      const goal = new THREE.Vector3(anchor.x + bot.followOffset.x, 0, anchor.z + bot.followOffset.z);
      const dist = fighter.body.position.distanceTo(goal);
      if (dist > 3.5) walkToward(goal, 0.85);
      else {
        fighter.body.yaw = world.player.fighter.body.yaw;
      }
    } else if (bot.heard) {
      const dist = walkToward(bot.heard, 0.9);
      if (dist < 1.5) bot.heard = null;
    } else if (bot.route) {
      const point = bot.route[bot.routeIndex];
      const dist = walkToward(point, 0.85);
      if (dist < 1.3) {
        bot.routeIndex += 1;
        if (bot.routeIndex >= bot.route.length) {
          bot.route = null;
          const siteKey = bot.routeSite || 'A';
          bot.holdPoint = arena.holds[siteKey][botIndex(bot) % 3];
          bot.mode = 'hold';
        }
      }
    } else if (bot.holdPoint) {
      const dist = walkToward(bot.holdPoint, 0.6);
      if (dist < 1.0) {
        // Hold: face the lane the route came down.
        fighter.body.yaw = isEmber ? Math.PI : 0;
      }
    }

    fighter.step(dt, null, intent);
    group.position.copy(fighter.body.position);
    group.rotation.y = fighter.body.yaw;
  }

  function botIndex(self) {
    return isEmber ? EMBER_NAMES.indexOf(self.name) : VANGUARD_NAMES.indexOf(self.name);
  }

  return {
    bot, reset, damage, update,
    get alive() { return bot.alive; },
    get hp() { return bot.hp; },
    get name() { return name; },
    get side() { return side; },
    eye(out) {
      return fighter.eyePosition(out);
    },
    speed() {
      return fighter.speed();
    },
  };
}

// Build the two squads for a round: two Vanguard allies and four Ember enemies.
export function makeSquads(scene, arena, rng) {
  const allies = [];
  const enemies = [];
  for (let i = 0; i < 2; i += 1) {
    allies.push(makeBot(scene, arena, 'vanguard', i, arena.spawns.vanguard[i + 1], rng));
  }
  for (let i = 0; i < 4; i += 1) {
    enemies.push(makeBot(scene, arena, 'ember', i, arena.spawns.ember[i], rng));
  }
  return { allies, enemies };
}
