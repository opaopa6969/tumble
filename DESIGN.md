# tumble — design

A general 3D **rigid-body physics engine**: boxes, a ground plane and spheres,
resolved with **XPBD contacts**. It is engine-agnostic, but it exists to drop
into a 3D mahjong game (tiles are boxes, dice are cubes, props are boxes/spheres).

The thing that makes it distinct from its sibling [`xpbd-body`](https://github.com/opaopa6969/xpbd-body):
`xpbd-body` does **articulated** bodies (joints + motors); `tumble` does **rigid
contacts** — non-penetration, stacking, Coulomb friction — and it uses a real
**anisotropic box inertia tensor** so flat bodies (a tile) rotate to lie down on
a face instead of spinning like a ball.

## House style (non-negotiable)

Same 流儀 as `motion-engine` / `xpbd-body`:

- **Pure ESM, zero runtime dependencies.** No renderer, no `three.js`, no DOM. The
  engine speaks only plain arrays (`[x,y,z]`, `[x,y,z,w]`). Your renderer reads
  `body.p` / `body.q` and draws.
- **Deterministic.** Fixed timestep, fixed substep count, **no `Math.random`**.
  Identical setup → bit-identical trajectory. This is what makes it compatible
  with **seeded** mahjong deals: a physics-shuffled wall is still reproducible.
- **Headless-testable.** Runs in Node; `test.mjs` asserts behaviour without any
  graphics.
- MIT, author `opaopa6969`.

## Primitives

`minimal primitives × combinatorial expressiveness` — a handful of parts that
combine into stacks, rolls and settles.

### Body

| field | meaning |
|---|---|
| `p` | position `[x,y,z]` (centre of mass) |
| `q` | orientation quaternion `[x,y,z,w]` |
| `v`, `w` | linear / angular velocity |
| `invM` | inverse mass (`0` when `fixed`) |
| `invIl` | **inverse box inertia diagonal** in body-local principal axes |
| `half` | box half-extents `[hx,hy,hz]` |

The box inertia diagonal (principal axes, `d = 2h`):

```
I_x = m/12 · (d_y² + d_z²),   I_y = m/12 · (d_x² + d_z²),   I_z = m/12 · (d_x² + d_y²)
invIl = [12 / (m(d_y²+d_z²)), 12 / (m(d_x²+d_z²)), 12 / (m(d_x²+d_y²))]
```

A thin tile (`half ≈ [0.4, 0.05, 0.3]`) has very different inertia about its three
axes — that anisotropy is exactly what makes it *tumble* and settle face-down
rather than tumble forever.

### The inertia quat-trick (why there's no mat3)

To apply the world-space inverse inertia to a world torque/impulse `L`, instead of
building a 3×3 world inertia matrix `R · I⁻¹ · Rᵀ` we rotate `L` into the body
frame, scale by the diagonal, and rotate back:

```
applyInvI(L) = R · ( invIl ⊙ ( R⁻¹ · L ) )
```

where `R·` is `quat.rotate(q, ·)` and `R⁻¹·` is `quat.rotate(conj(q), ·)`. Pure
quaternion ops — no matrix type needed, and it stays correct as the body spins.

### Colliders

- **box** (half-extents) — primary.
- **ground plane** — `y = floor`, normal `+y`.
- **sphere** — radius (cheap broadphase proxy + actual collider).

## Integrator + contact solver (XPBD)

Substepped XPBD (position-based). Per substep `h = dt / substeps`:

1. **Predict.** `v += g·h`; save `pp = p`, `pq = q`; integrate `p += v·h` and the
   quaternion by `w`.
2. **Solve contacts** (iterated so floor and box manifolds propagate through a stack):
   each penetrating contact is a non-penetration constraint with compliance 0.
   For a contact at offset `r` from COM with normal `n` and depth `C`:

   ```
   w_gen = invM + (r×n) · applyInvI(r×n)
   Δλ    = C / w_gen
   p     += n · (invM · Δλ)
   q     ⊕= applyInvI( r × (n·Δλ) )          // small-angle quaternion nudge
   ```

   Off-centre contacts therefore produce a torque through the **box inertia** —
   this is the whole reason a corner-first landing rotates the body onto a face.
3. **Recover velocities** from the position change: `v = (p − pp)/h`,
   `w = 2·(q · pq⁻¹)_xyz / h`, each scaled by linear/angular damping.

**Restitution** [M2]: after velocity recovery, an explicit `restitution` in
`[0,1]` applies a normal impulse only to closing contact velocity. It defaults
to `0`, so existing scenes remain inelastic. Box-pair restitution uses the
geometric mean; ground contact uses the box value.

**Coulomb friction** [M2]: after velocity recovery, a tangential contact impulse
is clamped to `μ · Δλ_normal / h`. Box-pair friction uses the geometric mean of
the two coefficients, so stacks don't slide apart and a tile that lands at an
angle sticks instead of skating.

## Milestones

| | scope | state |
|---|---|---|
| **M1** | `Body` + box inertia + integrator + **box↔ground-plane** contacts (the 8 corners that dip below the plane become XPBD contacts) → drop a tilted box, it tumbles and settles on a face | **DONE** |
| **M2** | **box↔box**: SAT over 15 axes (3+3 face normals + 9 edge×edge) → clipped contact **manifold**; Coulomb friction. = **stacking** = the mahjong wall | **DONE** |
| **M3a** | **broadphase**: uniform spatial **grid** (each body hashed into the cell of its centre; candidate pairs from the 3×3×3 neighbourhood). Replaces O(n²) pair enumeration so many tiles are cheap, while staying deterministic (sorted pairs, no `Math.random`). | **DONE** |
| **M3b** | **sleeping** — settled islands stop simulating (a wall of ~136 tiles can't all run forever); wake on contact. | **DONE** |
| **M4** | **host wiring**: physics-shuffled wall, dice roll → read the top face, discard toss onto the river. Determinism keeps seeded deals reproducible | planned |

### Narrowphase detail

- **box↔ground-plane** (M1): iterate the 8 corners; any with `y < floor` is one
  contact (normal `+y`, depth `floor − y`). Multiple corners at once form the
  manifold that lets a face settle flat.
- **box↔box** (M2): **SAT** tests 15 separating axes — the 3 face normals of each
  box (6) plus the 9 cross products of their edge directions. Least-penetration
  axis is the contact normal; the manifold comes from **clipping** the incident
  face against the reference face's side planes. Each clipped point below the
  reference face is fed to the same XPBD contact solver as M1.

### Broadphase detail (M3a)

- A **uniform spatial grid** of edge `cellSize` (default `2`) replaces the
  O(n²) pair loop. Each body is hashed into the single cell containing its
  centre; candidate pairs come from searching that cell and its 26 neighbours
  (3×3×3 block), so two touching bodies are always found even when they straddle
  a cell boundary (no false negatives while `cellSize ≥ body diameter`).
- Candidate pairs are sorted into the brute-force order (`i` ascending, then `j`
  ascending), so the trajectory is **bit-identical** whether broadphase is on or
  off for identical candidate sets — determinism is preserved exactly.
- `broadphase: false` on `World` falls back to the plain O(n²) enumeration.

### Sleeping detail (M3b)

- A body whose linear speed `|v|` and angular speed `|w|` stay below
  `sleepVel` (default `0.05`) and `sleepAng` (default `0.20`) for `sleepTime`
  (default `1.0s`) goes to **sleep**: `sleeping = true` and `v = w = 0`.
- A sleeping body **skips** predict + velocity-recovery (no integration), and is
  treated as **inert** in contacts (like `fixed`): it can still support a stack
  but is not displaced. A pair where both bodies sleep generates no contact.
- **Wake on contact.** A sleeping body sharing a candidate pair with a *moving*
  neighbour (above the sleep thresholds) is woken and its timer reset. Near-rest
  neighbours do **not** wake a sleeper, so a fully settled stack can sleep
  together instead of one body waking another forever.
- `sleep: false` on `World` disables the whole mechanism (bodies never sleep);
  the trajectory then matches the pre-M3b engine exactly.
- **Determinism is preserved**: the wake/sleep decision is thresholded and the
  candidate-pair order is fixed (sorted), so identical setup → bit-identical
  trajectory including the `sleeping` flags.

## API

```js
new World({ gravity = [0,-9.81,0], floor = 0, linDamp = 0.999, angDamp = 0.995, contactIterations = 8, broadphase = true, cellSize = 2, sleep = true, sleepVel = 0.05, sleepAng = 0.20, sleepTime = 1.0 })
world.add(body) → body
world.step(dt, substeps = 8)

new Body({ pos, quat = [0,0,0,1], half = [0.5,0.5,0.5], mass = 1, fixed = false, friction = 0.5, restitution = 0 })
body.p / body.q / body.v / body.w        // read state
body.corners()                            // 8 world-space corners
```

## Mahjong applications (the reason it exists)

- **The wall.** ~136 tiles (boxes) physics-shuffled and stacked two-high — M2's
  box↔box stacking + M3's broadphase/sleeping so the wall is stable and cheap.
- **Dice.** A die is a unit cube; roll it, let it tumble (box inertia!) and settle,
  then **read the top face** from `body.q`.
- **The discard / river.** A tossed tile arcs, lands and settles flat among other
  discards — the same drop-and-settle M1 already does, now onto a populated river.
- **Determinism** means all of the above is **seed-compatible**: the same deal
  seed reproduces the same shuffle, the same dice, the same toss — exactly.
