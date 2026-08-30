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

// M3 broadphase: 100+ boxes on a grid settle without overlap, stay finite, and
// the trajectory is bit-identical across two runs (determinism preserved under
// the uniform-grid candidate-pair generation).
function gridField(n = 120, frames = 240) {
  const world = new World();
  const bodies = [];
  // a 12×10 single layer of unit boxes spaced so neighbours touch; total 120.
  for (let i = 0; i < n; i++) {
    const gx = i % 12, gz = Math.floor(i / 12) % 10;
    bodies.push(world.add(new Body({ pos: [gx * 1.02, 0.5, gz * 1.02], half: [0.5, 0.5, 0.5] })));
  }
  for (let i = 0; i < frames; i++) world.step(1 / 60, 8);
  return bodies;
}
{
  const field = gridField();
  ok(field.every((b) => finite(b.p) && finite(b.q) && finite(b.v) && finite(b.w)), '120-box grid stays finite');
  ok(field.every((b) => Math.hypot(...b.v) < 0.1 && Math.hypot(...b.w) < 0.1),
    '120-box grid comes to rest');
  // bit-identical across two runs (determinism under broadphase)
  const a = gridField().map((b) => [b.p, b.q, b.v, b.w]);
  const b = gridField().map((body) => [body.p, body.q, body.v, body.w]);
  ok(JSON.stringify(a) === JSON.stringify(b), '120-box grid is bit-identical across two runs');
}

// M3 broadphase: candidate pairs must be a strict match to O(n²) when bodies
// overlap, and the grid must NOT emit pairs for widely separated boxes.
{
  const world = new World({ gravity: [0, 0, 0], floor: -100 });
  world.add(new Body({ pos: [0, 0, 0], half: [0.5, 0.5, 0.5] }));
  world.add(new Body({ pos: [1.0, 0, 0], half: [0.5, 0.5, 0.5] }));   // touches
  world.add(new Body({ pos: [100, 0, 0], half: [0.5, 0.5, 0.5] }));   // far
  const pairs = world._candidatePairs().map(([i, j]) => i + ':' + j);
  ok(pairs.includes('0:1'), 'broadphase emits a pair for touching neighbours');
  ok(!pairs.includes('0:2') && !pairs.includes('1:2'),
    'broadphase skips far-apart boxes (the point of the grid)');
}

// M3 broadphase: disabling broadphase falls back to the O(n²) path and yields
// the same trajectory as the grid (equivalence of candidate sets at rest).
{
  const make = (bp) => {
    const w = new World({ broadphase: bp });
    for (let i = 0; i < 6; i++) w.add(new Body({ pos: [0, 0.5 + i * 1.02, 0], half: [0.5, 0.5, 0.5] }));
    for (let i = 0; i < 360; i++) w.step(1 / 60, 8);
    return w.bodies.map((b) => [b.p, b.q, b.v, b.w]);
  };
  const grid = make(true), brute = make(false);
  ok(JSON.stringify(grid) === JSON.stringify(brute),
    'broadphase on/off produces identical stack trajectory (candidate sets agree)');
}

console.log(`tumble M2: ${pass} total passed${fail ? `, ${fail} FAILED` : ''}`);

// M3b sleeping: a box that settles on the floor goes to sleep after sleepTime
// seconds of being below the velocity thresholds; its velocity is zeroed.
{
  const world = new World();
  const b = world.add(new Body({ pos: [0, 2.0, 0], quat: TILT, half: [0.4, 0.05, 0.3] }));
  for (let i = 0; i < 600; i++) world.step(1 / 60, 8);   // 10s — well past sleepTime
  ok(b.sleeping === true, 'settled box goes to sleep (sleeping flag set)');
  ok(b.v[0] === 0 && b.v[1] === 0 && b.v[2] === 0, 'sleeping body has zero linear velocity');
  ok(b.w[0] === 0 && b.w[1] === 0 && b.w[2] === 0, 'sleeping body has zero angular velocity');
}

// M3b sleeping: a dropped box onto a stack must keep sleeping until disturbed,
// and a moving neighbour that contacts a sleeping body wakes it.
{
  const world = new World();
  const floor = world.add(new Body({ pos: [0, -0.5, 0], half: [4, 0.5, 4], fixed: true }));
  const rest = world.add(new Body({ pos: [0, 0.5, 0], half: [0.5, 0.5, 0.5] }));
  // let the box settle and sleep
  for (let i = 0; i < 600; i++) world.step(1 / 60, 8);
  ok(rest.sleeping === true, 'box on floor sleeps after settling');
  // drop a mover onto the resting box from above — it must wake the sleeper
  const mover = world.add(new Body({ pos: [0, 3.0, 0], half: [0.5, 0.5, 0.5] }));
  for (let i = 0; i < 30; i++) world.step(1 / 60, 8);   // mover is still moving
  ok(rest.sleeping === false, 'sleeping box wakes when a moving neighbour approaches');
}

// M3b sleeping: a settled stack can fully sleep, and disabling sleeping keeps
// bodies awake (sleeping flag never set) without breaking the trajectory.
{
  const stackSleep = (sleepOn) => {
    const w = new World({ sleep: sleepOn });
    const bodies = [];
    for (let i = 0; i < 5; i++) bodies.push(w.add(new Body({ pos: [0, 0.5 + i * 1.02, 0], half: [0.5, 0.5, 0.5] })));
    for (let i = 0; i < 720; i++) w.step(1 / 60, 8);    // 12s
    return w;
  };
  const on = stackSleep(true);
  ok(on.bodies.every((b) => b.sleeping === true), 'five-box stack fully sleeps when sleep is on');
  const off = stackSleep(false);
  ok(off.bodies.every((b) => b.sleeping === false), 'no body sleeps when sleep is disabled');
}

// M3b sleeping: determinism is preserved — a settled+slept multi-body field is
// bit-identical across two runs (sleep is thresholded + ordered, no RNG).
{
  const field = (n = 60, frames = 480) => {
    const w = new World();
    const bodies = [];
    for (let i = 0; i < n; i++) {
      const gx = i % 10, gz = Math.floor(i / 10) % 6;
      bodies.push(w.add(new Body({ pos: [gx * 1.02, 0.5, gz * 1.02], half: [0.5, 0.5, 0.5] })));
    }
    for (let i = 0; i < frames; i++) w.step(1 / 60, 8);
    return bodies.map((b) => [b.p, b.q, b.v, b.w, b.sleeping]);
  };
  const a = field();
  const b = field();
  ok(JSON.stringify(a) === JSON.stringify(b), '60-box grid with sleeping is bit-identical across two runs');
}

// M3b sleeping: a slept stack stays bit-identical to itself run for longer —
// i.e. sleeping does not introduce drift once bodies are asleep (stable).
{
  const make = (frames) => {
    const w = new World();
    for (let i = 0; i < 3; i++) w.add(new Body({ pos: [0, 0.5 + i * 1.02, 0], half: [0.5, 0.5, 0.5] }));
    for (let i = 0; i < frames; i++) w.step(1 / 60, 8);
    return w.bodies.map((b) => [b.p, b.q, b.v, b.w, b.sleeping]);
  };
  const short = make(600), long = make(900);
  ok(JSON.stringify(short) === JSON.stringify(long),
    'slept stack is stable (no drift after sleeping)');
}

console.log(`tumble M3: ${pass} total passed${fail ? `, ${fail} FAILED` : ''}`);

// input guard: step(dt<=0) or step(_, substeps<=0) must throw a RangeError and
// leave body state untouched (no NaN contamination).
{
  const w = new World({ floor: 0 });
  const b = w.add(new Body({ pos: [0, 2, 0], half: [0.5, 0.5, 0.5] }));
  const before = JSON.stringify([b.p, b.q, b.v, b.w]);
  let threwDt0 = false, threwDtNeg = false, threwSub = false;
  try { w.step(0, 8); } catch (e) { threwDt0 = e instanceof RangeError; }
  try { w.step(-1 / 60, 8); } catch (e) { threwDtNeg = e instanceof RangeError; }
  try { w.step(1 / 60, 0); } catch (e) { threwSub = e instanceof RangeError; }
  ok(threwDt0, 'step(0, 8) throws RangeError');
  ok(threwDtNeg, 'step(-1/60, 8) throws RangeError');
  ok(threwSub, 'step(1/60, 0) throws RangeError');
  ok(JSON.stringify([b.p, b.q, b.v, b.w]) === before,
    'body state untouched after rejected step calls (no NaN contamination)');
  w.step(1 / 60, 8);
  ok(finite(b.p) && finite(b.v) && finite(b.w), 'subsequent valid step keeps state finite');
}

console.log(`tumble input-guard: ${pass} total passed${fail ? `, ${fail} FAILED` : ''}`);

// finite-loop guard: substeps=Infinity and contactIterations=Infinity slip past
// the existing `> 0` checks (Infinity > 0 === true) and hang the process in an
// unbounded `for` loop — a single step() becomes a DoS. The finite-loop guard
// must reject them with RangeError and leave body state untouched.
{
  const w = new World({ floor: 0 });
  const b = w.add(new Body({ pos: [0, 2, 0], half: [0.5, 0.5, 0.5] }));
  const before = JSON.stringify([b.p, b.q, b.v, b.w]);
  let threwSubInf = false, threwSubNaN = false, threwIter = false;
  try { w.step(1 / 60, Infinity); } catch (e) { threwSubInf = e instanceof RangeError; }
  try { w.step(1 / 60, NaN); } catch (e) { threwSubNaN = e instanceof RangeError; }
  try { w.contactIterations = Infinity; w.step(1 / 60, 8); } catch (e) { threwIter = e instanceof RangeError; }
  ok(threwSubInf, 'step(_, Infinity) throws RangeError (no unbounded substep loop)');
  ok(threwSubNaN, 'step(_, NaN) throws RangeError (no unbounded substep loop)');
  ok(threwIter, 'contactIterations=Infinity throws RangeError (no unbounded contact loop)');
  ok(JSON.stringify([b.p, b.q, b.v, b.w]) === before,
    'body state untouched after rejected finite-loop inputs (no NaN contamination)');
}

// broadphase guard: cellSize < largest body diameter must throw at step() so the
// silent false-negative (overlapping bodies passing through each other) is
// surfaced early instead of corrupting the trajectory.
{
  const w = new World({ cellSize: 0.5, gravity: [0, 0, 0], floor: -100 });
  w.add(new Body({ pos: [0, 0, 0], half: [2.0, 2.0, 2.0] }));
  w.add(new Body({ pos: [1.1, 0, 0], half: [2.0, 2.0, 2.0] }));
  let threw = false;
  try { w.step(1 / 60, 8); } catch (e) { threw = e instanceof RangeError; }
  ok(threw, 'step() throws RangeError when cellSize < max body diameter (broadphase guard)');

  // raising cellSize to the max diameter lets step() proceed normally
  const w2 = new World({ cellSize: 4.0, gravity: [0, 0, 0], floor: -100 });
  const a = w2.add(new Body({ pos: [0, 0, 0], half: [2.0, 2.0, 2.0] }));
  const b = w2.add(new Body({ pos: [1.1, 0, 0], half: [2.0, 2.0, 2.0] }));
  let threw2 = false;
  try { w2.step(1 / 60, 8); } catch (e) { threw2 = true; }
  ok(!threw2 && finite(a.p) && finite(b.p), 'step() proceeds when cellSize >= max diameter');

  // broadphase disabled bypasses the guard entirely
  const w3 = new World({ cellSize: 0.5, broadphase: false, gravity: [0, 0, 0], floor: -100 });
  w3.add(new Body({ pos: [0, 0, 0], half: [2.0, 2.0, 2.0] }));
  w3.add(new Body({ pos: [1.1, 0, 0], half: [2.0, 2.0, 2.0] }));
  let threw3 = false;
  try { w3.step(1 / 60, 8); } catch (e) { threw3 = true; }
  ok(!threw3, 'broadphase:false bypasses the cellSize guard (O(n^2) needs no grid)');
}

console.log(`tumble broadphase-guard: ${pass} total passed${fail ? `, ${fail} FAILED` : ''}`);

// API contract: World/Body defaults must match the documented README values
// exactly. A refactor that silently changes a default breaks every caller that
// relies on it, so pin each one.
{
  const w = new World();
  ok(Array.isArray(w.gravity) && w.gravity[0] === 0 && w.gravity[1] === -9.81 && w.gravity[2] === 0,
    'World default gravity is [0,-9.81,0]');
  ok(w.floor === 0, 'World default floor is 0');
  ok(w.linDamp === 0.999, 'World default linDamp is 0.999');
  ok(w.angDamp === 0.995, 'World default angDamp is 0.995');
  ok(w.contactIterations === 8, 'World default contactIterations is 8');
  ok(w.broadphase === true, 'World default broadphase is true');
  ok(w.cellSize === 2, 'World default cellSize is 2');
  ok(w.sleep === true, 'World default sleep is true');
  ok(w.sleepVel === 0.05, 'World default sleepVel is 0.05');
  ok(w.sleepAng === 0.20, 'World default sleepAng is 0.20');
  ok(w.sleepTime === 1.0, 'World default sleepTime is 1.0');

  const b = new Body({ pos: [1, 2, 3] });
  ok(Array.isArray(b.p) && b.p[0] === 1 && b.p[1] === 2 && b.p[2] === 3, 'Body stores pos');
  ok(Array.isArray(b.q) && b.q[0] === 0 && b.q[1] === 0 && b.q[2] === 0 && b.q[3] === 1,
    'Body default quat is identity [0,0,0,1]');
  ok(Array.isArray(b.half) && b.half[0] === 0.5 && b.half[1] === 0.5 && b.half[2] === 0.5,
    'Body default half is [0.5,0.5,0.5]');
  ok(b.invM === 1, 'Body default mass=1 gives invM=1');
  ok(b.fixed === false, 'Body default fixed is false');
  ok(b.friction === 0.5, 'Body default friction is 0.5');
  // box inertia diagonal for a 1kg unit cube (half 0.5): I = m/12·(d²+d²) = 1/6
  ok(Math.abs(b.invIl[0] - 6) < 1e-9 && Math.abs(b.invIl[1] - 6) < 1e-9 && Math.abs(b.invIl[2] - 6) < 1e-9,
    'Body unit-cube inverse inertia diagonal is 6 (1/12·2·(1+1)=1/6 → inv=6)');

  const f = new Body({ pos: [0, 0, 0], fixed: true });
  ok(f.invM === 0, 'fixed body has invM=0');
  ok(Array.isArray(f.invIl) && f.invIl[0] === 0 && f.invIl[1] === 0 && f.invIl[2] === 0,
    'fixed body has invIl=[0,0,0]');
}

// API contract: step(dt) uses substeps=8 by default and must produce a
// trajectory byte-identical to an explicit step(dt, 8). Every existing test
// passes 8 explicitly, so the default-parameter path is otherwise unexercised.
{
  const make = (sub) => {
    const w = new World({ gravity: [0, -9.81, 0], floor: 0 });
    const b = w.add(new Body({
      pos: [0, 2.0, 0], quat: TILT.slice(), half: [0.4, 0.05, 0.3], mass: 1,
    }));
    for (let i = 0; i < 180; i++) w.step(1 / 60, sub);
    return [b.p, b.q, b.v, b.w];
  };
  const explicit = make(8);
  const implicit = make(undefined);
  ok(JSON.stringify(explicit) === JSON.stringify(implicit),
    'step(dt) default substeps (8) is byte-identical to step(dt, 8)');
}

// API contract: a fixed body is immovable — its position, orientation, linear
// and angular velocity must be byte-identical before and after being loaded by a
// stack, even though it participates in contact solving. Existing tests check
// that stacks settle *on top of* a fixed floor indirectly; this pins the
// invariant directly so a regression that nudges a fixed body is caught.
{
  const world = new World({ gravity: [0, -9.81, 0], floor: -100 });
  const ground = world.add(new Body({
    pos: [0, 0.5, 0], half: [4, 0.5, 4], fixed: true, friction: 0.8,
  }));
  // load it: a stack of three boxes dropped onto the fixed ground
  for (let i = 0; i < 3; i++)
    world.add(new Body({ pos: [0, 1.5 + i * 1.02, 0], half: [0.5, 0.5, 0.5], friction: 0.8 }));
  const before = JSON.stringify([ground.p, ground.q, ground.v, ground.w]);
  for (let i = 0; i < 480; i++) world.step(1 / 60, 8);   // 8s of stacking
  const after = JSON.stringify([ground.p, ground.q, ground.v, ground.w]);
  ok(before === after, 'fixed body stays byte-identical under a loaded stack (immovable)');
}

// API contract: with no external forces (gravity zero, damping one, no
// contacts) the integrator must conserve linear velocity exactly and advance
// position linearly — the free-drift invariant. The XPBD predict step does
// p += v·h then recovers v = (p − pp)/h, so with no contact correction and
// damping = 1 this is exact (modulo FP rounding). This is the base case every
// other test builds on, yet none isolates it.
{
  const world = new World({ gravity: [0, 0, 0], floor: -100, linDamp: 1, angDamp: 1 });
  const b = world.add(new Body({ pos: [0, 0, 0], half: [0.5, 0.5, 0.5], mass: 2 }));
  b.v = [1, -2, 3];
  for (let i = 0; i < 100; i++) world.step(1 / 60, 8);   // 100 frames free drift
  ok(Math.abs(b.v[0] - 1) < 1e-9 && Math.abs(b.v[1] + 2) < 1e-9 && Math.abs(b.v[2] - 3) < 1e-9,
    'free drift conserves linear velocity (gravity=0, damp=1, no contacts)');
  const expected = 100 / 60;   // v·t with dt=1/60 over 100 frames
  ok(Math.abs(b.p[0] - expected) < 1e-9 && Math.abs(b.p[1] + 2 * expected) < 1e-9 && Math.abs(b.p[2] - 3 * expected) < 1e-9,
    'free drift advances position by v·t (linear, no drift)');
}

// API contract: the quaternion stays unit-length across a long spinning run.
// applyDRot normalises after each nudge, but finite() only rejects NaN/Inf — a
// slow norm drift (e.g. from a broken q.norm) would pass every existing test
// while silently corrupting rotations. Pin |q| ≈ 1 after 10s of pure spin.
{
  const world = new World({ gravity: [0, 0, 0], floor: -100, linDamp: 1, angDamp: 1 });
  const b = world.add(new Body({ pos: [0, 0, 0], half: [0.5, 0.5, 0.5], mass: 1 }));
  b.w = [3, 0, 0];                                     // pure spin about x
  for (let i = 0; i < 600; i++) world.step(1 / 60, 8);  // 10 seconds
  const qn = Math.hypot(b.q[0], b.q[1], b.q[2], b.q[3]);
  ok(Math.abs(qn - 1) < 1e-9, `quaternion stays unit-length over 10s of spin (|q|=${qn.toFixed(12)})`);
}

console.log(`tumble api-contract: ${pass} total passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
