/**
 * Sculpting tool definitions.
 * Each tool has a name, icon, color, and an apply() function.
 */

import { fbm, ridgedNoise } from '../engine/noise.js';

export const TOOLS = {
  camera: {
    name: 'Rotate Camera',
    icon: '🔄',
    color: '#9ca3af',
    cursor: 'grab',
    isBrush: false,
    isCamera: true,
    category: 'Camera',
  },

  pan_camera: {
    name: 'Pan Camera',
    icon: '🖐️',
    color: '#9ca3af',
    cursor: 'grab',
    isBrush: false,
    isCamera: true,
    isPan: true,
    category: 'Camera',
  },
  
  raise: {
    name: 'Raise',
    icon: '⛰️',
    color: '#4ade80',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Mountains',
    apply(heightmap, res, cx, cz, radius, strength, isStart, noiseAmount = 0.5) {
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        const x = i % res;
        const z = Math.floor(i / res);
        // Add a bit of organic noise so it doesn't look like a smooth blob
        const noise = fbm(x * 0.1, z * 0.1, 3, 2.0, 0.5) * 0.5 + 0.5; // 0..1
        heightmap[i] += strength * falloff * ( (1.0 - noiseAmount) + (noise * noiseAmount * 1.5) );
      });
    },
  },
  
  hill: {
    name: 'Hill',
    icon: '🏔️',
    color: '#86efac',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Mountains',
    apply(heightmap, res, cx, cz, radius, strength, isStart, noiseAmount = 0.5) {
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        const x = i % res;
        const z = Math.floor(i / res);
        // Add subtle organic texture to hills
        const noise = fbm(x * 0.08, z * 0.08, 2, 2.0, 0.5) * 0.5 + 0.5;
        const targetLift = strength * Math.pow(falloff, 2) * ((1.0 - noiseAmount * 0.4) + (noise * noiseAmount * 0.8));
        heightmap[i] += targetLift * 0.4;
      });
    },
  },

  peak: {
    name: 'Peak',
    icon: '🗻',
    color: '#d946ef',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Mountains',
    apply(heightmap, res, cx, cz, radius, strength, isStart, noiseAmount = 0.5) {
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        const x = i % res;
        const z = Math.floor(i / res);
        // Sharp spire/peak using tighter exponential falloff
        // Add more aggressive noise for craggy peaks
        const noise = fbm(x * 0.15, z * 0.15, 4, 2.0, 0.5) * 0.5 + 0.5; // 0..1
        heightmap[i] += strength * Math.pow(falloff, 4) * 0.8 * ( (1.0 - noiseAmount) + (noise * noiseAmount * 2.0) );
      });
    },
  },

  couloir: {
    name: 'Couloir',
    icon: '⚡',
    color: '#e2e8f0',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Mountains',
    apply(heightmap, res, cx, cz, radius, strength) {
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        // Flat bottom with aggressive steep sides, forming a U-shaped chute.
        // This avoids digging a massive sharp hole in the center.
        const chuteFalloff = Math.min(1.0, falloff * 2.5);
        heightmap[i] -= strength * chuteFalloff * 0.8;
      });
    },
  },

  spires: {
    name: 'Spires',
    icon: '🌵',
    color: '#ea580c',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Nature',
    apply(heightmap, res, cx, cz, radius, strength, isStart, noiseAmount = 0.5) {
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        const x = i % res;
        const z = Math.floor(i / res);
        
        // Very high frequency noise to isolate thin pillars
        const n = fbm(x * 0.45, z * 0.45, 4, 2.2, 0.5) * 0.5 + 0.5; // 0..1
        
        // Threshold the noise to create separate spires
        if (n > 0.65) {
          // Normalize the spire intensity
          const spireIntensity = (n - 0.65) / 0.35;
          // Apply a sharp power to make them thin and vertical
          const spireShape = Math.pow(spireIntensity, 2.5);
          
          let h = strength * radius * 1.8 * falloff * spireShape;
          
          // Bryce Canyon "layered" effect: 
          // Quantize the vertical growth into discrete sedimentary bands
          const layerSize = 1.0;
          h = Math.floor(h / layerSize) * layerSize;
          
          heightmap[i] += h;
        }
      });
    },
  },

  cliff: {
    name: 'Cliff Band',
    icon: '🧗',
    color: '#71717a',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Mountains',
    apply(heightmap, res, cx, cz, radius, strength) {
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        const stepSize = 10.0;
        const h = heightmap[i];
        
        const localH = h / stepSize;
        const band = Math.floor(localH);
        const fract = localH - band;
        
        // Create an S-curve staircase: gentle terrace slope, then steep cliff face
        let newFract;
        if (fract < 0.7) {
          // 70% of the step is a gentle terrace (20% original slope)
          newFract = fract * 0.2; 
        } else {
          // 30% of the step is the actual steep cliff
          const t = (fract - 0.7) / 0.3;
          const smooth = t * t * (3 - 2 * t);
          newFract = 0.7 * 0.2 + smooth * (1.0 - 0.7 * 0.2);
        }
        
        const targetH = (band + newFract) * stepSize;
        
        // Blend towards the terraced geometry
        const cliffFalloff = Math.pow(falloff, 0.5); 
        heightmap[i] += (targetH - h) * cliffFalloff * strength * 0.5;
      });
    },
  },

  lower: {
    name: 'Lower',
    icon: '🕳️',
    color: '#60a5fa',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Utility',
    apply(heightmap, res, cx, cz, radius, strength) {
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        heightmap[i] -= strength * falloff;
      });
    },
  },

  bowl: {
    name: 'Bowl',
    icon: '🥣',
    color: '#a78bfa',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Mountains',
    apply(heightmap, res, cx, cz, radius, strength, isStart, noiseAmount = 0.5) {
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        const x = i % res;
        const z = Math.floor(i / res);
        // Add noise to the bowl floor and rim
        const noise = fbm(x * 0.1, z * 0.1, 2, 2.0, 0.5) * 0.5 + 0.5;
        const flatFalloff = Math.min(1.0, falloff * 1.8);
        const effect = strength * flatFalloff * 0.6 * ((1.0 - noiseAmount * 0.3) + (noise * noiseAmount * 0.6));
        heightmap[i] -= effect;
      });
    },
  },

  smooth: {
    name: 'Smooth',
    icon: '🌊',
    color: '#c084fc',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Utility',
    apply(heightmap, res, cx, cz, radius, strength) {
      // We need a copy to read from while writing
      const copy = new Float32Array(heightmap);
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        const x = i % res;
        const z = Math.floor(i / res);
        let sum = 0, count = 0;
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx, nz = z + dz;
            if (nx >= 0 && nx < res && nz >= 0 && nz < res) {
              sum += copy[nz * res + nx];
              count++;
            }
          }
        }
        const avg = sum / count;
        heightmap[i] += (avg - heightmap[i]) * falloff * strength * 0.5;
      });
    },
  },

  roughen: {
    name: 'Roughen',
    icon: '📊',
    color: '#a78bfa',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Utility',
    apply(heightmap, res, cx, cz, radius, strength, isStart, noiseAmount = 0.5) {
      // Add fBm noise to make terrain look more organic and rough
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        const x = i % res;
        const z = Math.floor(i / res);
        
        // Use a fixed scale for the brush noise so it doesn't change wildly
        // Offset by the grid coordinates
        const scale = 15.0;
        const noiseVal = fbm(x / res * scale, z / res * scale, 4, 2.0, 0.5);
        
        // Apply noise relative to strength, falloff, and noiseAmount slider
        heightmap[i] += noiseVal * strength * falloff * noiseAmount;
      });
    },
  },

  erode: {
    name: 'Erode',
    icon: '💧',
    color: '#78716c',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Utility',
    apply(heightmap, res, cx, cz, radius, strength) {
      // Erosion: steeper areas get carved more, material flows downhill
      // Read from a copy to avoid feedback loops within a single pass
      const copy = new Float32Array(heightmap);
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        const x = i % res;
        const z = Math.floor(i / res);
        if (x < 1 || x >= res - 1 || z < 1 || z >= res - 1) return;

        // Compute local gradient (steepness)
        const hL = copy[z * res + (x - 1)];
        const hR = copy[z * res + (x + 1)];
        const hU = copy[(z - 1) * res + x];
        const hD = copy[(z + 1) * res + x];
        const h = copy[i];

        const gradX = (hR - hL) * 0.5;
        const gradZ = (hD - hU) * 0.5;
        const steepness = Math.sqrt(gradX * gradX + gradZ * gradZ);

        // Steeper areas erode more aggressively — carve channels
        const erosionAmount = steepness * strength * falloff * 0.8;
        heightmap[i] -= erosionAmount;

        // Deposit a fraction of eroded material downhill
        const gradMag = steepness || 0.001;
        const dnx = Math.round(-gradX / gradMag);
        const dnz = Math.round(-gradZ / gradMag);
        const nx = x + dnx;
        const nz = z + dnz;
        if (nx >= 0 && nx < res && nz >= 0 && nz < res) {
          heightmap[nz * res + nx] += erosionAmount * 0.3; // 30% deposited downhill
        }

        // Gentle areas get smoothed (sediment fills in)
        if (steepness < 0.3) {
          const avg = (hL + hR + hU + hD) / 4;
          heightmap[i] += (avg - h) * falloff * strength * 0.2;
        }
      });
    },
  },

  flatten: {
    name: 'Flatten',
    icon: '⬜',
    color: '#fbbf24',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Utility',
    _targetHeight: null,
    apply(heightmap, res, cx, cz, radius, strength, isStart) {
      if (isStart || this._targetHeight === null) {
        const ci = Math.round(cz) * res + Math.round(cx);
        this._targetHeight = heightmap[ci] ?? 0;
      }
      const target = this._targetHeight;
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        heightmap[i] += (target - heightmap[i]) * falloff * strength * 0.3;
      });
    },
  },

  ramp: {
    name: 'Ramp',
    icon: '📐',
    color: '#f97316',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Features',
    _startX: null,
    _startZ: null,
    _startH: null,
    apply(heightmap, res, cx, cz, radius, strength, isStart) {
      const ci = Math.round(cz) * res + Math.round(cx);
      
      // Capture the start of the ramp
      if (isStart || this._startX === null) {
        this._startX = cx;
        this._startZ = cz;
        this._startH = heightmap[ci] ?? 0;
      }

      // The current end of the ramp is the terrain height at our current brush center
      const currentH = heightmap[ci] ?? 0;
      
      const dx = cx - this._startX;
      const dz = cz - this._startZ;
      const distSq = dx * dx + dz * dz;

      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        const x = i % res;
        const z = Math.floor(i / res);
        
        let targetH = currentH; 
        if (distSq > 0.1) {
          // Project the current grid point (x, z) onto the line from Start to Current
          const px = x - this._startX;
          const pz = z - this._startZ;
          
          // t is the normalized projection mapping representing progress along the ramp
          const t = (px * dx + pz * dz) / distSq;
          targetH = this._startH + t * (currentH - this._startH);
        }

        // Pull terrain towards the slanted ramp plane
        heightmap[i] += (targetH - heightmap[i]) * falloff * strength * 0.4;
      });
    },
  },

  jump: {
    name: 'Ski Jump',
    icon: '🚀',
    color: '#f43f5e',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Features',
    _startX: null,
    _startZ: null,
    _startH: null,
    apply(heightmap, res, cx, cz, radius, strength, isStart) {
      const ci = Math.round(cz) * res + Math.round(cx);

      if (isStart || this._startX === null) {
        this._startX = cx;
        this._startZ = cz;
        this._startH = heightmap[ci] ?? 0;
      }

      const dirX = cx - this._startX;
      const dirZ = cz - this._startZ;
      const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);

      if (dirLen < 1.0) return;

      const ndx = dirX / dirLen;
      const ndz = dirZ / dirLen;
      const perpX = -ndz;
      const perpZ = ndx;

      const currentH = heightmap[ci] ?? 0;

      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        const x = i % res;
        const z = Math.floor(i / res);

        const px = x - this._startX;
        const pz = z - this._startZ;

        const along = px * ndx + pz * ndz;
        const across = px * perpX + pz * perpZ;

        // Normalized cross-section position: -1 to 1 across the jump width
        const crossT = across / radius;

        if (Math.abs(crossT) > 1.2) return;

        // Create a flat surface that drops off smoothly at the edges
        let crossFalloff = 1.0;
        const flatWidth = 0.5;
        if (Math.abs(crossT) > flatWidth) {
           const edgeT = (Math.abs(crossT) - flatWidth) / (1.0 - flatWidth);
           // Smoothstep for the steep dropoff
           crossFalloff = 1.0 - (edgeT * edgeT * (3 - 2 * edgeT));
        }
        if (crossFalloff <= 0) return;

        // We want the kicker to form along the drag line (from 0 to dirLen)
        if (along < -radius) return;
        
        let t = Math.max(0, Math.min(1, along / dirLen));

        // The base slope of the jump (straight line from start to end)
        const baseSlopeH = this._startH + t * (currentH - this._startH);

        // The kicker curve: dips slightly, then curves up exponentially
        // We use strength to define the max height of the kicker lip
        const kickerLipH = strength * 25.0; 
        
        // A simple polynomial for the kicker lip: y = 2*t^3 - t
        // Creates a slight swoop down before kicking up hard at t=1
        const curve = 2.0 * Math.pow(t, 3) - 1.0 * t;

        const targetH = baseSlopeH + Math.max(0, curve) * kickerLipH + Math.min(0, curve) * kickerLipH * 0.3;

        // Blend the terrain strongly into the flat kicker profile
        heightmap[i] += (targetH - heightmap[i]) * falloff * crossFalloff * 0.5;
      });
    },
  },

  ski_trail: {
    name: 'Ski Trail',
    icon: '🎿',
    color: '#38bdf8',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Features',
    _targetHeight: null,
    apply(heightmap, res, cx, cz, radius, strength, isStart, noiseAmount, snowmap) {
      const ci = Math.round(cz) * res + Math.round(cx);
      const localH = heightmap[ci] ?? 0;

      if (isStart || this._targetHeight === null) {
        this._targetHeight = localH;
      }
      
      // Moving average follows the slope but filters out sharp bumps
      this._targetHeight += (localH - this._targetHeight) * 0.15;
      
      // Subtract a small offset so it "carves" into the terrain
      const target = this._targetHeight - 1.0; 
      
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        // 1. Smooth/Carve terrain
        // We pull terrain DOWN to the target more aggressively than we pull it up
        const diff = target - heightmap[i];
        const weight = diff < 0 ? 0.5 : 0.2; 
        heightmap[i] += diff * falloff * strength * weight;
        
        // 2. Add snow to the snowmap
        if (snowmap) {
          snowmap[i] = Math.max(snowmap[i], Math.min(1.0, falloff * 1.5));
        }
      });
    },
  },

  halfpipe: {
    name: 'Half Pipe',
    icon: '🛹',
    color: '#06b6d4',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Features',
    _startX: null,
    _startZ: null,
    _startH: null,
    apply(heightmap, res, cx, cz, radius, strength, isStart) {
      const ci = Math.round(cz) * res + Math.round(cx);

      // Capture the start of the halfpipe
      if (isStart || this._startX === null) {
        this._startX = cx;
        this._startZ = cz;
        this._startH = heightmap[ci] ?? 0;
      }

      // Direction vector from start to current brush position
      const dirX = cx - this._startX;
      const dirZ = cz - this._startZ;
      const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);

      // Need a minimum drag distance to establish direction
      if (dirLen < 1.0) return;

      // Normalized direction (along the pipe) and perpendicular (across the pipe)
      const ndx = dirX / dirLen;
      const ndz = dirZ / dirLen;
      // Perpendicular = 90° rotation of direction
      const perpX = -ndz;
      const perpZ = ndx;

      const currentH = heightmap[ci] ?? 0;

      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        const x = i % res;
        const z = Math.floor(i / res);

        // Vector from start to this grid point
        const px = x - this._startX;
        const pz = z - this._startZ;

        // Project onto pipe direction (along) and perpendicular (across)
        const along = px * ndx + pz * ndz;
        const across = px * perpX + pz * perpZ;

        // Normalized cross-section position: -1 to 1 across the pipe width
        const crossT = across / radius;

        // Skip points far outside the pipe width
        if (Math.abs(crossT) > 1.0) return;

        // U-shaped cross section using cosine curve:
        // At center (crossT=0): cos(0) = 1 → lowest point (dig down)
        // At edges (crossT=±1): cos(π) = -1 → highest point (walls rise)
        // Shifted so: profile goes from -1 (wall top) to +1 (trough bottom)
        const uProfile = Math.cos(crossT * Math.PI);

        // Graded height: interpolate along the drag direction
        const t = along / dirLen;
        const gradedH = this._startH + t * (currentH - this._startH);

        // Wall height and trough depth scale with strength
        const wallHeight = strength * 2.5;
        const troughDepth = strength * 3.0;

        // Combine: negative uProfile = walls up, positive = trough down
        const shapeOffset = uProfile > 0
          ? -uProfile * troughDepth   // Dig center down
          : -uProfile * wallHeight;   // Raise walls up

        const targetH = gradedH + shapeOffset;

        // Blend toward the target shape
        heightmap[i] += (targetH - heightmap[i]) * falloff * 0.35;
      });
    },
  },

  pillowline: {
    name: 'Pillow Line',
    icon: '☁️',
    color: '#e2e8f0',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Features',
    apply(heightmap, res, cx, cz, radius, strength, isStart, noiseAmount, snowmap) {
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        const x = i % res;
        const z = Math.floor(i / res);

        // Two offset noise fields — multiplying them isolates peaks
        // into distinct rounded bumps instead of continuous ridges
        const scale = 0.25;
        const n1 = fbm(x * scale, z * scale, 2, 2.0, 0.5) * 0.5 + 0.5;       // 0..1
        const n2 = fbm(x * scale + 100, z * scale + 100, 2, 2.0, 0.5) * 0.5 + 0.5; // 0..1

        // Multiply creates isolated peaks where BOTH fields are high
        const combined = n1 * n2;

        // Smoothstep for rounder, gentler bumps (no jagged peaks)
        const t = Math.min(1, combined * 2.0);
        const pillow = t * t * (3 - 2 * t); // hermite smoothstep: 0..1

        // Low contrast: valleys still grow, peaks grow a bit more
        // This keeps bumps uniform in height and rounded
        heightmap[i] += strength * falloff * (0.5 + pillow * 0.8);

        // Paint snow on pillow tops
        if (snowmap) {
          snowmap[i] = Math.max(snowmap[i], pillow * falloff);
        }
      });
    }
  },

  spine: {
    name: 'Spine',
    icon: '🦴',
    color: '#a8a29e',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Features',
    _startX: null,
    _startZ: null,
    _dirX: 0,
    _dirZ: 1,
    _locked: false,
    _startX: null,
    _startZ: null,
    apply(heightmap, res, cx, cz, radius, strength, isStart, noiseAmount, snowmap) {
      if (isStart) {
        this._startX = cx;
        this._startZ = cz;
        this._locked = false;
      }

      // Lock direction once we have enough drag distance
      if (!this._locked && this._startX !== null) {
        const dx = cx - this._startX;
        const dz = cz - this._startZ;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len > 4) {
          // Ridges run along drag direction, wave is perpendicular
          this._dirX = -dz / len;
          this._dirZ = dx / len;
          this._locked = true;
        }
      }

        // Calculate perpendicular axis to the drag
        const perpX = this._dirX;
        const perpZ = this._dirZ;
        // Calculate axis along the drag
        const alongX = -perpZ;
        const alongZ = perpX;

        applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
          const x = i % res;
          const z = Math.floor(i / res);

          // Project onto both axes to create a grid of pillars
          const projCross = x * perpX + z * perpZ;
          const projAlong = x * alongX + z * alongZ;

          const ridgeSpacing = 22.0;
          const waveCross = Math.sin(projCross / ridgeSpacing * Math.PI);
          const waveAlong = Math.sin(projAlong / ridgeSpacing * Math.PI);

          // Combining waves on both axes creates individual cuboid columns
          const combined = Math.max(0, waveCross) * Math.max(0, waveAlong);

          // Steep but slightly more natural sides
          const steep = Math.pow(combined, 0.12);

          // Flat-top logic
          const topNoise = fbm(x * 0.3, z * 0.3, 2, 2.0, 0.5);
          const topCap = 0.9 + topNoise * 0.06;
          const flat = Math.min(steep, topCap);

          // Ledges / Banding
          const banding = Math.floor(steep * 8) / 8;
          let spine = flat * 0.75 + banding * 0.25;

          // Blocky noise
          const n = fbm(x * 0.2, z * 0.2, 3, 2.0, 0.5);
          spine *= (0.8 + n * 0.4);

          // Height output
          heightmap[i] += strength * falloff * (0.05 + spine * 4.0);

        if (snowmap) {
          snowmap[i] = Math.max(snowmap[i], spine * falloff);
        }
      });
    }
  },

  ridge: {
    name: 'Ridge',
    icon: '🔺',
    color: '#f59e0b',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Mountains',
    _startX: null,
    _startZ: null,
    _startH: null,
    apply(heightmap, res, cx, cz, radius, strength, isStart, noiseAmount = 0.5) {
      const ci = Math.round(cz) * res + Math.round(cx);

      // Capture the start of the ridge
      if (isStart || this._startX === null) {
        this._startX = cx;
        this._startZ = cz;
        this._startH = heightmap[ci] ?? 0;
      }

      // Direction vector from start to current brush position
      const dirX = cx - this._startX;
      const dirZ = cz - this._startZ;
      const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);

      // Need a minimum drag distance to establish direction
      if (dirLen < 1.0) return;

      // Normalized direction (along the ridge) and perpendicular
      const ndx = dirX / dirLen;
      const ndz = dirZ / dirLen;
      const perpX = -ndz;
      const perpZ = ndx;

      const currentH = heightmap[ci] ?? 0;

      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        const x = i % res;
        const z = Math.floor(i / res);

        // Vector from start to this grid point
        const px = x - this._startX;
        const pz = z - this._startZ;

        // Project onto ridge direction (along) and perpendicular (across)
        const along = px * ndx + pz * ndz;
        const across = px * perpX + pz * perpZ;

        // Normalized cross-section position: -1 to 1
        const crossT = Math.max(-1, Math.min(1, across / radius));

        // Ridge profile: raised spine at center, sloping down to sides
        const ridgeProfile = (Math.cos(crossT * Math.PI) + 1) * 0.5; // 0 at edges, 1 at center
        const sharpProfile = ridgeProfile * ridgeProfile;

        // Graded height along the drag direction
        const t = along / dirLen;
        const gradedH = this._startH + t * (currentH - this._startH);

        // Add jagged noise to the ridge spine based on the noise slider
        const ridgeNoise = fbm(x * 0.15, z * 0.15, 3, 2.0, 0.5) * 0.5 + 0.5;
        const noiseMod = (1.0 - noiseAmount * 0.6) + (ridgeNoise * noiseAmount * 1.2);

        // Ridge height scales with strength
        const ridgeHeight = strength * 4.0;
        const targetH = gradedH + sharpProfile * ridgeHeight * noiseMod;

        // Blend toward the target shape
        heightmap[i] += (targetH - heightmap[i]) * falloff * 0.3;
      });
    },
  },

  plateau: {
    name: 'Plateau',
    icon: '🔲',
    color: '#a3a3a3',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Mountains',
    _targetHeight: null,
    apply(heightmap, res, cx, cz, radius, strength, isStart) {
      if (isStart || this._targetHeight === null) {
        const ci = Math.round(cz) * res + Math.round(cx);
        this._targetHeight = heightmap[ci] ?? 0;
      }
      const target = this._targetHeight;

      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        // Sharp-edged plateau: use a step function instead of smooth Gaussian
        // Create a flat interior with a steep rim at the edges
        // Remap falloff so most of the interior is at full strength
        const plateauFalloff = Math.min(1.0, Math.pow(falloff, 0.3));

        // Raise a subtle rim at the boundary where falloff drops off
        // The rim zone is where falloff is between 0.15 and 0.5
        let rimBoost = 0;
        if (falloff > 0.05 && falloff < 0.4) {
          const rimT = (falloff - 0.05) / 0.35;
          rimBoost = Math.sin(rimT * Math.PI) * strength * 1.5;
        }

        const targetH = target + rimBoost;
        heightmap[i] += (targetH - heightmap[i]) * plateauFalloff * strength * 0.4;
      });
    },
  },

  snowmaker: {
    name: 'Snow Maker',
    icon: '❄️',
    color: '#a5f3fc',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Nature',
    isSnowBrush: true,
    apply(snowmap, res, cx, cz, radius, strength, isStart, noiseAmount, _ignored, heightmap) {
      applyBrush(snowmap, res, cx, cz, radius, (i, falloff) => {
        const x = i % res;
        const z = Math.floor(i / res);
        
        let curvature = 0;
        if (heightmap && x > 0 && x < res - 1 && z > 0 && z < res - 1) {
          const hL = heightmap[z * res + (x - 1)];
          const hR = heightmap[z * res + (x + 1)];
          const hU = heightmap[(z - 1) * res + x];
          const hD = heightmap[(z + 1) * res + x];
          const h = heightmap[i];
          curvature = hL + hR + hU + hD - 4.0 * h;
        }

        // Valley/Couloir (curvature > 0) speeds up accumulation up to 3.0x.
        // Convex ridges (curvature < 0) slow down accumulation down to 0.1x.
        const curvatureMultiplier = curvature >= 0 
          ? 1.0 + Math.min(2.0, curvature * 4.0) 
          : Math.max(0.1, 1.0 + curvature * 3.0);

        snowmap[i] += strength * falloff * 0.5 * curvatureMultiplier;
        if (snowmap[i] > 1.0) snowmap[i] = 1.0;
      });
    },
  },

  grassmaker: {
    name: 'Grass',
    icon: '🌿',
    color: '#2d5a27',
    cursor: 'crosshair',
    isBrush: true,
    category: 'Nature',
    isGrassBrush: true,
    apply(grassmap, res, cx, cz, radius, strength, isStart, noiseAmount, snowmap, heightmap) {
      applyBrush(grassmap, res, cx, cz, radius, (i, falloff) => {
        const x = i % res;
        const z = Math.floor(i / res);
        
        let curvature = 0;
        if (heightmap && x > 0 && x < res - 1 && z > 0 && z < res - 1) {
          const hL = heightmap[z * res + (x - 1)];
          const hR = heightmap[z * res + (x + 1)];
          const hU = heightmap[(z - 1) * res + x];
          const hD = heightmap[(z + 1) * res + x];
          const h = heightmap[i];
          curvature = hL + hR + hU + hD - 4.0 * h;
        }

        const curvatureMultiplier = curvature >= 0 
          ? 1.0 + Math.min(2.0, curvature * 3.0) 
          : Math.max(0.2, 1.0 + curvature * 2.0);

        grassmap[i] += strength * falloff * 0.5 * curvatureMultiplier;
        if (grassmap[i] > 1.0) grassmap[i] = 1.0;
      });
    },
  },


  boulders: {
    name: 'Boulders',
    icon: '🪨',
    color: '#9ca3af',
    cursor: 'crosshair',
    isBrush: false,
    category: 'Nature',
    isBoulder: true,
    apply() { /* no-op — handled externally */ },
  },

  demolish: {
    name: 'Demolish',
    icon: '💥',
    color: '#ef4444',
    cursor: 'crosshair',
    isBrush: false,
    category: 'Utility',
    isDemolish: true,
    apply() { /* no-op — handled externally */ },
  },

  skier: {
    name: 'Skier',
    icon: '⛷️',
    color: '#e63946',
    cursor: 'crosshair',
    isBrush: false,
    category: 'Skiing',
    isSkier: true,
    apply() { /* no-op — skier placement handled externally */ },
  },

  chairlift: {
    name: 'Chairlift',
    icon: '🚡',
    color: '#3b82f6',
    cursor: 'crosshair',
    isBrush: false,
    category: 'Skiing',
    isChairlift: true,
    liftType: 'chairlift',
    apply() { /* no-op — handled externally */ },
  },

  tram: {
    name: 'Aerial Tram',
    icon: '🚠',
    color: '#f59e0b',
    cursor: 'crosshair',
    isBrush: false,
    category: 'Skiing',
    isTram: true,
    isChairlift: true,
    liftType: 'tram',
    apply() { /* no-op — handled externally */ },
  },
  
  trees: {
    name: 'Trees',
    icon: '🌲',
    color: '#34d399',
    cursor: 'crosshair',
    isBrush: false,  // handled specially in main.js
    category: 'Nature',
    isTree: true,
    apply() { /* no-op — tree placement handled externally */ },
  },

  river: {
    name: 'River',
    icon: '🏞️',
    color: '#38bdf8',
    cursor: 'crosshair',
    isBrush: false,
    category: 'Nature',
    isRiver: true,
    apply() { /* no-op — handled externally via two-click placement */ },
  },
};

/**
 * Generic brush applicator with Gaussian falloff.
 */
function applyBrush(heightmap, res, cx, cz, radius, fn) {
  const r = Math.ceil(radius);
  const gx = Math.round(cx);
  const gz = Math.round(cz);

  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = gx + dx;
      const z = gz + dz;
      if (x < 0 || x >= res || z < 0 || z >= res) continue;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > radius) continue;
      // Gaussian falloff
      const sigma = radius * 0.45;
      const falloff = sigma > 0.001 
        ? Math.exp(-((dist * dist) / (2 * sigma * sigma)))
        : (dist < 0.1 ? 1.0 : 0.0);
      const i = z * res + x;
      fn(i, falloff);
    }
  }
}
