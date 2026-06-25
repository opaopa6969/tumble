// rigid-body engine (M1) — general 3D rigid bodies with box colliders + a ground
// plane, resolved with XPBD contacts. Box INERTIA (not isotropic) so flat bodies
// tumble and settle on a face the way a mahjong tile / die does. Pure,
// dependency-free, deterministic (fixed substeps, no Math.random) — headless
// testable, same 流儀 as motion-engine / xpbd-body.
//
// M1 scope: Body(box) + gravity + box↔ground-plane contacts (non-penetration via
// the 8 corners) + damping. M2 adds box↔box (SAT + manifold = stacking),
// M3 broadphase + sleeping, M4 the mahjong wiring (tiles/dice).

const v = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
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

export class Body {
  // { pos, quat?, half:[hx,hy,hz], mass, fixed? }
  constructor(o) {
    this.p = o.pos.slice(); this.q = (o.quat || [0, 0, 0, 1]).slice();
    this.v = [0, 0, 0]; this.w = [0, 0, 0];
    this.half = o.half ? o.half.slice() : [0.5, 0.5, 0.5];
    this.fixed = !!o.fixed;
    const m = o.mass || 1;
    this.invM = this.fixed ? 0 : 1 / m;
    // box inertia diagonal (principal axes): I_x = m/12 (dy²+dz²), d = 2h
    const [hx, hy, hz] = this.half; const sq = (x) => (2 * x) * (2 * x);
    this.invIl = this.fixed ? [0, 0, 0]
      : [12 / (m * (sq(hy) + sq(hz))), 12 / (m * (sq(hx) + sq(hz))), 12 / (m * (sq(hx) + sq(hy)))];
    this.pp = this.p.slice(); this.pq = this.q.slice();
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
    this.bodies = [];
  }
  add(b) { this.bodies.push(b); return b; }

  step(dt, substeps = 8) {
    const h = dt / substeps;
    for (let s = 0; s < substeps; s++) {
      for (const b of this.bodies) {
        if (b.fixed) continue;
        b.v = v.add(b.v, v.scale(this.gravity, h));
        b.pp = b.p.slice(); b.p = v.add(b.p, v.scale(b.v, h));
        b.pq = b.q.slice();
        const w = b.w; const dq = q.mul([w[0], w[1], w[2], 0], b.q);
        b.q = q.norm([b.q[0] + 0.5 * h * dq[0], b.q[1] + 0.5 * h * dq[1], b.q[2] + 0.5 * h * dq[2], b.q[3] + 0.5 * h * dq[3]]);
      }
      // a couple of iterations help the multi-corner manifold converge
      for (let it = 0; it < 2; it++) this._floorContacts();
      for (const b of this.bodies) {
        if (b.fixed) continue;
        b.v = v.scale(v.scale(v.sub(b.p, b.pp), 1 / h), this.linDamp);
        let dq = q.mul(b.q, q.conj(b.pq));
        if (dq[3] < 0) dq = [-dq[0], -dq[1], -dq[2], -dq[3]];
        b.w = v.scale([2 / h * dq[0], 2 / h * dq[1], 2 / h * dq[2]], this.angDamp);
      }
    }
  }

  // box ↔ ground plane: each of the 8 corners that dips below the floor is a
  // non-penetration contact (XPBD, compliance 0). Off-centre contacts torque the
  // body via its box inertia → it tumbles and settles onto a face.
  _floorContacts() {
    const n = [0, 1, 0];
    for (const b of this.bodies) {
      if (b.fixed) continue;
      for (const c of b.corners()) {
        const C = this.floor - c[1];                 // penetration depth (>0 below)
        if (C <= 0) continue;
        const r = v.sub(c, b.p);                      // contact offset from COM
        const rn = v.cross(r, n);
        const wgen = b.invM + v.dot(rn, b.applyInvI(rn));
        if (wgen <= 0) continue;
        const dl = C / wgen;
        b.p = v.add(b.p, v.scale(n, b.invM * dl));
        b.applyDRot(b.applyInvI(v.cross(r, v.scale(n, dl))));
      }
    }
  }
}
