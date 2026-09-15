import * as THREE from 'three/webgpu';
import { Snowmobile } from './Snowmobile.js';

/**
 * Shared registry of all placed snowmobiles in the world.
 * Used by both the editor tool (click-to-place) and the player/NPC systems
 * so everyone operates on the same list.
 */
export class Snowmobiles {
  constructor(terrain, seaLevel = 1) {
    this.terrain = terrain;
    this.seaLevel = seaLevel;
    this.group = new THREE.Group();
    this.snowmobiles = []; // Snowmobile[]
  }

  /** Place a new snowmobile at world position (wx, wz) */
  place(wx, wz, heading = 0) {
    const sno = new Snowmobile(this.terrain, this.seaLevel);
    sno.spawn(wx, wz);
    sno.heading = heading;
    this.snowmobiles.push(sno);
    this.group.add(sno.group);
    return sno;
  }

  /** Remove all snowmobiles */
  clear() {
    for (const sno of this.snowmobiles) {
      sno.despawn();
      this.group.remove(sno.group);
    }
    this.snowmobiles = [];
  }

  /** Remove snowmobiles within a world radius (for the demolish tool) */
  removeNear(wx, wz, radius) {
    const toRemove = this.snowmobiles.filter(s => s.distanceTo(wx, wz) < radius);
    for (const sno of toRemove) {
      sno.despawn();
      this.group.remove(sno.group);
    }
    this.snowmobiles = this.snowmobiles.filter(s => !toRemove.includes(s));
  }

  /**
   * Update all snowmobiles that are NOT currently mounted by the player.
   * NPC-driven ones pass an AI keys object; idle ones pass null (coast to stop).
   * @param {number} dt
   */
  update(dt) {
    for (const sno of this.snowmobiles) {
      if (!sno.active) continue;
      // Player-mounted snowmobiles are updated by PlayerSkier._updateSnowmobile
      // NPC-mounted ones are updated by Skiers with AI keys passed in via sno._npcKeys
      if (sno.riderMounted) {
        if (sno._npcKeys) {
          sno.update(dt, sno._npcKeys);
        }
        // player-mounted: PlayerSkier calls sno.update itself
      } else {
        sno.update(dt, null); // coast to a stop
      }
    }
  }

  /** Visual interpolation for all snowmobiles */
  interpolateVisuals(alpha) {
    for (const sno of this.snowmobiles) {
      if (sno.active) sno.interpolateVisuals(alpha);
    }
  }
}
