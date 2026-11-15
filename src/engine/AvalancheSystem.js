import * as THREE from 'three/webgpu';

/**
 * Avalanche Simulation System
 * Creates realistic, physics-driven alpine snow slab avalanches with:
 * - Crown fracture & initial blast
 * - Downhill-flowing avalanche fronts steered by terrain slope fall-lines
 * - Cascading tumbling snow slab chunks (InstancedMesh)
 * - Billowing, expanding powder cloud aerosol blast (InstancedMesh)
 * - Sweeping AI skiers & snowmobiles downhill in the slide path
 * - Thunderous procedural audio rumble (Web Audio API)
 * - Visceral camera shake
 */
export class AvalancheSystem {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();

    // Active avalanche slide instances
    this.activeSlides = [];

    // --- Snow Slab Chunks (Dense tumbled blocks) ---
    this.MAX_CHUNKS = 500;
    const chunkGeo = new THREE.DodecahedronGeometry(0.38, 0);
    this.chunkMat = new THREE.MeshStandardMaterial({
      color: 0xedf6fc,
      roughness: 0.85,
      metalness: 0.05,
    });
    this.chunkMesh = new THREE.InstancedMesh(chunkGeo, this.chunkMat, this.MAX_CHUNKS);
    this.chunkMesh.frustumCulled = false;
    this.chunkMesh.castShadow = true;
    this.chunkMesh.count = 0;
    this.group.add(this.chunkMesh);

    this.chunks = [];
    for (let i = 0; i < this.MAX_CHUNKS; i++) {
      this.chunks.push({
        active: false,
        x: 0, y: 0, z: 0,
        vx: 0, vy: 0, vz: 0,
        rotX: 0, rotY: 0, rotZ: 0,
        vRotX: 0, vRotY: 0, vRotZ: 0,
        scale: 1,
        life: 0,
        maxLife: 1,
      });
    }

    // --- Billowing Powder Clouds (Aerosol blast) ---
    this.MAX_CLOUDS = 450;
    const cloudGeo = new THREE.IcosahedronGeometry(0.85, 1);
    this.cloudMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    this.cloudMesh = new THREE.InstancedMesh(cloudGeo, this.cloudMat, this.MAX_CLOUDS);
    this.cloudMesh.frustumCulled = false;
    this.cloudMesh.count = 0;
    this.group.add(this.cloudMesh);

    this.clouds = [];
    for (let i = 0; i < this.MAX_CLOUDS; i++) {
      this.clouds.push({
        active: false,
        x: 0, y: 0, z: 0,
        vx: 0, vy: 0, vz: 0,
        scale: 1,
        startScale: 1,
        endScale: 4.5,
        life: 0,
        maxLife: 1,
      });
    }

    // Pre-allocated matrix helper to avoid GC allocations
    this._dummy = new THREE.Object3D();

    // Procedural Audio Context
    this._audioCtx = null;

    // Camera shake intensity & duration
    this._trauma = 0; // 0..1
    this._shakeOffset = new THREE.Vector3();
  }

  // ---------------------------------------------------------------------------
  // Sound Synthesis (Web Audio API procedural alpine roar)
  // ---------------------------------------------------------------------------

  _initAudio() {
    if (this._audioCtx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      this._audioCtx = new AudioCtx();
    }
  }

  _playAvalancheSound(intensity = 1.0) {
    try {
      this._initAudio();
      if (!this._audioCtx) return;
      if (this._audioCtx.state === 'suspended') {
        this._audioCtx.resume();
      }

      const now = this._audioCtx.currentTime;
      const duration = 6.0;

      // 1. Initial Blast / Boom Oscillator (deep sub-bass thud)
      const osc = this._audioCtx.createOscillator();
      const oscGain = this._audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(75, now);
      osc.frequency.exponentialRampToValueAtTime(24, now + 1.2);

      oscGain.gain.setValueAtTime(0.45 * intensity, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 1.6);

      osc.connect(oscGain);
      oscGain.connect(this._audioCtx.destination);
      osc.start(now);
      osc.stop(now + 1.6);

      // 2. Rolling Thunder / Roaring Snow Noise
      const bufferSize = this._audioCtx.sampleRate * duration;
      const noiseBuffer = this._audioCtx.createBuffer(1, bufferSize, this._audioCtx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        // Brown noise filter for deep rushing rumble
        output[i] = (lastOut + 0.025 * white) / 1.025;
        lastOut = output[i];
        output[i] *= 3.5;
      }

      const whiteNoise = this._audioCtx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      // Filter: resonant lowpass opening and sweeping as debris accelerates
      const filter = this._audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(140, now);
      filter.frequency.linearRampToValueAtTime(380, now + 1.0);
      filter.frequency.exponentialRampToValueAtTime(80, now + duration);

      const noiseGain = this._audioCtx.createGain();
      noiseGain.gain.setValueAtTime(0.01, now);
      noiseGain.gain.linearRampToValueAtTime(0.55 * intensity, now + 0.4);
      noiseGain.gain.setValueAtTime(0.50 * intensity, now + 2.0);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      whiteNoise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this._audioCtx.destination);

      whiteNoise.start(now);
      whiteNoise.stop(now + duration);
    } catch (_) {
      // Audio autoplay policy or unavailable WebAudio
    }
  }

  // ---------------------------------------------------------------------------
  // Triggering
  // ---------------------------------------------------------------------------

  /**
   * Trigger an avalanche at world coordinate (wx, wz).
   * @param {number} wx
   * @param {number} wz
   * @returns {boolean} true if slide was successfully created
   */
  trigger(wx, wz) {
    const half = this.terrain.size / 2;
    if (wx < -half || wx > half || wz < -half || wz > half) return false;

    const startH = this.terrain.getInterpolatedHeight(wx, wz);
    if (!isFinite(startH) || startH <= this.terrain.seaLevel + 0.2) return false;

    // Calculate initial slope gradient
    const spacing = this.terrain.size / (this.terrain.resolution - 1);
    const hL = this.terrain.getInterpolatedHeight(wx - spacing, wz);
    const hR = this.terrain.getInterpolatedHeight(wx + spacing, wz);
    const hU = this.terrain.getInterpolatedHeight(wx, wz - spacing);
    const hD = this.terrain.getInterpolatedHeight(wx, wz + spacing);
    const gradX = (hR - hL) / (2 * spacing);
    const gradZ = (hD - hU) / (2 * spacing);
    const slopeLen = Math.sqrt(gradX * gradX + gradZ * gradZ);

    // Default downhill vector along steepest descent
    let dirX = 0;
    let dirZ = 1;
    if (slopeLen > 0.02) {
      dirX = -gradX / slopeLen;
      dirZ = -gradZ / slopeLen;
    } else {
      const randAngle = Math.random() * Math.PI * 2;
      dirX = Math.sin(randAngle);
      dirZ = Math.cos(randAngle);
    }

    // Perpendicular vector for fanning out the slide flanks
    const perpX = -dirZ;
    const perpZ = dirX;

    // Slide definition with 3 flowing front heads (center + left & right flanks)
    const slide = {
      active: true,
      age: 0,
      maxAge: 9.0, // seconds of active downhill flow
      heads: [
        // Center head
        {
          x: wx,
          z: wz,
          vx: dirX * 10,
          vz: dirZ * 10,
          radius: 4.5,
          maxRadius: 18.0,
          power: 1.0,
          stuckTime: 0,
        },
        // Left flank head
        {
          x: wx + perpX * 2.5,
          z: wz + perpZ * 2.5,
          vx: (dirX + perpX * 0.3) * 8.5,
          vz: (dirZ + perpZ * 0.3) * 8.5,
          radius: 3.5,
          maxRadius: 14.0,
          power: 0.85,
          stuckTime: 0,
        },
        // Right flank head
        {
          x: wx - perpX * 2.5,
          z: wz - perpZ * 2.5,
          vx: (dirX - perpX * 0.3) * 8.5,
          vz: (dirZ - perpZ * 0.3) * 8.5,
          radius: 3.5,
          maxRadius: 14.0,
          power: 0.85,
          stuckTime: 0,
        },
      ],
      emitTimer: 0,
    };

    this.activeSlides.push(slide);

    // Initial Crown Fracture Blast: explosive burst of debris blocks and clouds
    const blastCount = 45;
    for (let i = 0; i < blastCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 4.0;
      const bx = wx + Math.cos(angle) * dist;
      const bz = wz + Math.sin(angle) * dist;
      const by = this.terrain.getInterpolatedHeight(bx, bz) + 0.3;

      const launchSpeed = 8.0 + Math.random() * 14.0;
      const launchAngle = (Math.random() - 0.5) * 1.2;
      const chunkDirX = dirX * Math.cos(launchAngle) + perpX * Math.sin(launchAngle);
      const chunkDirZ = dirZ * Math.cos(launchAngle) + perpZ * Math.sin(launchAngle);

      this._spawnChunk(
        bx, by, bz,
        chunkDirX * launchSpeed + (Math.random() - 0.5) * 4,
        6.0 + Math.random() * 8.0, // upward burst
        chunkDirZ * launchSpeed + (Math.random() - 0.5) * 4,
        0.5 + Math.random() * 0.8,
        3.5 + Math.random() * 3.0
      );

      if (i % 2 === 0) {
        this._spawnCloud(
          bx, by + 0.5, bz,
          chunkDirX * (launchSpeed * 0.6) + (Math.random() - 0.5) * 3,
          2.5 + Math.random() * 3.5,
          chunkDirZ * (launchSpeed * 0.6) + (Math.random() - 0.5) * 3,
          1.2, 5.0,
          3.0 + Math.random() * 2.5
        );
      }
    }

    // Procedural sound & camera trauma
    this._playAvalancheSound(1.0);
    this._trauma = Math.min(1.0, this._trauma + 0.85);

    return true;
  }

  // ---------------------------------------------------------------------------
  // Particle Spawning
  // ---------------------------------------------------------------------------

  _spawnChunk(x, y, z, vx, vy, vz, scale, maxLife) {
    for (const c of this.chunks) {
      if (!c.active) {
        c.active = true;
        c.x = x; c.y = y; c.z = z;
        c.vx = vx; c.vy = vy; c.vz = vz;
        c.scale = scale;
        c.baseScale = scale;
        c.life = 0;
        c.maxLife = maxLife;
        c.rotX = Math.random() * Math.PI * 2;
        c.rotY = Math.random() * Math.PI * 2;
        c.rotZ = Math.random() * Math.PI * 2;
        c.vRotX = (Math.random() - 0.5) * 14.0;
        c.vRotY = (Math.random() - 0.5) * 14.0;
        c.vRotZ = (Math.random() - 0.5) * 14.0;
        return c;
      }
    }
    return null;
  }

  _spawnCloud(x, y, z, vx, vy, vz, startScale, endScale, maxLife) {
    for (const cl of this.clouds) {
      if (!cl.active) {
        cl.active = true;
        cl.x = x; cl.y = y; cl.z = z;
        cl.vx = vx; cl.vy = vy; cl.vz = vz;
        cl.scale = startScale;
        cl.startScale = startScale;
        cl.endScale = endScale;
        cl.life = 0;
        cl.maxLife = maxLife;
        return cl;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Simulation Loop
  // ---------------------------------------------------------------------------

  /**
   * Main simulation update.
   * @param {number} dt delta time
   * @param {object} skiers Skiers manager instance
   * @param {object} snowmobiles Snowmobiles manager instance
   */
  update(dt, skiers = null, snowmobiles = null) {
    const spacing = this.terrain.size / (this.terrain.resolution - 1);
    const half = this.terrain.size / 2;

    // 1. Update Active Avalanche Slides
    for (let sIdx = this.activeSlides.length - 1; sIdx >= 0; sIdx--) {
      const slide = this.activeSlides[sIdx];
      slide.age += dt;

      if (slide.age >= slide.maxAge) {
        this.activeSlides.splice(sIdx, 1);
        continue;
      }

      slide.emitTimer = (slide.emitTimer || 0) + dt;
      const shouldEmit = slide.emitTimer >= 0.05;
      if (shouldEmit) slide.emitTimer = 0;

      // Update flow heads
      for (const head of slide.heads) {
        if (head.stuckTime > 1.8) continue; // head has settled into a flat valley/runout

        // Sample local slope gradient
        const hL = this.terrain.getInterpolatedHeight(head.x - spacing, head.z);
        const hR = this.terrain.getInterpolatedHeight(head.x + spacing, head.z);
        const hU = this.terrain.getInterpolatedHeight(head.x, head.z - spacing);
        const hD = this.terrain.getInterpolatedHeight(head.x, head.z + spacing);
        const gradX = (hR - hL) / (2 * spacing);
        const gradZ = (hD - hU) / (2 * spacing);
        const steepness = Math.sqrt(gradX * gradX + gradZ * gradZ);

        // Downhill acceleration along local fall-line
        const gravity = 28.0;
        head.vx -= gradX * gravity * 1.4 * dt;
        head.vz -= gradZ * gravity * 1.4 * dt;

        // Friction / settling on flat terrain
        let friction = 0.985;
        if (steepness < 0.12) {
          friction = 0.90; // rapid slowing on flats/runouts
          head.stuckTime += dt;
        } else {
          head.stuckTime = Math.max(0, head.stuckTime - dt * 2);
        }

        head.vx *= friction;
        head.vz *= friction;

        // Advance position
        head.x += head.vx * dt;
        head.z += head.vz * dt;

        // Boundary clamp
        if (head.x < -half + 2 || head.x > half - 2 || head.z < -half + 2 || head.z > half - 2) {
          head.stuckTime = 999;
          continue;
        }

        const headY = this.terrain.getInterpolatedHeight(head.x, head.z);
        if (headY <= this.terrain.seaLevel + 0.1) {
          head.stuckTime = 999; // splash into sea/lake
        }

        // Expand radius as it fans out downhill
        head.radius = Math.min(head.maxRadius, head.radius + dt * 1.8);

        const currentSpeed = Math.sqrt(head.vx * head.vx + head.vz * head.vz);

        // Continuous particle emission along flow path
        if (shouldEmit && currentSpeed > 1.0) {
          const spawnCount = Math.min(4, Math.floor(currentSpeed * 0.25) + 1);
          for (let k = 0; k < spawnCount; k++) {
            const spreadAngle = Math.random() * Math.PI * 2;
            const spreadDist = Math.random() * (head.radius * 0.85);
            const px = head.x + Math.cos(spreadAngle) * spreadDist;
            const pz = head.z + Math.sin(spreadAngle) * spreadDist;
            const py = this.terrain.getInterpolatedHeight(px, pz) + 0.25;

            // Tumbling snow chunk
            this._spawnChunk(
              px, py, pz,
              head.vx * 0.9 + (Math.random() - 0.5) * 6.0,
              1.5 + Math.random() * 3.5,
              head.vz * 0.9 + (Math.random() - 0.5) * 6.0,
              0.3 + Math.random() * 0.6,
              2.5 + Math.random() * 2.5
            );

            // Billowing powder cloud
            this._spawnCloud(
              px, py + 0.4, pz,
              head.vx * 0.6 + (Math.random() - 0.5) * 4.0,
              1.8 + Math.random() * 2.5,
              head.vz * 0.6 + (Math.random() - 0.5) * 4.0,
              1.0 + Math.random() * 0.8,
              3.5 + Math.random() * 3.0,
              2.5 + Math.random() * 2.0
            );
          }
        }

        // --- Sweep AI Skiers caught in the avalanche path ---
        if (skiers && skiers.skiers) {
          const radSq = head.radius * head.radius;
          for (const s of skiers.skiers) {
            if (!s.active) continue;
            const dx = s.wx - head.x;
            const dz = s.wz - head.z;
            const distSq = dx * dx + dz * dz;

            if (distSq < radSq) {
              // Wipe skier's tracks in the slide path
              s.trailPoints = [];
              s.trailStartIndex = 0;
              if (s.trail && s.trail.geometry) {
                s.trail.geometry.setDrawRange(0, 0);
              }
              s._lastLeftPoint = null;
              s._lastRightPoint = null;

              // Sweep skier downhill violently
              s.grounded = false;
              s.vx = head.vx * 1.25 + (Math.random() - 0.5) * 12.0;
              s.vz = head.vz * 1.25 + (Math.random() - 0.5) * 12.0;
              s.vy = Math.max(s.vy, 4.0 + Math.random() * 5.0);
              s.speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);

              if (s.mesh) {
                s.mesh.rotation.x += (Math.random() - 0.5) * 15.0 * dt;
                s.mesh.rotation.z += (Math.random() - 0.5) * 15.0 * dt;
              }
            }
          }
        }

        // --- Knock Snowmobiles caught in the avalanche path ---
        if (snowmobiles && snowmobiles.snowmobiles) {
          const radSq = head.radius * head.radius;
          for (const sno of snowmobiles.snowmobiles) {
            if (!sno.active) continue;
            const dx = sno.wx - head.x;
            const dz = sno.wz - head.z;
            if (dx * dx + dz * dz < radSq) {
              sno.vx += head.vx * 0.9;
              sno.vz += head.vz * 0.9;
              sno.speed = Math.sqrt(sno.vx * sno.vx + sno.vz * sno.vz);
            }
          }
        }
      }
    }

    // 2. Update Chunk Particles (InstancedMesh)
    let chunkCount = 0;
    const gravity = 22.0;
    for (const c of this.chunks) {
      if (!c.active) continue;

      c.life += dt;
      if (c.life >= c.maxLife) {
        c.active = false;
        continue;
      }

      c.vy -= gravity * dt;
      c.x += c.vx * dt;
      c.z += c.vz * dt;
      c.y += c.vy * dt;

      // Bounce against terrain
      const terrH = this.terrain.getInterpolatedHeight(c.x, c.z);
      if (c.y <= terrH + 0.15) {
        c.y = terrH + 0.15;
        c.vy = Math.abs(c.vy) * 0.28; // bounce damping
        c.vx *= 0.92;
        c.vz *= 0.92;
      }

      // Tumbling rotation
      c.rotX += c.vRotX * dt;
      c.rotY += c.vRotY * dt;
      c.rotZ += c.vRotZ * dt;

      // Fade shrink at end of life
      const lifeRatio = c.life / c.maxLife;
      const scaleMultiplier = lifeRatio > 0.8 ? (1.0 - (lifeRatio - 0.8) / 0.2) : 1.0;
      const currentScale = c.baseScale * scaleMultiplier;

      this._dummy.position.set(c.x, c.y, c.z);
      this._dummy.rotation.set(c.rotX, c.rotY, c.rotZ);
      this._dummy.scale.setScalar(Math.max(0.01, currentScale));
      this._dummy.updateMatrix();

      this.chunkMesh.setMatrixAt(chunkCount, this._dummy.matrix);
      chunkCount++;
    }
    this.chunkMesh.count = chunkCount;
    if (chunkCount > 0) {
      this.chunkMesh.instanceMatrix.needsUpdate = true;
    }

    // 3. Update Powder Cloud Particles (InstancedMesh)
    let cloudCount = 0;
    for (const cl of this.clouds) {
      if (!cl.active) continue;

      cl.life += dt;
      if (cl.life >= cl.maxLife) {
        cl.active = false;
        continue;
      }

      const progress = cl.life / cl.maxLife;

      // Aerosol rises and rolls forward
      cl.vy = Math.max(0.4, cl.vy * 0.96);
      cl.vx *= 0.965;
      cl.vz *= 0.965;
      cl.x += cl.vx * dt;
      cl.z += cl.vz * dt;
      cl.y += cl.vy * dt;

      // Cloud expands as it rises
      const currentScale = THREE.MathUtils.lerp(cl.startScale, cl.endScale, Math.pow(progress, 0.6));

      this._dummy.position.set(cl.x, cl.y, cl.z);
      this._dummy.rotation.set(0, 0, 0);
      this._dummy.scale.setScalar(currentScale);
      this._dummy.updateMatrix();

      this.cloudMesh.setMatrixAt(cloudCount, this._dummy.matrix);
      cloudCount++;
    }
    this.cloudMesh.count = cloudCount;
    if (cloudCount > 0) {
      this.cloudMesh.instanceMatrix.needsUpdate = true;
    }

    // 4. Decay Camera Trauma Shake
    if (this._trauma > 0) {
      this._trauma = Math.max(0, this._trauma - dt * 0.35);
    }
  }

  // ---------------------------------------------------------------------------
  // Camera Shake
  // ---------------------------------------------------------------------------

  /**
   * Apply procedural camera rumble based on current avalanche activity and distance.
   * @param {THREE.Camera} camera
   * @param {number} dt
   */
  applyCameraShake(camera, dt) {
    if (this._trauma <= 0.001) {
      this._shakeOffset.set(0, 0, 0);
      return;
    }

    const shakeAmount = this._trauma * this._trauma * 0.35; // non-linear cubic response
    const time = performance.now() * 0.035;

    this._shakeOffset.set(
      (Math.sin(time * 1.7) + Math.cos(time * 2.3)) * shakeAmount,
      (Math.cos(time * 2.1) + Math.sin(time * 1.5)) * (shakeAmount * 0.65),
      (Math.sin(time * 1.9) + Math.cos(time * 1.2)) * shakeAmount
    );

    camera.position.add(this._shakeOffset);
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  clear() {
    this.activeSlides = [];
    for (const c of this.chunks) c.active = false;
    for (const cl of this.clouds) cl.active = false;
    this.chunkMesh.count = 0;
    this.cloudMesh.count = 0;
    this.chunkMesh.instanceMatrix.needsUpdate = true;
    this.cloudMesh.instanceMatrix.needsUpdate = true;
    this._trauma = 0;
  }
}
