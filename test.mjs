// tumble unit tests — proves the M1 engine runs headless (no renderer, no
// browser), is deterministic, and that a tilted box dropped onto the ground
// plane tumbles and SETTLES on a face (the mahjong-tile behaviour).
//   node test.mjs    (or: npm test)
import { World, Body, topFace } from './index.js';

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

// Initial box overlap is a placement error, not an impact. Its positional
// repair must not be converted into an explosive velocity by recovery.
{
  for (const overlap of [0.001, 0.01, 0.05, 0.1, 0.5]) {
    const world = new World({ gravity: [0, 0, 0], floor: -100 });
    const a = world.add(new Body({ pos: [0, 0, 0], half: [0.5, 0.5, 0.5] }));
    const b = world.add(new Body({ pos: [1 - overlap, 0, 0], half: [0.5, 0.5, 0.5] }));
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      world.step(1 / 60, 8);
      peak = Math.max(peak, Math.hypot(...b.v));
    }
    const separation = Math.hypot(...vsub(b.p, a.p));
    ok(peak < 0.5, `initial overlap ${overlap} does not create explosive velocity`);
    ok(Math.abs(separation - 1) < 0.05, `initial overlap ${overlap} resolves to unit separation`);
    ok(finite(b.p) && finite(b.v), `deep overlap ${overlap} remains finite`);
  }
}

function vsub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

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

// input guard: a non-finite/non-positive dt or non-positive substeps must throw
// a RangeError and leave body state untouched (no NaN contamination).
{
  const w = new World({ floor: 0 });
  const b = w.add(new Body({ pos: [0, 2, 0], half: [0.5, 0.5, 0.5] }));
  const before = JSON.stringify([b.p, b.q, b.v, b.w]);
  let threwDtInf = false, threwDtNaN = false, threwDt0 = false, threwDtNeg = false, threwSub = false;
  try { w.step(Infinity, 8); } catch (e) { threwDtInf = e instanceof RangeError; }
  try { w.step(NaN, 8); } catch (e) { threwDtNaN = e instanceof RangeError; }
  try { w.step(0, 8); } catch (e) { threwDt0 = e instanceof RangeError; }
  try { w.step(-1 / 60, 8); } catch (e) { threwDtNeg = e instanceof RangeError; }
  try { w.step(1 / 60, 0); } catch (e) { threwSub = e instanceof RangeError; }
  ok(threwDtInf, 'step(Infinity, 8) throws RangeError');
  ok(threwDtNaN, 'step(NaN, 8) throws RangeError');
  ok(threwDt0, 'step(0, 8) throws RangeError');
  ok(threwDtNeg, 'step(-1/60, 8) throws RangeError');
  ok(threwSub, 'step(1/60, 0) throws RangeError');
  ok(JSON.stringify([b.p, b.q, b.v, b.w]) === before,
    'body state untouched after rejected step calls (no NaN contamination)');
  w.step(1 / 60, 8);
  ok(finite(b.p) && finite(b.v) && finite(b.w), 'subsequent valid step keeps state finite');
}

console.log(`tumble input-guard: ${pass} total passed${fail ? `, ${fail} FAILED` : ''}`);

// Iteration counts are discrete. Previously a fractional count was silently
// rounded up by the loop condition: substeps=0.5 ran once with h=2*dt, while
// contactIterations=1.5 solved twice. Reject fractions instead of changing the
// requested simulation time or solver work behind the caller's back.
{
  for (const substeps of [0.5, 1.5]) {
    const w = new World({ gravity: [0, 0, 0], linDamp: 1, angDamp: 1, sleep: false });
    const b = w.add(new Body({ pos: [0, 0, 0] }));
    b.v = [1, 0, 0];
    const before = JSON.stringify([b.p, b.q, b.v, b.w, b.sleeping, b.sleepTimer]);
    let threw = false;
    try { w.step(1, substeps); } catch (e) { threw = e instanceof RangeError; }
    ok(threw, `step(_, ${substeps}) rejects a fractional substep count`);
    ok(JSON.stringify([b.p, b.q, b.v, b.w, b.sleeping, b.sleepTimer]) === before,
      `step(_, ${substeps}) leaves simulation state untouched`);
  }
  for (const iterations of [0.5, 1.5]) {
    const w = new World();
    const b = w.add(new Body({ pos: [0, 2, 0] }));
    w.contactIterations = iterations;
    const before = JSON.stringify([b.p, b.q, b.v, b.w, b.sleeping, b.sleepTimer]);
    let threw = false;
    try { w.step(1 / 60, 8); } catch (e) { threw = e instanceof RangeError; }
    ok(threw, `mutated contactIterations=${iterations} is rejected before stepping`);
    ok(JSON.stringify([b.p, b.q, b.v, b.w, b.sleeping, b.sleepTimer]) === before,
      `contactIterations=${iterations} leaves simulation state untouched`);
  }
}

console.log(`tumble integer-count-guard: ${pass} total passed${fail ? `, ${fail} FAILED` : ''}`);

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

// broadphase guard: cellSize < largest body's bounding-sphere diameter must
// throw at step() so the silent false-negative (overlapping bodies passing
// through each other) is surfaced early instead of corrupting the trajectory.
// The bound must be the bounding-sphere diameter (2·|half|), not the longest
// edge (2·max(half)): a rotated box reaches up to its corner distance from
// its centre, which for a near-cubic box is up to sqrt(3) times the longest
// edge.
{
  const w = new World({ cellSize: 0.5, gravity: [0, 0, 0], floor: -100 });
  w.add(new Body({ pos: [0, 0, 0], half: [2.0, 2.0, 2.0] }));
  w.add(new Body({ pos: [1.1, 0, 0], half: [2.0, 2.0, 2.0] }));
  let threw = false;
  try { w.step(1 / 60, 8); } catch (e) { threw = e instanceof RangeError; }
  ok(threw, 'step() throws RangeError when cellSize < max body diameter (broadphase guard)');

  // cellSize equal to the longest edge (the old, insufficient bound) must
  // still throw: a cube of half=[2,2,2] has bounding diameter 2*sqrt(12) ≈
  // 6.928, well past its 4.0 edge length.
  const wEdge = new World({ cellSize: 4.0, gravity: [0, 0, 0], floor: -100 });
  wEdge.add(new Body({ pos: [0, 0, 0], half: [2.0, 2.0, 2.0] }));
  wEdge.add(new Body({ pos: [1.1, 0, 0], half: [2.0, 2.0, 2.0] }));
  let threwEdge = false;
  try { wEdge.step(1 / 60, 8); } catch (e) { threwEdge = e instanceof RangeError; }
  ok(threwEdge, 'step() still throws when cellSize == longest edge but < bounding-sphere diameter');

  // raising cellSize to the true bounding-sphere diameter lets step() proceed
  const trueDiam = 2 * Math.hypot(2.0, 2.0, 2.0);
  const w2 = new World({ cellSize: trueDiam, gravity: [0, 0, 0], floor: -100 });
  const a = w2.add(new Body({ pos: [0, 0, 0], half: [2.0, 2.0, 2.0] }));
  const b = w2.add(new Body({ pos: [1.1, 0, 0], half: [2.0, 2.0, 2.0] }));
  let threw2 = false;
  try { w2.step(1 / 60, 8); } catch (e) { threw2 = true; }
  ok(!threw2 && finite(a.p) && finite(b.p), 'step() proceeds when cellSize >= bounding-sphere diameter');

  // broadphase disabled bypasses the guard entirely
  const w3 = new World({ cellSize: 0.5, broadphase: false, gravity: [0, 0, 0], floor: -100 });
  w3.add(new Body({ pos: [0, 0, 0], half: [2.0, 2.0, 2.0] }));
  w3.add(new Body({ pos: [1.1, 0, 0], half: [2.0, 2.0, 2.0] }));
  let threw3 = false;
  try { w3.step(1 / 60, 8); } catch (e) { threw3 = true; }
  ok(!threw3, 'broadphase:false bypasses the cellSize guard (O(n^2) needs no grid)');
}

// rotated bodies: at a cellSize that only covers the axis-aligned edge (not
// the bounding-sphere diameter), two mobile boxes rotated 45deg can overlap
// while their centres straddle a 2-cell gap, which the 3x3x3 neighbour
// search never pairs. The corrected guard must reject that cellSize outright
// (regression for the false-negative fixed here), and a cellSize raised to
// the true bounding diameter must match the broadphase:false trajectory
// exactly.
{
  const half = [0.5, 0.5, 0.5];
  const h = Math.PI / 8; // 45deg about z, as a quaternion
  const rot45z = [0, 0, Math.sin(h), Math.cos(h)];
  const makeWorld = (broadphase, cellSize) => {
    const world = new World({ gravity: [0, 0, 0], floor: -1000, cellSize, broadphase, sleep: false });
    const a = world.add(new Body({ pos: [0.999, 5, 0], quat: rot45z, half, mass: 1 }));
    const b = world.add(new Body({ pos: [2.001, 5, 0], quat: rot45z, half, mass: 1 }));
    return { world, a, b };
  };

  let threwRotated = false;
  try { makeWorld(true, 1).world.step(1 / 60, 8); } catch (e) { threwRotated = e instanceof RangeError; }
  ok(threwRotated, 'guard rejects cellSize sized only for the axis-aligned edge of a rotatable box');

  const trueDiam = 2 * Math.hypot(...half);
  const runs = {};
  for (const bp of [true, false]) {
    const { world, a, b } = makeWorld(bp, trueDiam);
    for (let i = 0; i < 30; i++) world.step(1 / 60, 8);
    runs[bp] = { a: a.p.slice(), b: b.p.slice(), av: a.v.slice(), bv: b.v.slice() };
  }
  ok(JSON.stringify(runs[true]) === JSON.stringify(runs[false]),
    'rotated boxes: broadphase on/off trajectories match once cellSize covers the bounding-sphere diameter');
  ok(runs[true].a[0] !== 0.999,
    'rotated boxes actually separate (contact was resolved, not silently skipped)');
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
  ok(b.restitution === 0, 'Body default restitution is 0');
  // box inertia diagonal for a 1kg unit cube (half 0.5): I = m/12·(d²+d²) = 1/6
  ok(Math.abs(b.invIl[0] - 6) < 1e-9 && Math.abs(b.invIl[1] - 6) < 1e-9 && Math.abs(b.invIl[2] - 6) < 1e-9,
    'Body unit-cube inverse inertia diagonal is 6 (1/12·2·(1+1)=1/6 → inv=6)');

  const f = new Body({ pos: [0, 0, 0], fixed: true });
  ok(f.invM === 0, 'fixed body has invM=0');
  ok(Array.isArray(f.invIl) && f.invIl[0] === 0 && f.invIl[1] === 0 && f.invIl[2] === 0,
    'fixed body has invIl=[0,0,0]');
}

// A quaternion's magnitude is not part of its orientation. Body must
// canonicalise it before any public geometry or the first collision query:
// q.rot assumes a unit quaternion, so a scaled copy otherwise distorts the
// corners and can turn the same initial pose into a different floor contact.
{
  const h = Math.PI / 12; // 30 degrees about x (quaternion stores half-angle)
  const unitQuat = [Math.sin(h), 0, 0, Math.cos(h)];
  const scaledQuat = unitQuat.map((component) => component * 2);
  const make = (quat) => new Body({
    pos: [0, 0.35, 0], quat, half: [0.5, 0.2, 0.3],
  });
  const unit = make(unitQuat); const scaled = make(scaledQuat);
  const nearArray = (a, b, epsilon = 1e-12) =>
    a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) <= epsilon);
  ok(nearArray(scaled.q, unit.q) && Math.abs(Math.hypot(...scaled.q) - 1) <= 1e-12,
    'Body normalises equivalent quaternion magnitudes to one stored orientation');
  ok(scaled.corners().every((corner, i) => nearArray(corner, unit.corners()[i])),
    'equivalent quaternion magnitudes produce identical corners before step');
  const touchesFloor = (body) => body.corners().some((corner) => corner[1] < 0);
  ok(touchesFloor(scaled) === touchesFloor(unit),
    'equivalent quaternion magnitudes produce the same collision result before step');
}

// M2 restitution: explicit bounce is applied to closing velocity, while the
// default remains inelastic and initial overlap repair does not create a kick.
{
  const w = new World({ gravity: [0, -10, 0], floor: 0, sleep: false, linDamp: 1, angDamp: 1 });
  const b = w.add(new Body({ pos: [0, 3, 0], half: [0.5, 0.5, 0.5], restitution: 1 }));
  let peak = 0;
  for (let i = 0; i < 90; i++) { w.step(1 / 60, 8); peak = Math.max(peak, b.v[1]); }
  ok(peak > 3, `restitution produces an upward bounce (peak |v|=${peak.toFixed(3)})`);

  const quiet = new World({ gravity: [0, 0, 0], floor: -100, sleep: false, linDamp: 1, angDamp: 1 });
  const a = quiet.add(new Body({ pos: [0, 0, 0], restitution: 1 }));
  const c = quiet.add(new Body({ pos: [0.9, 0, 0], restitution: 1 }));
  for (const body of [a, c]) body.v = [0, 0, 0];
  quiet.step(1 / 60, 8);
  ok(Math.hypot(...a.v) < 0.01 && Math.hypot(...c.v) < 0.01,
    'initial overlap repair does not create restitution velocity');
}

console.log(`tumble restitution: ${pass} total passed${fail ? `, ${fail} FAILED` : ''}`);

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

// A fixed platform may extend far beyond its centre cell. Boxes at its edge
// must collide exactly as in brute force, regardless of registration order
// or platform orientation. The grid must still cull distant mobile pairs.
{
  for (const fixedFirst of [true, false]) for (const rotated of [false, true]) {
    const simulate = (broadphase) => {
      const world = new World({ broadphase, floor: -100, sleep: false });
      const platform = new Body({
        pos: [0, 0, 0], half: [6, 0.5, 2], fixed: true,
        quat: rotated ? [0, Math.SQRT1_2, 0, Math.SQRT1_2] : [0, 0, 0, 1],
      });
      const box = new Body({ pos: rotated ? [0, 2, -5] : [5, 2, 0] });
      for (const body of fixedFirst ? [platform, box] : [box, platform]) world.add(body);
      world.add(new Body({ pos: [100, 2, 0] }));
      const before = JSON.stringify(platform);
      const pairs = world._candidatePairs();
      const label = `fixedFirst=${fixedFirst}, rotated=${rotated}, broadphase=${broadphase}`;
      ok(pairs.some(([i, j]) => i === 0 && j === 1), `platform edge is a candidate (${label})`);
      ok(new Set(pairs.map(([i, j]) => `${i}:${j}`)).size === pairs.length,
        `candidate pairs are unique (${label})`);
      ok(pairs.every(([i, j], k) => i < j && (k === 0 ||
        pairs[k - 1][0] < i || (pairs[k - 1][0] === i && pairs[k - 1][1] < j))),
        `candidate pairs retain brute-force order (${label})`);
      if (broadphase) ok(!pairs.some(([i, j]) => i === (fixedFirst ? 1 : 0) && j === 2),
        `distant mobile pair is culled (${label})`);
      for (let i = 0; i < 120; i++) world.step(1 / 60);
      ok(Math.abs(box.p[1] - 1) < 0.02, `box rests on platform edge (${label})`);
      ok(JSON.stringify(platform) === before, `fixed platform is unchanged (${label})`);
      return world.bodies.map((b) => [b.p, b.q, b.v, b.w, b.sleeping]);
    };
    ok(JSON.stringify(simulate(true)) === JSON.stringify(simulate(false)),
      `platform edge trajectory matches brute force (fixedFirst=${fixedFirst}, rotated=${rotated})`);
  }
}

console.log(`tumble api-contract: ${pass} total passed${fail ? `, ${fail} FAILED` : ''}`);

// constructor guard: World/Body accepted broken arguments silently, so a bad
// option produced a *wrong trajectory* instead of an error. Each case below
// was reproduced against the unguarded engine: `mass: -1` fell through the
// floor to y = -12.6 after 120 frames, `mass: 0` was swallowed by a `|| 1`
// fallback, `half: [0,0,0]` gave invIl = Infinity, `friction: -5` injected
// energy (slid 2.57 instead of 0.42), and a 2-element gravity turned every
// position into NaN. They must throw at construction instead.
{
  const throws = (fn, Type, label) => {
    let caught = null;
    try { fn(); } catch (e) { caught = e; }
    ok(caught instanceof Type, `${label} throws ${Type.name}` + (caught ? ` (got ${caught.constructor.name}: ${caught.message})` : ' (nothing thrown)'));
  };
  const accepts = (fn, label) => {
    let caught = null;
    try { fn(); } catch (e) { caught = e; }
    ok(caught === null, `${label} is still accepted` + (caught ? ` (threw ${caught.message})` : ''));
  };

  // Body.pos — required, 3 finite numbers.
  throws(() => new Body({}), TypeError, 'new Body({}) (pos missing)');
  throws(() => new Body(), TypeError, 'new Body() (no options)');
  throws(() => new Body({ pos: [0, 1] }), RangeError, 'Body.pos with 2 elements');
  throws(() => new Body({ pos: [NaN, 1, 0] }), RangeError, 'Body.pos containing NaN');
  throws(() => new Body({ pos: [0, Infinity, 0] }), RangeError, 'Body.pos containing Infinity');
  throws(() => new Body({ pos: '0,1,0' }), RangeError, 'Body.pos that is not an array');

  // Body.quat — 4 finite numbers, non-zero length.
  throws(() => new Body({ pos: [0, 1, 0], quat: [0, 0, 1] }), RangeError, 'Body.quat with 3 elements');
  throws(() => new Body({ pos: [0, 1, 0], quat: [0, 0, 0, NaN] }), RangeError, 'Body.quat containing NaN');
  throws(() => new Body({ pos: [0, 1, 0], quat: [0, 0, 0, 0] }), RangeError, 'Body.quat of zero length');

  // Body.half — 3 finite numbers, each > 0.
  throws(() => new Body({ pos: [0, 1, 0], half: [0, 0, 0] }), RangeError, 'Body.half of [0,0,0] (invIl would be Infinity)');
  throws(() => new Body({ pos: [0, 1, 0], half: [0.4, 0, 0.3] }), RangeError, 'Body.half with a zero extent');
  throws(() => new Body({ pos: [0, 1, 0], half: [-0.5, 0.5, 0.5] }), RangeError, 'Body.half with a negative extent');
  throws(() => new Body({ pos: [0, 1, 0], half: [0.5, 0.5] }), RangeError, 'Body.half with 2 elements');

  // Body.mass — a mobile body needs a finite mass > 0; `fixed` ignores it.
  throws(() => new Body({ pos: [0, 1, 0], mass: 0 }), RangeError, 'Body.mass of 0 (was silently coerced to 1)');
  throws(() => new Body({ pos: [0, 1, 0], mass: -1 }), RangeError, 'Body.mass of -1 (fell through the floor)');
  throws(() => new Body({ pos: [0, 1, 0], mass: NaN }), RangeError, 'Body.mass of NaN');
  throws(() => new Body({ pos: [0, 1, 0], mass: Infinity }), RangeError, 'Body.mass of Infinity');
  {
    let message = '';
    try { new Body({ pos: [0, 1, 0], mass: 0 }); } catch (e) { message = e.message; }
    ok(message.includes('fixed: true'), 'Body.mass of 0 points at `fixed: true` in the message');
  }
  accepts(() => new Body({ pos: [0, 1, 0], mass: 0, fixed: true }), 'a fixed body with mass 0 (mass is ignored)');
  ok(new Body({ pos: [0, 1, 0], mass: 0, fixed: true }).invM === 0, 'a fixed body with mass 0 still has invM = 0');

  // Body.friction / Body.restitution.
  throws(() => new Body({ pos: [0, 1, 0], friction: -5 }), RangeError, 'Body.friction of -5 (injected energy)');
  throws(() => new Body({ pos: [0, 1, 0], friction: NaN }), RangeError, 'Body.friction of NaN');
  throws(() => new Body({ pos: [0, 1, 0], restitution: NaN }), RangeError, 'Body.restitution of NaN');
  accepts(() => new Body({ pos: [0, 1, 0], friction: 0 }), 'Body.friction of 0 (frictionless)');
  ok(new Body({ pos: [0, 1, 0], restitution: 2 }).restitution === 1, 'Body.restitution is still clamped to [0,1] (2 → 1)');
  ok(new Body({ pos: [0, 1, 0], restitution: -1 }).restitution === 0, 'Body.restitution is still clamped to [0,1] (-1 → 0)');

  // World options.
  throws(() => new World({ gravity: [0, -9.81] }), RangeError, 'World.gravity with 2 elements (made every position NaN)');
  throws(() => new World({ gravity: [0, NaN, 0] }), RangeError, 'World.gravity containing NaN');
  throws(() => new World({ floor: NaN }), RangeError, 'World.floor of NaN');
  throws(() => new World({ linDamp: NaN }), RangeError, 'World.linDamp of NaN');
  throws(() => new World({ linDamp: -1 }), RangeError, 'World.linDamp of -1');
  throws(() => new World({ angDamp: Infinity }), RangeError, 'World.angDamp of Infinity');
  throws(() => new World({ cellSize: 0 }), RangeError, 'World.cellSize of 0');
  throws(() => new World({ cellSize: -2 }), RangeError, 'World.cellSize of -2');
  throws(() => new World({ cellSize: NaN }), RangeError, 'World.cellSize of NaN');
  throws(() => new World({ contactIterations: 0 }), RangeError, 'World.contactIterations of 0 (solved no contacts)');
  throws(() => new World({ contactIterations: 0.5 }), RangeError, 'World.contactIterations of 0.5 (was silently run once)');
  throws(() => new World({ contactIterations: 1.5 }), RangeError, 'World.contactIterations of 1.5 (was silently run twice)');
  throws(() => new World({ contactIterations: Infinity }), RangeError, 'World.contactIterations of Infinity');
  throws(() => new World({ sleepVel: -1 }), RangeError, 'World.sleepVel of -1');
  throws(() => new World({ sleepAng: NaN }), RangeError, 'World.sleepAng of NaN');
  throws(() => new World({ sleepTime: NaN }), RangeError, 'World.sleepTime of NaN');

  // Every option the README documents, at a legal value, must still construct.
  accepts(() => new World(), 'new World() with no options');
  accepts(() => new World({
    gravity: [0, -9.81, 0], floor: -100, linDamp: 1, angDamp: 1, contactIterations: 1,
    broadphase: false, cellSize: 0.5, sleep: false, sleepVel: 0, sleepAng: 0, sleepTime: 0,
  }), 'a World with every documented option set');

  // The guards must not change the physics: a scene built from valid inputs
  // runs exactly as before (bit-identical across two runs, still settling).
  const run = () => {
    const world = new World({ gravity: [0, -9.81, 0], floor: 0 });
    const platform = world.add(new Body({ pos: [0, -0.5, 0], half: [4, 0.5, 4], fixed: true, mass: 0 }));
    const tile = world.add(new Body({ pos: [0, 2, 0], quat: TILT, half: [0.4, 0.05, 0.3] }));
    const die = world.add(new Body({ pos: [0.9, 3, 0.2], half: [0.25, 0.25, 0.25], restitution: 0.3 }));
    for (let i = 0; i < 240; i++) world.step(1 / 60, 8);
    return { snapshot: JSON.stringify([platform, tile, die].map((b) => [b.p, b.q, b.v, b.w, b.sleeping])), tile, die };
  };
  const first = run(), second = run();
  ok(first.snapshot === second.snapshot, 'a valid scene is still bit-identical across two runs');
  ok(finite(first.tile.p) && finite(first.die.p), 'a valid scene keeps every position finite');
  ok(first.tile.p[1] > 0 && first.die.p[1] > 0, 'bodies still rest on the fixed platform (no fall-through)');
}

console.log(`tumble ctor-guard: ${pass} total passed${fail ? `, ${fail} FAILED` : ''}`);
// top face readout (M4 host wiring): the host has to be able to ask "which
// face is up?" after a die settles. Before topFace() the only way was to
// re-implement the quaternion rotation of the 6 face normals in every caller.
// The checks below pin the contract: the upmost face, a flatness measure, a
// deterministic tie-break, and no mutation of the simulation.
{
  const throws = (fn, Type, label) => {
    let caught = null;
    try { fn(); } catch (e) { caught = e; }
    ok(caught instanceof Type, `topFace: ${label} throws ${Type.name}` + (caught ? ` (got ${caught.constructor.name}: ${caught.message})` : ' (nothing thrown)'));
  };
  const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

  // A body at rest with no rotation: +y local face is up, exactly flat.
  const flat = new Body({ pos: [0, 1, 0], half: [0.25, 0.25, 0.25] });
  const up0 = topFace(flat);
  ok(up0.axis === 1 && up0.sign === 1, 'identity orientation reports the local +y face');
  ok(near(up0.alignment, 1), `identity orientation is exactly flat (alignment ${up0.alignment})`);
  ok(near(up0.normal[1], 1) && near(up0.normal[0], 0) && near(up0.normal[2], 0), 'identity orientation returns the world +y normal');

  // Flipped over (180° about x): the local -y face is now up.
  const flipped = new Body({ pos: [0, 1, 0], quat: [1, 0, 0, 0] });
  const up1 = topFace(flipped);
  ok(up1.axis === 1 && up1.sign === -1, 'a body flipped 180° about x reports the local -y face');
  ok(near(up1.alignment, 1), 'a flipped body is still exactly flat');

  // 90° about z maps the local +x axis onto world +y.
  const s = Math.SQRT1_2;
  const rolled = new Body({ pos: [0, 1, 0], quat: [0, 0, s, s] });
  const up2 = topFace(rolled);
  ok(up2.axis === 0 && up2.sign === 1, 'a body rolled 90° about z reports the local +x face');
  ok(near(up2.alignment, 1, 1e-12), 'a body rolled 90° about z is still flat');

  // A custom `up` — gravity need not point down -y for the caller.
  ok(topFace(flat, [0, -1, 0]).sign === -1, 'up = [0,-1,0] reports the opposite face');
  const sideways = topFace(flat, [1, 0, 0]);
  ok(sideways.axis === 0 && sideways.sign === 1, 'up = [1,0,0] reports the local +x face');
  ok(near(topFace(flat, [0, 5, 0]).alignment, 1), 'a non-normalised up still yields alignment 1');

  // A non-normalised quaternion is legal at construction (only non-zero is
  // required), and must not push alignment outside [-1, 1].
  const scaled = new Body({ pos: [0, 1, 0], quat: [0, 0, 0, 3] });
  const up3 = topFace(scaled);
  ok(up3.axis === 1 && up3.sign === 1, 'a non-normalised quaternion still reports the local +y face');
  ok(up3.alignment <= 1 && near(up3.alignment, 1), `a non-normalised quaternion keeps alignment in [-1,1] (${up3.alignment})`);

  // ...and the face itself must not change with |q|. [0,0,0,k] above is the
  // degenerate case (a pure scalar is the identity rotation whatever k is), so
  // pin a real tilt too: 30° about x, written once as a unit quaternion and
  // once scaled by 2. q.rot is a rotation only for |q| = 1 — without
  // normalising, the scaled copy reports axis 2 / sign -1 (a different die
  // face) with a HIGHER alignment (0.9741) than the true 0.8660, which would
  // slip past an `alignment > 0.99`-style flatness gate.
  const h = Math.PI / 12;                       // half of 30°
  const tilt = [Math.sin(h), 0, 0, Math.cos(h)];
  const unitTilt = topFace(new Body({ pos: [0, 1, 0], quat: tilt }));
  const scaledTilt = topFace(new Body({ pos: [0, 1, 0], quat: tilt.map((c) => c * 2) }));
  ok(unitTilt.axis === 1 && unitTilt.sign === 1, 'a 30° tilt about x still reports the local +y face');
  ok(near(unitTilt.alignment, Math.cos(Math.PI / 6), 1e-12), `a 30° tilt reports cos 30° (${unitTilt.alignment})`);
  ok(scaledTilt.axis === unitTilt.axis && scaledTilt.sign === unitTilt.sign, 'scaling a tilted quaternion by 2 reports the SAME face');
  ok(near(scaledTilt.alignment, unitTilt.alignment, 1e-12), `scaling a tilted quaternion by 2 reports the same alignment (${scaledTilt.alignment} vs ${unitTilt.alignment})`);
  ok(near(scaledTilt.normal[0], unitTilt.normal[0], 1e-12) && near(scaledTilt.normal[1], unitTilt.normal[1], 1e-12) && near(scaledTilt.normal[2], unitTilt.normal[2], 1e-12), 'scaling a tilted quaternion by 2 reports the same normal');

  // An exact tie (two faces equally aligned) must resolve deterministically:
  // lowest axis index first, then sign +1.
  const tie = topFace(flat, [1, 1, 0]);
  ok(tie.axis === 0 && tie.sign === 1, 'an exact tie resolves to the lowest axis index, then +1');
  ok(near(tie.alignment, Math.SQRT1_2), 'the tie-broken face still reports its true alignment');
  const tieTwice = topFace(flat, [1, 1, 0]);
  ok(tieTwice.axis === tie.axis && tieTwice.sign === tie.sign, 'the tie-break is stable across calls');

  // Reading the top face must not touch the simulation.
  const before = JSON.stringify([flat.p, flat.q, flat.v, flat.w]);
  topFace(flat); topFace(flat, [0, 0, 1]);
  ok(JSON.stringify([flat.p, flat.q, flat.v, flat.w]) === before, 'topFace leaves the body state bit-identical');

  // Bad input fails loudly, in the same style as the constructors.
  throws(() => topFace(), TypeError, 'no body');
  throws(() => topFace({}), TypeError, 'an object without `q`');
  throws(() => topFace({ q: [0, 0, 0] }), RangeError, 'a 3-element quaternion');
  throws(() => topFace({ q: [0, 0, NaN, 1] }), RangeError, 'a quaternion containing NaN');
  throws(() => topFace(flat, [0, 1]), RangeError, 'a 2-element up');
  throws(() => topFace(flat, [0, NaN, 0]), RangeError, 'an up containing NaN');
  throws(() => topFace(flat, [0, 0, 0]), RangeError, 'a zero-length up');

  // The real use: roll a die, let it settle, read the face. A cube dropped
  // tilted onto the floor must end up flat on ONE face, and the reported face
  // must be the highest of the six.
  const world = new World({ gravity: [0, -9.81, 0], floor: 0 });
  const die = world.add(new Body({ pos: [0, 2, 0], quat: TILT, half: [0.25, 0.25, 0.25] }));
  for (let i = 0; i < 300; i++) world.step(1 / 60, 8);
  const settled = topFace(die);
  ok(settled.alignment > 0.99, `a settled die lies flat on a face (alignment ${settled.alignment.toFixed(4)})`);
  ok(settled.normal[1] > 0.99, 'a settled die reports a face normal pointing up');
  // Independent check: of the six face centres, the reported one is highest.
  let highest = -Infinity, highestAxis = -1, highestSign = 0;
  for (let axis = 0; axis < 3; axis++) for (const sign of [1, -1]) {
    const local = [0, 0, 0]; local[axis] = sign * die.half[axis];
    const [lx, ly, lz] = local, [qx, qy, qz, qw] = die.q;
    // rotate local by q (expanded here so the check does not reuse index.js)
    const tx = 2 * (qy * lz - qz * ly), ty = 2 * (qz * lx - qx * lz), tz = 2 * (qx * ly - qy * lx);
    const wy = die.p[1] + ly + qw * ty + (qz * tx - qx * tz);
    if (wy > highest) { highest = wy; highestAxis = axis; highestSign = sign; }
  }
  ok(settled.axis === highestAxis && settled.sign === highestSign, 'the reported face is the highest of the six face centres');
  ok(die.sleeping === true, 'the die has actually come to rest before the face is read');
}

console.log(`tumble top-face: ${pass} total passed${fail ? `, ${fail} FAILED` : ''}`);

process.exit(fail ? 1 : 0);
