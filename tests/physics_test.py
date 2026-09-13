import math
import unittest


CONFIG = {
    "physics": {
        "gravity": 1180,
        "maxRiseSpeed": -520,
        "maxFallSpeed": 520,
        "mass": 1.05,
        "inertia": 1150,
        "drag": 0.985,
        "angularDamping": 0.88,
        "maxAngularVelocity": 7.5,
    },
    "dolphin": {
        "bodyRadius": 23,
    },
    "rings": {
        "innerRadius": 49,
        "outerRadius": 73,
        "depthTilt": 1,
        "visualWidthScale": 0.58,
        "visualHeightScale": 1.08,
        "collisionRestitution": 0.74,
        "collisionImpulse": 320,
        "positionCorrection": 0.74,
        "angularImpulseScale": 1.65,
        "passageDepth": 12,
    },
}


def clamp(value, min_value, max_value):
    return max(min_value, min(max_value, value))


def create_body(x=0, y=0, vx=0, vy=0):
    mass = CONFIG["physics"]["mass"]
    inertia = CONFIG["physics"]["inertia"]
    return {
        "x": x,
        "y": y,
        "vx": vx,
        "vy": vy,
        "angle": 0,
        "angularVelocity": 0,
        "mass": mass,
        "invMass": 1 / mass,
        "inertia": inertia,
        "invInertia": 1 / inertia,
        "radius": CONFIG["dolphin"]["bodyRadius"],
        "linearDamping": CONFIG["physics"]["drag"],
        "angularDamping": CONFIG["physics"]["angularDamping"],
        "maxAngularVelocity": CONFIG["physics"]["maxAngularVelocity"],
        "forceX": 0,
        "forceY": 0,
        "torque": 0,
    }


def create_ring(x=0, y=0):
    return {
        "x": x,
        "y": y,
        "vx": -255,
        "vy": 0,
        "tilt": 0,
        "inner": CONFIG["rings"]["innerRadius"],
        "outer": CONFIG["rings"]["outerRadius"],
        "passed": False,
        "hitCooldown": 0,
    }


def apply_impulse(body, impulse_x, impulse_y, contact_x=0, contact_y=0):
    body["vx"] += impulse_x * body["invMass"]
    body["vy"] += impulse_y * body["invMass"]
    body["angularVelocity"] += (contact_x * impulse_y - contact_y * impulse_x) * body["invInertia"]
    if body["maxAngularVelocity"]:
        body["angularVelocity"] = clamp(
            body["angularVelocity"],
            -body["maxAngularVelocity"],
            body["maxAngularVelocity"],
        )


def get_ring_contact(body, ring, depth_tilt, visual_width_scale=1, visual_height_scale=1):
    cos = math.cos(-ring["tilt"])
    sin = math.sin(-ring["tilt"])
    dx = body["x"] - ring["x"]
    dy = body["y"] - ring["y"]
    local_x = dx * cos - dy * sin
    local_y = dx * sin + dy * cos
    scaled_x = local_x / visual_width_scale
    scaled_y = local_y / (visual_height_scale * depth_tilt)
    normalized = math.hypot(scaled_x, scaled_y)
    angle = math.atan2(scaled_y, scaled_x)
    local_normal_x = math.cos(angle) / visual_width_scale
    local_normal_y = math.sin(angle) / (visual_height_scale * depth_tilt)
    normal_length = math.hypot(local_normal_x, local_normal_y) or 1
    unit_local_normal_x = local_normal_x / normal_length
    unit_local_normal_y = local_normal_y / normal_length
    normal_x = unit_local_normal_x * math.cos(ring["tilt"]) - unit_local_normal_y * math.sin(ring["tilt"])
    normal_y = unit_local_normal_x * math.sin(ring["tilt"]) + unit_local_normal_y * math.cos(ring["tilt"])
    return {
        "normalized": normalized,
        "localX": local_x,
        "localY": local_y,
        "normalX": normal_x,
        "normalY": normal_y,
    }


def collide_body_with_ring(body, ring):
    if ring["passed"] or ring["hitCooldown"] > 0:
        return None

    options = {
        "depthTilt": CONFIG["rings"]["depthTilt"],
        "minImpulse": CONFIG["rings"]["collisionImpulse"],
        "restitution": CONFIG["rings"]["collisionRestitution"],
        "positionCorrection": CONFIG["rings"]["positionCorrection"],
        "angularImpulseScale": CONFIG["rings"]["angularImpulseScale"],
        "passageDepth": CONFIG["rings"]["passageDepth"],
        "visualWidthScale": CONFIG["rings"]["visualWidthScale"],
        "visualHeightScale": CONFIG["rings"]["visualHeightScale"],
    }
    c = get_ring_contact(body, ring, options["depthTilt"], options["visualWidthScale"], options["visualHeightScale"])
    normalized_body = body["radius"] / max(options["visualWidthScale"], options["visualHeightScale"])
    inside_tube_band = c["normalized"] > ring["inner"] - normalized_body and c["normalized"] < ring["outer"] + normalized_body
    crossing_ring_plane = abs(c["localX"]) < options["passageDepth"] + body["radius"] * 0.45
    if not inside_tube_band or not crossing_ring_plane:
        return None

    target = ring["inner"] - normalized_body if c["normalized"] < (ring["inner"] + ring["outer"]) * 0.5 else ring["outer"] + normalized_body
    correction = target - c["normalized"]
    body["x"] += c["normalX"] * correction * options["positionCorrection"]
    body["y"] += c["normalY"] * correction * options["positionCorrection"]

    rvx = body["vx"] - ring["vx"]
    rvy = body["vy"] - ring["vy"]
    normal_speed = rvx * c["normalX"] + rvy * c["normalY"]
    impulse_size = max(options["minImpulse"], abs(normal_speed) * (1 + options["restitution"]))
    direction = math.copysign(1, correction) if correction else 1
    impulse_x = c["normalX"] * impulse_size * direction
    impulse_y = c["normalY"] * impulse_size * direction
    apply_impulse(
        body,
        impulse_x,
        impulse_y,
        c["localX"] * options["angularImpulseScale"],
        c["localY"] * options["angularImpulseScale"],
    )
    return {**c, "impulseX": impulse_x, "impulseY": impulse_y, "impulseSize": impulse_size, "correction": correction}


class PhysicsTest(unittest.TestCase):
    def test_clean_center_pass_has_no_collision(self):
        body = create_body(x=0, y=0, vx=0, vy=0)
        ring = create_ring()
        self.assertIsNone(collide_body_with_ring(body, ring))

    def test_ring_only_collides_at_crossing_plane(self):
        body = create_body(x=-70, y=-56, vx=0, vy=0)
        ring = create_ring()
        self.assertIsNone(collide_body_with_ring(body, ring))

    def test_upper_inner_edge_pushes_dolphin_downward(self):
        body = create_body(x=0, y=-56, vx=0, vy=0)
        ring = create_ring()
        contact = collide_body_with_ring(body, ring)
        self.assertIsNotNone(contact)
        self.assertGreater(body["vy"], 0)
        self.assertGreater(body["y"], -56)

    def test_lower_inner_edge_pushes_dolphin_upward(self):
        body = create_body(x=0, y=56, vx=0, vy=0)
        ring = create_ring()
        contact = collide_body_with_ring(body, ring)
        self.assertIsNotNone(contact)
        self.assertLess(body["vy"], 0)
        self.assertLess(body["y"], 56)

    def test_off_center_collision_creates_rotation(self):
        body = create_body(x=20, y=-56, vx=0, vy=0)
        ring = create_ring()
        contact = collide_body_with_ring(body, ring)
        self.assertIsNotNone(contact)
        self.assertNotAlmostEqual(body["angularVelocity"], 0, places=4)
        self.assertLessEqual(abs(body["angularVelocity"]), CONFIG["physics"]["maxAngularVelocity"])

    def test_centered_ring_hit_does_not_create_rotation(self):
        body = create_body(x=0, y=-56, vx=0, vy=0)
        ring = create_ring()
        contact = collide_body_with_ring(body, ring)
        self.assertIsNotNone(contact)
        self.assertAlmostEqual(body["angularVelocity"], 0, places=4)

    def test_outer_edge_pushes_away_from_ring(self):
        body = create_body(x=0, y=-82, vx=0, vy=0)
        ring = create_ring()
        contact = collide_body_with_ring(body, ring)
        self.assertIsNotNone(contact)
        self.assertLess(body["vy"], 0)
        self.assertLess(body["y"], -82)


if __name__ == "__main__":
    unittest.main()
