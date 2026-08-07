import * as THREE from 'three/webgpu';

export class Clouds {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.time = 0;

    // Wind dynamics (serene drifting)
    this.windAngle = Math.PI * 0.25; // Blowing towards northeast
    this.windSpeed = 2.0;            // Units per second
    this.cloudCoverage = 50;         // Default 50% coverage

    const sphereGeo = new THREE.SphereGeometry(1, 24, 24);

    // Sky Fleet Stylized Core Material (Dense, pillow-like cumulus core)
    this.coreMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.75,
      metalness: 0.02,
      transparent: true,
      opacity: 0.88,
      depthWrite: true,
      fog: true
    });

    // Sky Fleet Soft Outer Shell Material (Fluffy rim feathering)
    this.shellMat = new THREE.MeshStandardMaterial({
      color: 0xeef5ff,
      roughness: 0.9,
      metalness: 0.0,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      fog: true
    });

    this.maxCoreInstances = 1400;
    this.maxShellInstances = 1400;

    this.coreMeshes = new THREE.InstancedMesh(sphereGeo, this.coreMat, this.maxCoreInstances);
    this.coreMeshes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coreMeshes.castShadow = true;
    this.coreMeshes.receiveShadow = true;
    this.group.add(this.coreMeshes);

    this.shellMeshes = new THREE.InstancedMesh(sphereGeo, this.shellMat, this.maxShellInstances);
    this.shellMeshes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.shellMeshes);

    // Virga / Snowfall Particles under active clouds
    this.particleCount = 10000;
    this.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.particleCount * 3);
    const velocities = new Float32Array(this.particleCount * 3);
    const origins = new Float32Array(this.particleCount * 3);
    this.systemIndices = new Float32Array(this.particleCount);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    this.geometry.setAttribute('origin', new THREE.BufferAttribute(origins, 3));

    this.particleMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.3,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      sizeAttenuation: true
    });

    this.mesh = new THREE.Points(this.geometry, this.particleMat);
    this.group.add(this.mesh);

    this.cloudSystems = [];
    this.corePuffList = [];
    this.shellPuffList = [];
    this.dummy = new THREE.Object3D();
  }

  setAmount(val) {
    this.cloudCoverage = val;
    this.updatePositions(this.seaLevel || 0);
  }

  updatePositions(seaLevel = 0) {
    this.seaLevel = seaLevel;
    this.cloudSystems = [];
    this.corePuffList = [];
    this.shellPuffList = [];

    const coverage = (this.cloudCoverage !== undefined ? this.cloudCoverage : 50) / 100;
    if (coverage <= 0) {
      this.coreMeshes.count = 0;
      this.shellMeshes.count = 0;
      if (this.mesh) this.mesh.visible = false;
      return;
    }

    const size = this.terrain.size;
    const res = this.terrain.resolution;
    const half = size / 2;

    const peakCandidates = [];
    for (let gz = 4; gz < res - 4; gz += 10) {
      for (let gx = 4; gx < res - 4; gx += 10) {
        const idx = gz * res + gx;
        const h = this.terrain.heightmap[idx];
        if (h > seaLevel + 20) {
          const wx = (gx / (res - 1)) * size - half;
          const wz = (gz / (res - 1)) * size - half;
          peakCandidates.push({ x: wx, y: h, z: wz });
        }
      }
    }

    const systemCount = Math.max(1, Math.min(32, Math.round(coverage * 28)));

    for (let i = 0; i < systemCount; i++) {
      let wx, wz, baseH;
      if (peakCandidates.length > 0 && Math.random() < 0.7) {
        const target = peakCandidates[Math.floor(Math.random() * peakCandidates.length)];
        wx = target.x + (Math.random() - 0.5) * 45;
        wz = target.z + (Math.random() - 0.5) * 45;
        baseH = target.y + 20 + Math.random() * 12;
      } else {
        wx = (Math.random() - 0.5) * size;
        wz = (Math.random() - 0.5) * size;
        const groundH = this.terrain.getInterpolatedHeight(wx, wz) || seaLevel;
        baseH = Math.max(seaLevel + 35, groundH + 22 + Math.random() * 15);
      }

      const sysRadius = 30 + Math.random() * 35;
      const system = {
        id: i,
        x: wx,
        y: baseH,
        z: wz,
        radius: sysRadius,
        coreStartIndex: this.corePuffList.length,
        coreCount: 0,
        shellStartIndex: this.shellPuffList.length,
        shellCount: 0
      };

      // Sky Fleet Cumulus Cloud Generation:
      // 1. Flat Stratus Base Puffs (Creates signature flat cloud underside)
      // 2. Bulbous Mounded Core Domes (Creates pillowy cumulus tops)
      const numBasePuffs = 4 + Math.floor(Math.random() * 4);
      const numCorePuffs = 8 + Math.floor(Math.random() * 8);

      // Base Puffs
      for (let b = 0; b < numBasePuffs; b++) {
        const relX = (Math.random() - 0.5) * sysRadius * 0.9;
        const relY = -2 - Math.random() * 2;
        const relZ = (Math.random() - 0.5) * sysRadius * 0.9;
        const sx = 14 + Math.random() * 16;
        const sy = 4 + Math.random() * 4; // Flat base
        const sz = 14 + Math.random() * 16;

        this.corePuffList.push({
          relX, relY, relZ, sx, sy, sz,
          rotY: Math.random() * Math.PI * 2,
          pulseSpeed: 0.15 + Math.random() * 0.25,
          phase: Math.random() * Math.PI * 2
        });

        this.shellPuffList.push({
          relX, relY: relY - 0.5, relZ,
          sx: sx * 1.25, sy: sy * 1.3, sz: sz * 1.25,
          rotY: Math.random() * Math.PI * 2,
          pulseSpeed: 0.15 + Math.random() * 0.25,
          phase: Math.random() * Math.PI * 2
        });
      }

      // Mounded Upper Core Billows
      for (let c = 0; c < numCorePuffs; c++) {
        const radFrac = Math.random() * 0.65;
        const ang = Math.random() * Math.PI * 2;
        const relX = Math.cos(ang) * sysRadius * radFrac;
        const relY = (1 - radFrac) * (5 + Math.random() * 12); // Mounds upward near center
        const relZ = Math.sin(ang) * sysRadius * radFrac;

        const mainScale = (1.0 - radFrac * 0.35) * (12 + Math.random() * 14);
        const sx = mainScale;
        const sy = mainScale * (0.85 + Math.random() * 0.3);
        const sz = mainScale;

        this.corePuffList.push({
          relX, relY, relZ, sx, sy, sz,
          rotY: Math.random() * Math.PI * 2,
          pulseSpeed: 0.15 + Math.random() * 0.25,
          phase: Math.random() * Math.PI * 2
        });

        this.shellPuffList.push({
          relX, relY, relZ,
          sx: sx * 1.22, sy: sy * 1.22, sz: sz * 1.22,
          rotY: Math.random() * Math.PI * 2,
          pulseSpeed: 0.15 + Math.random() * 0.25,
          phase: Math.random() * Math.PI * 2
        });
      }

      system.coreCount = numBasePuffs + numCorePuffs;
      system.shellCount = numBasePuffs + numCorePuffs;
      this.cloudSystems.push(system);
    }

    this.coreMeshes.count = Math.min(this.corePuffList.length, this.maxCoreInstances);
    this.shellMeshes.count = Math.min(this.shellPuffList.length, this.maxShellInstances);

    this._updateCloudMeshMatrices(0);
    this._initPrecipitationParticles();
  }

  _initPrecipitationParticles() {
    if (this.cloudSystems.length === 0) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    const positions = this.geometry.attributes.position.array;
    const velocities = this.geometry.attributes.velocity.array;
    const origins = this.geometry.attributes.origin.array;

    for (let i = 0; i < this.particleCount; i++) {
      const sys = this.cloudSystems[Math.floor(Math.random() * this.cloudSystems.length)];
      this.systemIndices[i] = sys.id;

      const rOffset = (Math.random() - Math.random()) * sys.radius * 0.95;
      const ang = Math.random() * Math.PI * 2;
      const px = sys.x + Math.cos(ang) * rOffset;
      const py = sys.y - 1 - Math.random() * 35;
      const pz = sys.z + Math.sin(ang) * rOffset;

      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;

      origins[i * 3] = sys.y - Math.random() * 3;

      velocities[i * 3] = Math.cos(this.windAngle) * this.windSpeed * 0.5 + (Math.random() - 0.5) * 0.8;
      velocities[i * 3 + 1] = -(Math.random() * 6 + 5);
      velocities[i * 3 + 2] = Math.sin(this.windAngle) * this.windSpeed * 0.5 + (Math.random() - 0.5) * 0.8;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.velocity.needsUpdate = true;
    this.geometry.attributes.origin.needsUpdate = true;
  }

  isUnderCloud(wx, wz) {
    if (!this.group.visible || !this.cloudSystems || this.cloudSystems.length === 0) return false;
    for (let i = 0; i < this.cloudSystems.length; i++) {
      const sys = this.cloudSystems[i];
      const dx = wx - sys.x;
      const dz = wz - sys.z;
      if (dx * dx + dz * dz <= sys.radius * sys.radius) {
        return true;
      }
    }
    return false;
  }

  toggle(isVisible) {
    this.group.visible = isVisible;
  }

  _updateCloudMeshMatrices(dt) {
    let coreIdx = 0;
    let shellIdx = 0;

    for (let i = 0; i < this.cloudSystems.length; i++) {
      const sys = this.cloudSystems[i];

      // Update Core Puff Instances
      const endCore = sys.coreStartIndex + sys.coreCount;
      for (let c = sys.coreStartIndex; c < endCore && coreIdx < this.coreMeshes.count; c++) {
        const puff = this.corePuffList[c];
        const pulse = Math.sin(this.time * puff.pulseSpeed + puff.phase);
        const scaleMult = 1.0 + pulse * 0.06;
        const morphY = pulse * 1.0;

        this.dummy.position.set(sys.x + puff.relX, sys.y + puff.relY + morphY, sys.z + puff.relZ);
        this.dummy.scale.set(puff.sx * scaleMult, puff.sy * scaleMult, puff.sz * scaleMult);
        this.dummy.rotation.set(0, puff.rotY + this.time * 0.015, 0);
        this.dummy.updateMatrix();

        this.coreMeshes.setMatrixAt(coreIdx, this.dummy.matrix);
        coreIdx++;
      }

      // Update Shell Puff Instances
      const endShell = sys.shellStartIndex + sys.shellCount;
      for (let s = sys.shellStartIndex; s < endShell && shellIdx < this.shellMeshes.count; s++) {
        const puff = this.shellPuffList[s];
        const pulse = Math.sin(this.time * puff.pulseSpeed + puff.phase);
        const scaleMult = 1.0 + pulse * 0.07;
        const morphY = pulse * 1.0;

        this.dummy.position.set(sys.x + puff.relX, sys.y + puff.relY + morphY, sys.z + puff.relZ);
        this.dummy.scale.set(puff.sx * scaleMult, puff.sy * scaleMult, puff.sz * scaleMult);
        this.dummy.rotation.set(0, puff.rotY + this.time * 0.015, 0);
        this.dummy.updateMatrix();

        this.shellMeshes.setMatrixAt(shellIdx, this.dummy.matrix);
        shellIdx++;
      }
    }

    this.coreMeshes.instanceMatrix.needsUpdate = true;
    this.shellMeshes.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    if (!this.group.visible || this.cloudSystems.length === 0) return;

    this.time += dt;

    // Dynamic weather wind shifts (gradual & serene)
    this.windAngle += Math.sin(this.time * 0.02) * 0.0005 * dt;
    const windX = Math.cos(this.windAngle) * this.windSpeed;
    const windZ = Math.sin(this.windAngle) * this.windSpeed;

    const halfSize = this.terrain.size / 2;
    const margin = 50;

    // Update cloud systems motion & mountain lift
    for (let i = 0; i < this.cloudSystems.length; i++) {
      const sys = this.cloudSystems[i];

      sys.x += windX * dt;
      sys.z += windZ * dt;

      // Upwind wrap
      if (sys.x > halfSize + margin) {
        sys.x = -halfSize - margin;
        sys.z = (Math.random() - 0.5) * this.terrain.size;
      } else if (sys.x < -halfSize - margin) {
        sys.x = halfSize + margin;
        sys.z = (Math.random() - 0.5) * this.terrain.size;
      }
      if (sys.z > halfSize + margin) {
        sys.z = -halfSize - margin;
        sys.x = (Math.random() - 0.5) * this.terrain.size;
      } else if (sys.z < -halfSize - margin) {
        sys.x = halfSize + margin;
        sys.z = (Math.random() - 0.5) * this.terrain.size;
      }

      // Mountain Orographic Lift
      const groundH = this.terrain.getInterpolatedHeight(sys.x, sys.z) || this.seaLevel || 0;
      const desiredH = Math.max((this.seaLevel || 0) + 30, groundH + 20);
      sys.y += (desiredH - sys.y) * Math.min(1.0, dt * 1.2);
    }

    // Update cloud matrices
    this._updateCloudMeshMatrices(dt);

    // Update Dense Virga / Snowfall particles
    const positions = this.geometry.attributes.position.array;
    const velocities = this.geometry.attributes.velocity.array;

    const coverage = (this.cloudCoverage !== undefined ? this.cloudCoverage : 50) / 100;
    const activeParticles = Math.round(1500 + coverage * (this.particleCount - 1500));
    this.geometry.setDrawRange(0, activeParticles);

    for (let i = 0; i < activeParticles; i++) {
      const sysId = this.systemIndices[i];
      const sys = this.cloudSystems[sysId] || this.cloudSystems[0];

      const swayX = Math.sin(this.time * 2.2 + i * 0.3) * 0.7;
      const swayZ = Math.cos(this.time * 2.2 + i * 0.3) * 0.7;

      positions[i * 3] += (velocities[i * 3] + windX * 0.4 + swayX) * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += (velocities[i * 3 + 2] + windZ * 0.4 + swayZ) * dt;

      const groundH = this.terrain.getInterpolatedHeight(positions[i * 3], positions[i * 3 + 2]) || 0;
      if (positions[i * 3 + 1] < groundH || positions[i * 3 + 1] < sys.y - 45) {
        const rOffset = (Math.random() - Math.random()) * sys.radius * 0.95;
        const ang = Math.random() * Math.PI * 2;

        positions[i * 3] = sys.x + Math.cos(ang) * rOffset;
        positions[i * 3 + 1] = sys.y - Math.random() * 4;
        positions[i * 3 + 2] = sys.z + Math.sin(ang) * rOffset;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}


