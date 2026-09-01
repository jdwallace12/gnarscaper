import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Skier entity that follows the steepest downhill gradient on the terrain.
 * Builds a tiny low-poly stick figure with skis, optimized with InstancedMesh.
 */

const MAX_SKIERS = 2000;

const PARACHUTE_COLORS = [
  0xef233c, // Red
  0x06b6d4, // Cyan
  0xfbbf24, // Yellow
  0xa855f7, // Purple
  0x22c55e, // Green
  0xf97316, // Orange
  0xec4899, // Pink
  0x3b82f6  // Blue
];

export class Skiers {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.skiers = []; // { mesh, wx, wz, vx, vz, active, trail }
    this._chairlifts = null; // cached reference for attraction forces
    this._tmpColor = new THREE.Color();

    // Shared materials across all skiers to reduce GPU state changes
    this._bodyMat = new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.6 });
    this._pantsMat = new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.7 });
    this._skinMat = new THREE.MeshStandardMaterial({ color: 0xf4d4b0, roughness: 0.8 });
    this._skiMat = new THREE.MeshStandardMaterial({ color: 0xffa500, roughness: 0.3, metalness: 0.2 });

    this.materials = [
      this._bodyMat, // 0 torso
      this._skinMat, // 1 head
      this._pantsMat, // 2 leg
      this._pantsMat, // 3 leg
      this._skiMat,  // 4 ski
      this._skiMat,  // 5 ski
      this._skiMat,  // 6 pole
      this._skiMat   // 7 pole
    ];

    this.mergedGeo = this._buildSkierGeo();
    this.skierIM = new THREE.InstancedMesh(this.mergedGeo, this.materials, MAX_SKIERS);
    this.skierIM.castShadow = true;
    this.skierIM.frustumCulled = false;
    this.skierIM.count = 0;
    this.group.add(this.skierIM);

    // Spatial hash for efficient repulsion
    this._spatialHash = new Map();
    this._gridSize = 20.0;

    // Track map to allow skiers to seek fresh snow
    this.trackMap = new Uint8Array(terrain.resolution * terrain.resolution);
    
    // Shared snow powder particle pool for all NPCs
    this._snowMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      roughness: 1.0,
      metalness: 0.0,
    });
    this._snowGeo = new THREE.IcosahedronGeometry(0.3, 0);
    this._snowPool = [];
    this._snowPoolSize = 600;
    this._trailsVisible = true;
  }

  _buildParachute(colorHex) {
    const chuteGroup = new THREE.Group();
    const chuteMat = new THREE.MeshStandardMaterial({ 
      color: colorHex, 
      roughness: 0.7, 
      side: THREE.DoubleSide 
    });
    
    // Canopy geometry
    const chuteMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.4),
      chuteMat
    );
    chuteMesh.scale.set(1.5, 0.5, 0.6);
    chuteMesh.position.y = 1.8;
    chuteGroup.add(chuteMesh);

    // Strings
    const stringMat = new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.7 });
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const rimRadius = 1.2 * Math.sin(Math.PI * 0.4);
      const px = Math.cos(angle) * rimRadius * 1.5;
      const pz = Math.sin(angle) * rimRadius * 0.6;
      const py = 1.8 + (1.2 * Math.cos(Math.PI * 0.4) * 0.5);

      const points = [
        new THREE.Vector3(0, 0.2, 0),
        new THREE.Vector3(px, py, pz)
      ];
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const string = new THREE.Line(lineGeo, stringMat);
      chuteGroup.add(string);
    }

    chuteGroup.visible = false;
    this.group.add(chuteGroup);
    return chuteGroup;
  }

  _updateSpatialHash() {
    this._spatialHash.clear();
    for (const s of this.skiers) {
      if (!s.active || s.state !== 'skiing') continue;
      const gx = Math.floor(s.wx / this._gridSize);
      const gz = Math.floor(s.wz / this._gridSize);
      const key = `${gx},${gz}`;
      if (!this._spatialHash.has(key)) this._spatialHash.set(key, []);
      this._spatialHash.get(key).push(s);
    }
  }

  /** Drop a new skier at world position (wx, wz) */
  spawn(wx, wz) {
    if (this.skiers.length >= MAX_SKIERS) return;

    const h = this.terrain.getInterpolatedHeight(wx, wz);

    const mesh = new THREE.Object3D();
    mesh.scale.setScalar(0.7);
    mesh.position.set(wx, h + 0.15, wz);

    // Parachute
    const chuteColor = PARACHUTE_COLORS[Math.floor(Math.random() * PARACHUTE_COLORS.length)];
    const chuteGroup = this._buildParachute(chuteColor);

    // Trail line (ski tracks)
    const trailMat = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.9 });
    const trailGeo = new THREE.BufferGeometry();
    const trailPositions = new Float32Array(2000 * 3); // max 2000 trail points
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeo.setDrawRange(0, 0);
    const trail = new THREE.Line(trailGeo, trailMat);
    this.group.add(trail);

    this.skiers.push({
      mesh,
      chuteGroup,
      paragliding: false,
      wx, wz,
      vx: 0, vz: 0,
      active: true,
      trail,
      trailPoints: [],
      speed: 0,
      timeAlive: 0,
      state: 'skiing',
      grounded: true,
      y: h,
      vy: 0,
      targetStation: null,
      targetLine: null,
      chair: null,
      carvePhase: Math.random() * Math.PI * 2, // unique carve offset so skiers don't turn in sync
      traverseTimeLeft: 0,
      traverseDir: 1,
    });
  }

  /** Update all skiers — call each frame with deltaTime, water, and chairlifts ref */
  update(dt, water, chairlifts, isSnowing = false, activeClouds = null) {
    const gravity = 8.0; // Reduced from 10.0 for slower overall acceleration
    const friction = 0.97; // Increased base drag (was 0.98)
    const minSpeed = 0.001;
    this._chairlifts = chairlifts;
    const seaLevel = water ? water.seaLevel : -1;
    const res = this.terrain.resolution;
    const size = this.terrain.size;
    const half = size / 2;

    // Decay the track map over time to represent snow refilling or tracks fading
    // We decay a random subset of cells to amortize the cost across frames
    const decayCount = Math.floor(this.trackMap.length / 30);
    for (let i = 0; i < decayCount; i++) {
       const idx = Math.floor(Math.random() * this.trackMap.length);
       if (this.trackMap[idx] > 0) this.trackMap[idx]--;
    }

    this._updateSpatialHash();

    for (const s of this.skiers) {
      if (s.trailStartIndex === undefined) s.trailStartIndex = 0;

      // Trail Fading/Overwriting
      let fadePointsCount = isSnowing ? 6 : 0; // If snowing everywhere, remove old tracks rapidly
      
      // Advance start index if we exceed max points
      if (s.active && (s.trailPoints.length - s.trailStartIndex) >= 2000 * 3) {
        s.trailStartIndex += 3;
      }
      
      if (fadePointsCount > 0 && (s.trailPoints.length - s.trailStartIndex) > 0) {
        s.trailStartIndex += Math.min(fadePointsCount, s.trailPoints.length - s.trailStartIndex);
      }

      let activeLength = s.trailPoints.length - s.trailStartIndex;
      
      // Amortize garbage collection by periodically dumping old points from memory
      if (s.trailStartIndex > 3000 * 3) {
        s.trailPoints = s.trailPoints.slice(s.trailStartIndex);
        s.trailStartIndex = 0;
      }

      // Update trail geometry buffer for active and inactive (if they still have tracks fading)
      if (activeLength > 0 || isSnowing || (activeClouds && activeClouds.group.visible)) {
         const posAttr = s.trail.geometry.attributes.position;
         for (let j = 0; j < activeLength; j += 3) {
            const idx = s.trailStartIndex + j;
            
            // If under localized cloud shadows, tracks slowly sink into the terrain to simulate being snowed over
            if (activeClouds && activeClouds.group.visible && activeClouds.isUnderCloud(s.trailPoints[idx], s.trailPoints[idx+2])) {
               const h = this.terrain.getInterpolatedHeight(s.trailPoints[idx], s.trailPoints[idx+2]);
               if (s.trailPoints[idx+1] > h - 0.2) {
                  s.trailPoints[idx+1] -= dt * 0.4; // Sinks roughly 0.4 world units per second
               }
            }
            
            posAttr.array[j] = s.trailPoints[idx];
            posAttr.array[j+1] = s.trailPoints[idx+1];
            posAttr.array[j+2] = s.trailPoints[idx+2];
         }
         posAttr.needsUpdate = true;
         s.trail.geometry.setDrawRange(0, activeLength / 3);
      }

      if (!s.active) continue;

      // Walking, waiting, and riding states handle their own logic
      // Grid boundary check only applies to actively skiing
      if (s.state === 'walking') {
        s.paragliding = false;
        if (s.chuteGroup) s.chuteGroup.visible = false;
        const dx = s.targetStation.x - s.wx;
        const dz = s.targetStation.z - s.wz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist < 4.0) {
          s.state = 'waiting';
          s.mesh.visible = false; // Hide inside the base station building!
        } else {
          s.wx += (dx / dist) * dt * 8.0; // Walk speed
          s.wz += (dz / dist) * dt * 8.0;
          const { gx: wgx, gz: wgz } = this.terrain.worldToGrid(s.wx, s.wz);
          const newH = this.terrain.getHeight(wgx, wgz);
          s.mesh.position.set(s.wx, newH + 0.15, s.wz);
          s.mesh.rotation.y = Math.atan2(dx, dz);
        }
        continue;
      }

      if (s.state === 'waiting') {
        s.paragliding = false;
        if (s.chuteGroup) s.chuteGroup.visible = false;
        
        // Determine if targetStation is p1 or p2
        const isP1Base = (s.targetStation === s.targetLine.p1);
        let bestChair = null;
        let bestDiff = s.targetLine.type === 'tram' ? 0.12 : 0.08;
        
        for (const chair of s.targetLine.chairs) {
           const maxCap = chair.capacity || 1;
           const currentCount = chair.passengers ? chair.passengers.length : (chair.passenger ? 1 : 0);
           if (currentCount >= maxCap) continue;
           
           if (isP1Base) {
             // Upward direction from p1 is progress 0.0 -> 0.5 (or arriving at 0.98)
             const pVal = (chair.progress >= 0.98) ? 0 : chair.progress;
             if ((chair.progress >= 0.0 && chair.progress <= 0.09) || chair.progress >= 0.98) {
               if (pVal < bestDiff) {
                 bestDiff = pVal;
                 bestChair = chair;
               }
             }
           } else {
             // Upward direction from p2 is progress 0.5 -> 1.0
             if (chair.progress >= 0.50 && chair.progress <= 0.59) {
               const diff = chair.progress - 0.50;
               if (diff < bestDiff) {
                 bestDiff = diff;
                 bestChair = chair;
               }
             }
           }
        }
        
        if (bestChair) {
           if (!bestChair.passengers) bestChair.passengers = [];
           bestChair.passengers.push(s);
           bestChair.passenger = s;
           s.seatIdx = bestChair.passengers.length - 1;
           s.chair = bestChair;
           s.state = 'riding';
           s.mesh.visible = true;
        }
        continue;
      }

      if (s.state === 'riding') {
         s.paragliding = false;
         if (s.chuteGroup) s.chuteGroup.visible = false;
         const p = s.chair.mesh.position;
         const chairAngle = s.chair.mesh.rotation.y;
         const isTram = (s.targetLine && s.targetLine.type === 'tram');
         const isQuad = (s.targetLine && s.targetLine.type === 'quad');

         let xOffset = 0;
         let zOffset = 0;
         let yOffset = -0.5;

         if (isTram) {
           yOffset = -1.8;
           const seat = (s.seatIdx || 0) % 6;
           xOffset = ((seat % 2) - 0.5) * 0.7;
           zOffset = (Math.floor(seat / 2) - 1.0) * 0.6;
         } else if (isQuad) {
           yOffset = -0.52;
           const lateralOffset = ((s.seatIdx || 0) - 1.5) * 0.38;
           // Align perpendicular to chair travel direction
           xOffset = Math.cos(chairAngle + Math.PI / 2) * lateralOffset;
           zOffset = Math.sin(chairAngle + Math.PI / 2) * lateralOffset;
         } else {
           // Double chair
           yOffset = -0.5;
           const lateralOffset = ((s.seatIdx || 0) - 0.5) * 0.35;
           xOffset = Math.cos(chairAngle + Math.PI / 2) * lateralOffset;
           zOffset = Math.sin(chairAngle + Math.PI / 2) * lateralOffset;
         }

         // sit or stand — keep wx/wz in sync with vehicle
         s.wx = p.x + xOffset;
         s.wz = p.z + zOffset;
         s.mesh.position.set(s.wx, p.y + yOffset, s.wz);
         s.mesh.rotation.y = isTram ? chairAngle : (chairAngle + Math.PI / 2);
         s.mesh.scale.setScalar(isTram ? 0.7 : 0.9);

         const isP1Base = (s.targetStation === s.targetLine.p1);
         let reachedTop = false;

         if (isP1Base) {
           if (s.chair.progress >= 0.46 && s.chair.progress <= 0.53) {
             reachedTop = true;
           }
         } else {
           if (s.chair.progress >= 0.96 || s.chair.progress <= 0.03) {
             reachedTop = true;
           }
         }
         
         if (reachedTop) { 
            if (s.chair.passengers) {
              const idx = s.chair.passengers.indexOf(s);
              if (idx !== -1) s.chair.passengers.splice(idx, 1);
            }
            if (s.chair.passenger === s) {
              s.chair.passenger = (s.chair.passengers && s.chair.passengers.length > 0) ? s.chair.passengers[0] : null;
            }
            s.chair = null;
            s.state = 'skiing';
            
            s.wx = s.mesh.position.x;
            s.wz = s.mesh.position.z;
            s.vx = 0;
            s.vz = 0;
            s.speed = 0;
            s.trailPoints = [];
            s.trailStartIndex = 0;
            s.trail.geometry.setDrawRange(0, 0);

            // Randomly choose left or right (-1 or 1)
            const sideOffset = Math.random() < 0.5 ? 1 : -1;
            const pushAngle = chairAngle + sideOffset * 1.0; // Angled to the side (~60 degrees)

            // push off
            s.wx += Math.cos(pushAngle) * 3;
            s.wz -= Math.sin(pushAngle) * 3;
            
            // Give them a slight initial velocity in that direction
            s.vx = Math.cos(pushAngle) * 4;
            s.vz = -Math.sin(pushAngle) * 4;

            // Start skiing straight, they will only traverse if they get too close to others
            s.traverseTimeLeft = 0; 
            s.traverseDir = sideOffset;
            
            s.mesh.scale.setScalar(0.7); // Scale back to normal
         }
         continue;
      }

      if (s.state === 'paraglide_respawn') {
        const target = s.respawnTarget;
        if (!target) { s.state = 'skiing'; continue; }

        const dx = target.x - s.wx;
        const dz = target.z - s.wz;
        const horizDist = Math.sqrt(dx * dx + dz * dz);

        // Steer toward target
        const targetHeading = Math.atan2(dx, dz);
        if (s.glideHeading === undefined) s.glideHeading = targetHeading;
        let hDiff = targetHeading - s.glideHeading;
        while (hDiff < -Math.PI) hDiff += Math.PI * 2;
        while (hDiff > Math.PI) hDiff -= Math.PI * 2;
        s.glideHeading += hDiff * 2.0 * dt; // Smooth turn toward target

        const glideSpeed = 11.5;
        s.vx = Math.sin(s.glideHeading) * glideSpeed;
        s.vz = Math.cos(s.glideHeading) * glideSpeed;
        s.speed = glideSpeed;

        // Gentle sink rate
        s.vy = THREE.MathUtils.lerp(s.vy, -2.4, dt * 3.0);
        s.y += s.vy * dt;

        // Move horizontally
        s.wx += s.vx * dt;
        s.wz += s.vz * dt;

        // Check bounds
        const { gx: rgx, gz: rgz } = this.terrain.worldToGrid(s.wx, s.wz);
        if (rgx < 1 || rgx >= res - 1 || rgz < 1 || rgz >= res - 1) {
          s.active = false;
          s.mesh.visible = false;
          if (s.chuteGroup) s.chuteGroup.visible = false;
          continue;
        }

        let terrainH = this.terrain.getInterpolatedHeight(s.wx, s.wz);
        if (terrainH <= seaLevel && water) {
          terrainH = seaLevel + water.getWaveHeight(s.wx, s.wz);
        }

        // Visual banking
        s._bankAngle = hDiff * 0.3;

        // Touchdown: close to target OR terrain catches up
        const landed = s.y <= terrainH;
        const closeEnough = horizDist < 8.0;

        if (landed || (closeEnough && s.y <= terrainH + 2.0)) {
          s.y = terrainH;
          s.vy = 0;
          s.grounded = true;
          s.paragliding = false;
          s._bankAngle = 0;
          s.state = 'skiing';
          s.respawnTarget = null;

          // Give a downhill push so they start moving
          const cellSz = size / (res - 1);
          const sR = 3;
          const hL = this.terrain.getHeight(Math.max(0, rgx - sR), rgz);
          const hR = this.terrain.getHeight(Math.min(res - 1, rgx + sR), rgz);
          const hU = this.terrain.getHeight(rgx, Math.max(0, rgz - sR));
          const hD = this.terrain.getHeight(rgx, Math.min(res - 1, rgz + sR));
          const gX = (hR - hL) / (2 * sR * cellSz);
          const gZ = (hD - hU) / (2 * sR * cellSz);
          const gMag = Math.sqrt(gX * gX + gZ * gZ);
          if (gMag > 0.001) {
            s.vx = (-gX / gMag) * 4.0;
            s.vz = (-gZ / gMag) * 4.0;
          } else {
            s.vx = 0; s.vz = 0;
          }
          s.speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
          s.stuckCount = 0;
          s.stuckTime = 0;
        }

        // Update mesh & chute visuals
        s.mesh.position.set(s.wx, s.y + 0.15, s.wz);
        if (s.speed > 0.01) {
          s.mesh.rotation.y = s.glideHeading;
        }
        if (s.chuteGroup) {
          s.chuteGroup.visible = s.paragliding;
          s.chuteGroup.position.set(s.wx, s.y + 0.15, s.wz);
          s.chuteGroup.rotation.y = s.mesh.rotation.y;
          const tgtBank = s._bankAngle || 0;
          s.chuteGroup.rotation.z = THREE.MathUtils.lerp(s.chuteGroup.rotation.z, tgtBank, 0.1);
          s.chuteGroup.rotation.x = 0;
        }
        continue;
      }

      // --- Skiing State from here on ---

      // Get grid position (only for skiing state)
      const { gx, gz } = this.terrain.worldToGrid(s.wx, s.wz);
      if (gx <= 1 || gx >= res - 2 || gz <= 1 || gz >= res - 2) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }

      // Compute gradient using wider sampling (3-cell radius) to smooth over rough terrain
      const cellSize = size / (res - 1);
      const sampleR = 3; // sample radius in grid cells
      const hL = this.terrain.getHeight(Math.max(0, gx - sampleR), gz);
      const hR = this.terrain.getHeight(Math.min(res - 1, gx + sampleR), gz);
      const hU = this.terrain.getHeight(gx, Math.max(0, gz - sampleR));
      const hD = this.terrain.getHeight(gx, Math.min(res - 1, gz + sampleR));

      const gradX = (hR - hL) / (2 * sampleR * cellSize);
      const gradZ = (hD - hU) / (2 * sampleR * cellSize);

      // Find nearest chairlift base first (needed to dampen gravity near bases)
      let nearestBaseDist = Infinity;
      let nearestBase = null;
      if (chairlifts && chairlifts.lines.length > 0) {
        let nearestDistSq = Infinity;
        for (const line of chairlifts.lines) {
          const base = line.p1.y < line.p2.y ? line.p1 : line.p2;
          const dbx = base.x - s.wx;
          const dbz = base.z - s.wz;
          const dSq = dbx * dbx + dbz * dbz;
          if (dSq < nearestDistSq) {
            nearestDistSq = dSq;
            nearestBase = base;
          }
        }
        if (nearestBase) {
          nearestBaseDist = Math.sqrt(nearestDistSq);
        }
      }

      // Apply gravity along slope — dampen when close to a chairlift base
      // so skiers can overpower the slope to reach the lift
      const gravityDampen = nearestBaseDist < 30.0
        ? Math.max(0.05, nearestBaseDist / 30.0)
        : 1.0;

      if (s.traverseTimeLeft > 0) {
        s.traverseTimeLeft -= dt;

        // The gradient vector is (gradX, gradZ), so downhill is (-gradX, -gradZ).
        // Orthogonal (contour line) depends on traverseDir.
        const contourX = gradZ * s.traverseDir;
        const contourZ = -gradX * s.traverseDir;
        const contourLen = Math.sqrt(contourX * contourX + contourZ * contourZ) || 1;
        
        // Push along the contour to traverse (cut)
        const traverseForceMag = 10.0; 
        s.vx += (contourX / contourLen) * traverseForceMag * dt;
        s.vz += (contourZ / contourLen) * traverseForceMag * dt;
        
        // Dampen the downhill gravity slightly during the cut so it's a diagonal sweep
        // Keeping this at 0.8 means the slope continues to pull them mostly downwards
        s.vx -= gradX * gravity * gravityDampen * 0.8 * dt;
        s.vz -= gradZ * gravity * gravityDampen * 0.8 * dt;
      } else {
        // Continue counting down into negative numbers to act as a cooldown timer
        s.traverseTimeLeft -= dt; 
        s.vx -= gradX * gravity * gravityDampen * dt;
        s.vz -= gradZ * gravity * gravityDampen * dt;
      }

      // Chairlift base attraction force while skiing
      if (nearestBase && nearestBaseDist < 80.0 && nearestBaseDist > 1.0) {
        
        // If they physically reached the base during skiing, stop and get in line!
        if (nearestBaseDist < 4.0) {
           this._handleStop(s, chairlifts);
           continue;
        }

        // Strong attraction that increases as skier gets closer
        const attractStrength = 4.0 * (1.0 - nearestBaseDist / 80.0);
        const adx = (nearestBase.x - s.wx) / nearestBaseDist;
        const adz = (nearestBase.z - s.wz) / nearestBaseDist;
        s.vx += adx * attractStrength * dt;
        s.vz += adz * attractStrength * dt;
      }

      // Skier-to-skier repulsion using Spatial Hash
      if (nearestBaseDist > 25.0) {
        const repelRadius = 15.0;
        const rrSq = repelRadius * repelRadius;
        
        const cgx = Math.floor(s.wx / this._gridSize);
        const cgz = Math.floor(s.wz / this._gridSize);

        // Check 3x3 grid around current cell
        for (let ox = -1; ox <= 1; ox++) {
          for (let oz = -1; oz <= 1; oz++) {
            const neighbors = this._spatialHash.get(`${cgx + ox},${cgz + oz}`);
            if (!neighbors) continue;
            
            for (const other of neighbors) {
              if (other === s) continue;
              const dx = s.wx - other.wx;
              const dz = s.wz - other.wz;
              const distSq = dx * dx + dz * dz;
              
              if (distSq < rrSq && distSq > 0.01) {
                const dist = Math.sqrt(distSq);
                const repelStrength = 6.0 * (1.0 - dist / repelRadius);
                const invDist = 1.0 / dist;
                s.vx += (dx * invDist) * repelStrength * dt;
                s.vz += (dz * invDist) * repelStrength * dt;
              }
            }
          }
        }
      }

      // Fresh powder & terrain seeking traverse: probe forward to steer away from tracked snow or dirt!
      const currentH = this.terrain.getInterpolatedHeight(s.wx, s.wz);
      
      if (s.speed > 1.0) {
        const probeDistWorld = 8.0;
        let bestDx = 0, bestDz = 0, bestScore = -Infinity;
        const forwardAngle = Math.atan2(s.vz, s.vx);
        
        // Scan a 180-degree fan in front of the skier
        for (let angleOffset = -Math.PI/2.5; angleOffset <= Math.PI/2.5; angleOffset += Math.PI / 5) {
          const angle = forwardAngle + angleOffset;
          const px = s.wx + Math.cos(angle) * probeDistWorld;
          const pz = s.wz + Math.sin(angle) * probeDistWorld;
          
          const { gx: pxG, gz: pzG } = this.terrain.worldToGrid(px, pz);
          let trackedAmount = 0;
          let isDirt = false;
          
          if (pxG >= 0 && pxG < res && pzG >= 0 && pzG < res) {
             const idx = pzG * res + pxG;
             trackedAmount = this.trackMap[idx];
                          // Check if it's dirt (no snow cover)
              isDirt = this.terrain.getSnowCover(px, pz) <= 0.05;
          }
          
          let ph = this.terrain.getInterpolatedHeight(px, pz);
          if (ph <= seaLevel && water) {
             ph = seaLevel + water.getWaveHeight(px, pz);
          }
          const climbNeeded = Math.max(0, ph - currentH);
          
          // Evaluate this direction:
          // 1. We strongly prefer going straight relative to our current velocity
          const forwardBias = Math.cos(angleOffset) * 8.0;
          // 2. We aggressively seek out and prefer steep downhill slopes & couloirs!
          const heightDrop = Math.max(0, currentH - ph);
          const steepBonus = heightDrop * 25.0;
          // 3. We penalize tracked-out snow heavily so they hunt for fresh powder
          const trackPenalty = trackedAmount * 0.08;
          // 4. We absolutely refuse to ski uphill unless necessary
          const hillPenalty = climbNeeded * 30.0;
          // 5. We desperately avoid dirt
          const dirtPenalty = isDirt ? 100.0 : 0;
          
          const score = forwardBias + steepBonus - trackPenalty - hillPenalty - dirtPenalty;
          
          if (score > bestScore) {
            bestScore = score;
            bestDx = Math.cos(angle);
            bestDz = Math.sin(angle);
          }
        }
        
        // Gently nudge them towards the best untouched snow and steep lines
        const traverseStrength = 3.5;
        s.vx += bestDx * traverseStrength * dt;
        s.vz += bestDz * traverseStrength * dt;
        
        // Mark the current spot as tracked!
        const { gx: cgx, gz: cgz } = this.terrain.worldToGrid(s.wx, s.wz);
        if (cgx >= 0 && cgx < res && cgz >= 0 && cgz < res) {
           const cidx = cgz * res + cgx;
           // Add heavy tracks
           this.trackMap[cidx] = Math.min(255, this.trackMap[cidx] + 25);
        }
      }

      // Friction: Scrub speed more heavily on steep terrain when going fast
      let currentFriction = friction;
      if (s.speed > 1.2) {
        currentFriction -= (s.speed - 1.2) * 0.008;
      }
      currentFriction = Math.max(0.88, currentFriction); // cap max friction — let them rip

      s.vx *= currentFriction;
      s.vz *= currentFriction;

      s.speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);

      // Minimum downhill nudge: if nearly stopped but on a slope, give a small push
      const gradMag = Math.sqrt(gradX * gradX + gradZ * gradZ);
      if (s.speed < 0.05 && gradMag > 0.005) {
        s.vx -= (gradX / gradMag) * 0.1;
        s.vz -= (gradZ / gradMag) * 0.1;
        s.speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
      }

      // Stuck detection: require being slow for a bit
      if (s.speed < 0.1 && gradMag < 0.01) {
        s.stuckTime = (s.stuckTime || 0) + dt;
        if (s.stuckTime > 1.5) {
          s.stuckTime = 0;
          s.stuckCount = (s.stuckCount || 0) + 1;
          
          if (s.stuckCount > 4) {
            // Completely trapped after 4 hops, give up
            this._handleStop(s, chairlifts);
            continue;
          }

          // Desperate hop out of the flat/bowl!
          s.grounded = false;
          s.vy = 6.0; // Hop up
          
          // Push in a random direction to try and find a slope
          const escapeAngle = Math.random() * Math.PI * 2;
          const hopForce = 6.0;
          s.vx = Math.cos(escapeAngle) * hopForce;
          s.vz = Math.sin(escapeAngle) * hopForce;
          s.speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
        }
      } else {
        s.stuckTime = 0;
        if (s.speed > 2.0) s.stuckCount = 0; // Reset if they get moving again
      }

      s.timeAlive += dt;

      // Calculate perpendicular (cross) vector to current velocity for carving (strictly when grounded)
      let carveX = 0, carveZ = 0;
      if (s.speed > 0.01 && s.grounded) {
        // Frequency increases aggressively with speed for very tight, quick turns
        const turnFreq = 3.5 + s.speed * 2.5; 
        s.carvePhase += dt * turnFreq;

        // perpendicular to [vx, vz] is [-vz, vx]
        const px = -s.vz / s.speed;
        const pz = s.vx / s.speed;
        
        // Massive carving amplitude limit allows extreme cross-slope travel (exaggerated carving)
        const carveStrength = Math.min(s.speed * 2.2, 8.0); 
        const carveForce = Math.sin(s.carvePhase) * carveStrength;
        
        carveX = px * carveForce;
        carveZ = pz * carveForce;
      }

      // Move with both forward velocity and lateral carve velocity
      s.wx += (s.vx + carveX) * dt;
      s.wz += (s.vz + carveZ) * dt;

      // Get new height
      const { gx: ngx, gz: ngz } = this.terrain.worldToGrid(s.wx, s.wz);
      if (ngx < 0 || ngx >= res || ngz < 0 || ngz >= res) {
        s.active = false;
        s.mesh.visible = false;
        if (s.chuteGroup) s.chuteGroup.visible = false;
        continue;
      }
      let terrainH = this.terrain.getInterpolatedHeight(s.wx, s.wz);
      if (terrainH <= seaLevel && water) {
        terrainH = seaLevel + water.getWaveHeight(s.wx, s.wz);
      }

      const hasLifts = this._chairlifts && this._chairlifts.lines && this._chairlifts.lines.length > 0;
      const disableChute = hasLifts || s.state === 'walking' || s.state === 'waiting' || s.state === 'riding' || this._isNearChairlift(s.wx, s.wz, 30);
      if (disableChute) {
        s.paragliding = false;
        if (s.chuteGroup) s.chuteGroup.visible = false;
      }

      // Proactive Cliff Jump Detection: probe 4.5 units ahead for major vertical cliff drop-offs (> 8.0 height drop)
      if (s.grounded && s.speed > 3.0 && !disableChute) {
        const normVx = (s.vx + carveX) / (s.speed || 1);
        const normVz = (s.vz + carveZ) / (s.speed || 1);
        const lookAheadX = s.wx + normVx * 4.5;
        const lookAheadZ = s.wz + normVz * 4.5;
        const lookAheadH = this.terrain.getInterpolatedHeight(lookAheadX, lookAheadZ);
        
        // Launch off genuine cliff drops (only truly massive drops)
        if (lookAheadH < terrainH - 15.0) {
          s.grounded = false;
          s.vy = Math.max(s.vy, 5.0); // Pop off cliff edge!
          s.paragliding = true;       // Deploy parachute for cliff flight!
          s.glideHeading = Math.atan2(s.vx, s.vz);
        }
      }

      // Vertical physics & Straight Paragliding
      if (s.grounded) {
        const dh = terrainH - s.y;
        const slopeVy = dh / dt;
        // Stick to ground down steep slopes (slopeVy up to -80.0) before launching
        if (slopeVy < -80.0 && s.speed > 25.0) {
          s.grounded = false;
          s.vy = slopeVy;
          s.glideHeading = Math.atan2(s.vx, s.vz);
        } else {
          s.y = terrainH;
          s.vy = slopeVy;
          s.paragliding = false;
        }
      } else {
        const heightAboveGround = s.y - terrainH;

        // Deploy parachute when high above ground (> 12.0 units for truly massive drops)
        if (!disableChute && heightAboveGround > 12.0 && s.vy < 2.0) {
          if (!s.paragliding) {
            s.paragliding = true;
            s.glideHeading = Math.atan2(s.vx, s.vz);
          }
        }

        if (s.paragliding) {
          if (s.glideHeading === undefined) {
            s.glideHeading = Math.atan2(s.vx, s.vz);
          }

          // Smoothly align glide heading toward downhill direction without oscillating
          const downhillHeading = Math.atan2(-gradX, -gradZ);
          let diff = downhillHeading - s.glideHeading;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          s.glideHeading += diff * 0.4 * dt;

          // Straight, aerodynamic forward flight vector
          const glideSpeed = 11.5;
          s.vx = Math.sin(s.glideHeading) * glideSpeed;
          s.vz = Math.cos(s.glideHeading) * glideSpeed;
          s.speed = glideSpeed;

          // Smooth, realistic linear sink rate
          s.vy = THREE.MathUtils.lerp(s.vy, -2.4, dt * 3.0);
          
          s._bankAngle = diff * 0.3; // Subtle wing bank when making gentle course adjustments
        } else {
          // Standard gravity when falling without chute
          s.vy -= 22.0 * dt;
          s._bankAngle = 0;
        }

        s.y += s.vy * dt;

        // Touchdown on terrain
        if (s.y <= terrainH) {
          s.y = terrainH;
          s.vy = 0;
          s.grounded = true;
          s.paragliding = false;
          s._bankAngle = 0;
        }
      }

      // Update mesh position
      s.mesh.position.set(s.wx, s.y + 0.15, s.wz);

      // Parachute Visual Mesh Position & Level Flight
      if (s.chuteGroup) {
        if (s.paragliding && s.active && s.mesh.visible && !isNearLift) {
          s.chuteGroup.visible = true;
          s.chuteGroup.position.set(s.wx, s.y + 0.15, s.wz);
          s.chuteGroup.rotation.y = s.mesh.rotation.y;
          
          // Level flight with subtle banking during turns
          const targetBank = s._bankAngle || 0;
          s.chuteGroup.rotation.z = THREE.MathUtils.lerp(s.chuteGroup.rotation.z, targetBank, 0.1);
          s.chuteGroup.rotation.x = 0;
        } else {
          s.chuteGroup.visible = false;
        }
      }

      // Stop if we run out of snow (either natural snowpack or painted snow)
      const isOnSnow = this.terrain.getSnowCover(s.wx, s.wz) > 0.05;
      
      if (!isOnSnow) {
        this._handleStop(s, chairlifts);
        continue;
      }
      
      // Emit snow powder particles
      if (s.grounded && s.speed > 1.0 && isOnSnow) {
        s._snowTimer = (s._snowTimer || 0) + dt;
        const emitInterval = Math.max(0.01, 0.06 - s.speed * 0.002);
        while (s._snowTimer >= emitInterval) {
          s._snowTimer -= emitInterval;
          const turnIntensity = Math.abs(Math.sin(s.carvePhase || 0));
          const turnMultiplier = 1 + turnIntensity * 1.5;
          const count = Math.min(3, Math.floor((s.speed > 5 ? 2 : 1) * turnMultiplier));
          for (let i = 0; i < count; i++) {
            this._emitSnow(s, terrainH);
          }
        }
      }

      // Smoothly face direction of overall movement (velocity + carve)
      if (s.speed > 0.01) {
        const targetRot = Math.atan2(s.vx + carveX, s.vz + carveZ);
        // Lerp rotation to remove jumpiness
        let diff = targetRot - s.mesh.rotation.y;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        s.mesh.rotation.y += diff * 6.0 * dt; 

        // Add a bit of pitch lean if in air
        const targetPitch = s.grounded ? 0 : -s.vy * 0.015;
        s.mesh.rotation.x += (targetPitch - s.mesh.rotation.x) * 4.0 * dt;
      }

      // Trail points appending
      s.trailPoints.push(s.wx, s.y + 0.15, s.wz);
    }

    // Sync InstancedMesh
    let imCount = 0;
    for (const s of this.skiers) {
      if (s.active && s.mesh.visible) {
        s.mesh.updateMatrix();
        this.skierIM.setMatrixAt(imCount, s.mesh.matrix);
        imCount++;
      }
    }
    this.skierIM.count = imCount;
    if (imCount > 0) {
      this.skierIM.instanceMatrix.needsUpdate = true;
    }
    
    // Update all shared snow particles
    this._updateSnowParticles(dt);
  }

  _isNearChairlift(wx, wz, threshold = 30) {
    if (!this._chairlifts || !this._chairlifts.lines || this._chairlifts.lines.length === 0) return false;
    for (const line of this._chairlifts.lines) {
      const isP1Lower = line.p1.y < line.p2.y;
      const base = isP1Lower ? line.p1 : line.p2;
      const d1Sq = (wx - base.x) ** 2 + (wz - base.z) ** 2;
      if (d1Sq <= threshold * threshold) return true;
    }
    return false;
  }

  _handleStop(s, chairlifts) {
    // 1. If chairlifts exist, WALK TO THE CHAIRLIFT BASE STATION FIRST!
    let closestBase = null;
    let closestDistSq = Infinity;
    let targetLine = null;

    if (chairlifts && chairlifts.lines.length > 0) {
      for (const line of chairlifts.lines) {
        const base = line.p1.y < line.p2.y ? line.p1 : line.p2;
        const distSq = (s.wx - base.x) ** 2 + (s.wz - base.z) ** 2;
        if (distSq < closestDistSq) {
          closestDistSq = distSq;
          closestBase = base;
          targetLine = line;
        }
      }
    }

    if (closestBase) {
      s.state = 'walking';
      s.targetStation = closestBase;
      s.targetLine = targetLine;
      s.paragliding = false;
      s.grounded = true;
      if (s.chuteGroup) s.chuteGroup.visible = false;
      s.trailPoints = [];
      s.trailStartIndex = 0;
      s.trail.geometry.setDrawRange(0, 0);
      s.stuckCount = 0;
      s.stuckTime = 0;
      return;
    }

    // 2. Fallback: Only try parachute respawn if NO chairlifts exist on map!
    const respawnTarget = this._findRespawnTarget(s);
    if (respawnTarget) {
      s.state = 'paraglide_respawn';
      s.respawnTarget = respawnTarget;
      s.grounded = false;
      s.vy = 8.0; // Launch upward
      s.paragliding = true;
      s.glideHeading = Math.atan2(respawnTarget.x - s.wx, respawnTarget.z - s.wz);
      s.trailPoints = [];
      s.trailStartIndex = 0;
      s.trail.geometry.setDrawRange(0, 0);
      s.stuckCount = 0;
      s.stuckTime = 0;
      return;
    }

    s.active = false;
    s.mesh.visible = false;
    if (s.chuteGroup) s.chuteGroup.visible = false;
  }

  /**
   * Scan terrain for a nearby snowy slope suitable for landing and skiing.
   * Returns { x, z } world coords or null if nothing found.
   */
  _findRespawnTarget(s) {
    const res = this.terrain.resolution;
    const size = this.terrain.size;
    const half = size / 2;
    const cellSize = size / (res - 1);
    const searchRadius = 80.0; // world units
    const sampleCount = 40;    // random probes

    let bestTarget = null;
    let bestScore = -Infinity;

    for (let i = 0; i < sampleCount; i++) {
      // Random point within search radius, biased toward farther distances
      const angle = Math.random() * Math.PI * 2;
      const dist = 15.0 + Math.random() * (searchRadius - 15.0); // min 15 away
      const wx = s.wx + Math.cos(angle) * dist;
      const wz = s.wz + Math.sin(angle) * dist;

      // Bounds check
      if (wx < -half + 5 || wx > half - 5 || wz < -half + 5 || wz > half - 5) continue;

      // Snow check
      const snowCover = this.terrain.getSnowCover(wx, wz);
      if (snowCover < 0.15) continue;

      // Height & sea level check
      const h = this.terrain.getInterpolatedHeight(wx, wz);
      if (h <= (this.terrain.seaLevel || -1)) continue;

      // Slope check — need some gradient so they can ski away
      const { gx, gz } = this.terrain.worldToGrid(wx, wz);
      if (gx < 3 || gx >= res - 3 || gz < 3 || gz >= res - 3) continue;

      const sR = 3;
      const hL = this.terrain.getHeight(gx - sR, gz);
      const hR = this.terrain.getHeight(gx + sR, gz);
      const hU = this.terrain.getHeight(gx, gz - sR);
      const hD = this.terrain.getHeight(gx, gz + sR);
      const gradX = (hR - hL) / (2 * sR * cellSize);
      const gradZ = (hD - hU) / (2 * sR * cellSize);
      const gradMag = Math.sqrt(gradX * gradX + gradZ * gradZ);

      if (gradMag < 0.02) continue; // Too flat to ski
      if (gradMag > 1.5) continue;  // Too steep / cliff

      // Score: prefer higher elevation (longer runs) + good slope + more snow
      const elevScore = h * 0.5;
      const slopeScore = Math.min(gradMag, 0.5) * 20.0;
      const snowScore = snowCover * 10.0;
      const score = elevScore + slopeScore + snowScore;

      if (score > bestScore) {
        bestScore = score;
        bestTarget = { x: wx, z: wz };
      }
    }

    return bestTarget;
  }

  clear() {
    for (const s of this.skiers) {
      this.group.remove(s.trail);
      s.trail.geometry.dispose();
      s.trail.material.dispose();
      if (s.chuteGroup) {
        this.group.remove(s.chuteGroup);
        s.chuteGroup.traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      }
    }
    this.skiers = [];
    this.skierIM.count = 0;
    if (this.trackMap) this.trackMap.fill(0);
    
    for (const p of this._snowPool) {
      this.group.remove(p.mesh);
    }
    this._snowPool = [];
  }

  setTrailsVisible(visible) {
    this._trailsVisible = visible;
    for (const s of this.skiers) {
      if (s.trail) s.trail.visible = this._trailsVisible;
    }
  }

  get count() {
    return this.skiers.length;
  }

  get activeCount() {
    return this.skiers.filter(s => s.active).length;
  }

  _buildSkierGeo() {
    const geos = [];

    // Torso
    const torso = new THREE.BoxGeometry(0.12, 0.18, 0.08);
    torso.translate(0, 0.28, 0);
    geos.push(torso);

    // Head
    const head = new THREE.SphereGeometry(0.05, 6, 6);
    head.translate(0, 0.42, 0);
    geos.push(head);

    // Legs
    for (const side of [-1, 1]) {
      const leg = new THREE.BoxGeometry(0.04, 0.16, 0.05);
      leg.translate(side * 0.035, 0.12, 0);
      geos.push(leg);
    }

    // Skis
    for (const side of [-1, 1]) {
      const ski = new THREE.BoxGeometry(0.08, 0.03, 0.6);
      ski.translate(side * 0.08, 0.015, 0);
      geos.push(ski);
    }

    // Poles
    for (const side of [-1, 1]) {
      const pole = new THREE.CylinderGeometry(0.01, 0.01, 0.4, 4);
      pole.rotateZ(side * 0.2);
      pole.translate(side * 0.16, 0.2, 0);
      geos.push(pole);
    }

    for (let i = 0; i < geos.length; i++) {
      geos[i] = geos[i].toNonIndexed();
    }

    return BufferGeometryUtils.mergeGeometries(geos, true);
  }

  // ---- Snow Powder Particle System ----

  _getSnowParticle() {
    for (const p of this._snowPool) {
      if (!p.active) {
        p.active = true;
        p.mesh.visible = true;
        return p;
      }
    }
    if (this._snowPool.length < this._snowPoolSize) {
      const mesh = new THREE.Mesh(this._snowGeo, this._snowMat.clone());
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      const p = { mesh, active: true, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0, baseScale: 1 };
      this._snowPool.push(p);
      return p;
    }
    // Pool full, steal oldest
    const oldest = this._snowPool[0];
    oldest.active = true;
    oldest.mesh.visible = true;
    return oldest;
  }

  _emitSnow(s, snowY) {
    const p = this._getSnowParticle();
    const heading = s.mesh.rotation.y;
    
    const sideOffset = (Math.random() - 0.5) * 0.8;
    const fwdOffset = (Math.random() - 0.5) * 0.6;
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);
    
    p.mesh.position.set(
      s.wx + cosH * sideOffset + sinH * fwdOffset,
      snowY + 0.1 + Math.random() * 0.2,
      s.wz - sinH * sideOffset + cosH * fwdOffset
    );
    
    const turnIntensity = Math.abs(Math.sin(s.carvePhase || 0));
    const turnInfluence = turnIntensity * 0.4; 
    const speedFactor = Math.min(s.speed * 0.15, 3.0);
    const spreadAngle = (Math.random() - 0.5) * Math.PI * 0.6;
    const launchAngle = heading + Math.PI + spreadAngle + turnInfluence;
    
    p.vx = Math.sin(launchAngle) * speedFactor * (0.5 + Math.random() * 1.0);
    p.vy = 0.5 + Math.random() * 2.0 * speedFactor + turnIntensity * 0.8;
    p.vz = Math.cos(launchAngle) * speedFactor * (0.5 + Math.random() * 1.0);
    
    p.life = 0;
    p.maxLife = 0.6 + Math.random() * 0.5;
    p.baseScale = 0.3 + Math.random() * 0.7;
    p.mesh.scale.setScalar(p.baseScale);
    p.mesh.material.opacity = 0.35;
    p.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  }

  _updateSnowParticles(dt) {
    const gravity = 3.0;
    for (const p of this._snowPool) {
      if (!p.active) continue;
      
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      
      p.vx *= 0.95;
      p.vz *= 0.95;
      p.vy -= gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.y += 0.5 * dt;
      p.mesh.rotation.z += 0.5 * dt;
      
      const terrainH = this.terrain.getInterpolatedHeight(p.mesh.position.x, p.mesh.position.z);
      if (p.mesh.position.y < terrainH) {
        p.mesh.position.y = terrainH;
        p.vy = 0;
        p.vx *= 0.5;
        p.vz *= 0.5;
      }
      
      const t = p.life / p.maxLife;
      p.mesh.material.opacity = 0.35 * (1 - t);
      p.mesh.scale.setScalar(p.baseScale * (1.0 + t * 1.5));
    }
  }
}
