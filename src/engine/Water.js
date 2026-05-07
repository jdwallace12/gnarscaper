import * as THREE from 'three/webgpu';

export class Water {
  constructor(size = 200, seaLevel = -1) {
    this.size = size;
    this.seaLevel = seaLevel;
    this._time = 0;

    // Subdivided plane for wave animation
    const segments = 128;
    this.geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    this.geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.MeshStandardMaterial({
      color: 0x1a8fba,
      transparent: true,
      opacity: 0.75,
      roughness: 0.1,
      metalness: 0.5,
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
    return Water.waveHeight(wx, wz, this._time);
  }

  /**
   * Static wave function — can be used by any system.
   * Returns the Y offset (add to seaLevel for absolute height).
   */
  static waveHeight(wx, wz, time) {
    // Layer 1: Large rolling swells
    const w1 = Math.sin(wx * 0.05 + time * 0.9) *
               Math.cos(wz * 0.04 + time * 0.7) * 1.8;

    // Layer 2: Medium chop at an angle
    const w2 = Math.sin((wx * 0.09 + wz * 0.07) + time * 1.5) * 0.7;

    // Layer 3: Small ripples
    const w3 = Math.sin(wx * 0.18 + time * 2.3) *
               Math.cos(wz * 0.20 + time * 1.9) * 0.3;

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

      // Animate Y with wave function
      pos.setY(i, Water.waveHeight(wx, wz, this._time));
    }

    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
