# tumble

> Pure, deterministic, headless-testable 3D **rigid-body physics** — boxes and a ground plane resolved with **XPBD contacts**, with a real **box inertia tensor** so flat bodies tumble and settle on a face the way a mahjong tile or a die does.

`tumble` is a tiny, dependency-free physics engine for *things that fall, tumble, stack and come to rest*. Unlike a typical isotropic toy, every body carries an **anisotropic box inertia** applied in world space via a quaternion trick (no 3×3 matrices), so a thin tile rotates to lie down on a face instead of spinning like a ball. It's a sibling of [`xpbd-body`](https://github.com/opaopa6969/xpbd-body) (which does *articulated* bodies — joints + motors); `tumble` does *rigid contacts*: non-penetration, friction, stacking. It is **pure** (no renderer / DOM / dependencies) and **deterministic** (fixed substeps, no `Math.random`), so it runs **headless** and is unit-tested in Node — and it drops into a seeded mahjong deal (physics-shuffled wall, dice roll, discard toss) without breaking reproducibility.

```js
import { World, Body } from 'tumble';

const world = new World({ gravity: [0, -9.81, 0], floor: 0 });

// a mahjong tile, dropped tilted from a height
const tile = world.add(new Body({
  pos:  [0, 2, 0],
  quat: [0.1, 0.2, 0, 0.97],     // some tilt
  half: [0.4, 0.05, 0.3],        // thin → anisotropic inertia → it lies down
  mass: 1,
}));

// fixed timestep; each frame:
const dt = 1 / 60;
world.step(dt, 8);               // 8 XPBD substeps

// read plain data back for your renderer:
tile.p;   // [x, y, z] position
tile.q;   // [x, y, z, w] orientation quaternion
```

## API

- `new World({ gravity?, floor?, linDamp?, angDamp?, contactIterations?, broadphase?, cellSize?, sleep?, sleepVel?, sleepAng?, sleepTime? })` — `gravity` default `[0,-9.81,0]`, `floor` is the ground-plane height `y = floor` (normal `+y`), default `0`; `linDamp` default `0.999`, `angDamp` default `0.995`; `contactIterations` default `8` propagates manifold corrections through stacks; `broadphase` default `true` enables the M3 uniform-grid candidate-pair generation; `cellSize` default `2` is the grid edge (keep ≥ body diameter to avoid false negatives); `sleep` default `true` enables M3b sleeping (bodies still for `sleepTime` seconds stop integrating); `sleepVel` default `0.05` / `sleepAng` default `0.20` are the linear/angular rest thresholds; `sleepTime` default `1.0` is the still-time before sleep.
- `world.add(body)` → the body. `world.step(dt, substeps = 8)` — advance one fixed frame (`substeps` default `8`).
- `new Body({ pos, quat?, half?, mass?, fixed?, friction? })` — `pos` **required** `[x,y,z]`; `quat` default `[0,0,0,1]`; `half` = box half-extents `[hx,hy,hz]` (default `0.5³`); `mass` default `1`; `friction` is the Coulomb coefficient (default `0.5`); `fixed: true` makes it immovable (`invM = 0`). Read `body.p` (position), `body.q` (quat), `body.v` (linear vel), `body.w` (angular vel); `body.corners()` returns the 8 world-space corners.

## Use via CDN (no build step)

```html
<script type="importmap">
{ "imports": { "tumble": "https://cdn.jsdelivr.net/gh/opaopa6969/tumble@v0.1.0/index.js" } }
</script>
```

## Test

```sh
node test.mjs     # or: npm test
```

Headless: verifies a tilted box settling on the floor, separated OBBs, two-box and five-box stacks, Coulomb friction, a 120-box grid, broadphase candidate-pair correctness, broadphase on/off trajectory equivalence, **M3b sleeping** (settle→sleep, wake-on-contact, full-stack sleep, sleep-disabled, and slept determinism), and **bit-identical multi-body results across two runs**.

## Status

**M3 done** — M1's box inertia and box↔ground-plane contacts, M2's box↔box OBB SAT over 15 axes, clipped contact manifolds, XPBD stacking and Coulomb friction, M3a's **uniform-grid broadphase** (each body hashed into the cell of its centre; candidate pairs from the 3×3×3 neighbourhood, sorted to match brute-force order so trajectories stay bit-identical), and M3b's **sleeping** (bodies still for `sleepTime` seconds stop integrating; a moving neighbour wakes a sleeper; near-rest neighbours don't, so a settled stack sleeps together). See [`DESIGN.md`](./DESIGN.md) for the remaining M4 (mahjong host wiring) plan.

## MCP

tumble participates in the [volta-mcp](https://github.com/opaopa6969/volta-mcp) facade as **skill-only** (no MCP server). The namespace is `tumble`. Three skills are distributed via `docs/skills/tumble__*/SKILL.md` in the volta-mcp repo:

| skill | purpose | locality |
|---|---|---|
| `tumble__drop-and-settle` | Drop a tilted box, get the settle pose (M1) | repo |
| `tumble__deterministic-physics` | Deterministic physics policy (fixed substep, no Math.random) | global |
| `tumble__mahjong-physics-wiring` | M4 plan: physics shuffle wall, dice roll, discard toss for netmahg | repo |

M2 (box↔box stacking) completion will trigger re-evaluation of `library-serve` (a resident MCP server with `tumble://spec` / `tumble://guide` resources). See [`docs/mcp/DESIGN.md`](./docs/mcp/DESIGN.md) and [`docs/mcp/STATUS.md`](./docs/mcp/STATUS.md) for details. Coordination with netmahg is tracked in [issue-hub #339](https://github.com/opaopa6969/issue-hub/issues/339).

## License

MIT
