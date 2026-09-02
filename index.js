// rigid-body engine (M2) — general 3D rigid bodies with box colliders + a ground
// plane, resolved with XPBD contacts. Box INERTIA (not isotropic) so flat bodies
// tumble and settle on a face the way a mahjong tile / die does. Pure,
// dependency-free, deterministic (fixed substeps, no Math.random) — headless
// testable, same 流儀 as motion-engine / xpbd-body.
//
// M2 scope: Body(box) + gravity + box↔ground-plane and box↔box contacts (SAT over
// 15 axes + clipped manifold = stacking) + Coulomb friction and damping.
// M3 scope: uniform-grid broadphase (candidate pair generation replacing O(n²))
// keeps determinism (sorted keys, no Math.random). M3 sleeping + M4 mahjong
// wiring to follow.

const v = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
const q = {
  mul: (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ],
  conj: (a) => [-a[0], -a[1], -a[2], a[3]],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1; return [a[0] / l, a[1] / l, a[2] / l, a[3] / l]; },
  rot: (a, p) => {
    const tx = 2 * (a[1] * p[2] - a[2] * p[1]);
    const ty = 2 * (a[2] * p[0] - a[0] * p[2]);
    const tz = 2 * (a[0] * p[1] - a[1] * p[0]);
    return [p[0] + a[3] * tx + (a[1] * tz - a[2] * ty), p[1] + a[3] * ty + (a[2] * tx - a[0] * tz), p[2] + a[3] * tz + (a[0] * ty - a[1] * tx)];
  },
};

const BOX_EDGES = (() => {
  const out = [];
  for (let i = 0; i < 8; i++) {
    if (!(i & 1)) out.push([i, i | 1]);
    if (!(i & 2)) out.push([i, i | 2]);
    if (!(i & 4)) out.push([i, i | 4]);
  }
  return out;
})();

const boxAxes = (b) => [
  q.rot(b.q, [1, 0, 0]),
  q.rot(b.q, [0, 1, 0]),
  q.rot(b.q, [0, 0, 1]),
];

const projectionRadius = (b, axes, n) =>
  b.half[0] * Math.abs(v.dot(axes[0], n)) +
  b.half[1] * Math.abs(v.dot(axes[1], n)) +
  b.half[2] * Math.abs(v.dot(axes[2], n));

const pointInBox = (p, b, axes, eps = 1e-8) => {
  const d = v.sub(p, b.p);
  return axes.every((axis, i) => Math.abs(v.dot(d, axis)) <= b.half[i] + eps);
};

// Clip a segment against an OBB's six face planes. Returning both the entry and
// exit point makes edge/edge and rotated face intersections deterministic.
const clipSegmentToBox = (p0, p1, b, axes) => {
  const d = v.sub(p1, p0); let lo = 0; let hi = 1;
  const rel = v.sub(p0, b.p);
  for (let i = 0; i < 3; i++) {
    const start = v.dot(rel, axes[i]); const delta = v.dot(d, axes[i]);
    if (Math.abs(delta) < 1e-12) {
      if (Math.abs(start) > b.half[i] + 1e-8) return [];
      continue;
    }
    let a = (-b.half[i] - start) / delta;
    let z = (b.half[i] - start) / delta;
    if (a > z) [a, z] = [z, a];
    lo = Math.max(lo, a); hi = Math.min(hi, z);
    if (lo > hi + 1e-10) return [];
  }
  const at = (t) => v.add(p0, v.scale(d, Math.max(0, Math.min(1, t))));
  return Math.abs(hi - lo) < 1e-9 ? [at((lo + hi) * 0.5)] : [at(lo), at(hi)];
};

const uniquePoints = (points) => {
  const out = [];
  for (const p of points) {
    if (!out.some((x) => v.len(v.sub(x, p)) < 1e-7)) out.push(p);
  }
  return out;
};

const supportPoint = (b, axes, n) => {
  let p = b.p.slice();
  for (let i = 0; i < 3; i++) p = v.add(p, v.scale(axes[i], v.dot(axes[i], n) >= 0 ? b.half[i] : -b.half[i]));
  return p;
};

const clipPolygonPlane = (polygon, center, axis, limit) => {
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]; const b = polygon[(i + 1) % polygon.length];
    const da = v.dot(v.sub(a, center), axis) - limit;
    const db = v.dot(v.sub(b, center), axis) - limit;
    if (da <= 1e-9) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push(v.add(a, v.scale(v.sub(b, a), t)));
    }
  }
  return out;
};

// Clip the incident face polygon by the four side planes of a reference face.
const faceManifold = (reference, incident, refAxes, incAxes, refAxis, refOut) => {
  let incidentAxis = 0; let alignment = Math.abs(v.dot(incAxes[0], refOut));
  for (let i = 1; i < 3; i++) {
    const next = Math.abs(v.dot(incAxes[i], refOut));
    if (next > alignment) { incidentAxis = i; alignment = next; }
  }
  const faceSign = v.dot(incAxes[incidentAxis], refOut) > 0 ? -1 : 1;
  const center = v.add(incident.p, v.scale(incAxes[incidentAxis], faceSign * incident.half[incidentAxis]));
  const tangent = [0, 1, 2].filter((i) => i !== incidentAxis);
  let polygon = [
    v.add(v.add(center, v.scale(incAxes[tangent[0]], incident.half[tangent[0]])), v.scale(incAxes[tangent[1]], incident.half[tangent[1]])),
    v.add(v.add(center, v.scale(incAxes[tangent[0]], -incident.half[tangent[0]])), v.scale(incAxes[tangent[1]], incident.half[tangent[1]])),
    v.add(v.add(center, v.scale(incAxes[tangent[0]], -incident.half[tangent[0]])), v.scale(incAxes[tangent[1]], -incident.half[tangent[1]])),
    v.add(v.add(center, v.scale(incAxes[tangent[0]], incident.half[tangent[0]])), v.scale(incAxes[tangent[1]], -incident.half[tangent[1]])),
  ];
  for (const i of [0, 1, 2].filter((x) => x !== refAxis)) {
    polygon = clipPolygonPlane(polygon, reference.p, refAxes[i], reference.half[i]);
    polygon = clipPolygonPlane(polygon, reference.p, v.scale(refAxes[i], -1), reference.half[i]);
  }
  return uniquePoints(polygon.filter((p) => v.dot(v.sub(p, reference.p), refOut) <= reference.half[refAxis] + 1e-8)
    .map((p) => {
      const depth = reference.half[refAxis] - v.dot(v.sub(p, reference.p), refOut);
      return v.add(p, v.scale(refOut, depth * 0.5));
    }));
};

// OBB SAT over all 15 conventional axes. The manifold is the clipped
// intersection boundary projected onto the middle of the two support planes.
const boxContact = (a, b) => {
  const aa = boxAxes(a); const ba = boxAxes(b); const delta = v.sub(b.p, a.p);
  let best = null; let order = 0;
  const test = (raw) => {
    const length = v.len(raw); const axisOrder = order++;
    if (length < 1e-10) return true; // parallel edges: redundant SAT axis
    let axis = v.scale(raw, 1 / length);
    const distance = v.dot(delta, axis);
    const depth = projectionRadius(a, aa, axis) + projectionRadius(b, ba, axis) - Math.abs(distance);
    if (depth <= 0) return false;
    if (distance < 0) axis = v.scale(axis, -1);
    if (!best || depth < best.depth - 1e-10 || (Math.abs(depth - best.depth) <= 1e-10 && axisOrder < best.order)) {
      best = { normal: axis, depth, order: axisOrder };
    }
    return true;
  };
  for (const axis of aa) if (!test(axis)) return null;
  for (const axis of ba) if (!test(axis)) return null;
  for (const x of aa) for (const y of ba) if (!test(v.cross(x, y))) return null;

  const n = best.normal;
  let points = best.order < 3
    ? faceManifold(a, b, aa, ba, best.order, n)
    : best.order < 6
      ? faceManifold(b, a, ba, aa, best.order - 3, v.scale(n, -1))
      : [];
  if (!points.length) {
    const ac = a.corners(); const bc = b.corners(); const candidates = [];
    for (const p of ac) if (pointInBox(p, b, ba)) candidates.push(p);
    for (const p of bc) if (pointInBox(p, a, aa)) candidates.push(p);
    for (const [i, j] of BOX_EDGES) candidates.push(...clipSegmentToBox(ac[i], ac[j], b, ba));
    for (const [i, j] of BOX_EDGES) candidates.push(...clipSegmentToBox(bc[i], bc[j], a, aa));
    const plane = (v.dot(a.p, n) + projectionRadius(a, aa, n) + v.dot(b.p, n) - projectionRadius(b, ba, n)) * 0.5;
    points = uniquePoints(candidates.map((p) => v.add(p, v.scale(n, plane - v.dot(p, n)))));
  }
  if (!points.length) points = [v.scale(v.add(supportPoint(a, aa, n), supportPoint(b, ba, v.scale(n, -1))), 0.5)];
  // Four contacts are sufficient for a convex box face and avoid applying the
  // same positional correction repeatedly when clipped edges share endpoints.
  if (points.length > 4) {
    const helper = Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
    const u = v.norm(v.cross(n, helper)); const w = v.cross(n, u); const picked = [];
    for (const axis of [u, w]) {
      for (const sign of [-1, 1]) {
        let choice = points[0]; let score = sign * v.dot(choice, axis);
        for (const p of points.slice(1)) {
          const next = sign * v.dot(p, axis);
          if (next < score) { choice = p; score = next; }
        }
        if (!picked.includes(choice)) picked.push(choice);
      }
    }
    for (const p of points) if (picked.length < 4 && !picked.includes(p)) picked.push(p);
    points = picked;
  }
  return { normal: n, depth: best.depth, points };
};

export class Body {
  // { pos, quat?, half:[hx,hy,hz], mass, fixed? }
  constructor(o) {
    this.p = o.pos.slice(); this.q = (o.quat || [0, 0, 0, 1]).slice();
    this.v = [0, 0, 0]; this.w = [0, 0, 0];
    this.half = o.half ? o.half.slice() : [0.5, 0.5, 0.5];
    this.fixed = !!o.fixed;
    this.friction = o.friction != null ? o.friction : 0.5;
    const m = o.mass || 1;
    this.invM = this.fixed ? 0 : 1 / m;
    // box inertia diagonal (principal axes): I_x = m/12 (dy²+dz²), d = 2h
    const [hx, hy, hz] = this.half; const sq = (x) => (2 * x) * (2 * x);
    this.invIl = this.fixed ? [0, 0, 0]
      : [12 / (m * (sq(hy) + sq(hz))), 12 / (m * (sq(hx) + sq(hz))), 12 / (m * (sq(hx) + sq(hy)))];
    this.pp = this.p.slice(); this.pq = this.q.slice();
    // M3b sleeping: a body still below the velocity threshold for sleepTime
    // seconds stops integrating; a moving neighbour wakes it. Deterministic
    // (no Math.random, thresholded timer).
    this.sleeping = false; this.sleepTimer = 0;
  }
  // world inverse-inertia applied to a world vector L:  R · (invIl ⊙ (R⁻¹·L))
  applyInvI(L) {
    const l = q.rot(q.conj(this.q), L);
    return q.rot(this.q, [l[0] * this.invIl[0], l[1] * this.invIl[1], l[2] * this.invIl[2]]);
  }
  applyDRot(am) {                          // rotate by a small angular vector
    const dq = q.mul([am[0], am[1], am[2], 0], this.q);
    this.q = q.norm([this.q[0] + 0.5 * dq[0], this.q[1] + 0.5 * dq[1], this.q[2] + 0.5 * dq[2], this.q[3] + 0.5 * dq[3]]);
  }
  corners() {
    const [hx, hy, hz] = this.half; const out = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push(v.add(this.p, q.rot(this.q, [sx * hx, sy * hy, sz * hz])));
    return out;
  }
}

export class World {
  constructor(o = {}) {
    this.gravity = o.gravity || [0, -9.81, 0];
    this.floor = o.floor != null ? o.floor : 0;     // ground plane y = floor, normal +y
    this.linDamp = o.linDamp != null ? o.linDamp : 0.999;
    this.angDamp = o.angDamp != null ? o.angDamp : 0.995;
    this.contactIterations = o.contactIterations != null ? o.contactIterations : 8;
    this.broadphase = o.broadphase != null ? o.broadphase : true; // M3 uniform grid
    this.cellSize = o.cellSize != null ? o.cellSize : 2;          // grid cell edge
    this.sleep = o.sleep != null ? o.sleep : true;                // M3b sleeping
    this.sleepVel = o.sleepVel != null ? o.sleepVel : 0.05;       // |v| below → resting
    this.sleepAng = o.sleepAng != null ? o.sleepAng : 0.20;       // |w| below → resting
    this.sleepTime = o.sleepTime != null ? o.sleepTime : 1.0;    // seconds still → sleep
    this._hasStepped = false;
    this.bodies = [];
  }
  add(b) { this.bodies.push(b); return b; }

  step(dt, substeps = 8) {
    if (!(dt > 0)) throw new RangeError(`step(dt, substeps): dt must be > 0 (got ${dt})`);
    if (!(substeps > 0)) throw new RangeError(`step(dt, substeps): substeps must be > 0 (got ${substeps})`);
    if (!Number.isFinite(substeps)) throw new RangeError(`step(dt, substeps): substeps must be finite (got ${substeps})`);
    if (!Number.isFinite(this.contactIterations)) throw new RangeError(`World.contactIterations must be finite (got ${this.contactIterations})`);
    if (this.broadphase && this.bodies.length > 1) {
      let maxDiam = 0;
      for (const b of this.bodies) {
        if (b.fixed) continue;                       // fixed bodies don't move, so
        const d = 2 * Math.max(b.half[0], b.half[1], b.half[2]);  // their size can't cause
        if (d > maxDiam) maxDiam = d;                // a broadphase false negative
      }
      if (this.cellSize < maxDiam) {
        throw new RangeError(
          `step(): cellSize (${this.cellSize}) is smaller than the largest mobile body diameter (${maxDiam}); ` +
          `broadphase would miss overlaps. Increase cellSize to >= ${maxDiam} or set broadphase:false.`
        );
      }
    }
    const h = dt / substeps;
    const initialPenetration = new Set();
    // Only overlaps present when the public step begins are treated as
    // placement repairs. Contacts created by gravity during this step retain
    // the normal velocity-recovery behaviour.
    for (const b of this.bodies) {
      if (this._hasStepped) break;
      if (b.fixed || b.sleeping || v.len(b.v) > 0.5 || v.len(b.w) > 0.5) continue;
      if (b.corners().some((c) => this.floor - c[1] > 0)) initialPenetration.add(b);
    }
    for (const [i, j] of this._candidatePairs()) {
      if (this._hasStepped) break;
      const a = this.bodies[i]; const b = this.bodies[j];
      if (a.fixed && b.fixed) continue;
      const hit = boxContact(a, b);
      if (!hit) continue;
      if (!a.fixed && !a.sleeping && v.len(a.v) <= 0.5 && v.len(a.w) <= 0.5) initialPenetration.add(a);
      if (!b.fixed && !b.sleeping && v.len(b.v) <= 0.5 && v.len(b.w) <= 0.5) initialPenetration.add(b);
    }
    for (let s = 0; s < substeps; s++) {
      const contacts = new Map();
      const predicted = new Map();
      for (const b of this.bodies) {
        if (b.fixed) continue;
        if (b.sleeping) continue;                    // M3b: sleeping skip predict
        b.v = v.add(b.v, v.scale(this.gravity, h));
        b.pp = b.p.slice(); b.p = v.add(b.p, v.scale(b.v, h));
        b.pq = b.q.slice();
        const w = b.w; const dq = q.mul([w[0], w[1], w[2], 0], b.q);
        b.q = q.norm([b.q[0] + 0.5 * h * dq[0], b.q[1] + 0.5 * h * dq[1], b.q[2] + 0.5 * h * dq[2], b.q[3] + 0.5 * h * dq[3]]);
        predicted.set(b, { p: b.p.slice(), q: b.q.slice() });
      }
      // Iterating floor and box manifolds together propagates corrections from
      // the floor through a stack without making result order non-deterministic.
      for (let it = 0; it < this.contactIterations; it++) {
        this._floorContacts(contacts);
        this._boxContacts(contacts);
      }
      for (const b of this.bodies) {
        if (b.fixed) continue;
        if (b.sleeping) continue;                    // M3b: sleeping skip recovery
        const prediction = predicted.get(b);
        const recoveredP = initialPenetration.has(b) ? prediction.p : b.p;
        const recoveredQ = initialPenetration.has(b) ? prediction.q : b.q;
        b.v = v.scale(v.scale(v.sub(recoveredP, b.pp), 1 / h), this.linDamp);
        let dq = q.mul(recoveredQ, q.conj(b.pq));
        if (dq[3] < 0) dq = [-dq[0], -dq[1], -dq[2], -dq[3]];
        b.w = v.scale([2 / h * dq[0], 2 / h * dq[1], 2 / h * dq[2]], this.angDamp);
      }
      // Initial overlap repair must not leave an inward normal velocity.  A
      // small projected velocity preserves gravity/tangential motion while
      // preventing the corrected bodies from immediately re-penetrating.
      for (const contact of contacts.values()) {
        const { a, b, normal: n } = contact;
        if (!a) {
          if (initialPenetration.has(b) && v.dot(b.v, n) < 0) {
            b.v = v.sub(b.v, v.scale(n, v.dot(b.v, n)));
          }
          continue;
        }
        const aMarked = initialPenetration.has(a), bMarked = initialPenetration.has(b);
        if (!aMarked && !bMarked) continue;
        const relative = v.dot(v.sub(b.v, a.v), n);
        if (relative >= 0) continue;
        const wa = aMarked && !a.fixed ? a.invM : 0;
        const wb = bMarked && !b.fixed ? b.invM : 0;
        const total = wa + wb;
        if (total <= 0) continue;
        if (wa) a.v = v.add(a.v, v.scale(n, relative * wa / total));
        if (wb) b.v = v.sub(b.v, v.scale(n, relative * wb / total));
      }
      this._frictionContacts(contacts, h);
    }
    this._hasStepped = true;
    if (this.sleep) this._updateSleep(dt);
  }

  // M3b: a body still below the velocity thresholds for sleepTime seconds goes
  // to sleep (stops integrating); a sleeping body sharing a candidate pair with
  // a *moving* (above threshold) neighbour wakes up. Near-rest bodies do not
  // wake neighbours, so a fully settled stack can sleep together instead of
  // churning. Deterministic: fixed iteration order, thresholded, no RNG.
  _updateSleep(dt) {
    const woken = new Set();
    for (const [i, j] of this._candidatePairs()) {
      const a = this.bodies[i], b = this.bodies[j];
      if (a.sleeping && !b.fixed && !b.sleeping && (Math.hypot(...b.v) > this.sleepVel || Math.hypot(...b.w) > this.sleepAng)) woken.add(i);
      if (b.sleeping && !a.fixed && !a.sleeping && (Math.hypot(...a.v) > this.sleepVel || Math.hypot(...a.w) > this.sleepAng)) woken.add(j);
    }
    for (const idx of woken) { this.bodies[idx].sleeping = false; this.bodies[idx].sleepTimer = 0; }
    for (const b of this.bodies) {
      if (b.fixed || b.sleeping) continue;
      const speed = Math.hypot(...b.v), spin = Math.hypot(...b.w);
      if (speed < this.sleepVel && spin < this.sleepAng) {
        b.sleepTimer += dt;
        if (b.sleepTimer >= this.sleepTime) {
          b.sleeping = true; b.v = [0, 0, 0]; b.w = [0, 0, 0];
        }
      } else {
        b.sleepTimer = 0;
      }
    }
  }

  // box ↔ ground plane: each of the 8 corners that dips below the floor is a
  // non-penetration contact (XPBD, compliance 0). Off-centre contacts torque the
  // body via its box inertia → it tumbles and settles onto a face.
  _floorContacts(contacts) {
    const n = [0, 1, 0];
    for (let bi = 0; bi < this.bodies.length; bi++) {
      const b = this.bodies[bi]; let normalLambda = 0; const points = [];
      if (b.fixed || b.sleeping) continue;          // M3b: sleeping treated as inert
      for (const c of b.corners()) {
        const C = this.floor - c[1];                 // penetration depth (>0 below)
        if (C <= 0) continue;
        const r = v.sub(c, b.p);                      // contact offset from COM
        const rn = v.cross(r, n);
        const wgen = b.invM + v.dot(rn, b.applyInvI(rn));
        if (wgen <= 0) continue;
        const dl = C / wgen;
        normalLambda += dl; points.push(c);
        b.p = v.add(b.p, v.scale(n, b.invM * dl));
        b.applyDRot(b.applyInvI(v.cross(r, v.scale(n, dl))));
      }
      if (normalLambda > 0) {
        const key = `f:${bi}`; const previous = contacts.get(key);
        if (!previous || normalLambda > previous.normalLambda) contacts.set(key, { a: null, b, normal: n, points, normalLambda });
      }
    }
  }

  // M3 broadphase: a uniform spatial grid. Each body is hashed into the single
  // cell containing its centre; candidate pairs come from searching that cell
  // and its 26 neighbours (3×3×3 block), so two bodies whose AABBs overlap are
  // guaranteed to share a candidate pair even when they straddle a cell boundary.
  // Cell keys are integers and pair emission is ordered (i<j), keeping the
  // candidate set deterministic. The resulting pairs are sorted to match the
  // brute-force enumeration order so trajectories stay bit-identical whether
  // broadphase is on or off (for identical candidate sets).
  _candidatePairs() {
    if (!this.broadphase || this.bodies.length < 2) {
      const pairs = [];
      for (let i = 0; i < this.bodies.length; i++) for (let j = i + 1; j < this.bodies.length; j++) pairs.push([i, j]);
      return pairs;
    }
    const cs = this.cellSize;
    const inv = 1 / cs;
    const grid = new Map();
    const key = (x, y, z) => x + ',' + y + ',' + z;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      const cx = Math.floor(b.p[0] * inv), cy = Math.floor(b.p[1] * inv), cz = Math.floor(b.p[2] * inv);
      const k = key(cx, cy, cz);
      let cell = grid.get(k);
      if (!cell) { cell = []; grid.set(k, cell); }
      cell.push(i);
    }
    const seen = new Set(); const pairs = [];
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      const cx = Math.floor(b.p[0] * inv), cy = Math.floor(b.p[1] * inv), cz = Math.floor(b.p[2] * inv);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const cell = grid.get(key(cx + dx, cy + dy, cz + dz));
        if (!cell) continue;
        for (const j of cell) {
          if (j <= i) continue;
          const pk = i + ':' + j;
          if (seen.has(pk)) continue;
          seen.add(pk); pairs.push([i, j]);
        }
      }
    }
    // Match brute-force order (i ascending, then j ascending) so identical
    // candidate sets yield identical trajectories with broadphase on/off.
    pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    return pairs;
  }

  _boxContacts(contacts) {
    for (const [i, j] of this._candidatePairs()) {
      const a = this.bodies[i]; const b = this.bodies[j];
      if (a.fixed && b.fixed) continue;
      if (a.sleeping && b.sleeping) continue;       // M3b: both asleep → no contact
      const aInert = a.fixed || a.sleeping, bInert = b.fixed || b.sleeping;
      if (aInert && bInert) continue;               // both inert → nothing to solve
      const hit = boxContact(a, b);
      if (!hit) continue;
      let normalLambda = 0;
      for (const p of hit.points) {
        const ra = v.sub(p, a.p); const rb = v.sub(p, b.p); const n = hit.normal;
        const ran = v.cross(ra, n); const rbn = v.cross(rb, n);
        const wgen = (aInert ? 0 : a.invM) + (bInert ? 0 : b.invM) + (aInert ? 0 : v.dot(ran, a.applyInvI(ran))) + (bInert ? 0 : v.dot(rbn, b.applyInvI(rbn)));
        if (wgen <= 0) continue;
        const dl = hit.depth / (wgen * hit.points.length);
        normalLambda += dl;
        if (!aInert) {
          a.p = v.add(a.p, v.scale(n, -a.invM * dl));
          a.applyDRot(a.applyInvI(v.cross(ra, v.scale(n, -dl))));
        }
        if (!bInert) {
          b.p = v.add(b.p, v.scale(n, b.invM * dl));
          b.applyDRot(b.applyInvI(v.cross(rb, v.scale(n, dl))));
        }
      }
      const key = `b:${i}:${j}`; const previous = contacts.get(key);
      if (!previous || normalLambda > previous.normalLambda) contacts.set(key, { a, b, normal: hit.normal, points: hit.points, normalLambda });
    }
  }

  _frictionContacts(contacts, h) {
    for (const contact of contacts.values()) {
      const { a, b, normal: n, points, normalLambda } = contact;
      const mu = a ? Math.sqrt(a.friction * b.friction) : b.friction;
      if (mu <= 0 || !points.length) continue;
      const maxImpulse = mu * normalLambda / (h * points.length);
      for (const p of points) {
        const ra = a ? v.sub(p, a.p) : [0, 0, 0]; const rb = v.sub(p, b.p);
        const va = a ? v.add(a.v, v.cross(a.w, ra)) : [0, 0, 0];
        const vb = v.add(b.v, v.cross(b.w, rb)); const relative = v.sub(vb, va);
        const tangentVelocity = v.sub(relative, v.scale(n, v.dot(relative, n)));
        const speed = v.len(tangentVelocity); if (speed < 1e-10) continue;
        const t = v.scale(tangentVelocity, 1 / speed);
        const rat = a ? v.cross(ra, t) : [0, 0, 0]; const rbt = v.cross(rb, t);
        const wgen = (a ? a.invM + v.dot(rat, a.applyInvI(rat)) : 0) + b.invM + v.dot(rbt, b.applyInvI(rbt));
        if (wgen <= 0) continue;
        const jt = Math.min(speed / wgen, maxImpulse); const impulse = v.scale(t, -jt);
        if (a && !a.fixed && !a.sleeping) {
          a.v = v.add(a.v, v.scale(impulse, -a.invM));
          a.w = v.add(a.w, a.applyInvI(v.cross(ra, v.scale(impulse, -1))));
        }
        if (!b.fixed && !b.sleeping) {
          b.v = v.add(b.v, v.scale(impulse, b.invM));
          b.w = v.add(b.w, b.applyInvI(v.cross(rb, impulse)));
        }
      }
    }
  }
}
