// EMBERLINE — the map: "Ashworks Yard", an industrial yard with two bomb sites.
// North is -z. Vanguard spawns south and pushes north; Ember spawns north and holds.
// Three lanes run the length of the yard: A-Long along the west wall, Mid through the
// container row, B-Short along the east wall. Every solid is both a wall the fighters
// collide with and a surface a bullet stops on.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const YARD_W = 44; // x: -22 .. 22
const YARD_D = 36; // z: -18 .. 18
const WALL_H = 5;

export function buildArena(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.5 : 0.94,
      metalness: 0.04,
    });
  }

  const colliders = [];
  const shootables = [];

  // A solid block: add the mesh, remember its box for collision and for bullets.
  function solid(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor and the four outer walls.
  solid(YARD_W + 0.8, 0.4, YARD_D + 0.8, 0, -0.2, 0, 'ground');
  solid(0.5, WALL_H, YARD_D + 0.8, -YARD_W / 2 - 0.25, WALL_H / 2, 0, 'surface');
  solid(0.5, WALL_H, YARD_D + 0.8, YARD_W / 2 + 0.25, WALL_H / 2, 0, 'surface');
  solid(YARD_W + 0.8, WALL_H, 0.5, 0, WALL_H / 2, -YARD_D / 2 - 0.25, 'surface');
  solid(YARD_W + 0.8, WALL_H, 0.5, 0, WALL_H / 2, YARD_D / 2 + 0.25, 'surface');

  // --- Site A "Furnace", west-north: a furnace block, a low wall, crate cover.
  solid(4.5, 3.2, 2.0, -17.5, 1.6, -15.5, 'container');
  solid(1.4, 1.4, 1.4, -12.5, 0.7, -13.5, 'crate');
  solid(1.4, 1.4, 1.4, -12.5, 0.7, -11.2, 'crate');
  solid(1.4, 2.8, 1.4, -13.6, 1.4, -12.3, 'crate');
  solid(5.0, 1.1, 0.8, -15.5, 0.55, -7.5, 'hairline');
  solid(2.2, 0.9, 2.2, -18.5, 0.45, -6.5, 'crate');

  // --- Site B "Depot", east-north: stacked containers and a crate nest.
  solid(6.0, 2.4, 2.4, 17.5, 1.2, -15.0, 'containerB');
  solid(6.0, 2.4, 2.4, 17.5, 3.6, -15.0, 'container');
  solid(1.4, 1.4, 1.4, 12.0, 0.7, -13.0, 'crate');
  solid(1.4, 1.4, 1.4, 12.0, 0.7, -10.6, 'crate');
  solid(5.0, 1.1, 0.8, 15.0, 0.55, -7.0, 'hairline');
  solid(2.2, 0.9, 2.2, 10.5, 0.45, -6.0, 'crate');

  // --- Mid: a container row that splits the middle lane into two gaps.
  solid(2.4, 2.4, 7.0, -3.0, 1.2, -1.0, 'container');
  solid(2.4, 2.4, 7.0, 3.0, 1.2, -1.0, 'containerB');
  solid(1.4, 1.4, 1.4, 0, 0.7, -6.5, 'crate');
  solid(1.4, 2.8, 1.4, -6.5, 1.4, 3.5, 'crate');
  solid(1.4, 1.4, 1.4, 6.5, 0.7, 3.5, 'crate');

  // --- Lane cover: low walls and crates along A-Long, B-Short and the south approach.
  solid(0.8, 1.1, 5.0, -19.0, 0.55, 2.0, 'hairline');
  solid(0.8, 1.1, 5.0, 19.0, 0.55, 2.0, 'hairline');
  solid(2.4, 0.9, 1.2, -9.0, 0.45, 8.5, 'crate');
  solid(2.4, 0.9, 1.2, 9.0, 0.45, 8.5, 'crate');
  solid(1.4, 1.4, 1.4, -14.0, 0.7, 6.0, 'crate');
  solid(1.4, 1.4, 1.4, 14.0, 0.7, 6.0, 'crate');
  solid(3.0, 1.1, 1.0, -4.0, 0.55, 12.0, 'hairline');
  solid(3.0, 1.1, 1.0, 4.0, 0.55, 12.0, 'hairline');

  // --- Site markers: a glowing floor plate at each site so the objective reads at a glance.
  function sitePlate(x, z, color) {
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.4, 0.06, 28),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.22 }),
    );
    plate.position.set(x, 0.04, z);
    group.add(plate);
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 2.6, 0.3),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color) }),
    );
    post.position.set(x, 1.3, z);
    group.add(post);
    return plate;
  }
  sitePlate(-15, -11, PALETTE.accent);
  sitePlate(15, -11, PALETTE.accent);

  // Dusk light: a warm low key from the west, a cool fill from the east, sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8a7a66'), new THREE.Color(PALETTE.canvas), 1.0);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color('#ffb066'), 2.4);
  key.position.set(-14, 16, 10);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#6e86a8'), 0.5);
  fill.position.set(12, 10, 12);
  scene.add(fill);

  // Bomb sites, spawn points and the lane routes the bots walk.
  const sites = {
    A: { name: 'Furnace', center: new THREE.Vector3(-15, 0, -11), radius: 3.4 },
    B: { name: 'Depot', center: new THREE.Vector3(15, 0, -11), radius: 3.4 },
  };
  const spawns = {
    vanguard: [
      new THREE.Vector3(0, 0, 14.5),
      new THREE.Vector3(-3.5, 0, 15.0),
      new THREE.Vector3(3.5, 0, 15.0),
    ],
    ember: [
      new THREE.Vector3(-6, 0, -14.5),
      new THREE.Vector3(0, 0, -15.0),
      new THREE.Vector3(6, 0, -14.5),
      new THREE.Vector3(-13, 0, -13.0),
    ],
  };
  // Routes are walked north-to-south or south-to-north; each bot picks one and follows it.
  const routes = {
    aLong: [
      new THREE.Vector3(-19, 0, 6), new THREE.Vector3(-19, 0, -3),
      new THREE.Vector3(-17, 0, -8), new THREE.Vector3(-15, 0, -11),
    ],
    mid: [
      new THREE.Vector3(0, 0, 6), new THREE.Vector3(0, 0, -4),
      new THREE.Vector3(-1, 0, -9), new THREE.Vector3(0, 0, -12),
    ],
    bShort: [
      new THREE.Vector3(19, 0, 6), new THREE.Vector3(19, 0, -3),
      new THREE.Vector3(17, 0, -8), new THREE.Vector3(15, 0, -11),
    ],
  };
  const holds = {
    A: [new THREE.Vector3(-12, 0, -13), new THREE.Vector3(-18, 0, -8), new THREE.Vector3(-13, 0, -7)],
    B: [new THREE.Vector3(12, 0, -13), new THREE.Vector3(18, 0, -8), new THREE.Vector3(13, 0, -7)],
    mid: [new THREE.Vector3(-6, 0, -4), new THREE.Vector3(6, 0, -4), new THREE.Vector3(0, 0, 8)],
  };

  return { colliders, shootables, group, sites, spawns, routes, holds };
}
