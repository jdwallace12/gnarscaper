import * as THREE from 'three/webgpu';

export class Water {
  constructor(size = 200, seaLevel = -1, terrain = null) {
    this.size = size;
    this.seaLevel = seaLevel;
    this.terrain = terrain;
    this._time = 0;

    // Subdivided plane for wave animation
    const segments = 128;
    this.geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    this.geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.MeshStandardMaterial({
      color: 0x147ca6,
      transparent: true,
      opacity: 0.8,
      roughness: 0.05,
      metalness: 0.35,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.y = seaLevel;
    this.mesh.receiveShadow = true;
  }

  setSeaLevel(level) {
    this.seaLevel = level;
    this.mesh.position.y = level;
  }

  /**
   * Get the wave height offset at a world position for the current time.
   * Returns a value to ADD to seaLevel.
   */
  getWaveHeight(wx, wz) {
    let rawHeight = Water.waveHeight(wx, wz, this._time);
    
    if (this.terrain) {
      const terrainH = this.terrain.getInterpolatedHeight(wx, wz);
      const depth = this.seaLevel - terrainH;
      
      let depthMultiplier = 1.0;
      if (depth <= 0) {
        depthMultiplier = 0.0;
      } else if (depth < 5) {
        // Fade waves out linearly as water gets shallower than 5 units
        depthMultiplier = depth / 5;
      }
      
      rawHeight *= depthMultiplier;
    }
    
    return rawHeight;
  }

  /**
   * Static wave function — can be used by any system.
   * Returns the Y offset (add to seaLevel for absolute height).
   */
  static waveHeight(wx, wz, time) {
    // Layer 1: Large rolling swells
    const w1 = Math.sin(wx * 0.05 + time * 0.45) *
               Math.cos(wz * 0.04 + time * 0.35) * 1.8;

    // Layer 2: Medium chop at an angle
    const w2 = Math.sin((wx * 0.09 + wz * 0.07) + time * 0.75) * 0.7;

    // Layer 3: Small ripples
    const w3 = Math.sin(wx * 0.18 + time * 1.15) *
               Math.cos(wz * 0.20 + time * 0.95) * 0.3;

    return w1 + w2 + w3;
  }

  update(dt) {
    this._time += dt;

    const pos = this.geometry.attributes.position;
    const count = pos.count;
    const half = this.size / 2;

    for (let i = 0; i < count; i++) {
      const wx = pos.getX(i);
      const wz = pos.getZ(i);

      // Animate Y with wave function and terrain dampening
      pos.setY(i, this.getWaveHeight(wx, wz));
    }

    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
