import * as THREE from 'three/webgpu';

/**
 * Snowmobile — a rideable vehicle the player can mount, drive at high speed,
 * and dramatically launch off of to continue skiing.
 *
 * Physics units match PlayerSkier (1 unit ≈ 5 mph).
 */
export class Snowmobile {
  constructor(terrain, seaLevel = 1) {
    this.terrain = terrain;
    this.seaLevel = seaLevel;

    // World state
    this.wx = 0;
    this.wz = 0;
    this.y = 0;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.heading = 0;
    this.speed = 0;
    this.grounded = true;
    this.angularVelocity = 0;

    this.active = false;
    this.riderMounted = false; // true while player is sitting on it

    // The group exposed to the scene
    this.group = new THREE.Group();
    this.mesh = null; // The snowmobile Three.js group

    // Exhaust / snow spray particle pool
    this._exhaustPool = [];
    this._exhaustPoolSize = 120;
    this._exhaustTimer = 0;
    this._exhaustMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.22,
      roughness: 1.0,
    });

    // Skidoo track (single centre line in dark grey)
    this._trackMat = new THREE.LineBasicMaterial({ color: 0x4a4a4a, transparent: true, opacity: 0.7 });
    this._trackPoints = [];
    this._trackLine = null;

    // Previous physics state for visual interpolation
    this._prevWx = 0;
    this._prevWz = 0;
    this._prevY = 0;

    // Materials (shared across mesh parts)
    this._hullMat  = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.5, metalness: 0.3 });
    this._accentMat = new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.4, metalness: 0.2 });
    this._skiMat   = new THREE.MeshStandardMaterial({ color: 0xadb5bd, roughness: 0.3, metalness: 0.6 });
    this._trackRubberMat = new THREE.MeshStandardMaterial({ color: 0x212529, roughness: 0.9, metalness: 0.1 });
    this._seatMat  = new THREE.MeshStandardMaterial({ color: 0x343a40, roughness: 0.8 });
    this._headlightMat = new THREE.MeshStandardMaterial({ color: 0xffee99, emissive: 0xffdd44, emissiveIntensity: 1.2, roughness: 0.1 });
    this._exhaustPipeMat = new THREE.MeshStandardMaterial({ color: 0x6c757d, roughness: 0.3, metalness: 0.8 });
    this._windshieldMat = new THREE.MeshStandardMaterial({ color: 0x90e0ef, roughness: 0.05, metalness: 0.5, transparent: true, opacity: 0.45 });
  }

  // -------------------------------------------------------------------------
  // Spawn & Despawn
  // -------------------------------------------------------------------------

  spawn(wx, wz) {
    this.wx = wx;
    this.wz = wz;
    const h = this.terrain.getInterpolatedHeight(wx, wz);
    this.y = h;
    this.vy = 0;
    this.vx = 0;
    this.vz = 0;
    this.speed = 0;
    this.grounded = true;
    this.active = true;
    this.riderMounted = false;
    this._prevWx = wx;
    this._prevWz = wz;
    this._prevY = h;
    this.angularVelocity = 0;

    // Build mesh
    this.mesh = this._buildMesh();
    this.mesh.position.set(wx, h + this._groundOffset(), wz);
    this.group.add(this.mesh);

    // Build track line
    const maxTrackVerts = 3000;
    const trackGeo = new THREE.BufferGeometry();
    const trackPositions = new Float32Array(maxTrackVerts * 3);
    trackGeo.setAttribute('position', new THREE.BufferAttribute(trackPositions, 3));
    trackGeo.setDrawRange(0, 0);
    this._trackLine = new THREE.Line(trackGeo, this._trackMat);
    this.group.add(this._trackLine);
    this._trackPoints = [];
  }

  despawn() {
    this.active = false;
    this.riderMounted = false;
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.traverse(c => { if (c.geometry) c.geometry.dispose(); });
      this.mesh = null;
    }
    if (this._trackLine) {
      this.group.remove(this._trackLine);
      this._trackLine.geometry.dispose();
      this._trackLine = null;
    }
    this._trackPoints = [];
    for (const p of this._exhaustPool) {
      this.group.remove(p.mesh);
    }
    this._exhaustPool = [];
  }

  // -------------------------------------------------------------------------
  // Physics Update (called from PlayerSkier's _updateSnowmobile)
  // -------------------------------------------------------------------------

  /**
   * @param {number} dt
   * @param {object} keys - same _keys object as PlayerSkier
   */
  update(dt, keys) {
    if (!this.active) return;

    this._prevWx = this.wx;
    this._prevWz = this.wz;
    this._prevY = this.y;

    const res = this.terrain.resolution;
    const { gx, gz } = this.terrain.worldToGrid(this.wx, this.wz);

    // Despawn if out of bounds
    if (gx <= 1 || gx >= res - 2 || gz <= 1 || gz >= res - 2) {
      this.active = false;
      return;
    }

    const gravity = 22.0;

    // Terrain gradient
    const sampleR = 3;
    const size = this.terrain.size;
    const cellSize = size / (res - 1);
    const hL = this.terrain.getHeight(Math.max(0, gx - sampleR), gz);
    const hR = this.terrain.getHeight(Math.min(res - 1, gx + sampleR), gz);
    const hU = this.terrain.getHeight(gx, Math.max(0, gz - sampleR));
    const hD = this.terrain.getHeight(gx, Math.min(res - 1, gz + sampleR));
    const gradX = (hR - hL) / (2 * sampleR * cellSize);
    const gradZ = (hD - hU) / (2 * sampleR * cellSize);

    // Snowmobile turning — wide turning radius, speed-dependent
    const maxTurnAccel = 14.0;
    const turnDamping = 0.88;
    const maxAngularVel = Math.max(1.0, 2.2 - Math.min(this.speed * 0.06, 1.2));

    if (keys) {
      if (keys.left)  this.angularVelocity += maxTurnAccel * dt;
      if (keys.right) this.angularVelocity -= maxTurnAccel * dt;
    }
    this.angularVelocity *= turnDamping;
    this.angularVelocity = Math.max(-maxAngularVel, Math.min(maxAngularVel, this.angularVelocity));
    this.heading += this.angularVelocity * dt;

    if (this.grounded) {
      // Slope gravity
      this.vx -= gradX * gravity * dt;
      this.vz -= gradZ * gravity * dt;

      // Engine thrust (W)
      if (keys && keys.forward) {
        const thrust = 40.0; // Very powerful — snowmobiles are fast!
        this.vx += Math.sin(this.heading) * thrust * dt;
        this.vz += Math.cos(this.heading) * thrust * dt;
      }

      // Braking (S)
      let friction = 0.988;
      if (keys && keys.brake) {
        friction = 0.82;
      }

      // Track edge grip — snowmobile tracks grip well, less carving than skis
      this.speed = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
      if (this.speed > 0.1) {
        const sinH = Math.sin(this.heading);
        const cosH = Math.cos(this.heading);
        const vFwd = this.vx * sinH + this.vz * cosH;
        const vLat = this.vx * cosH - this.vz * sinH;
        const gripRate = 18.0; // Strong lateral grip
        const newVLat = vLat * Math.max(0, 1.0 - gripRate * dt);
        const latEnergy = (Math.abs(vLat) - Math.abs(newVLat)) * 0.3;
        const newVFwd = vFwd + Math.sign(vFwd || 1) * latEnergy;
        this.vx = newVFwd * sinH + newVLat * cosH;
        this.vz = newVFwd * cosH - newVLat * sinH;
      }

      this.vx *= friction;
      this.vz *= friction;
      this.speed = Math.sqrt(this.vx * this.vx + this.vz * this.vz);

      // Top speed cap ~140 mph = 28 internal units
      const maxSpeed = 28.0;
      if (this.speed > maxSpeed) {
        const r = maxSpeed / this.speed;
        this.vx *= r; this.vz *= r;
        this.speed = maxSpeed;
      }

      // Move
      this.wx += this.vx * dt;
      this.wz += this.vz * dt;

      // Terrain stick
      const terrainH = this.terrain.getInterpolatedHeight(this.wx, this.wz);
      const ballisticVy = this.vy - gravity * dt;
      const ballisticY  = this.y + ballisticVy * dt;
      const groundY = terrainH;

      if (ballisticY - groundY > 1.2 && this.speed > 5.0) {
        // Catching air over cliff/jump
        this.grounded = false;
        this.vy = ballisticVy;
        this.y  = ballisticY;
      } else {
        const targetVy = (groundY - this.y) / Math.max(dt, 0.001);
        this.vy = THREE.MathUtils.lerp(this.vy, Math.min(targetVy, 8.0), 0.4);
        this.y = groundY;
        this.vy = 0;
      }
    } else {
      // Airborne
      this.vy -= gravity * dt;
      this.wx += this.vx * dt;
      this.wz += this.vz * dt;
      this.y  += this.vy * dt;

      const terrainH = this.terrain.getInterpolatedHeight(this.wx, this.wz);
      if (this.y <= terrainH) {
        this.y = terrainH;
        this.vy = 0;
        this.grounded = true;
        this.speed = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
      }
    }

    // Exhaust particles when throttling
    if (this.riderMounted && keys && keys.forward && this.grounded) {
      this._exhaustTimer += dt;
      const interval = Math.max(0.02, 0.07 - this.speed * 0.002);
      while (this._exhaustTimer >= interval) {
        this._exhaustTimer -= interval;
        this._emitExhaust();
      }
    } else {
      this._exhaustTimer = 0;
    }

    this._updateExhaustParticles(dt);
    this._updateTrack();
  }

  // -------------------------------------------------------------------------
  // Visual Update
  // -------------------------------------------------------------------------

  /** Called every render frame with the interpolation alpha */
  interpolateVisuals(alpha) {
    if (!this.active || !this.mesh) return;

    const x = this._prevWx + (this.wx - this._prevWx) * alpha;
    const z = this._prevWz + (this.wz - this._prevWz) * alpha;
    const y = this._prevY  + (this.y  - this._prevY)  * alpha;
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;

    this.mesh.position.set(x, y + this._groundOffset(), z);

    // Smooth heading rotation
    let diff = this.heading - this.mesh.rotation.y;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff >  Math.PI) diff -= Math.PI * 2;
    this.mesh.rotation.y += diff * 0.92;

    // Lean into turn
    const targetLean = -this.angularVelocity * 0.12;
    this.mesh.rotation.z = THREE.MathUtils.lerp(this.mesh.rotation.z, targetLean, 0.15);
  }

  // -------------------------------------------------------------------------
  // Interaction helpers
  // -------------------------------------------------------------------------

  /** Distance (2D) from given world coords to this snowmobile */
  distanceTo(wx, wz) {
    const dx = this.wx - wx;
    const dz = this.wz - wz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /**
   * Compute the launch velocity when the player jumps off.
   * Returns { vx, vz, vy, heading } to give to PlayerSkier.
   */
  getLaunchVelocity() {
    // Strong upward launch + carry the snowmobile's forward momentum
    const launchVy = 10.0 + Math.min(this.speed * 0.25, 5.0);
    // Give a slight backward toss (jump off the back)
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    return {
      vx: this.vx * 0.9 - sinH * 2.0,
      vz: this.vz * 0.9 - cosH * 2.0,
      vy: launchVy,
      heading: this.heading,
    };
  }

  /** Rider mount position in world coords (rider sits on seat) */
  getRiderPosition() {
    return {
      x: this.wx,
      y: this.y + this._groundOffset() + 0.28, // seat height above track
      z: this.wz,
    };
  }

  // -------------------------------------------------------------------------
  // Ground offset constant (distance from terrain to mesh pivot)
  // -------------------------------------------------------------------------
  _groundOffset() { return 0.18; }

  // -------------------------------------------------------------------------
  // Track trail
  // -------------------------------------------------------------------------
  _updateTrack() {
    if (!this._trackLine || !this.grounded || this.speed < 0.3) return;
    const maxVerts = 3000;
    const pts = this._trackPoints;

    // Only add a point if moved enough
    const lastIdx = pts.length - 3;
    if (lastIdx >= 0) {
      const dx = this.wx - pts[lastIdx];
      const dz = this.wz - pts[lastIdx + 2];
      if (dx * dx + dz * dz < 0.04) return;
    }

    pts.push(this.wx, this.y + 0.02, this.wz);
    if (pts.length > maxVerts * 3) {
      this._trackPoints = pts.slice(pts.length - maxVerts * 3);
    }

    const posAttr = this._trackLine.geometry.attributes.position;
    const count = Math.min(this._trackPoints.length, maxVerts * 3);
    const offset = this._trackPoints.length - count;
    posAttr.array.set(this._trackPoints.slice(offset, offset + count));
    posAttr.needsUpdate = true;
    this._trackLine.geometry.setDrawRange(0, count / 3);
  }

  // -------------------------------------------------------------------------
  // Exhaust / snow spray particle system
  // -------------------------------------------------------------------------

  _getExhaustParticle() {
    for (const p of this._exhaustPool) {
      if (!p.active) { p.active = true; p.mesh.visible = true; return p; }
    }
    if (this._exhaustPool.length < this._exhaustPoolSize) {
      const geo = new THREE.IcosahedronGeometry(0.14, 0);
      const mesh = new THREE.Mesh(geo, this._exhaustMat.clone());
      this.group.add(mesh);
      const p = { mesh, active: true, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0, baseScale: 1 };
      this._exhaustPool.push(p);
      return p;
    }
    const oldest = this._exhaustPool[0];
    oldest.active = true;
    oldest.mesh.visible = true;
    return oldest;
  }

  _emitExhaust() {
    const p = this._getExhaustParticle();
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    // Emit from the rear of the snowmobile
    const tailDist = 0.7 + Math.random() * 0.2;
    p.mesh.position.set(
      this.wx - sinH * tailDist + (Math.random() - 0.5) * 0.3,
      this.y + this._groundOffset() + 0.1 + Math.random() * 0.1,
      this.wz - cosH * tailDist + (Math.random() - 0.5) * 0.3
    );

    const speedFactor = Math.min(this.speed * 0.12, 2.0);
    const spread = (Math.random() - 0.5) * Math.PI * 0.6;
    const launchAngle = this.heading + Math.PI + spread;
    p.vx = Math.sin(launchAngle) * speedFactor * (0.4 + Math.random() * 0.5);
    p.vy = 0.3 + Math.random() * 0.5;
    p.vz = Math.cos(launchAngle) * speedFactor * (0.4 + Math.random() * 0.5);
    p.life = 0;
    p.maxLife = 0.35 + Math.random() * 0.35;
    p.baseScale = 0.2 + Math.random() * 0.3;
    p.mesh.scale.setScalar(p.baseScale);
    p.mesh.material.opacity = 0.22;
  }

  _updateExhaustParticles(dt) {
    const gravity = 1.5;
    for (const p of this._exhaustPool) {
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) { p.active = false; p.mesh.visible = false; continue; }
      p.vy -= gravity * dt;
      p.vx *= 0.94;
      p.vz *= 0.94;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      const t = p.life / p.maxLife;
      p.mesh.material.opacity = 0.22 * (1 - t * t);
      p.mesh.scale.setScalar(p.baseScale * (1 + t * 1.5));
    }
  }

  // -------------------------------------------------------------------------
  // 3D Mesh Builder
  // -------------------------------------------------------------------------

  _buildMesh() {
    const g = new THREE.Group();

    // ---- Chassis / Hull ----
    // Main body — low-slung elongated snowmobile hull
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.22, 1.35),
      this._hullMat
    );
    hull.position.set(0, 0.25, 0.05);
    hull.castShadow = true;
    g.add(hull);

    // Front nose (tapered wedge shape using a scaled box)
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.18, 0.55),
      this._hullMat
    );
    nose.position.set(0, 0.22, 0.78);
    nose.rotation.x = -0.25; // slight downward angle
    nose.castShadow = true;
    g.add(nose);

    // Red accent stripe along the side
    const stripeL = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.08, 1.1),
      this._accentMat
    );
    stripeL.position.set(-0.28, 0.30, 0.0);
    g.add(stripeL);

    const stripeR = stripeL.clone();
    stripeR.position.x = 0.28;
    g.add(stripeR);

    // ---- Seat ----
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.10, 0.52),
      this._seatMat
    );
    seat.position.set(0, 0.40, -0.22);
    seat.castShadow = true;
    g.add(seat);

    // Seat hump (slightly rounded top)
    const seatHump = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.06, 0.3),
      this._seatMat
    );
    seatHump.position.set(0, 0.45, -0.28);
    g.add(seatHump);

    // ---- Handlebars ----
    const stemGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.32, 6);
    const stem = new THREE.Mesh(stemGeo, this._skiMat);
    stem.position.set(0, 0.55, 0.48);
    stem.rotation.x = 0.2;
    g.add(stem);

    const barGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.52, 6);
    const bar = new THREE.Mesh(barGeo, this._skiMat);
    bar.position.set(0, 0.70, 0.52);
    bar.rotation.z = Math.PI / 2;
    g.add(bar);

    // Grips (dark rubber at each end of handlebar)
    const gripGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.075, 6);
    gripGeo.rotateZ(Math.PI / 2);
    const gripL = new THREE.Mesh(gripGeo, this._seatMat);
    gripL.position.set(-0.26, 0.70, 0.52);
    g.add(gripL);
    const gripR = gripL.clone();
    gripR.position.x = 0.26;
    g.add(gripR);

    // ---- Windshield ----
    const windshield = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.24, 0.05),
      this._windshieldMat
    );
    windshield.position.set(0, 0.68, 0.60);
    windshield.rotation.x = -0.55;
    g.add(windshield);

    // ---- Headlight ----
    const headlight = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 8, 6),
      this._headlightMat
    );
    headlight.position.set(0, 0.27, 0.98);
    g.add(headlight);

    // Headlight lens housing ring
    const lensRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.055, 0.012, 6, 12),
      this._skiMat
    );
    lensRing.position.set(0, 0.27, 0.97);
    lensRing.rotation.x = Math.PI / 2;
    g.add(lensRing);

    // ---- Front Skis (2 parallel runners) ----
    const frontSkiGeo = new THREE.BoxGeometry(0.08, 0.04, 0.70);
    const frontSkiL = new THREE.Mesh(frontSkiGeo, this._skiMat);
    frontSkiL.position.set(-0.14, 0.06, 0.58);
    frontSkiL.rotation.x = -0.08; // slight upward tip
    frontSkiL.castShadow = true;
    g.add(frontSkiL);

    const frontSkiR = frontSkiL.clone();
    frontSkiR.position.x = 0.14;
    g.add(frontSkiR);

    // Ski tip curl (separate small angled piece)
    const tipGeo = new THREE.BoxGeometry(0.08, 0.04, 0.12);
    const tipL = new THREE.Mesh(tipGeo, this._skiMat);
    tipL.position.set(-0.14, 0.10, 0.90);
    tipL.rotation.x = -0.5;
    g.add(tipL);
    const tipR = tipL.clone();
    tipR.position.x = 0.14;
    g.add(tipR);

    // Ski struts connecting to hull
    const strutGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.22, 4);
    const strutL = new THREE.Mesh(strutGeo, this._skiMat);
    strutL.position.set(-0.14, 0.17, 0.55);
    strutL.rotation.z = 0.15;
    g.add(strutL);
    const strutR = strutL.clone();
    strutR.position.x = 0.14;
    strutR.rotation.z = -0.15;
    g.add(strutR);

    // ---- Rear Drive Track ----
    // Main rubber track (wide flat undercarriage)
    const track = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.06, 0.90),
      this._trackRubberMat
    );
    track.position.set(0, 0.04, -0.22);
    track.castShadow = true;
    g.add(track);

    // Track ridges (decorative rubber cleats)
    for (let i = 0; i < 7; i++) {
      const cleat = new THREE.Mesh(
        new THREE.BoxGeometry(0.44, 0.03, 0.04),
        this._trackRubberMat
      );
      cleat.position.set(0, 0.075, -0.58 + i * 0.18);
      g.add(cleat);
    }

    // ---- Exhaust pipes (left side) ----
    const pipeGeo = new THREE.CylinderGeometry(0.022, 0.018, 0.35, 6);
    const pipe1 = new THREE.Mesh(pipeGeo, this._exhaustPipeMat);
    pipe1.position.set(-0.30, 0.28, -0.05);
    pipe1.rotation.x = 0.4;
    pipe1.rotation.z = 0.15;
    g.add(pipe1);

    const pipe2 = pipe1.clone();
    pipe2.position.z = -0.15;
    g.add(pipe2);

    // Pipe end caps
    const capGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.03, 6);
    const cap1 = new THREE.Mesh(capGeo, this._hullMat);
    cap1.position.set(-0.30, 0.43, -0.19);
    cap1.rotation.x = 0.4;
    cap1.rotation.z = 0.15;
    g.add(cap1);

    const cap2 = cap1.clone();
    cap2.position.z = -0.29;
    g.add(cap2);

    // ---- Tunnel / engine cover ----
    const tunnelGeo = new THREE.BoxGeometry(0.38, 0.12, 0.85);
    const tunnel = new THREE.Mesh(tunnelGeo, this._hullMat);
    tunnel.position.set(0, 0.12, -0.20);
    g.add(tunnel);

    // Scale to world size (snowmobiles are roughly 3m long — use ~1.5× skier scale)
    g.scale.setScalar(1.15);
    g.castShadow = true;

    return g;
  }
}
