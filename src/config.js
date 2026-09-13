export const CONFIG = {
  world: {
    baseWidth: 960,
    baseHeight: 540,
    dolphinX: 235,
    seaFloorPadding: 34,
    surfacePadding: 30
  },
  physics: {
    gravity: 1180,
    liftAcceleration: -1780,
    tapRiseVelocity: -410,
    maxRiseSpeed: -520,
    maxFallSpeed: 520,
    horizontalReturn: 7.5,
    horizontalDamping: 0.86,
    drag: 0.985,
    mass: 1.05,
    inertia: 1150,
    worldRestitution: 0.24,
    buoyancySmoothing: 0.18,
    rotationSmoothing: 0.2,
    tapLeveling: 0.18,
    angularDamping: 0.88,
    maxAngularVelocity: 7.5
  },
  dolphin: {
    visualScale: 0.72,
    radiusX: 31,
    radiusY: 15,
    passPadding: 5,
    cleanRadius: 21,
    bodyRadius: 23
  },
  rings: {
    spawnEvery: 1.9,
    startSpeed: 255,
    maxSpeed: 415,
    outerRadius: 73,
    innerRadius: 49,
    depthTilt: 1,
    visualWidthScale: 0.58,
    visualHeightScale: 1.08,
    visualDepth: 14,
    minVisualTilt: -0.16,
    maxVisualTilt: 0.16,
    tubeHighlight: 7,
    minTilt: 0,
    maxTilt: 0,
    collisionRestitution: 0.42,
    collisionImpulse: 170,
    collisionCooldown: 0.2,
    positionCorrection: 0.46,
    angularImpulseScale: 1.05,
    passageDepth: 12,
    minY: 115,
    maxY: 425,
    missX: 150
  },
  difficulty: {
    speedPerScore: 4.2,
    speedPerSecond: 1.35,
    spawnReductionPerScore: 0.004,
    minSpawnEvery: 1.24,
    verticalNoise: 68,
    obstacleScoreThreshold: 45
  },
  effects: {
    toastMs: 720,
    bubbleCount: 44,
    backgroundDolphinCount: 5
  },
  ranking: {
    limit: 10,
    fallbackName: "Guest"
  }
};
