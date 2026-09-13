import { CONFIG } from "./config.js";
import {
  addForce,
  addTorque,
  applyImpulse,
  collideBodyWithTiltedRing,
  constrainToBounds,
  createBody,
  createPhysicsWorld,
  getRingContact,
  getRingVerticalClearance,
  stepBody
} from "./physics.js";

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const ui = {
  score: document.querySelector("#score"),
  combo: document.querySelector("#combo"),
  toast: document.querySelector("#toast"),
  startPanel: document.querySelector("#startPanel"),
  gameOverPanel: document.querySelector("#gameOverPanel"),
  rankingPanel: document.querySelector("#rankingPanel"),
  rankingList: document.querySelector("#rankingList"),
  playerName: document.querySelector("#playerName"),
  startButton: document.querySelector("#startButton"),
  restartButton: document.querySelector("#restartButton"),
  rankingButton: document.querySelector("#rankingButton"),
  showRankingButton: document.querySelector("#showRankingButton"),
  closeRankingButton: document.querySelector("#closeRankingButton"),
  finalScore: document.querySelector("#finalScore"),
  bestScore: document.querySelector("#bestScore"),
  myRank: document.querySelector("#myRank")
};

let scale = 1;
let width = CONFIG.world.baseWidth;
let height = CONFIG.world.baseHeight;
let state = createState("ready");
const physicsWorld = createPhysicsWorld({
  gravityY: CONFIG.physics.gravity,
  maxRiseSpeed: CONFIG.physics.maxRiseSpeed,
  maxFallSpeed: CONFIG.physics.maxFallSpeed,
  bounds: {
    left: CONFIG.world.dolphinX - 90,
    right: CONFIG.world.dolphinX + 64,
    top: CONFIG.world.surfacePadding,
    bottom: CONFIG.world.baseHeight - CONFIG.world.seaFloorPadding
  }
});
let lastTime = performance.now();
let tapPulse = 0;
let toastUntil = 0;
let lastSubmitId = null;

function createState(mode = "playing") {
  return {
    mode,
    score: 0,
    combo: 0,
    best: Number(localStorage.getItem("dolphin.best") || 0),
    dolphin: {
      body: createBody({
        x: CONFIG.world.dolphinX,
        y: CONFIG.world.baseHeight * 0.5,
        mass: CONFIG.physics.mass,
        inertia: CONFIG.physics.inertia,
        radius: CONFIG.dolphin.bodyRadius,
        linearDamping: CONFIG.physics.drag,
        angularDamping: CONFIG.physics.angularDamping,
        maxAngularVelocity: CONFIG.physics.maxAngularVelocity
      }),
      x: CONFIG.world.dolphinX,
      y: CONFIG.world.baseHeight * 0.5,
      vx: 0,
      vy: 0,
      angle: 0,
      angularVelocity: 0,
      swim: 0
    },
    rings: [],
    obstacles: [],
    comboBursts: [],
    particles: makeParticles(),
    backgroundDolphins: makeBackgroundDolphins(),
    spawnTimer: 0,
    worldTime: 0,
    lastRingY: CONFIG.world.baseHeight * 0.5
  };
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const rect = document.body.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  width = rect.width;
  height = rect.height;
  scale = Math.min(width / CONFIG.world.baseWidth, height / CONFIG.world.baseHeight);
}

function toScreen(v) {
  return v * scale;
}

function worldY(y) {
  return (height - CONFIG.world.baseHeight * scale) / 2 + y * scale;
}

function makeParticles() {
  return Array.from({ length: CONFIG.effects.bubbleCount }, () => ({
    x: Math.random() * CONFIG.world.baseWidth,
    y: Math.random() * CONFIG.world.baseHeight,
    r: 2 + Math.random() * 5,
    speed: 18 + Math.random() * 42
  }));
}

function makeBackgroundDolphins() {
  return Array.from({ length: CONFIG.effects.backgroundDolphinCount }, (_, i) => ({
    x: Math.random() * CONFIG.world.baseWidth,
    y: 95 + Math.random() * 320,
    speed: 10 + Math.random() * 24,
    size: 0.34 + Math.random() * 0.22,
    phase: i * 1.7
  }));
}

function startGame() {
  const name = cleanName(ui.playerName.value);
  localStorage.setItem("dolphin.name", name);
  ui.playerName.value = name;
  state = createState("playing");
  ui.startPanel.classList.add("hidden");
  ui.gameOverPanel.classList.add("hidden");
  ui.rankingPanel.classList.add("hidden");
}

function cleanName(name) {
  return (name || localStorage.getItem("dolphin.name") || CONFIG.ranking.fallbackName).trim().slice(0, 16) || CONFIG.ranking.fallbackName;
}

function inputDown(event) {
  if (event.target.closest("button,input,.ranking")) return;
  event.preventDefault();
  if (state.mode === "ready") startGame();
  if (state.mode === "playing") flapDolphin();
}

function inputUp() {
}

function flapDolphin() {
  const body = state.dolphin.body;
  const targetVy = CONFIG.physics.tapRiseVelocity;
  const impulseY = Math.min(0, targetVy - body.vy) * body.mass;
  applyImpulse(body, 0, impulseY, 0, 0);
  if (Math.abs(body.angle) > 0.04 || Math.abs(body.angularVelocity) > 0.08) {
    body.angle *= CONFIG.physics.tapLeveling;
    body.angularVelocity *= CONFIG.physics.tapLeveling;
  }
  tapPulse = 0.18;
}

function spawnRing() {
  const cfg = CONFIG.rings;
  const drift = (Math.random() * 2 - 1) * CONFIG.difficulty.verticalNoise;
  const visualTilt = cfg.minVisualTilt + Math.random() * (cfg.maxVisualTilt - cfg.minVisualTilt);
  state.lastRingY = clamp(state.lastRingY + drift, cfg.minY, cfg.maxY);
  state.rings.push({
    x: CONFIG.world.baseWidth + cfg.outerRadius,
    y: state.lastRingY,
    outer: cfg.outerRadius,
    inner: Math.max(42, cfg.innerRadius - Math.min(12, state.score * 0.16)),
    wobble: Math.random() * Math.PI * 2,
    tilt: visualTilt,
    visualTilt,
    hitCooldown: 0,
    stallTimer: 0,
    touched: false,
    passed: false
  });
}

function update(dt) {
  state.worldTime += dt;
  updateAmbient(dt);
  if (state.mode !== "playing") return;

  const p = CONFIG.physics;
  const dolphin = state.dolphin;
  const body = dolphin.body;
  addForce(body, (CONFIG.world.dolphinX - body.x) * p.horizontalReturn * body.mass, 0);
  const gravityRelief = ringGravityRelief(body);
  if (gravityRelief > 0) {
    addForce(body, 0, -p.gravity * body.mass * gravityRelief);
    if (body.vy > 0) body.vy *= 1 - 0.34 * gravityRelief;
  }
  body.vx *= p.horizontalDamping;
  const targetAngle = 0;
  addTorque(body, (targetAngle - body.angle) * p.rotationSmoothing * p.inertia);
  stepBody(physicsWorld, body, dt);
  const hitBounds = constrainToBounds(body, physicsWorld.bounds, p.worldRestitution);
  dolphin.x = body.x;
  dolphin.y = body.y;
  dolphin.vx = body.vx;
  dolphin.vy = body.vy;
  dolphin.angle = clamp(body.angle, -0.95, 0.95);
  body.angle = dolphin.angle;
  dolphin.angularVelocity = body.angularVelocity;
  tapPulse = Math.max(0, tapPulse - dt);
  dolphin.swim += dt * (tapPulse > 0 ? 13 : 7);

  if (hitBounds) {
    state.combo = 0;
    updateHud();
  }

  const speed = currentRingSpeed();
  const spawnEvery = Math.max(CONFIG.difficulty.minSpawnEvery, CONFIG.rings.spawnEvery - state.score * CONFIG.difficulty.spawnReductionPerScore);
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    spawnRing();
    state.spawnTimer = spawnEvery;
  }

  for (const ring of state.rings) {
    const stalled = ring.stallTimer > 0;
    ring.stallTimer = Math.max(0, (ring.stallTimer || 0) - dt);
    const ringSpeed = stalled ? speed * 0.08 : speed;
    ring.x -= ringSpeed * dt;
    ring.vx = -ringSpeed;
    ring.vy = 0;
    ring.hitCooldown = Math.max(0, ring.hitCooldown - dt);
    resolveRingCollision(ring);
    if (!ring.passed && ring.x < dolphin.x - CONFIG.dolphin.radiusX * 0.35) {
      if (didPassRing(ring)) {
        ring.passed = true;
        scoreRing(ring);
      } else {
        endGame();
        break;
      }
    }
    if (!ring.passed && ring.x + ring.outer < CONFIG.rings.missX) {
      endGame();
      break;
    }
  }
  state.rings = state.rings.filter((ring) => ring.x + ring.outer > -40);
}

function didPassRing(ring) {
  const clearance = getRingClearance(ring);
  const cleanPassRadius = Math.max(1, CONFIG.dolphin.radiusY - CONFIG.dolphin.passPadding);
  return clearance.normalized + cleanPassRadius < ring.inner;
}

function ringGravityRelief(body) {
  let relief = 0;
  const cfg = CONFIG.rings;
  for (const ring of state.rings) {
    if (ring.passed) continue;
    const c = getRingContact(body, ring, cfg.depthTilt, cfg.visualWidthScale, cfg.visualHeightScale);
    const gateRange = cfg.outerRadius * cfg.visualWidthScale + CONFIG.dolphin.radiusX;
    const inGateDepth = Math.abs(c.localX) < gateRange;
    const inOpening = getRingClearance(ring).normalized < ring.inner - CONFIG.dolphin.radiusY * 0.15;
    if (!inGateDepth || !inOpening) continue;
    const depthFactor = 1 - Math.min(1, Math.abs(c.localX) / gateRange);
    relief = Math.max(relief, 0.72 + depthFactor * 0.28);
  }
  return relief;
}

function scoreRing(ring) {
  const clearance = getRingClearance(ring);
  const clean = !ring.touched && clearance.normalized + CONFIG.dolphin.cleanRadius < ring.inner;
  if (clean) {
    state.combo += 1;
    state.score += state.combo;
    showToast(`CLEAN! +${state.combo}`);
    showComboBurst(ring, state.combo);
  } else {
    state.score += 1;
    state.combo = 0;
    showToast("HIT +1");
  }
  updateHud();
}

function resolveRingCollision(ring) {
  const cfg = CONFIG.rings;
  const contact = collideBodyWithTiltedRing(state.dolphin.body, ring, {
    depthTilt: cfg.depthTilt,
    minImpulse: cfg.collisionImpulse,
    restitution: cfg.collisionRestitution,
    positionCorrection: cfg.positionCorrection,
    angularImpulseScale: cfg.angularImpulseScale,
    passageDepth: cfg.passageDepth,
    visualWidthScale: cfg.visualWidthScale,
    visualHeightScale: cfg.visualHeightScale
  });
  if (!contact) return;

  ring.touched = true;
  ring.hitCooldown = cfg.collisionCooldown;
  ring.stallTimer = Math.max(ring.stallTimer || 0, 0.18);
  state.dolphin.x = state.dolphin.body.x;
  state.dolphin.y = state.dolphin.body.y;
  state.dolphin.vx = state.dolphin.body.vx;
  state.dolphin.vy = state.dolphin.body.vy;
  state.dolphin.angularVelocity = state.dolphin.body.angularVelocity;
  state.combo = 0;
  updateHud();
}

function getRingClearance(ring) {
  return getRingVerticalClearance(state.dolphin.body, ring, CONFIG.rings.depthTilt);
}

function currentRingSpeed() {
  return Math.min(
    CONFIG.rings.maxSpeed,
    CONFIG.rings.startSpeed
      + state.score * CONFIG.difficulty.speedPerScore
      + state.worldTime * CONFIG.difficulty.speedPerSecond
  );
}

function endGame() {
  if (state.mode !== "playing") return;
  state.mode = "over";
  state.best = Math.max(state.best, state.score);
  localStorage.setItem("dolphin.best", String(state.best));
  ui.finalScore.textContent = state.score;
  ui.bestScore.textContent = state.best;
  ui.myRank.textContent = "-";
  ui.gameOverPanel.classList.remove("hidden");
  submitScore();
}

async function submitScore() {
  const player = cleanName(ui.playerName.value);
  try {
    const res = await fetch("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player, score: state.score })
    });
    const data = await res.json();
    lastSubmitId = data.id;
    ui.myRank.textContent = data.rank ? `#${data.rank}` : "-";
  } catch {
    ui.myRank.textContent = "offline";
  }
}

async function loadRanking() {
  ui.rankingPanel.classList.remove("hidden");
  ui.rankingList.innerHTML = "<li>불러오는 중...</li>";
  try {
    const res = await fetch(`/api/rankings?limit=${CONFIG.ranking.limit}`);
    const data = await res.json();
    ui.rankingList.innerHTML = data.rankings.map((row) => {
      const mine = row.id === lastSubmitId ? " class=\"mine\"" : "";
      return `<li${mine}><span>#${row.rank} ${escapeHtml(row.player)}</span><strong>${row.score}</strong></li>`;
    }).join("") || "<li>아직 기록이 없습니다.</li>";
  } catch {
    ui.rankingList.innerHTML = "<li>서버 연결이 필요합니다.</li>";
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char]));
}

async function loadRankingClean() {
  ui.rankingPanel.classList.remove("hidden");
  ui.rankingList.innerHTML = "<li>Loading rankings...</li>";
  try {
    const res = await fetch(`/api/rankings?limit=${CONFIG.ranking.limit}`);
    const data = await res.json();
    ui.rankingList.innerHTML = data.rankings.map((row) => {
      const mine = row.id === lastSubmitId ? " class=\"mine\"" : "";
      return `<li${mine}><span>#${row.rank} ${escapeHtml(row.player)}</span><strong>${row.score}</strong></li>`;
    }).join("") || "<li>No scores yet.</li>";
  } catch {
    ui.rankingList.innerHTML = "<li>Ranking server unavailable.</li>";
  }
}

function updateHud() {
  ui.score.textContent = state.score;
  ui.combo.textContent = state.combo;
}

function showToast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add("show");
  toastUntil = performance.now() + CONFIG.effects.toastMs;
}

function updateAmbient(dt) {
  for (const b of state.particles) {
    b.y -= b.speed * dt;
    b.x -= 12 * dt;
    if (b.y < -10) {
      b.y = CONFIG.world.baseHeight + 10;
      b.x = Math.random() * CONFIG.world.baseWidth;
    }
  }
  for (const d of state.backgroundDolphins) {
    d.x -= d.speed * dt;
    d.phase += dt * 2;
    if (d.x < -120) {
      d.x = CONFIG.world.baseWidth + Math.random() * 360;
      d.y = 95 + Math.random() * 320;
    }
  }
  for (const burst of state.comboBursts) {
    burst.age += dt;
  }
  state.comboBursts = state.comboBursts.filter((burst) => burst.age < burst.duration);
}

function draw() {
  ctx.clearRect(0, 0, width, height);
  drawBackground();
  drawRings();
  drawDolphin();
  drawFrontRings();
  drawComboBursts();
  if (performance.now() > toastUntil) ui.toast.classList.remove("show");
}

function drawBackground() {
  const grd = ctx.createLinearGradient(0, 0, 0, height);
  grd.addColorStop(0, "#8cebf3");
  grd.addColorStop(0.52, "#1689bd");
  grd.addColorStop(1, "#084a78");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 5; i++) {
    const x = ((i * 230 - state.worldTime * 22) % (CONFIG.world.baseWidth + 280)) * scale - 120;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + toScreen(56), 0);
    ctx.lineTo(x + toScreen(170), height);
    ctx.lineTo(x + toScreen(68), height);
    ctx.fill();
  }
  ctx.restore();

  for (const d of state.backgroundDolphins) drawBackgroundDolphin(d);
  for (const b of state.particles) {
    ctx.strokeStyle = "rgba(230, 255, 255, .62)";
    ctx.lineWidth = Math.max(1, toScreen(1.2));
    ctx.beginPath();
    ctx.arc(toScreen(b.x), worldY(b.y), toScreen(b.r), 0, Math.PI * 2);
    ctx.stroke();
  }
  drawSeaPlants();
}

function drawBackgroundDolphin(d) {
  const s = d.size;
  const x = toScreen(d.x);
  const y = worldY(d.y + Math.sin(d.phase) * 8);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * scale, s * scale);
  ctx.globalAlpha = 0.26;
  ctx.fillStyle = "#d7f8ff";
  ctx.beginPath();
  ctx.ellipse(0, 0, 48, 17, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-36, 0);
  ctx.lineTo(-70, -16 + Math.sin(d.phase * 2) * 6);
  ctx.lineTo(-58, 0);
  ctx.lineTo(-70, 16 - Math.sin(d.phase * 2) * 6);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-2, -14);
  ctx.lineTo(16, -33);
  ctx.lineTo(24, -10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSeaPlants() {
  const base = worldY(CONFIG.world.baseHeight);
  ctx.strokeStyle = "rgba(37, 194, 139, .55)";
  ctx.lineWidth = toScreen(5);
  for (let i = 0; i < 14; i++) {
    const x = (i * 87 - (state.worldTime * 38) % 87) * scale;
    const h = toScreen(28 + (i % 4) * 13);
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.quadraticCurveTo(x + Math.sin(state.worldTime + i) * 12, base - h * 0.55, x + 8, base - h);
    ctx.stroke();
  }
}

function drawRings() {
  for (const ring of state.rings) {
    drawRingHalf(ring, "back");
  }
}

function drawFrontRings() {
  for (const ring of state.rings) {
    drawRingHalf(ring, "front");
  }
}

function drawRingHalf(ring, half) {
  const x = toScreen(ring.x);
  const y = worldY(ring.y);
  const rx = toScreen(ring.outer * CONFIG.rings.visualWidthScale);
  const ry = toScreen(ring.outer * CONFIG.rings.visualHeightScale);
  const innerRx = toScreen(ring.inner * CONFIG.rings.visualWidthScale);
  const innerRy = toScreen(ring.inner * CONFIG.rings.visualHeightScale);
  const depth = toScreen(CONFIG.rings.visualDepth * (ring.touched ? 0.7 : 1));

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ring.visualTilt || 0);

  if (half === "back") {
    drawRingDepth(rx, ry, innerRx, innerRy, depth, ring.touched);
    drawFilledRingHalf(rx, ry, innerRx, innerRy, Math.PI * 1.5, Math.PI * 2.5, ring.touched ? "#aa0e0c" : "#930706", false, true);
    ctx.restore();
    return;
  }

  drawFilledRingHalf(rx, ry, innerRx, innerRy, Math.PI * 0.5, Math.PI * 1.5, ring.touched ? "#ef2118" : "#f0170d", false, true);
  drawRingHighlights(rx, ry, innerRx, innerRy);
  ctx.restore();
}

function drawRingDepth(rx, ry, innerRx, innerRy, depth, touched) {
  const sideGradient = ctx.createLinearGradient(-rx, 0, rx, 0);
  sideGradient.addColorStop(0, touched ? "#dc1c16" : "#e9160e");
  sideGradient.addColorStop(0.5, touched ? "#b90e0c" : "#c90907");
  sideGradient.addColorStop(1, touched ? "#7c0807" : "#700504");

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = sideGradient;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, Math.PI * 1.47, Math.PI * 2.53);
  ctx.ellipse(0, 0, innerRx, innerRy, 0, Math.PI * 2.53, Math.PI * 1.47, true);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.lineWidth = Math.max(1, depth * 0.36);
  ctx.strokeStyle = "rgba(50, 2, 2, .36)";
  drawEllipseArc(0, 0, innerRx + depth * 0.18, innerRy + depth * 0.1, Math.PI * 1.55, Math.PI * 2.4);
  ctx.stroke();
  ctx.restore();
}

function drawFilledRing(rx, ry, innerRx, innerRy, fill, shadow) {
  if (shadow) {
    ctx.shadowColor = "rgba(12, 5, 4, .3)";
    ctx.shadowBlur = toScreen(7);
    ctx.shadowOffsetX = toScreen(4);
    ctx.shadowOffsetY = toScreen(4);
  } else {
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.ellipse(0, 0, innerRx, innerRy, 0, Math.PI * 2, 0, true);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = toScreen(3);
  ctx.strokeStyle = "rgba(14, 8, 7, .94)";
  drawEllipseArc(0, 0, rx, ry, 0, Math.PI * 2);
  ctx.stroke();
  drawEllipseArc(0, 0, innerRx, innerRy, 0, Math.PI * 2);
  ctx.stroke();
}

function drawFilledRingHalf(rx, ry, innerRx, innerRy, start, end, fill, shadow, stroke = true) {
  ctx.shadowBlur = shadow ? toScreen(4) : 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, start, end);
  ctx.ellipse(0, 0, innerRx, innerRy, 0, end, start, true);
  ctx.closePath();
  ctx.fill();

  if (!stroke) return;
  ctx.shadowBlur = 0;
  ctx.lineWidth = toScreen(3);
  ctx.strokeStyle = "rgba(14, 8, 7, .94)";
  drawEllipseArc(0, 0, rx, ry, start, end);
  ctx.stroke();
  drawEllipseArc(0, 0, innerRx, innerRy, start, end);
  ctx.stroke();
}

function drawRingHighlights(rx, ry, innerRx, innerRy) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = toScreen(6);
  ctx.strokeStyle = "rgba(255, 138, 96, .72)";
  drawEllipseArc(0, 0, rx - toScreen(9), ry - toScreen(10), Math.PI * 0.78, Math.PI * 1.28);
  ctx.stroke();

  ctx.lineWidth = toScreen(3.2);
  ctx.strokeStyle = "rgba(255, 246, 218, .88)";
  drawEllipseArc(0, 0, rx - toScreen(12), ry - toScreen(14), Math.PI * 0.86, Math.PI * 1.18);
  ctx.stroke();

  ctx.lineWidth = toScreen(2.2);
  ctx.strokeStyle = "rgba(68, 2, 2, .55)";
  drawEllipseArc(0, 0, innerRx + toScreen(4), innerRy + toScreen(4), Math.PI * 1.5, Math.PI * 2.35);
  ctx.stroke();
  ctx.restore();
}

function drawEllipseArc(x, y, rx, ry, start, end) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, start, end);
}

function showComboBurst(ring, combo) {
  state.comboBursts.push({
    x: ring.x,
    y: ring.y,
    combo,
    age: 0,
    duration: 0.7
  });
}

function drawComboBursts() {
  for (const burst of state.comboBursts) {
    const t = Math.min(1, burst.age / burst.duration);
    const ease = 1 - Math.pow(1 - t, 3);
    const x = toScreen(burst.x);
    const y = worldY(burst.y);
    const alpha = 1 - t;

    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.lineWidth = toScreen(3);
    ctx.strokeStyle = "rgba(255, 245, 120, .9)";
    ctx.beginPath();
    ctx.ellipse(0, 0, toScreen(34 + 46 * ease), toScreen(60 + 58 * ease), 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, .85)";
    ctx.lineWidth = toScreen(2);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI * 0.25 + burst.age * 3;
      const r0 = toScreen(48 + 20 * ease);
      const r1 = toScreen(70 + 34 * ease);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }

    ctx.fillStyle = "#fff26d";
    ctx.font = `900 ${Math.round(toScreen(22 + burst.combo * 1.2))}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0, 44, 82, .5)";
    ctx.shadowBlur = toScreen(8);
    ctx.fillText(`COMBO x${burst.combo}`, 0, toScreen(-92 - 20 * ease));
    ctx.restore();
  }
}

function drawDolphin() {
  const d = state.dolphin;
  const x = toScreen(d.x);
  const y = worldY(d.y);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(d.angle);
  ctx.scale(CONFIG.dolphin.visualScale, CONFIG.dolphin.visualScale);
  const swim = Math.sin(d.swim);
  const tail = swim * toScreen(9);
  const fin = Math.sin(d.swim + 1.1) * toScreen(4);
  const bodyBob = Math.sin(d.swim * 0.5) * toScreen(1.8);
  ctx.translate(0, bodyBob);
  ctx.shadowColor = "rgba(1, 23, 52, .5)";
  ctx.shadowBlur = toScreen(18);
  ctx.shadowOffsetY = toScreen(3);

  const bodyGradient = ctx.createRadialGradient(toScreen(12), toScreen(-16), toScreen(8), toScreen(0), toScreen(0), toScreen(62));
  bodyGradient.addColorStop(0, "#f7fbff");
  bodyGradient.addColorStop(0.28, "#b9d1df");
  bodyGradient.addColorStop(0.68, "#6f96ad");
  bodyGradient.addColorStop(1, "#426c86");

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(13, 45, 68, .82)";
  ctx.lineWidth = toScreen(4);

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#071f34";
  ctx.beginPath();
  ctx.ellipse(toScreen(2), toScreen(5), toScreen(61), toScreen(30), -0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#6d93aa";
  ctx.beginPath();
  ctx.moveTo(toScreen(-38), toScreen(3));
  ctx.bezierCurveTo(toScreen(-55), toScreen(-12), toScreen(-76), toScreen(-8) + tail, toScreen(-88), toScreen(0) + tail);
  ctx.bezierCurveTo(toScreen(-72), toScreen(3), toScreen(-55), toScreen(12) - tail, toScreen(-38), toScreen(10));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#486f88";
  ctx.beginPath();
  ctx.moveTo(toScreen(-82), toScreen(0) + tail);
  ctx.lineTo(toScreen(-104), toScreen(-17) + tail);
  ctx.quadraticCurveTo(toScreen(-96), toScreen(-4) + tail, toScreen(-81), toScreen(0) + tail);
  ctx.lineTo(toScreen(-104), toScreen(18) + tail);
  ctx.quadraticCurveTo(toScreen(-95), toScreen(6) + tail, toScreen(-82), toScreen(0) + tail);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = bodyGradient;
  ctx.beginPath();
  ctx.moveTo(toScreen(-45), toScreen(2));
  ctx.bezierCurveTo(toScreen(-29), toScreen(-31), toScreen(21), toScreen(-43), toScreen(55), toScreen(-19));
  ctx.bezierCurveTo(toScreen(76), toScreen(-4), toScreen(65), toScreen(22), toScreen(38), toScreen(31));
  ctx.bezierCurveTo(toScreen(10), toScreen(41), toScreen(-26), toScreen(29), toScreen(-45), toScreen(11));
  ctx.bezierCurveTo(toScreen(-52), toScreen(6), toScreen(-52), toScreen(3), toScreen(-45), toScreen(2));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(9, 38, 61, .9)";
  ctx.lineWidth = toScreen(3.8);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  const bellyGradient = ctx.createLinearGradient(toScreen(-25), toScreen(2), toScreen(45), toScreen(32));
  bellyGradient.addColorStop(0, "rgba(255, 255, 250, .96)");
  bellyGradient.addColorStop(1, "rgba(215, 231, 238, .62)");
  ctx.fillStyle = bellyGradient;
  ctx.beginPath();
  ctx.moveTo(toScreen(-25), toScreen(9));
  ctx.bezierCurveTo(toScreen(-3), toScreen(20), toScreen(27), toScreen(26), toScreen(53), toScreen(5));
  ctx.bezierCurveTo(toScreen(45), toScreen(30), toScreen(6), toScreen(38), toScreen(-30), toScreen(19));
  ctx.bezierCurveTo(toScreen(-36), toScreen(15), toScreen(-34), toScreen(10), toScreen(-25), toScreen(9));
  ctx.closePath();
  ctx.fill();

  const shine = ctx.createLinearGradient(toScreen(-22), toScreen(-25), toScreen(40), toScreen(0));
  shine.addColorStop(0, "rgba(255,255,255,.58)");
  shine.addColorStop(0.7, "rgba(255,255,255,.12)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.ellipse(toScreen(8), toScreen(-13), toScreen(34), toScreen(7), -0.13, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, .34)";
  ctx.lineWidth = toScreen(2.2);
  ctx.beginPath();
  ctx.moveTo(toScreen(-24), toScreen(-16));
  ctx.bezierCurveTo(toScreen(0), toScreen(-31), toScreen(31), toScreen(-29), toScreen(53), toScreen(-14));
  ctx.stroke();

  ctx.fillStyle = "#567d94";
  ctx.beginPath();
  ctx.moveTo(toScreen(-6), toScreen(-24));
  ctx.bezierCurveTo(toScreen(7), toScreen(-50), toScreen(28), toScreen(-42), toScreen(25), toScreen(-17));
  ctx.bezierCurveTo(toScreen(12), toScreen(-24), toScreen(2), toScreen(-24), toScreen(-6), toScreen(-24));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(9, 38, 61, .72)";
  ctx.lineWidth = toScreen(2.5);
  ctx.stroke();

  ctx.fillStyle = "#3f657d";
  ctx.beginPath();
  ctx.moveTo(toScreen(-2), toScreen(14));
  ctx.bezierCurveTo(toScreen(10), toScreen(31) + fin, toScreen(21), toScreen(42) + fin, toScreen(37), toScreen(41) + fin);
  ctx.bezierCurveTo(toScreen(31), toScreen(25) + fin, toScreen(16), toScreen(14), toScreen(2), toScreen(9));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#d7edf4";
  ctx.beginPath();
  ctx.moveTo(toScreen(39), toScreen(-16));
  ctx.bezierCurveTo(toScreen(59), toScreen(-24), toScreen(84), toScreen(-15), toScreen(101), toScreen(-5));
  ctx.bezierCurveTo(toScreen(88), toScreen(3), toScreen(64), toScreen(8), toScreen(47), toScreen(0));
  ctx.bezierCurveTo(toScreen(43), toScreen(-5), toScreen(40), toScreen(-11), toScreen(39), toScreen(-16));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(9, 38, 61, .68)";
  ctx.lineWidth = toScreen(2.4);
  ctx.stroke();

  ctx.fillStyle = "#102842";
  ctx.beginPath();
  ctx.arc(toScreen(42), toScreen(-13), toScreen(3.5), 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,.86)";
  ctx.beginPath();
  ctx.arc(toScreen(43), toScreen(-14), toScreen(1.1), 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(4, 83, 123, .45)";
  ctx.lineWidth = toScreen(1.8);
  ctx.beginPath();
  ctx.arc(toScreen(58), toScreen(-2), toScreen(8), 0.45, 1.32);
  ctx.stroke();

  ctx.strokeStyle = "rgba(5, 80, 119, .18)";
  ctx.lineWidth = toScreen(1.2);
  ctx.beginPath();
  ctx.moveTo(toScreen(-38), toScreen(7));
  ctx.bezierCurveTo(toScreen(-12), toScreen(16), toScreen(24), toScreen(15), toScreen(51), toScreen(5));
  ctx.stroke();
  ctx.restore();
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

window.addEventListener("resize", resize);
window.addEventListener("pointerdown", inputDown, { passive: false });
window.addEventListener("pointerup", inputUp);
window.addEventListener("pointercancel", inputUp);
ui.startButton.addEventListener("click", startGame);
ui.restartButton.addEventListener("click", startGame);
ui.rankingButton.addEventListener("click", loadRankingClean);
ui.showRankingButton.addEventListener("click", loadRankingClean);
ui.closeRankingButton.addEventListener("click", () => ui.rankingPanel.classList.add("hidden"));
ui.playerName.value = localStorage.getItem("dolphin.name") || "";

resize();
updateHud();
requestAnimationFrame(loop);
