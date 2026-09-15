export function createBody(options) {
  return {
    x: options.x,
    y: options.y,
    vx: options.vx || 0,
    vy: options.vy || 0,
    angle: options.angle || 0,
    angularVelocity: options.angularVelocity || 0,
    mass: options.mass || 1,
    invMass: 1 / (options.mass || 1),
    inertia: options.inertia || 1,
    invInertia: 1 / (options.inertia || 1),
    radius: options.radius || 24,
    linearDamping: options.linearDamping ?? 0.985,
    angularDamping: options.angularDamping ?? 0.9,
    maxAngularVelocity: options.maxAngularVelocity || 0,
    forceX: 0,
    forceY: 0,
    torque: 0
  };
}

export function createPhysicsWorld(options) {
  return {
    gravityY: options.gravityY,
    bounds: options.bounds,
    maxRiseSpeed: options.maxRiseSpeed,
    maxFallSpeed: options.maxFallSpeed
  };
}

export function addForce(body, x, y) {
  body.forceX += x;
  body.forceY += y;
}

export function addTorque(body, torque) {
  body.torque += torque;
}

export function applyImpulse(body, impulseX, impulseY, contactX = 0, contactY = 0) {
  body.vx += impulseX * body.invMass;
  body.vy += impulseY * body.invMass;
  body.angularVelocity += (contactX * impulseY - contactY * impulseX) * body.invInertia;
  if (body.maxAngularVelocity) {
    body.angularVelocity = clamp(body.angularVelocity, -body.maxAngularVelocity, body.maxAngularVelocity);
  }
}

export function stepBody(world, body, dt) {
  body.vx += body.forceX * body.invMass * dt;
  body.vy += (world.gravityY + body.forceY * body.invMass) * dt;
  body.vx *= body.linearDamping;
  body.vy *= body.linearDamping;
  body.vy = clamp(body.vy, world.maxRiseSpeed, world.maxFallSpeed);
  body.x += body.vx * dt;
  body.y += body.vy * dt;

  body.angularVelocity += body.torque * body.invInertia * dt;
  body.angularVelocity *= body.angularDamping;
  body.angle += body.angularVelocity * dt;

  body.forceX = 0;
  body.forceY = 0;
  body.torque = 0;
}

export function constrainToBounds(body, bounds, restitution = 0.24) {
  let hit = false;
  if (body.y < bounds.top) {
    body.y = bounds.top;
    body.vy = Math.abs(body.vy) * restitution;
    hit = true;
  }
  if (body.y > bounds.bottom) {
    body.y = bounds.bottom;
    body.vy = -Math.abs(body.vy) * restitution;
    hit = true;
  }
  if (body.x < bounds.left) {
    body.x = bounds.left;
    body.vx = Math.abs(body.vx) * restitution;
    hit = true;
  }
  if (body.x > bounds.right) {
    body.x = bounds.right;
    body.vx = -Math.abs(body.vx) * restitution;
    hit = true;
  }
  return hit;
}

export function collideBodyWithTiltedRing(body, ring, options) {
  if (ring.passed || ring.hitCooldown > 0) return null;

  const c = getRingContact(body, ring, options.depthTilt, options.visualWidthScale, options.visualHeightScale);
  const normalizedBody = body.radius / Math.max(options.visualWidthScale, options.visualHeightScale);
  const insideTubeBand = c.normalized > ring.inner - normalizedBody && c.normalized < ring.outer + normalizedBody;
  const crossingRingPlane = Math.abs(c.localX) < options.passageDepth + body.radius * 0.45;
  if (!insideTubeBand || !crossingRingPlane) return null;

  const target = c.normalized < (ring.inner + ring.outer) * 0.5
    ? ring.inner - normalizedBody
    : ring.outer + normalizedBody;
  const correction = target - c.normalized;
  body.x += c.normalX * correction * options.positionCorrection;
  body.y += c.normalY * correction * options.positionCorrection;

  const rvx = body.vx - ring.vx;
  const rvy = body.vy - ring.vy;
  const direction = Math.sign(correction) || 1;
  const pushX = c.normalX * direction;
  const pushY = c.normalY * direction;
  const approachSpeed = Math.max(0, -(rvx * pushX + rvy * pushY));
  const impulseSize = Math.max(options.minImpulse * 0.18, approachSpeed * (1 + options.restitution));
  const impulseX = pushX * impulseSize;
  const impulseY = pushY * impulseSize;
  body.vx *= 0.88;
  body.vy *= 0.88;
  applyImpulse(
    body,
    impulseX,
    impulseY,
    c.localX * options.angularImpulseScale,
    c.localY * options.angularImpulseScale
  );

  return {
    ...c,
    impulseX,
    impulseY,
    impulseSize,
    correction
  };
}

export function getRingContact(body, ring, depthTilt, visualWidthScale = 1, visualHeightScale = 1) {
  const cos = Math.cos(-ring.tilt);
  const sin = Math.sin(-ring.tilt);
  const dx = body.x - ring.x;
  const dy = body.y - ring.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  const scaledX = localX / visualWidthScale;
  const scaledY = localY / (visualHeightScale * depthTilt);
  const normalized = Math.hypot(scaledX, scaledY);
  const angle = Math.atan2(scaledY, scaledX);
  const localNormalX = Math.cos(angle) / visualWidthScale;
  const localNormalY = Math.sin(angle) / (visualHeightScale * depthTilt);
  const normalLength = Math.hypot(localNormalX, localNormalY) || 1;
  const unitLocalNormalX = localNormalX / normalLength;
  const unitLocalNormalY = localNormalY / normalLength;
  const normalX = unitLocalNormalX * Math.cos(ring.tilt) - unitLocalNormalY * Math.sin(ring.tilt);
  const normalY = unitLocalNormalX * Math.sin(ring.tilt) + unitLocalNormalY * Math.cos(ring.tilt);
  return { normalized, localX, localY, normalX, normalY };
}

export function getRingVerticalClearance(body, ring, depthTilt) {
  const cos = Math.cos(-ring.tilt);
  const sin = Math.sin(-ring.tilt);
  const dx = body.x - ring.x;
  const dy = body.y - ring.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  const normalized = Math.abs(localY) / depthTilt;
  const localNormalY = localY < 0 ? -1 : 1;
  const normalX = -localNormalY * Math.sin(ring.tilt);
  const normalY = localNormalY * Math.cos(ring.tilt);
  return { normalized, localX, localY, normalX, normalY };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
