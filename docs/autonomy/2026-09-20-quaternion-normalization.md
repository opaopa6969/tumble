# Body quaternion normalization (#39)

## Observation and hypothesis

`Body` accepted every finite, non-zero quaternion but stored it unchanged.
`q.rot` is valid as a rotation only for a unit quaternion, while `corners`, SAT,
and inverse inertia used the stored value before the integrator normalized it.
Therefore two quaternions representing the same orientation at different
magnitudes could produce different initial geometry and collision decisions.

Reproduction on `main` at `a69fa37163103778fb3f1d2cccc13ba3b47b35b8`:

1. Construct two boxes at `pos: [0, 0.35, 0]`, `half: [0.5, 0.2, 0.3]`.
2. Give one a unit quaternion for 30 degrees about x and the other that
   quaternion multiplied by 2.
3. Compare `body.q`, `body.corners()`, and whether any corner has `y < 0`.

The regression checks failed 3/3 before the implementation: the stored
orientations and corners differed, and only the scaled representation reported
a floor collision before the first step.

## Decision and implementation

Normalize `quat` once in the `Body` constructor after validation. This keeps
the accepted input domain compatible, establishes one invariant for every
solver consumer, and avoids repeated normalization in hot paths. Rejecting a
non-unit value would break callers; normalizing separately in `corners`, SAT,
and inertia would duplicate a fragile rule.

The observable correction is intentionally limited to non-unit inputs, whose
previous result was not a valid rotation. Unit inputs keep the same deterministic
contract. `topFace` still normalizes defensively because it also accepts a
Body-shaped object and public `body.q` remains mutable.

## Acceptance and reversal

- Equivalent quaternion magnitudes yield the same unit orientation, corners,
  and pre-step floor-collision result.
- The complete `node test.mjs` suite and GitHub CI pass.
- README and DESIGN describe the normalized invariant.

Revert by creating a PR that runs `git revert -m 1 <merge-commit>`, then reopen
issue #39.

## Sources and reproducibility

Retrieved 2026-09-20. No external technical material or dependencies were
used. Repository code and documentation are MIT licensed:
<https://github.com/opaopa6969/tumble/blob/a69fa37163103778fb3f1d2cccc13ba3b47b35b8/LICENSE>.
Issue requirements were read from
<https://github.com/opaopa6969/tumble/issues/39>; GitHub content/API access is
subject to <https://docs.github.com/en/site-policy/github-terms/github-terms-of-service>.

Reproduce with `node test.mjs`; the three checks beginning with `Body
normalises equivalent quaternion magnitudes` cover the original failure.

## Iteration 1 ledger

- Observed: PR #26 is merged with successful CI, issue #25 is closed, no PR is
  open, and #39 is the only open issue.
- Hypothesis: constructor normalization fixes every affected solver path with
  one invariant.
- Implemented: constructor normalization, three regression checks, and contract
  documentation.
- Verification: before the fix the three new checks failed; after the fix,
  `node --check index.js`, `node --check test.mjs`, `git diff --check`, and all
  218 checks in `node test.mjs` passed. The existing `TILT` fixture has length
  exactly 1 and every component remains bit-identical after normalization, so
  its trajectory is unchanged. GitHub CI is recorded in the PR after execution.
- Next decision: independent Judge inspects the PR evidence; only an accept is
  eligible for Finalizer merge.
