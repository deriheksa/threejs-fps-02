// EMBERLINE — boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. The player fights with two Vanguard allies against four Ember bots in
// Ashworks Yard. Rounds are won by elimination or by the charge: plant it at Furnace or
// Depot, defend the fuse, and the round is yours.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture, renders
// it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeRng } from './rng.js';
import { buildArena } from './arena.js';
import { makeFighter } from './fighter.js';
import { makeGun, makeSpark, makeBlast, WEAPONS, GRENADE } from './arsenal.js';
import { makeSquads } from './squad.js';
import { makeMatch, BUY_SECONDS, ROUND_SECONDS, FUSE_SECONDS, PLANT_SECONDS, PRIZES } from './rounds.js';
import { makeDisplay } from './display.js';
import { makeControls } from './controls.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const rng = makeRng(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 22, 55);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const arena = buildArena(scene);
const display = makeDisplay();
const controls = makeControls(renderer.domElement, onLockChange);
const match = makeMatch();
const { match: matchState, startRound, goLive, endRound, nextRound, buy, addKill } = match;
const squads = makeSquads(scene, arena, rng);
const playerFighter = makeFighter(arena.colliders, arena.spawns.vanguard[0]);
const gun = makeGun(camera);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;

// --- The player, wrapped to look like any other fighter to the bots.
const player = {
  fighter: playerFighter,
  hp: 100,
  armor: 0,
  alive: true,
  side: 'vanguard',
  isPlayer: true,
  name: 'You',
  eye(out) { return playerFighter.eyePosition(out); },
  speed() { return playerFighter.speed(); },
};

const fighters = [player];
for (const ally of squads.allies) fighters.push(ally);
for (const enemy of squads.enemies) fighters.push(enemy);

const world = {
  time: 0,
  rng,
  shootables: arena.shootables,
  fighters,
  player,
  bomb: matchState.bomb,
  noises: [],
  defuser: null,
  fireShot,
  losClear,
  onDefused,
};

let time = 0;
let started = false;
let frozen = false;
let prevFiring = false;
let accumulator = 0;
let lastTime = performance.now();
let damageFlash = 0;
let audio = null;

const tracers = [];
const sparks = [];
const blasts = [];
const tmpDir = new THREE.Vector3();
const tmpFrom = new THREE.Vector3();
const tmpTo = new THREE.Vector3();
const tmpBox = new THREE.Box3();
const tmpRay = new THREE.Ray();

// The planted charge: a small dark box with a blinking lamp, shown at the site.
const charge = new THREE.Group();
const chargeBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.3, 0.35),
  new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c1c1c'), roughness: 0.5, metalness: 0.5 }),
);
const chargeLamp = new THREE.Mesh(
  new THREE.SphereGeometry(0.06, 8, 6),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.foe) }),
);
chargeLamp.position.set(0, 0.22, 0);
charge.add(chargeBody, chargeLamp);
charge.visible = false;
scene.add(charge);

// --- Tiny synth sounds, made in code (no audio assets). Created on the first user gesture.
function blip(freq, length, type, volume) {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + length);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + length);
  } catch (error) {
    audio = null;
  }
}

function addTracer(from, to, color) {
  const geometry = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
  scene.add(line);
  tracers.push({ line, until: time + 0.07 });
}

function losClear(from, to) {
  tmpDir.copy(to).sub(from);
  const dist = tmpDir.length();
  if (dist < 0.01) return true;
  tmpDir.normalize();
  raycaster.set(from, tmpDir);
  raycaster.far = dist - 0.3;
  const hit = raycaster.intersectObjects(arena.shootables, false)[0];
  raycaster.far = 90;
  return !hit;
}

function hurtPlayer(amount) {
  if (!player.alive) return;
  let left = amount;
  if (player.armor > 0) {
    const soaked = Math.min(player.armor, left * 0.5);
    player.armor -= soaked;
    left -= soaked;
  }
  player.hp -= left;
  damageFlash = 0.55;
  blip(140, 0.12, 'sawtooth', 0.05);
  if (player.hp <= 0) {
    player.hp = 0;
    player.alive = false;
    matchState.deaths += 1;
    display.feed('You were eliminated');
    if (matchState.bomb.state === 'carried') {
      matchState.bomb.state = 'lost';
      display.setBomb('Charge lost — elimination only');
    }
    checkRoundEnd();
  }
}

function hurtBot(bot, amount, part, shooterName) {
  const killed = bot.damageFn(amount, part);
  if (killed) {
    display.feed(`${shooterName} eliminated ${bot.name}`);
    if (shooterName === 'You') addKill();
    checkRoundEnd();
  }
  return killed;
}

// A shot from any fighter: raycast against the arena, the bots and the player, and take
// the nearest hit. Returns the hit point for the tracer.
function fireShot(shooter, from, direction, weapon, aimedHead) {
  raycaster.set(from, direction);
  const meshes = arena.shootables.slice();
  for (const fighter of fighters) {
    if (fighter.isPlayer) continue;
    if (fighter.bot === shooter) continue; // a bot never shoots its own body
    if (fighter.alive) meshes.push(...fighter.hitMeshes);
  }
  const hits = raycaster.intersectObjects(meshes, false);
  let hitPoint = null;
  let hitDist = Infinity;
  if (hits.length > 0) {
    hitPoint = hits[0].point;
    hitDist = hits[0].distance;
  }
  // The player has no hit mesh: test the ray against the player's body and head boxes.
  // Only Ember bots can hurt the player; Vanguard fire never tests the player.
  if (shooter.side === 'ember') {
    const body = playerFighter.body;
    tmpBox.min.set(body.position.x - 0.36, body.position.y, body.position.z - 0.36);
    tmpBox.max.set(body.position.x + 0.36, body.position.y + body.height, body.position.z + 0.36);
    tmpRay.set(from, direction);
    const bodyHit = tmpRay.intersectBox(tmpBox, tmpTo);
    if (bodyHit && player.alive) {
      const d = from.distanceTo(bodyHit);
      if (d < hitDist) {
        const headTop = body.position.y + body.eye + 0.12;
        const isHead = bodyHit.y > headTop - 0.3;
        hurtPlayer(isHead ? weapon.head : weapon.body);
        hitPoint = bodyHit.clone();
        hitDist = d;
      }
    }
  }
  if (hits.length > 0 && hits[0].distance <= hitDist && hits[0].object.userData.hit) {
    const { bot, part } = hits[0].object.userData.hit;
    const damage = part === 'head' ? weapon.head : weapon.body;
    hurtBot(bot, damage, part, shooter.name || 'You');
    if (shooter.isPlayer) {
      display.hitMarker(bot.hp <= 0);
      blip(bot.hp <= 0 ? 1320 : 880, 0.05, 'square', 0.04);
    }
  }
  if (!hitPoint) {
    hitPoint = from.clone().addScaledVector(direction, 80);
  }
  const color = shooter.side === 'vanguard' ? PALETTE.ally : PALETTE.foe;
  addTracer(from, hitPoint, color);
  world.noises.push({ pos: from.clone(), at: time });
  if (world.noises.length > 8) world.noises.shift();
}

function onDefused(bot) {
  if (matchState.bomb.state !== 'planted') return;
  matchState.bomb.state = 'defused';
  display.feed(`${bot.name} defused the charge`);
  endRound('ember', 'Charge defused');
  finishRound();
}

function playerShoot() {
  const def = gun.def;
  if (!gun.takeRound()) {
    gun.reload();
    return;
  }
  const spread = gun.spread(playerFighter.speed()) * (playerFighter.body.crouched ? 0.6 : 1);
  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    camera.getWorldDirection(tmpDir);
    tmpDir.x += (rng() * 2 - 1) * spread;
    tmpDir.y += (rng() * 2 - 1) * spread;
    tmpDir.z += (rng() * 2 - 1) * spread;
    tmpDir.normalize();
    camera.getWorldPosition(tmpFrom);
    fireShot(player, tmpFrom, tmpDir.clone(), def, false);
  }
  gun.fire();
  playerFighter.kick(0.009 + rng() * 0.004, (rng() * 2 - 1) * 0.004);
  blip(190, 0.06, 'square', 0.05);
  display.setAmmo(gun.state.mag, gun.state.reserve);
}

function throwSpark() {
  if (matchState.grenades <= 0) return;
  matchState.grenades -= 1;
  camera.getWorldDirection(tmpDir);
  camera.getWorldPosition(tmpFrom);
  sparks.push(makeSpark(scene, tmpFrom, tmpDir));
  display.feed('Spark grenade thrown');
}

function detonateSpark(spark) {
  const pos = spark.mesh.position.clone();
  blasts.push(makeBlast(scene, pos));
  blip(90, 0.3, 'sawtooth', 0.08);
  for (const fighter of fighters) {
    if (!fighter.alive) continue;
    const targetPos = fighter.isPlayer
      ? playerFighter.body.position.clone().setY(playerFighter.body.position.y + 1)
      : fighter.fighter.body.position.clone().setY(fighter.fighter.body.position.y + 1);
    const dist = pos.distanceTo(targetPos);
    if (dist > GRENADE.radius) continue;
    const falloff = 1 - dist / GRENADE.radius;
    const damage = Math.round(GRENADE.minDamage + (GRENADE.maxDamage - GRENADE.minDamage) * falloff);
    if (fighter.isPlayer) hurtPlayer(damage);
    else hurtBot(fighter, damage, 'body', 'You');
  }
}

function checkRoundEnd() {
  if (matchState.phase !== 'live') return;
  const emberAlive = squads.enemies.filter((bot) => bot.alive).length;
  const vanguardAlive = (player.alive ? 1 : 0) + squads.allies.filter((bot) => bot.alive).length;
  if (emberAlive === 0) {
    endRound('vanguard', 'Ember squad eliminated');
    finishRound();
  } else if (vanguardAlive === 0) {
    endRound('ember', 'Vanguard squad eliminated');
    finishRound();
  }
}

function finishRound() {
  display.showBuy(false, matchState.money, matchState.owned, matchState.grenades, matchState.kevlar);
  display.setPlant('', 0);
  charge.visible = false;
  const reason = matchState.lastReason;
  const winner = matchState.score.vanguard > matchState.score.ember ? 'Vanguard' : 'Ember';
  if (matchState.over) {
    display.showOverlay('match', `${matchState.winner === 'vanguard' ? 'Vanguard' : 'Ember'} takes the match ${matchState.score.vanguard}–${matchState.score.ember}. ${reason}`);
  } else {
    display.showOverlay('round', `${winner} takes round ${matchState.round} — ${reason}`);
  }
  controls.releaseLock();
}

function assignRoutes() {
  const routes = arena.routes;
  const picks = [
    { route: routes.aLong, site: 'A' },
    { route: routes.mid, site: 'A' },
    { route: routes.bShort, site: 'B' },
    { route: routes.mid, site: 'B' },
  ];
  squads.enemies.forEach((enemy, index) => {
    enemy.bot.route = picks[index].route;
    enemy.bot.routeSite = picks[index].site;
    enemy.bot.routeIndex = 0;
    enemy.bot.mode = 'route';
  });
  squads.allies[0].bot.followOffset.set(-2.5, 0, 1.5);
  squads.allies[1].bot.followOffset.set(2.5, 0, 1.5);
}

function resetPositions() {
  playerFighter.body.position.copy(arena.spawns.vanguard[0]);
  playerFighter.body.velocity.set(0, 0, 0);
  playerFighter.body.yaw = 0;
  playerFighter.body.pitch = 0;
  player.hp = 100;
  player.armor = matchState.kevlar;
  player.alive = true;
  gun.restock();
  squads.allies.forEach((ally, i) => ally.reset(arena.spawns.vanguard[i + 1]));
  squads.enemies.forEach((enemy, i) => enemy.reset(arena.spawns.ember[i]));
  assignRoutes();
  world.defuser = null;
  world.noises.length = 0;
  for (const spark of sparks) spark.remove();
  sparks.length = 0;
}

function syncCamera() {
  camera.position.set(
    playerFighter.body.position.x,
    playerFighter.body.position.y + playerFighter.body.eye,
    playerFighter.body.position.z,
  );
  camera.rotation.set(playerFighter.body.pitch, playerFighter.body.yaw, 0, 'YXZ');
}

function syncHud() {
  display.setHealth(player.hp);
  display.setArmor(player.armor);
  display.setAmmo(gun.state.mag, gun.state.reserve);
  display.setWeapon(gun.def.name);
  display.setMoney(matchState.money);
  display.setTimer(matchState.phaseLeft);
  display.setRound(matchState.round, 9);
  display.setScore(matchState.score.vanguard, matchState.score.ember);
  const emberAlive = squads.enemies.filter((bot) => bot.alive).length;
  const vanguardAlive = (player.alive ? 1 : 0) + squads.allies.filter((bot) => bot.alive).length;
  display.setAlive(vanguardAlive, emberAlive);
  display.setCrosshairGap(4 + gun.spread(playerFighter.speed()) * 900);
  const bomb = matchState.bomb;
  if (bomb.state === 'carried') display.setBomb('Charge carried — plant at Furnace (A) or Depot (B)');
  else if (bomb.state === 'planted') display.setBomb(`Planted at ${arena.sites[bomb.siteKey].name} — ${Math.ceil(bomb.fuseLeft)}s`);
  else if (bomb.state === 'lost') display.setBomb('Charge lost — elimination only');
  else if (bomb.state === 'defused') display.setBomb('Charge defused');
  else if (bomb.state === 'detonated') display.setBomb('Charge detonated');
  const damageEl = document.getElementById('damage');
  if (damageEl) damageEl.style.opacity = String(Math.max(0, damageFlash));
}

function step(dt) {
  time += dt;
  world.time = time;
  matchState.phaseLeft -= dt;

  // Phase clock.
  if (matchState.phase === 'buy' && matchState.phaseLeft <= 0) {
    goLive();
    display.showBuy(false, matchState.money, matchState.owned, matchState.grenades, matchState.kevlar);
    display.banner('Round live — plant the charge or eliminate Ember');
    window.setTimeout(() => display.banner(''), 3000);
  } else if (matchState.phase === 'over' && matchState.phaseLeft <= 0) {
    if (!matchState.over) {
      nextRound();
      resetPositions();
      display.hideOverlay();
      display.showBuy(true, matchState.money, matchState.owned, matchState.grenades, matchState.kevlar);
    }
  }

  if (matchState.phase === 'live') {
    // The plant: hold E inside a site while carrying the charge.
    const bomb = matchState.bomb;
    if (bomb.state === 'carried' && player.alive) {
      let siteKey = null;
      for (const key of ['A', 'B']) {
        const site = arena.sites[key];
        if (playerFighter.body.position.distanceTo(site.center) < site.radius) siteKey = key;
      }
      if (siteKey && controls.state.keys.has('KeyE')) {
        bomb.plantLeft -= dt;
        display.setPlant(`Planting at ${arena.sites[siteKey].name}…`, 1 - bomb.plantLeft / PLANT_SECONDS);
        if (bomb.plantLeft <= 0) {
          bomb.state = 'planted';
          bomb.siteKey = siteKey;
          bomb.siteCenter = arena.sites[siteKey].center;
          bomb.fuseLeft = FUSE_SECONDS;
          matchState.money += PRIZES.plant;
          display.feed(`Charge planted at ${arena.sites[siteKey].name}`);
          display.setPlant('', 0);
          charge.position.copy(arena.sites[siteKey].center);
          charge.position.y = 0.35;
          charge.visible = true;
          blip(520, 0.15, 'square', 0.06);
        }
      } else {
        bomb.plantLeft = PLANT_SECONDS;
        display.setPlant('', 0);
      }
    }

    // The fuse and the clock.
    if (bomb.state === 'planted') {
      bomb.fuseLeft -= dt;
      if (bomb.fuseLeft <= 0) {
        bomb.state = 'detonated';
        blasts.push(makeBlast(scene, bomb.siteCenter.clone().setY(1)));
        endRound('vanguard', 'Charge detonated');
        finishRound();
      }
      // Pick the nearest living Ember bot as the defuser.
      if (!world.defuser || !world.defuser.alive) {
        let best = null;
        let bestDist = Infinity;
        for (const enemy of squads.enemies) {
          if (!enemy.alive) continue;
          const d = enemy.fighter.body.position.distanceTo(bomb.siteCenter);
          if (d < bestDist) {
            bestDist = d;
            best = enemy;
          }
        }
        world.defuser = best ? best.bot : null;
        if (world.defuser) world.defuser.defuseLeft = 5;
      }
    }

    if (matchState.phaseLeft <= 0 && bomb.state !== 'planted') {
      endRound('ember', 'Time expired — no plant');
      finishRound();
    }
  }

  // Player movement and actions. The player can walk during the buy phase, but the
  // trigger only works once the round is live.
  if (player.alive && matchState.phase !== 'over') {
    playerFighter.step(dt, controls.state.keys, null);
    const firing = controls.state.firing;
    const triggerEdge = firing && !prevFiring;
    if (matchState.phase === 'live' && gun.ready() && (gun.def.auto ? firing : triggerEdge)) playerShoot();
    prevFiring = firing;
    if (controls.state.keys.has('KeyR')) gun.reload();
  }
  gun.step(dt);

  // One-shot keys.
  for (const code of controls.takePressed()) {
    if (code === 'KeyB' && matchState.phase === 'buy') {
      const buyEl = document.getElementById('buy');
      display.showBuy(buyEl.hidden, matchState.money, matchState.owned, matchState.grenades, matchState.kevlar);
    } else if (code === 'KeyG' && matchState.phase === 'live' && player.alive) {
      throwSpark();
    } else if (code.startsWith('Digit')) {
      const slot = Number(code.slice(5)) - 1;
      const keys = ['p9', 'vk', 'hornet', 'breacher', 'longbow'];
      const key = keys[slot];
      if (key && matchState.owned[key]) gun.swap(key);
    }
  }

  // Bots think and move only while the round is live.
  if (matchState.phase === 'live') {
    for (const ally of squads.allies) ally.update(dt, world);
    for (const enemy of squads.enemies) enemy.update(dt, world);
  }

  // Grenades and blasts.
  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    sparks[i].step(dt);
    if (sparks[i].done) {
      detonateSpark(sparks[i]);
      sparks[i].remove();
      sparks.splice(i, 1);
    }
  }
  for (let i = blasts.length - 1; i >= 0; i -= 1) {
    blasts[i].step(dt);
    if (blasts[i].gone) blasts.splice(i, 1);
  }

  // Tracers fade.
  for (let i = tracers.length - 1; i >= 0; i -= 1) {
    if (time >= tracers[i].until) {
      scene.remove(tracers[i].line);
      tracers[i].line.geometry.dispose();
      tracers.splice(i, 1);
    }
  }

  // The charge lamp blinks while the fuse runs.
  if (charge.visible) {
    chargeLamp.material.color.setHex(Math.floor(time * 4) % 2 === 0 ? 0xff4a38 : 0x881111);
  }
  damageFlash = Math.max(0, damageFlash - dt * 1.4);
  syncHud();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = controls.takeLook();
    if (player.alive) playerFighter.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    display.hideOverlay();
  } else if (!matchState.over && matchState.phase !== 'over') {
    display.showOverlay(started ? 'paused' : 'start');
  }
}

display.onPlay(() => {
  if (shot) return;
  if (matchState.over) {
    // Fresh match: reset everything and start round one.
    matchState.round = 1;
    matchState.score.vanguard = 0;
    matchState.score.ember = 0;
    matchState.money = 800;
    matchState.kills = 0;
    matchState.deaths = 0;
    matchState.owned = { p9: true };
    matchState.grenades = 0;
    matchState.kevlar = 0;
    matchState.over = false;
    matchState.winner = null;
    gun.swap('p9');
    startRound();
    resetPositions();
    display.hideOverlay();
    display.showBuy(true, matchState.money, matchState.owned, matchState.grenades, matchState.kevlar);
  } else if (matchState.phase === 'over') {
    nextRound();
    resetPositions();
    display.hideOverlay();
    display.showBuy(true, matchState.money, matchState.owned, matchState.grenades, matchState.kevlar);
  }
  controls.requestLock();
});

// Buy menu clicks.
document.querySelectorAll('#buy-items [data-item]').forEach((node) => {
  node.addEventListener('click', () => {
    const result = buy(node.getAttribute('data-item'));
    if (!result.ok) {
      display.feed(result.why);
      return;
    }
    if (result.item.kind === 'gun') gun.swap(result.item.id);
    display.showBuy(true, matchState.money, matchState.owned, matchState.grenades, matchState.kevlar);
    display.setMoney(matchState.money);
  });
});

function aimAt(point) {
  const body = playerFighter.body;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  display.hideOverlay();
  display.showBuy(false, matchState.money, matchState.owned, matchState.grenades, matchState.kevlar);
  playerFighter.body.pitch = 0;
  playerFighter.body.yaw = 0;
  resetPositions();
  goLive();
  matchState.phaseLeft = ROUND_SECONDS;
  if (name === 'start') {
    playerFighter.body.position.set(0, 0, 14.5);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
    display.showOverlay('start');
  } else if (name === 'play') {
    // Push two Ember bots into the mid lane, in view, and trade shots with one.
    const enemy = squads.enemies[1];
    enemy.fighter.body.position.set(1.5, 0, -4);
    enemy.fighter.body.yaw = 0;
    const enemy2 = squads.enemies[0];
    enemy2.fighter.body.position.set(-6, 0, -6);
    enemy2.fighter.body.yaw = Math.PI / 4;
    playerFighter.body.position.set(0, 0, 6);
    settle(20);
    const target = new THREE.Vector3();
    enemy.eye(target);
    aimAt(target);
    playerShoot();
    settle(6);
    aimAt(target);
    playerShoot();
    settle(4);
    display.hitMarker(false);
  } else {
    // Round won at Furnace: the charge is planted, the fuse is running.
    matchState.bomb.state = 'planted';
    matchState.bomb.siteKey = 'A';
    matchState.bomb.siteCenter = arena.sites.A.center;
    matchState.bomb.fuseLeft = 22;
    charge.position.copy(arena.sites.A.center);
    charge.position.y = 0.35;
    charge.visible = true;
    playerFighter.body.position.set(-8, 0, -4);
    settle(20);
    aimAt(new THREE.Vector3(-15, 1.2, -11));
    matchState.round = 3;
    matchState.score.vanguard = 2;
    matchState.score.ember = 1;
    endRound('vanguard', 'Charge detonated');
    matchState.phase = 'live';
    display.showOverlay('round', 'Vanguard takes round 3 — Charge detonated');
  }
  syncHud();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

resetPositions();
display.setAmmo(gun.state.mag, gun.state.reserve);
display.setScore(0, 0);
display.showBuy(true, matchState.money, matchState.owned, matchState.grenades, matchState.kevlar);
syncCamera();

// A small read-only handle for live testing: round state, the player, and both squads.
window.__ember = {
  match: matchState,
  player,
  allies: squads.allies,
  enemies: squads.enemies,
};

if (shot) runShot(shot);
else requestAnimationFrame(frame);
