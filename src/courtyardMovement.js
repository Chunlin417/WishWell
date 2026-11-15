// Shared by the visible steps and walking collision. The hall doors stay closed.
export const HALL_ACCESS = Object.freeze({
  baseH: .6, front: -5.9, doorZ: -6.9,
  stairWidth: 3.8, stepDepth: .35, stepHeight: .2, steps: 3,
  porchHalfX: 6.1, bodyRadius: .35,
});

export function hallFloorHeight(x, z, a = HALL_ACCESS) {
  if (z <= a.front && Math.abs(x) <= a.porchHalfX - a.bodyRadius) return a.baseH;
  const foot = a.front + a.steps * a.stepDepth;
  if (Math.abs(x) > a.stairWidth / 2 - a.bodyRadius || z >= foot) return 0;
  return Math.min(a.baseH, Math.ceil((foot - z) / a.stepDepth) * a.stepHeight);
}

// Resolve each axis separately so pushing against a door still lets you slide.
export function constrainHallMove(p, previous, a = HALL_ACCESS) {
  const foot = a.front + a.steps * a.stepDepth;
  const allowed = (x, z, fromY) => {
    if (z < a.doorZ + .1 + a.bodyRadius) return false;
    if (z < foot + a.bodyRadius && Math.abs(x) > a.porchHalfX - a.bodyRadius) return false;
    if (z < foot && z > a.front && Math.abs(x) > a.stairWidth / 2 - a.bodyRadius) return false;
    return hallFloorHeight(x, z, a) - fromY <= a.stepHeight + .001;
  };
  let x = previous.x, z = previous.z;
  if (allowed(p.x, z, hallFloorHeight(x, z, a))) x = p.x;
  if (allowed(x, p.z, hallFloorHeight(x, z, a))) z = p.z;
  p.x = x; p.z = z; p.y = hallFloorHeight(x, z, a);
  return p;
}
