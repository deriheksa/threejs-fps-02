// EMBERLINE — one body for every fighter, player or bot.
// Movement is acceleration-based with ground friction, gravity, a jump and a crouch, and
// the body is resolved against the arena's boxes one axis at a time, so a wall can stop a
// fighter but never swallow one. The body is a vertical capsule approximated by a box:
// a radius around the feet and a height that shrinks when crouched.
import * as THREE from 'three';

const BODY_RADIUS = 0.34;
const TALL_HEIGHT = 1.74;
const LOW_HEIGHT = 1.1;
const TALL_EYE = 1.62;
const LOW_EYE = 1.0;
const RUN_SPEED = 5.4;
const CROUCH_SPEED = 2.5;
const GROUND_PULL = 40;
const AIR_PULL = 10;
const DRAG = 9.5;
const FALL = 21;
const LEAP = 6.4;

export function makeFighter(colliders, start) {
  const body = {
    position: start.clone(),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: TALL_EYE,
    height: TALL_HEIGHT,
    crouched: false,
    grounded: true,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  // Does a body box at (x, y, z) with this height touch any arena box? `lift` trims the
  // box's bottom and top so standing on the floor never reads as walking into a wall.
  function blocked(x, y, z, height, lift) {
    probe.min.set(x - BODY_RADIUS, y + lift, z - BODY_RADIUS);
    probe.max.set(x + BODY_RADIUS, y + height - lift, z + BODY_RADIUS);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  function look(deltaX, deltaY, sensitivity = 0.0022) {
    body.yaw -= deltaX * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - deltaY * sensitivity));
  }

  function kick(pitchUp, yawSide) {
    body.pitch = Math.min(1.45, body.pitch + pitchUp);
    body.yaw += yawSide;
  }

  // `keys` is a Set of event.code strings; `intent` lets a bot drive the same body with a
  // plain {forward, strafe, jump, crouch} object instead of a keyboard.
  function step(dt, keys, intent) {
    const wantCrouch = intent
      ? intent.crouch
      : keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantCrouch && !body.crouched) {
      body.crouched = true;
      body.height = LOW_HEIGHT;
    } else if (!wantCrouch && body.crouched) {
      const clear = !blocked(body.position.x, body.position.y, body.position.z, TALL_HEIGHT, 0.02);
      if (clear) {
        body.crouched = false;
        body.height = TALL_HEIGHT;
      }
    }
    const eyeGoal = body.crouched ? LOW_EYE : TALL_EYE;
    body.eye += (eyeGoal - body.eye) * Math.min(1, dt * 12);

    let forward = 0;
    let strafe = 0;
    if (intent) {
      forward = intent.forward || 0;
      strafe = intent.strafe || 0;
    } else {
      forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    }
    wish.set(0, 0, 0);
    if (forward !== 0 || strafe !== 0) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe);
      wish.normalize();
    }

    const topSpeed = body.crouched ? CROUCH_SPEED : RUN_SPEED;
    const pull = body.grounded ? GROUND_PULL : AIR_PULL;
    const blend = Math.min(1, (pull * dt) / topSpeed);
    body.velocity.x += (wish.x * topSpeed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * topSpeed - body.velocity.z) * blend;
    if (body.grounded && wish.lengthSq() === 0) {
      const damp = Math.max(0, 1 - DRAG * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }

    const wantJump = intent ? intent.jump : keys.has('Space');
    if (wantJump && body.grounded) {
      body.velocity.y = LEAP;
      body.grounded = false;
    }
    body.velocity.y -= FALL * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!blocked(nextX, body.position.y, body.position.z, body.height, 0.04)) {
      body.position.x = nextX;
    } else {
      body.velocity.x = 0;
    }
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!blocked(body.position.x, body.position.y, nextZ, body.height, 0.04)) {
      body.position.z = nextZ;
    } else {
      body.velocity.z = 0;
    }

    body.position.y += body.velocity.y * dt;
    body.grounded = false;
    const floor = blocked(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (floor && body.velocity.y <= 0) {
      body.position.y = floor.max.y;
      body.velocity.y = 0;
      body.grounded = true;
    } else if (floor) {
      body.position.y = floor.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.grounded = true;
    }
    body.velocity.y = Math.max(-32, body.velocity.y);
  }

  return {
    body,
    step,
    look,
    kick,
    speed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    eyePosition(out) {
      out.set(body.position.x, body.position.y + body.eye, body.position.z);
      return out;
    },
  };
}
