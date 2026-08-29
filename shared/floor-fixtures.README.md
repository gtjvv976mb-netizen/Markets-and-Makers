# floor-fixtures.json

Thirty floor layouts and the multipliers they must produce.

The floor rule runs in two engines: `game/src/floorEffects.ts` in the browser, which tells a
maker what their floor is doing, and `server/src/floor.ts` in the authority, which decides what
they actually earned while they were away. The two packages duplicate rather than share.

Two copies of a spatial rule drift, and the drift is silent and monetary — it surfaces as a
player who is shown one number and paid another. These fixtures are the thing that stops that:
both test suites execute this file, so a change to either engine that is not made to the other
turns BOTH suites red on the same named fixture.

Regenerate only when the rule is meant to change, and only with both engines already updated.
