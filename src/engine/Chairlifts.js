import * as THREE from 'three/webgpu';

/**
 * Procedural lift system supporting:
 * 1. Double Chairlift (Classic fixed-grip 2-seater, relaxed speed)
 * 2. Quad Chairlift (High-speed express 4-seater, fast speed)
 * 3. Aerial Tram (Iconic reversible panoramic cabins, maximum speed)
 */

export class Chairlifts {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.lines = []; // { group, length, chairs, p1, p2, type, trackOffset, speed }

    // Shared Materials - Cable & Tower
    this.matTower = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8, metalness: 0.6 });
    this.matQuadTower = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.5, metalness: 0.7 });
    this.matCable = new THREE.LineBasicMaterial({ color: 0x111111, linewidth: 2 });

    // Materials - Double Chair
    this.matDoubleChair = new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.5 }); // Classic Red
    this.matDoublePole = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8 });

    // Materials - Quad Chair
    this.matQuadCushion = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.6, metalness: 0.1 }); // Sky Blue cushions
    this.matQuadFrame = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.8 }); // Slate metal frame
    this.matQuadBar = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4, metalness: 0.7 }); // Amber footrests/bar
    this.matQuadStationCover = new THREE.MeshStandardMaterial({ color: 0x0369a1, roughness: 0.3, metalness: 0.4 }); // Express Blue canopy
    this.matQuadStationTrim = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2, metalness: 0.5 }); // Crisp white trim

    // Materials - Aerial Tram
    this.matTramTower = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5, metalness: 0.7 });
    this.matTramCrossbar = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.8 });
    this.matTramSheave = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4, metalness: 0.8 }); // Yellow/gold pulleys
    this.matTramCabinBody1 = new THREE.MeshStandardMaterial({ color: 0xd90429, roughness: 0.35, metalness: 0.3 }); // Crimson Red Tram
    this.matTramCabinBody2 = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.35, metalness: 0.3 }); // Royal Blue Tram (Car 2)
    this.matTramRoof = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3, metalness: 0.4 }); // Crisp white/silver roof
    this.matTramGlass = new THREE.MeshStandardMaterial({ 
      color: 0x1e293b, 
      roughness: 0.1, 
      metalness: 0.8, 
      opacity: 0.85, 
      transparent: true 
    });
    this.matTramHanger = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.85 });
    this.matTramStationBase = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8, metalness: 0.3 });
    this.matTramStationRoof = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.5 });
    this.matTramStationAccent = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4, metalness: 0.8 });

    // Movement speeds (world units per second)
    this.doubleChairSpeed = 8.0; // Slower, relaxed classic fixed-grip
    this.quadChairSpeed = 12.0;   // Current high-speed express quad speed
    this.tramSpeed = 16.0;        // Fast aerial tramway speed
  }

  /**
   * Build a complete lift line between world points p1 and p2.
   * @param {THREE.Vector3} p1 - First station point
   * @param {THREE.Vector3} p2 - Second station point
   * @param {object|string} options - { type: 'chairlift' | 'quad' | 'tram' }
   */
  buildLine(p1, p2, options = {}) {
    const type = typeof options === 'string' ? options : (options.type || 'chairlift');
    const isTram = type === 'tram';
    const isQuad = type === 'quad';
    const lineGroup = new THREE.Group();
    
    // Always identify lower elevation as base, higher elevation as summit
    const isP1Lower = p1.y <= p2.y;
    const base = isP1Lower ? p1.clone() : p2.clone();
    const summit = isP1Lower ? p2.clone() : p1.clone();

    const dx = summit.x - base.x;
    const dz = summit.z - base.z;
    const horizontalLength = Math.sqrt(dx * dx + dz * dz);
    if (horizontalLength < 5) return; // Too short!

    // Flatten terrain pads under base and top stations
    const padRadius = isTram ? 16 : (isQuad ? 14 : 12);
    if (this.terrain && this.terrain.flattenPad) {
      this.terrain.flattenPad(base.x, base.z, padRadius);
      this.terrain.flattenPad(summit.x, summit.z, padRadius);
      base.y = this.terrain.getInterpolatedHeight(base.x, base.z);
      summit.y = this.terrain.getInterpolatedHeight(summit.x, summit.z);
    }

    // Direction unit vectors (u = uphill direction, v = perpendicular right-side direction)
    const ux = dx / horizontalLength;
    const uz = dz / horizontalLength;
    const vx = uz;
    const vz = -ux;

    // Standard Three.js yaw angles (atan2(dx, dz) where +Z is forward 0 rad)
    const yawUphill = Math.atan2(dx, dz);
    const yawDownhill = Math.atan2(-dx, -dz);

    // Determine tower spacing, clearance, and track width
    const towerSpacing = isTram ? 45 : (isQuad ? 32 : 28);
    const towerCount = Math.max(2, Math.floor(horizontalLength / towerSpacing));
    const step = 1.0 / towerCount;
    const clearance = isTram ? 11.0 : (isQuad ? 8.5 : 7.5);
    const minHeightAboveTerrain = isTram ? 4.5 : (isQuad ? 3.5 : 3.0);
    const trackOffset = isTram ? 1.6 : (isQuad ? 1.1 : 0.75);

    // Cable path arrays (from base index 0 to summit index towerCount)
    const cablePoints = [];

    for (let i = 0; i <= towerCount; i++) {
      const t = i * step;
      const tx = base.x + dx * t;
      const tz = base.z + dz * t;
      
      const { gx, gz } = this.terrain.worldToGrid(tx, tz);
      const h = this.terrain.getHeight(gx, gz);

      const idealH = THREE.MathUtils.lerp(base.y, summit.y, t) + clearance;
      const cableH = Math.max(idealH, h + minHeightAboveTerrain);

      cablePoints.push(new THREE.Vector3(tx, cableH, tz));

      const towerHeight = cableH - h;

      // Only place intermediate towers between stations
      if (i > 0 && i < towerCount) {
        if (isTram) {
          const towerObj = this._buildTramTower(towerHeight, trackOffset);
          towerObj.position.set(tx, h, tz);
          towerObj.rotation.y = yawUphill;
          lineGroup.add(towerObj);
        } else if (isQuad) {
          const towerObj = this._buildQuadTower(towerHeight, trackOffset);
          towerObj.position.set(tx, h, tz);
          towerObj.rotation.y = yawUphill;
          lineGroup.add(towerObj);
        } else {
          const towerGeo = new THREE.CylinderGeometry(0.1, 0.2, towerHeight, 4);
          towerGeo.translate(0, towerHeight / 2, 0);
          const towerMesh = new THREE.Mesh(towerGeo, this.matTower);
          towerMesh.position.set(tx, h, tz);
          towerMesh.castShadow = true;
          lineGroup.add(towerMesh);

          const crossbarGeo = new THREE.BoxGeometry(trackOffset * 2 + 0.4, 0.2, 0.2);
          const crossbar = new THREE.Mesh(crossbarGeo, this.matTower);
          crossbar.position.set(tx, cableH, tz);
          crossbar.rotation.y = yawUphill;
          crossbar.castShadow = true;
          lineGroup.add(crossbar);
        }
      }
    }

    // Build visual cables as a continuous closed loop
    const uphillCablePoints = cablePoints.map(p => new THREE.Vector3(p.x + vx * trackOffset, p.y + 0.1, p.z + vz * trackOffset));
    const downhillCablePoints = cablePoints.map(p => new THREE.Vector3(p.x - vx * trackOffset, p.y + 0.1, p.z - vz * trackOffset));

    const loopPoints = [...uphillCablePoints];
    const topPt = cablePoints[towerCount];
    const basePt = cablePoints[0];

    const arcSteps = 8;
    for (let k = 1; k < arcSteps; k++) {
      const th = (k / arcSteps) * Math.PI;
      const lx = topPt.x + (vx * Math.cos(th) + ux * Math.sin(th)) * trackOffset;
      const lz = topPt.z + (vz * Math.cos(th) + uz * Math.sin(th)) * trackOffset;
      loopPoints.push(new THREE.Vector3(lx, topPt.y + 0.1, lz));
    }
    for (let i = towerCount; i >= 0; i--) {
      loopPoints.push(downhillCablePoints[i]);
    }
    for (let k = 1; k < arcSteps; k++) {
      const th = (k / arcSteps) * Math.PI;
      const lx = basePt.x - (vx * Math.cos(th) + ux * Math.sin(th)) * trackOffset;
      const lz = basePt.z - (vz * Math.cos(th) + uz * Math.sin(th)) * trackOffset;
      loopPoints.push(new THREE.Vector3(lx, basePt.y + 0.1, lz));
    }
    loopPoints.push(uphillCablePoints[0].clone()); // Close loop

    const cableGeo = new THREE.BufferGeometry().setFromPoints(loopPoints);
    lineGroup.add(new THREE.Line(cableGeo, this.matCable));

    if (isTram) {
      const loopPoints2 = loopPoints.map(p => p.clone().add(new THREE.Vector3(0, 0.05, 0)));
      lineGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(loopPoints2), this.matCable));
    }

    // Measure actual 3D cable length along line
    let totalLength = 0;
    for (let i = 0; i < cablePoints.length - 1; i++) {
      totalLength += cablePoints[i].distanceTo(cablePoints[i+1]);
    }

    // Build Vehicles (Double Chairs, Quad Chairs, or Tram Cabins)
    const chairs = [];

    if (isTram) {
      const tram1 = this._buildTramCabin(this.matTramCabinBody1, '1');
      chairs.push({
        mesh: tram1,
        progress: 0.0,
        isTram: true,
        capacity: 12,
        passengers: [],
        passenger: null
      });
      lineGroup.add(tram1);

      const tram2 = this._buildTramCabin(this.matTramCabinBody2, '2');
      chairs.push({
        mesh: tram2,
        progress: 0.5,
        isTram: true,
        capacity: 12,
        passengers: [],
        passenger: null
      });
      lineGroup.add(tram2);
    } else if (isQuad) {
      const chairCount = Math.max(4, Math.floor(totalLength / 7));
      for (let i = 0; i < chairCount; i++) {
        const quadGrp = this._buildQuadChair();
        const progress = i / chairCount;
        chairs.push({
          mesh: quadGrp,
          progress: progress,
          isTram: false,
          isQuad: true,
          capacity: 4,
          passengers: [],
          passenger: null
        });
        lineGroup.add(quadGrp);
      }
    } else {
      const chairCount = Math.max(4, Math.floor(totalLength / 5));
      for (let i = 0; i < chairCount; i++) {
        const chairGrp = this._buildChair();
        const progress = i / chairCount;
        chairs.push({
          mesh: chairGrp,
          progress: progress,
          isTram: false,
          isQuad: false,
          capacity: 2,
          passengers: [],
          passenger: null
        });
        lineGroup.add(chairGrp);
      }
    }

    // Build Station Terminals at base and summit
    if (isTram) {
      const station1 = this._buildTramStation();
      station1.position.set(base.x, base.y, base.z);
      station1.rotation.y = yawUphill;
      lineGroup.add(station1);

      const station2 = this._buildTramStation();
      station2.position.set(summit.x, summit.y, summit.z);
      station2.rotation.y = yawUphill + Math.PI;
      lineGroup.add(station2);
    } else if (isQuad) {
      const station1 = this._buildQuadStation();
      station1.position.set(base.x, base.y, base.z);
      station1.rotation.y = yawUphill;
      lineGroup.add(station1);

      const station2 = this._buildQuadStation();
      station2.position.set(summit.x, summit.y, summit.z);
      station2.rotation.y = yawUphill + Math.PI;
      lineGroup.add(station2);
    } else {
      const station1 = this._buildStation();
      station1.position.set(base.x, base.y, base.z);
      station1.rotation.y = yawUphill;
      lineGroup.add(station1);

      const station2 = this._buildStation();
      station2.position.set(summit.x, summit.y, summit.z);
      station2.rotation.y = yawUphill + Math.PI;
      lineGroup.add(station2);
    }

    this.group.add(lineGroup);

    // Set appropriate line speed
    let speed = this.doubleChairSpeed;
    if (isTram) speed = this.tramSpeed;
    else if (isQuad) speed = this.quadChairSpeed;

    const lineData = {
      group: lineGroup,
      cablePoints,
      totalLength,
      chairs,
      dx, dz,
      ux, uz,
      vx, vz,
      yawUphill,
      yawDownhill,
      baseStation: base,
      summitStation: summit,
      p1: p1.clone(),
      p2: p2.clone(),
      type: type,
      trackOffset: trackOffset,
      speed: speed
    };

    this.lines.push(lineData);

    // Position all chairs immediately to prevent first-frame popping
    for (const chair of chairs) {
      const tform = this.getChairTransform(lineData, chair.progress);
      chair.mesh.position.set(tform.x, tform.y, tform.z);
      chair.mesh.rotation.y = tform.yaw;
    }
  }

  /**
   * Get smooth, continuous 3D world position and yaw rotation for a chair along the lift loop.
   * @param {object} line 
   * @param {number} progress in [0, 1)
   */
  getChairTransform(line, progress) {
    let p = progress % 1.0;
    if (p < 0) p += 1.0;

    const cablePoints = line.cablePoints;
    const segmentCount = cablePoints.length - 1;
    const trackOffset = line.trackOffset || 0.75;
    const vx = line.vx;
    const vz = line.vz;
    const ux = line.ux;
    const uz = line.uz;
    const yawUphill = line.yawUphill;
    const isTram = line.type === 'tram';
    const yLift = isTram ? 0.0 : 0.1;

    let x, y, z, yaw;

    if (p < 0.48) {
      // 1. Uphill Track (progress 0.0 -> 0.48)
      const u = p / 0.48; // 0 to 1
      const segT = u * segmentCount;
      const idx = Math.min(Math.floor(segT), segmentCount - 1);
      const frac = segT - idx;
      const pA = cablePoints[idx];
      const pB = cablePoints[idx + 1];

      x = THREE.MathUtils.lerp(pA.x, pB.x, frac) + vx * trackOffset;
      y = THREE.MathUtils.lerp(pA.y, pB.y, frac) + yLift;
      z = THREE.MathUtils.lerp(pA.z, pB.z, frac) + vz * trackOffset;
      yaw = yawUphill;
    } else if (p < 0.52) {
      // 2. Summit Bullwheel Loop (progress 0.48 -> 0.52)
      const u = (p - 0.48) / 0.04; // 0 to 1
      const theta = u * Math.PI; // 0 to PI
      const summitPt = cablePoints[segmentCount];

      x = summitPt.x + (vx * Math.cos(theta) + ux * Math.sin(theta)) * trackOffset;
      y = summitPt.y + yLift;
      z = summitPt.z + (vz * Math.cos(theta) + uz * Math.sin(theta)) * trackOffset;
      yaw = yawUphill + theta;
    } else if (p < 0.96) {
      // 3. Downhill Return Track (progress 0.52 -> 0.96)
      const u = (p - 0.52) / 0.44; // 0 to 1
      const segT = (1.0 - u) * segmentCount;
      const idx = Math.min(Math.floor(segT), segmentCount - 1);
      const frac = segT - idx;
      const pA = cablePoints[idx];
      const pB = cablePoints[idx + 1];

      x = THREE.MathUtils.lerp(pA.x, pB.x, frac) - vx * trackOffset;
      y = THREE.MathUtils.lerp(pA.y, pB.y, frac) + yLift;
      z = THREE.MathUtils.lerp(pA.z, pB.z, frac) - vz * trackOffset;
      yaw = yawUphill + Math.PI;
    } else {
      // 4. Base Bullwheel Loop (progress 0.96 -> 1.00)
      const u = (p - 0.96) / 0.04; // 0 to 1
      const theta = u * Math.PI; // 0 to PI
      const basePt = cablePoints[0];

      x = basePt.x - (vx * Math.cos(theta) + ux * Math.sin(theta)) * trackOffset;
      y = basePt.y + yLift;
      z = basePt.z - (vz * Math.cos(theta) + uz * Math.sin(theta)) * trackOffset;
      yaw = yawUphill + Math.PI + theta;
    }

    return { x, y, z, yaw };
  }

  update(dt) {
    for (const line of this.lines) {
      const lineSpeed = line.speed || (line.type === 'tram' ? this.tramSpeed : this.doubleChairSpeed);
      const progressSpeed = lineSpeed / (line.totalLength * 2);

      for (const chair of line.chairs) {
        chair.progress += progressSpeed * dt;
        if (chair.progress >= 1.0) chair.progress -= 1.0;

        const tform = this.getChairTransform(line, chair.progress);
        chair.mesh.position.set(tform.x, tform.y, tform.z);
        chair.mesh.rotation.y = tform.yaw;
      }
    }
  }

  clear() {
    for (const line of this.lines) {
      this.group.remove(line.group);
      line.group.traverse(c => {
        if (c.geometry) c.geometry.dispose();
      });
    }
    this.lines = [];
  }

  /** Remove any lift whose endpoint (or cable path) is within world radius of (wx, wz) */
  removeNear(wx, wz, radius) {
    const toRemove = [];
    for (const line of this.lines) {
      const d1 = Math.sqrt((line.p1.x - wx) ** 2 + (line.p1.z - wz) ** 2);
      const d2 = Math.sqrt((line.p2.x - wx) ** 2 + (line.p2.z - wz) ** 2);
      // Also check any cable point along the line
      const nearCable = line.cablePoints.some(p => {
        const d = Math.sqrt((p.x - wx) ** 2 + (p.z - wz) ** 2);
        return d < radius;
      });
      if (d1 < radius || d2 < radius || nearCable) {
        toRemove.push(line);
      }
    }
    for (const line of toRemove) {
      this.group.remove(line.group);
      line.group.traverse(c => { if (c.geometry) c.geometry.dispose(); });
      this.lines.splice(this.lines.indexOf(line), 1);
    }
  }

  /* ----------------------------------------------------
   * CLASSIC DOUBLE CHAIRLIFT GEOMETRY BUILDERS
   * ---------------------------------------------------- */
  _buildChair() {
    const g = new THREE.Group();
    
    // Hanger pole
    const poleObj = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 4), this.matDoublePole);
    poleObj.position.y = -1.0;
    g.add(poleObj);

    // Bench
    const benchGeo = new THREE.BoxGeometry(1.5, 0.18, 0.6);
    const bench = new THREE.Mesh(benchGeo, this.matDoubleChair);
    bench.position.set(0, -2.0, 0);
    g.add(bench);

    // Backrest
    const backGeo = new THREE.BoxGeometry(1.5, 0.55, 0.1);
    const back = new THREE.Mesh(backGeo, this.matDoubleChair);
    back.position.set(0, -1.65, -0.25);
    g.add(back);

    // Safety Bar
    const barGeo = new THREE.BoxGeometry(1.5, 0.06, 0.06);
    const bar = new THREE.Mesh(barGeo, this.matDoublePole);
    bar.position.set(0, -1.8, 0.28);
    g.add(bar);

    g.scale.setScalar(0.42); // Classic double chair scale
    g.castShadow = true;
    return g;
  }

  _buildStation() {
    const g = new THREE.Group();
    
    // Main cabin block
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });
    
    // Cabin base
    const baseGeo = new THREE.BoxGeometry(4, 3, 3);
    baseGeo.translate(0, 1.5, 0);
    const base = new THREE.Mesh(baseGeo, cabinMat);
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // Awning/roof
    const roofGeo = new THREE.BoxGeometry(4.4, 0.4, 4);
    roofGeo.translate(0, 3.2, 0);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.castShadow = true;
    g.add(roof);

    // Opening
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1.0 });
    const doorGeo = new THREE.BoxGeometry(2.4, 2.0, 3.1);
    doorGeo.translate(0, 1.0, 0);
    const door = new THREE.Mesh(doorGeo, doorMat);
    g.add(door);

    g.scale.setScalar(0.7);
    return g;
  }

  /* ----------------------------------------------------
   * HIGH-SPEED QUAD CHAIRLIFT GEOMETRY BUILDERS
   * ---------------------------------------------------- */
  _buildQuadTower(towerHeight, trackOffset) {
    const g = new THREE.Group();

    // Central tubular steel tower
    const towerGeo = new THREE.CylinderGeometry(0.18, 0.32, towerHeight, 8);
    towerGeo.translate(0, towerHeight / 2, 0);
    const towerMesh = new THREE.Mesh(towerGeo, this.matQuadTower);
    towerMesh.castShadow = true;
    g.add(towerMesh);

    // Wide T-Bar / Crosshead
    const crossarmWidth = trackOffset * 2 + 1.2;
    const crossarmGeo = new THREE.BoxGeometry(crossarmWidth, 0.3, 0.35);
    const crossarm = new THREE.Mesh(crossarmGeo, this.matQuadTower);
    crossarm.position.set(0, towerHeight, 0);
    crossarm.castShadow = true;
    g.add(crossarm);

    // Sheave battery assemblies (4 yellow wheels on each side)
    [-trackOffset, trackOffset].forEach(sideX => {
      const beamGeo = new THREE.BoxGeometry(0.2, 0.15, 1.2);
      const beam = new THREE.Mesh(beamGeo, this.matQuadTower);
      beam.position.set(sideX, towerHeight + 0.1, 0);
      g.add(beam);

      [-0.45, -0.15, 0.15, 0.45].forEach(zOffset => {
        const wheelGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.06, 8);
        wheelGeo.rotateZ(Math.PI / 2);
        const wheel = new THREE.Mesh(wheelGeo, this.matTramSheave);
        wheel.position.set(sideX, towerHeight + 0.18, zOffset);
        g.add(wheel);
      });
    });

    return g;
  }

  _buildQuadChair() {
    const g = new THREE.Group();

    // 1. Detachable cable grip clamp
    const gripGeo = new THREE.BoxGeometry(0.2, 0.15, 0.35);
    const grip = new THREE.Mesh(gripGeo, this.matQuadFrame);
    grip.position.set(0, 0, 0);
    g.add(grip);

    // 2. Arching steel hanger arm
    const armGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.8, 6);
    const arm = new THREE.Mesh(armGeo, this.matQuadFrame);
    arm.position.set(0, -0.9, 0);
    g.add(arm);

    // 3. Wide 4-seater bench frame
    const frameGeo = new THREE.BoxGeometry(2.3, 0.12, 0.7);
    const frame = new THREE.Mesh(frameGeo, this.matQuadFrame);
    frame.position.set(0, -1.8, 0);
    g.add(frame);

    // 4 individual contoured blue seat cushions
    [-0.84, -0.28, 0.28, 0.84].forEach(x => {
      const seatGeo = new THREE.BoxGeometry(0.5, 0.12, 0.6);
      const seat = new THREE.Mesh(seatGeo, this.matQuadCushion);
      seat.position.set(x, -1.74, 0.02);
      g.add(seat);

      // Backrest cushion
      const backGeo = new THREE.BoxGeometry(0.5, 0.55, 0.1);
      const back = new THREE.Mesh(backGeo, this.matQuadCushion);
      back.position.set(x, -1.45, -0.28);
      g.add(back);

      // Footrest hanger
      const footrestGeo = new THREE.BoxGeometry(0.4, 0.05, 0.2);
      const footrest = new THREE.Mesh(footrestGeo, this.matQuadBar);
      footrest.position.set(x, -2.1, 0.28);
      g.add(footrest);
    });

    // Safety pull-down bar
    const barGeo = new THREE.BoxGeometry(2.35, 0.06, 0.06);
    const bar = new THREE.Mesh(barGeo, this.matQuadBar);
    bar.position.set(0, -1.6, 0.32);
    g.add(bar);

    g.scale.setScalar(0.45); // Quad chairlift scale
    g.castShadow = true;
    return g;
  }

  _buildQuadStation() {
    const g = new THREE.Group();

    // Modern Terminal Platform
    const dockGeo = new THREE.BoxGeometry(5.2, 1.0, 6.8);
    dockGeo.translate(0, 0.5, 0);
    const dock = new THREE.Mesh(dockGeo, this.matQuadFrame);
    dock.castShadow = true;
    dock.receiveShadow = true;
    g.add(dock);

    // Aerodynamic Curved Express Enclosure Canopy
    const canopyGeo = new THREE.BoxGeometry(4.8, 3.2, 5.8);
    canopyGeo.translate(0, 2.5, -0.4);
    const canopy = new THREE.Mesh(canopyGeo, this.matQuadStationCover);
    canopy.castShadow = true;
    g.add(canopy);

    // Express White Trim on station roof
    const trimGeo = new THREE.BoxGeometry(5.0, 0.2, 6.0);
    trimGeo.translate(0, 4.15, -0.4);
    const trim = new THREE.Mesh(trimGeo, this.matQuadStationTrim);
    g.add(trim);

    // Internal Bullwheel
    const bullwheelGeo = new THREE.CylinderGeometry(1.4, 1.4, 0.25, 16);
    const bullwheel = new THREE.Mesh(bullwheelGeo, this.matTramSheave);
    bullwheel.position.set(0, 3.2, -0.6);
    g.add(bullwheel);

    // Open entrance for chairs
    const bayMat = new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.9 });
    const bayGeo = new THREE.BoxGeometry(3.6, 2.4, 3.2);
    bayGeo.translate(0, 1.8, 1.5);
    const bay = new THREE.Mesh(bayGeo, bayMat);
    g.add(bay);

    g.scale.setScalar(0.72);
    return g;
  }

  /* ----------------------------------------------------
   * AERIAL TRAM GEOMETRY BUILDERS
   * ---------------------------------------------------- */
  _buildTramTower(towerHeight, trackOffset) {
    const g = new THREE.Group();

    // Dual tapered steel legs (A-frame structure)
    const legRadiusTop = 0.18;
    const legRadiusBottom = 0.4;
    const legGeoLeft = new THREE.CylinderGeometry(legRadiusTop, legRadiusBottom, towerHeight, 6);
    legGeoLeft.translate(0, towerHeight / 2, 0);
    
    const legLeft = new THREE.Mesh(legGeoLeft, this.matTramTower);
    legLeft.position.x = -0.7;
    legLeft.rotation.z = -0.04;
    legLeft.castShadow = true;
    g.add(legLeft);

    const legRight = legLeft.clone();
    legRight.position.x = 0.7;
    legRight.rotation.z = 0.04;
    g.add(legRight);

    // Lattice cross braces
    const braceCount = Math.max(1, Math.floor(towerHeight / 4));
    for (let b = 1; b <= braceCount; b++) {
      const bh = (b / (braceCount + 1)) * towerHeight;
      const braceWidth = THREE.MathUtils.lerp(1.4, 0.8, b / (braceCount + 1));
      const braceGeo = new THREE.BoxGeometry(braceWidth, 0.15, 0.15);
      const brace = new THREE.Mesh(braceGeo, this.matTramTower);
      brace.position.set(0, bh, 0);
      g.add(brace);
    }

    // Heavy crossarm head at tower top
    const crossarmWidth = trackOffset * 2 + 1.6;
    const crossarmGeo = new THREE.BoxGeometry(crossarmWidth, 0.4, 0.5);
    const crossarm = new THREE.Mesh(crossarmGeo, this.matTramCrossbar);
    crossarm.position.set(0, towerHeight, 0);
    crossarm.castShadow = true;
    g.add(crossarm);

    // Cable guide saddles & yellow roller sheaves on both sides
    [-trackOffset, trackOffset].forEach(sideX => {
      // Saddle mount
      const saddleGeo = new THREE.BoxGeometry(0.5, 0.25, 0.8);
      const saddle = new THREE.Mesh(saddleGeo, this.matTramCrossbar);
      saddle.position.set(sideX, towerHeight + 0.2, 0);
      g.add(saddle);

      // Yellow pulley wheels
      const wheelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.1, 8);
      wheelGeo.rotateZ(Math.PI / 2);
      const wheel1 = new THREE.Mesh(wheelGeo, this.matTramSheave);
      wheel1.position.set(sideX, towerHeight + 0.3, -0.25);
      g.add(wheel1);

      const wheel2 = wheel1.clone();
      wheel2.position.set(sideX, towerHeight + 0.3, 0.25);
      g.add(wheel2);
    });

    return g;
  }

  _buildTramCabin(bodyMat, carNumber = '1') {
    const g = new THREE.Group();

    // 1. Top Carriage / Trolley (connects directly to overhead cable)
    const trolleyGeo = new THREE.BoxGeometry(0.3, 0.15, 1.4);
    const trolley = new THREE.Mesh(trolleyGeo, this.matTramHanger);
    trolley.position.set(0, 0, 0);
    g.add(trolley);

    // 4 Trolley wheels rolling on track cable
    const wheelGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8);
    wheelGeo.rotateZ(Math.PI / 2);
    [-0.45, -0.15, 0.15, 0.45].forEach(zOffset => {
      const w = new THREE.Mesh(wheelGeo, this.matTramSheave);
      w.position.set(0, 0.08, zOffset);
      g.add(w);
    });

    // 2. Heavy-duty Arching Suspension Hanger Arm
    const armGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.2, 8);
    const arm = new THREE.Mesh(armGeo, this.matTramHanger);
    arm.position.set(0, -1.0, 0);
    g.add(arm);

    // Suspension pivot hub
    const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.3, 8);
    hubGeo.rotateX(Math.PI / 2);
    const hub = new THREE.Mesh(hubGeo, this.matTramHanger);
    hub.position.set(0, -2.0, 0);
    g.add(hub);

    // 3. Cabin Group (Sits below suspension arm)
    const cabin = new THREE.Group();
    cabin.position.set(0, -2.1, 0);

    // Cabin Main Dimensions: 1.8 wide, 1.9 high, 3.2 long
    // Lower body (Colored alpine livery)
    const lowerBodyGeo = new THREE.BoxGeometry(1.8, 0.9, 3.2);
    lowerBodyGeo.translate(0, -0.9, 0);
    const lowerBody = new THREE.Mesh(lowerBodyGeo, bodyMat);
    lowerBody.castShadow = true;
    cabin.add(lowerBody);

    // Panoramic Window Section (Glass wrap-around)
    const glassGeo = new THREE.BoxGeometry(1.76, 0.95, 3.16);
    glassGeo.translate(0, 0, 0);
    const glass = new THREE.Mesh(glassGeo, this.matTramGlass);
    cabin.add(glass);

    // Cabin Pillars & Window Frames
    const pillarMat = this.matTramHanger;
    [-0.88, 0.88].forEach(px => {
      [-1.55, -0.5, 0.5, 1.55].forEach(pz => {
        const pillarGeo = new THREE.BoxGeometry(0.08, 0.95, 0.08);
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.set(px, 0, pz);
        cabin.add(pillar);
      });
    });

    // Aerodynamic White/Silver Roof with rounded bevels
    const roofGeo = new THREE.BoxGeometry(1.86, 0.22, 3.26);
    roofGeo.translate(0, 0.55, 0);
    const roof = new THREE.Mesh(roofGeo, this.matTramRoof);
    roof.castShadow = true;
    cabin.add(roof);

    // Roof equipment / HVAC housing
    const hvacGeo = new THREE.BoxGeometry(0.8, 0.15, 1.2);
    const hvac = new THREE.Mesh(hvacGeo, this.matTramHanger);
    hvac.position.set(0, 0.7, 0);
    cabin.add(hvac);

    // Yellow / Gold safety bumper strip around base
    const bumperGeo = new THREE.BoxGeometry(1.84, 0.1, 3.24);
    bumperGeo.translate(0, -1.35, 0);
    const bumper = new THREE.Mesh(bumperGeo, this.matTramStationAccent);
    cabin.add(bumper);

    // Exterior Ski Racks on both sides
    [-0.95, 0.95].forEach(sideX => {
      const rackGeo = new THREE.BoxGeometry(0.12, 0.5, 1.8);
      const rack = new THREE.Mesh(rackGeo, this.matTramHanger);
      rack.position.set(sideX, -0.9, 0);
      cabin.add(rack);
    });

    g.add(cabin);

    // Scale to fit the world terrain nicely while maintaining authentic grand tram presence
    g.scale.setScalar(0.75);
    g.castShadow = true;
    return g;
  }

  _buildTramStation() {
    const g = new THREE.Group();

    // Concrete Base / Platform Dock
    const dockGeo = new THREE.BoxGeometry(6.5, 1.2, 7.5);
    dockGeo.translate(0, 0.6, 0);
    const dock = new THREE.Mesh(dockGeo, this.matTramStationBase);
    dock.castShadow = true;
    dock.receiveShadow = true;
    g.add(dock);

    // Modern Terminal Main Building Enclosure
    const bldgGeo = new THREE.BoxGeometry(6.2, 4.2, 4.0);
    bldgGeo.translate(0, 2.7, -1.6);
    const bldg = new THREE.Mesh(bldgGeo, this.matTramStationRoof);
    bldg.castShadow = true;
    bldg.receiveShadow = true;
    g.add(bldg);

    // Cantilever Alpine Overhanging Roof with golden fascia
    const roofGeo = new THREE.BoxGeometry(7.0, 0.4, 8.2);
    roofGeo.translate(0, 5.0, 0.2);
    const roof = new THREE.Mesh(roofGeo, this.matTramStationRoof);
    roof.castShadow = true;
    g.add(roof);

    const fasciaGeo = new THREE.BoxGeometry(7.1, 0.15, 8.3);
    fasciaGeo.translate(0, 4.95, 0.2);
    const fascia = new THREE.Mesh(fasciaGeo, this.matTramStationAccent);
    g.add(fascia);

    // Huge Bullwheel / Cable Return Wheel inside station
    const bullwheelGeo = new THREE.CylinderGeometry(1.6, 1.6, 0.3, 16);
    const bullwheel = new THREE.Mesh(bullwheelGeo, this.matTramStationAccent);
    bullwheel.position.set(0, 3.8, -1.2);
    g.add(bullwheel);

    // Dual Open Docking Bays for the 2 Tram Cabins
    const openBayMat = new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.9 });
    const bayGeo = new THREE.BoxGeometry(4.8, 3.2, 3.8);
    bayGeo.translate(0, 2.4, 1.8);
    const bay = new THREE.Mesh(bayGeo, openBayMat);
    g.add(bay);

    // Steel support pillars at terminal entrance
    [-2.8, 2.8].forEach(px => {
      const pGeo = new THREE.CylinderGeometry(0.18, 0.18, 4.4, 6);
      pGeo.translate(0, 2.8, 0);
      const pillar = new THREE.Mesh(pGeo, this.matTramTower);
      pillar.position.set(px, 0, 3.8);
      g.add(pillar);
    });

    g.scale.setScalar(0.75);
    return g;
  }
}
