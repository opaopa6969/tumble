// tumble unit tests — proves the M1 engine runs headless (no renderer, no
// browser), is deterministic, and that a tilted box dropped onto the ground
// plane tumbles and SETTLES on a face (the mahjong-tile behaviour).
//   node test.mjs    (or: npm test)
import { World, Body } from './index.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const finite = (a) => a.every((x) => Number.isFinite(x));

// Drop one box from a height, tilted, and simulate ~3s at 60fps. A flat,
// tile-shaped box (half = [0.4, 0.05, 0.3]) so the inertia is anisotropic and
// the body has to rotate to lie down on a face.
function dropTile(seedQuat) {
  const world = new World({ gravity: [0, -9.81, 0], floor: 0 });
  const b = world.add(new Body({
    pos: [0, 2.0, 0],
    quat: seedQuat,                 // a deterministic tilt (no Math.random)
    half: [0.4, 0.05, 0.3],
    mass: 1,
  }));
  const dt = 1 / 60;
  for (let i = 0; i < 180; i++) world.step(dt, 8);   // 3 seconds
  return b;
}

// a fixed tilt quaternion (~25° about a slanted axis) — same every run
const TILT = (() => {
  const ax = [0.6, 0.2, 0.77], a = 0.44;             // axis (unit-ish) + half-angle
  const s = Math.sin(a), c = Math.cos(a);
  const l = Math.hypot(ax[0], ax[1], ax[2]);
  return [ax[0] / l * s, ax[1] / l * s, ax[2] / l * s, c];
})();

// 1) deterministic: identical setup → byte-identical final state (no Math.random)
{
  const a = dropTile(TILT.slice());
  const b = dropTile(TILT.slice());
  const same =
    a.p.every((x, i) => x === b.p[i]) &&
    a.q.every((x, i) => x === b.q[i]) &&
    a.v.every((x, i) => x === b.v[i]) &&
    a.w.every((x, i) => x === b.w[i]);
  ok(same, 'deterministic across two runs (bit-identical final pose)');
}

// 2..5) the tumble-and-settle assertions
{
  const b = dropTile(TILT.slice());

  // (a) stays finite — no blow-up
  ok(finite(b.p) && finite(b.q) && finite(b.v) && finite(b.w), 'state stays finite (no NaN/Inf)');

  // (b) comes to rest ABOVE the floor: the lowest corner sits ≈ on the plane,
  //     not buried below it and not floating.
  const ys = b.corners().map((c) => c[1]);
  const lowest = Math.min(...ys);
  ok(lowest > -0.02, `does not sink through the floor (lowest corner y=${lowest.toFixed(4)})`);
  ok(lowest < 0.02, `actually rests ON the floor (lowest corner y=${lowest.toFixed(4)})`);

  // (c) comes to REST: linear + angular velocity are small
  const speed = Math.hypot(...b.v), spin = Math.hypot(...b.w);
  ok(speed < 0.05, `linear velocity settled (|v|=${speed.toFixed(4)})`);
  ok(spin < 0.20, `angular velocity settled (|w|=${spin.toFixed(4)})`);

  // (d) settled FLAT on a face: a tile lying down has its thin axis (local y,
  //     half = 0.05) roughly vertical, so the body half-thickness above floor
  //     should be near 0.05 — i.e. its centre is low.
  ok(b.p[1] < 0.30, `settled low / lying on a face (com y=${b.p[1].toFixed(4)})`);
}

console.log(`\ntumble M1: ${pass} passed${fail ? `, ${fail} FAILED` : ''}`);

function stack(count, frames = 600) {
  const world = new World(); const bodies = [];
  for (let i = 0; i < count; i++) {
    bodies.push(world.add(new Body({ pos: [0, 0.5 + i * 1.02, 0], half: [0.5, 0.5, 0.5] })));
  }
  for (let i = 0; i < frames; i++) world.step(1 / 60, 8);
  return bodies;
}

// M2: separated OBBs must not be corrected by SAT.
{
  const world = new World({ gravity: [0, 0, 0], floor: -10, linDamp: 1, angDamp: 1 });
  const a = world.add(new Body({ pos: [0, 0, 0], quat: TILT, half: [0.5, 0.2, 0.3] }));
  const b = world.add(new Body({ pos: [3, 0, 0], quat: TILT, half: [0.5, 0.2, 0.3] }));
  const before = JSON.stringify([a.p, b.p]);
  world.step(1 / 60, 8);
  ok(JSON.stringify([a.p, b.p]) === before, 'SAT leaves separated boxes untouched');
}

// M2: two boxes and a five-box tower settle without overlap or collapse.
{
  const two = stack(2, 360);
  ok(Math.abs(two[0].p[1] - 0.5) < 0.02 && Math.abs(two[1].p[1] - 1.5) < 0.02,
    'two boxes stack at the expected heights');
  ok(two.every((b) => Math.hypot(...b.v) < 0.03 && Math.hypot(...b.w) < 0.03),
    'two-box stack comes to rest');

  const tower = stack(5);
  const aligned = tower.every((b, i) =>
    Math.abs(b.p[0]) < 0.03 && Math.abs(b.p[2]) < 0.03 && Math.abs(b.p[1] - (0.5 + i)) < 0.03);
  ok(aligned, 'five-box stack remains aligned and non-penetrating');
  ok(tower.every((b) => Math.hypot(...b.v) < 0.03 && Math.hypot(...b.w) < 0.03),
    'five-box stack comes to rest');
}

// M2: Coulomb friction removes tangential motion on a supporting box.
{
  const world = new World();
  world.add(new Body({ pos: [0, 0.5, 0], half: [2, 0.5, 2], fixed: true, friction: 0.8 }));
  const sliding = world.add(new Body({ pos: [0, 1.5, 0], friction: 0.8 }));
  sliding.v = [1, 0, 0];
  for (let i = 0; i < 120; i++) world.step(1 / 60, 8);
  ok(Math.abs(sliding.v[0]) < 0.02 && sliding.p[0] < 0.3, 'Coulomb friction stops tangential sliding');
}

// M2 remains bit-identical for the complete multi-body trajectory.
{
  const a = stack(5).map((b) => [b.p, b.q, b.v, b.w]);
  const b = stack(5).map((body) => [body.p, body.q, body.v, body.w]);
  ok(JSON.stringify(a) === JSON.stringify(b), 'five-box stack is bit-identical across two runs');
}

console.log(`tumble M2: ${pass} total passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
