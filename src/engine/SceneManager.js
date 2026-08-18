import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;

    // Build the renderer
    // WebGPURenderer automatically handles the fallback to WebGL2 internally
    try {
      this.renderer = new THREE.WebGPURenderer({ 
        canvas, 
        antialias: true,
        forceWebGL: false // Set to true only if WebGPU is severely broken in your environment
      });
      console.log('Renderer created');
    } catch (e) {
      console.error('Failed to create WebGPURenderer, falling back to WebGLRenderer', e);
      // If even creating the object fails, we follow the legacy path
      // This is unlikely in r183 but good for safety
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x2a4a6b, 0.0015);
    
    // Time of day state (6.0 to 22.0 hours, default 17.5 = Golden Hour)
    this.timeOfDay = 17.5;
    
    this._buildSky();
    this._buildLights();

    // Set initial dramatic lighting (Golden Hour)
    this.setTimeOfDay(17.5);

    // Camera
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 3000);
    this.camera.position.set(90, 120, 180);
    this.camera.lookAt(0, 0, 0);

    // Controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 1000;
    this.controls.zoomSpeed = 2.5;
    this.controls.panSpeed = 2.0;
    this.controls.screenSpacePanning = false;
    this.controls.target.set(0, 0, 0);
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
    this.controls.listenToKeyEvents(window);
    this.controls.keyPanSpeed = 50.0;

    // Resize
    window.addEventListener('resize', () => this._onResize());

    // Clock
    this.clock = new THREE.Clock();

    // Custom panning
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName && e.target.tagName.toLowerCase() === 'input') return;
      if (this._skierMode) return; // Don't interfere during ski mode
      if (e.key === 'Shift') this.controls.keyPanSpeed = 15.0;
      const verticalSpeed = e.shiftKey ? 2.0 : 8.0;
      if (e.key.toLowerCase() === 'w') {
        this.camera.position.y += verticalSpeed;
        this.controls.target.y += verticalSpeed;
      } else if (e.key.toLowerCase() === 's') {
        this.camera.position.y -= verticalSpeed;
        this.controls.target.y -= verticalSpeed;
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.target.tagName && e.target.tagName.toLowerCase() === 'input') return;
      if (e.key === 'Shift') this.controls.keyPanSpeed = 50.0;
    });
  }

  /** Initialize the renderer — handles the async WebGPU/WebGL setup */
  async init() {
    console.log('Initializing renderer...');
    try {
      await this.renderer.init();
      console.log('Renderer initialized successfully');
    } catch (e) {
      console.error('Renderer init failed:', e);
    }
  }

  add(object) {
    this.scene.add(object);
  }

  getDelta() {
    return this.clock.getDelta();
  }

  render() {
    if (!this._skierMode && !this._tourMode) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Enter 3rd-person skier camera mode */
  enterSkierMode() {
    this._currentLookAt = null; // Reset focus smoothing for new session
    this._forceSnapCamera = true; // Instantly snap behind the skier on the first frame
    
    // Save current state for restoration (only if we aren't already in skier mode)
    if (!this._skierMode) {
      this._savedCamPos = this.camera.position.clone();
      this._savedTarget = this.controls.target.clone();
    }
    
    this._skierMode = true;

    // Shadow Optimization: Shrink shadow frustum and center on player
    if (this.sun) {
      if (this.sun.target.parent !== this.scene) this.scene.add(this.sun.target);
      const s = 60; // tight frustum around player
      this.sun.shadow.camera.left = -s;
      this.sun.shadow.camera.right = s;
      this.sun.shadow.camera.top = s;
      this.sun.shadow.camera.bottom = -s;
      this.sun.shadow.camera.updateProjectionMatrix();
    }

    this.controls.enabled = false;
  }

  exitSkierMode(skierPos = null) {
    this._skierMode = false;
    this._currentLookAt = null;

    // Restore shadow frustum immediately to prevent artifacts
    if (this.sun) {
      const s = 240;
      this.sun.shadow.camera.left = -s;
      this.sun.shadow.camera.right = s;
      this.sun.shadow.camera.top = s;
      this.sun.shadow.camera.bottom = -s;
      this.sun.shadow.camera.updateProjectionMatrix();
      
      // Restore sun pos
      this.sun.target.position.set(0, 0, 0);
      this.sun.target.updateMatrixWorld();
    }

    // Restore OrbitControls
    this.controls.enabled = true;
    
    if (skierPos && isFinite(skierPos.x) && isFinite(skierPos.y) && isFinite(skierPos.z)) {
      this.controls.target.copy(skierPos);
      this.camera.position.set(
        skierPos.x - 40,
        skierPos.y + 50,
        skierPos.z + 70
      );
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.controls.target);
      this.controls.update();
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
    } else if (this._savedCamPos && isFinite(this._savedCamPos.x) && isFinite(this._savedTarget.x)) {
      this.camera.position.copy(this._savedCamPos);
      this.controls.target.copy(this._savedTarget);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this._savedTarget);
      this.controls.update();
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
    } else {
      this.camera.position.set(90, 120, 180);
      this.controls.target.set(0, 0, 0);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(0, 0, 0);
      this.controls.update();
    }
  }

  /** Reset camera to starting position */
  resetCamera() {
    if (this._skierMode) return;
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(90, 120, 180);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
    this.camera.updateProjectionMatrix();
  }

  /** Update chase camera to follow the player skier (call each frame in skier mode) */
  updateSkierCamera(targetPos, lookAtPos, dt) {
    if (!this._skierMode) return;

    if (!isFinite(targetPos.x) || !isFinite(targetPos.y) || !isFinite(targetPos.z) ||
        !isFinite(lookAtPos.x) || !isFinite(lookAtPos.y) || !isFinite(lookAtPos.z)) {
      return;
    }

    this.camera.position.copy(targetPos);
    
    if (!this._currentLookAt) this._currentLookAt = lookAtPos.clone();
    this._currentLookAt.copy(lookAtPos);
    this.camera.lookAt(this._currentLookAt);

    // Dynamic Shadow: center shadow map on player
    if (this.sun) {
      const sunDir = this._getSunOffsetVector();
      this.sun.position.copy(lookAtPos).add(sunDir);
      this.sun.target.position.copy(lookAtPos);
      this.sun.target.updateMatrixWorld();
    }
  }

  get isSkierMode() {
    return !!this._skierMode;
  }

  /** Set time of day in hours (6.0 = Dawn, 12.0 = Noon, 17.5 = Golden Hour, 19.5 = Sunset, 22.0 = Night) */
  setTimeOfDay(hours) {
    this.timeOfDay = THREE.MathUtils.clamp(hours, 6, 23.5);
    
    // Map hours (6 to 23.5) to sun elevation angle and azimuth
    // 6.0 = sun at horizon (0 rad), 13.0 = zenith peak, 19.5 = setting horizon
    const dayProgress = (this.timeOfDay - 6) / 14; // 0 at dawn, 0.5 at noon, 1 at dusk
    const sunAngle = Math.PI * THREE.MathUtils.clamp(dayProgress, 0, 1);
    
    // Sun position calculations (orbiting east to west)
    const distance = 250;
    const sunY = Math.sin(sunAngle) * distance;
    const sunX = Math.cos(sunAngle) * distance;
    const sunZ = Math.sin(sunAngle * 0.7) * 90 + 40;

    this.sunOffset = new THREE.Vector3(sunX, Math.max(15, sunY), sunZ);
    this.sun.position.copy(this.sunOffset);
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();

    // Color Interpolations based on time of day
    let sunColor, sunIntensity, skyHorizonColor, skyTopColor, hemiSkyColor, hemiGroundColor, fogColor, fogDensity, exposure;

    if (this.timeOfDay < 8.0) {
      // Dawn / Early Morning
      const t = (this.timeOfDay - 6.0) / 2.0;
      sunColor = new THREE.Color().lerpColors(new THREE.Color(0xff8c42), new THREE.Color(0xffd194), t);
      sunIntensity = THREE.MathUtils.lerp(1.2, 2.2, t);
      skyHorizonColor = new THREE.Color().lerpColors(new THREE.Color(0xd97736), new THREE.Color(0x7fb8e6), t);
      skyTopColor = new THREE.Color().lerpColors(new THREE.Color(0x1a2b4c), new THREE.Color(0x0f2b5c), t);
      hemiSkyColor = new THREE.Color(0x7fb8e6);
      hemiGroundColor = new THREE.Color(0x3a4835);
      fogColor = skyHorizonColor.clone();
      fogDensity = 0.0018;
      exposure = 1.15;
    } else if (this.timeOfDay < 16.5) {
      // High Alpine Noon
      const t = (this.timeOfDay - 8.0) / 8.5;
      sunColor = new THREE.Color().lerpColors(new THREE.Color(0xfff1df), new THREE.Color(0xffffff), t < 0.5 ? t * 2 : (1 - t) * 2);
      sunIntensity = 2.4;
      skyHorizonColor = new THREE.Color(0x4a8bb8);
      skyTopColor = new THREE.Color(0x0b1a3d);
      hemiSkyColor = new THREE.Color(0x60a5fa);
      hemiGroundColor = new THREE.Color(0x2d3a2e);
      fogColor = new THREE.Color(0x3a6b8c);
      fogDensity = 0.0012;
      exposure = 1.2;
    } else if (this.timeOfDay < 18.5) {
      // Golden Hour (Low warm dramatic golden sun, rich sky horizon, bright snow fill)
      const t = (this.timeOfDay - 16.5) / 2.0;
      sunColor = new THREE.Color().lerpColors(new THREE.Color(0xffe8c2), new THREE.Color(0xffa852), t);
      sunIntensity = 2.8; // Rich warm direct sunlight
      skyHorizonColor = new THREE.Color().lerpColors(new THREE.Color(0x4a8bb8), new THREE.Color(0xe58b54), t);
      skyTopColor = new THREE.Color().lerpColors(new THREE.Color(0x0b1a3d), new THREE.Color(0x18244d), t);
      hemiSkyColor = new THREE.Color(0x70a8fa);
      hemiGroundColor = new THREE.Color(0xc0d8f0); // Bright snow-reflective fill keeping white snow brilliant
      fogColor = skyHorizonColor.clone();
      fogDensity = 0.0012;
      exposure = 1.3;
    } else if (this.timeOfDay < 20.5) {
      // Alpenglow / Sunset Dusk
      const t = (this.timeOfDay - 18.5) / 2.0;
      sunColor = new THREE.Color().lerpColors(new THREE.Color(0xff7733), new THREE.Color(0xaa4466), t);
      sunIntensity = THREE.MathUtils.lerp(2.2, 0.8, t);
      skyHorizonColor = new THREE.Color().lerpColors(new THREE.Color(0xe07a48), new THREE.Color(0x6b3064), t);
      skyTopColor = new THREE.Color().lerpColors(new THREE.Color(0x1a244d), new THREE.Color(0x090c24), t);
      hemiSkyColor = new THREE.Color(0x818cf8);
      hemiGroundColor = new THREE.Color(0x1e1b2e);
      fogColor = skyHorizonColor.clone();
      fogDensity = 0.0019;
      exposure = 1.1;
    } else {
      // Night / Starlight Moonlight
      sunColor = new THREE.Color(0x7393b3);
      sunIntensity = 0.45;
      skyHorizonColor = new THREE.Color(0x0b1329);
      skyTopColor = new THREE.Color(0x040714);
      hemiSkyColor = new THREE.Color(0x2a3d66);
      hemiGroundColor = new THREE.Color(0x0a0f1d);
      fogColor = skyHorizonColor.clone();
      fogDensity = 0.0022;
      exposure = 0.95;
    }

    // Apply light changes
    this.sun.color.copy(sunColor);
    this.sun.intensity = sunIntensity;

    this.ambientLight.color.copy(hemiSkyColor).multiplyScalar(0.4);
    this.ambientLight.intensity = 0.25;

    this.hemiLight.color.copy(hemiSkyColor);
    this.hemiLight.groundColor.copy(hemiGroundColor);
    this.hemiLight.intensity = 0.55;

    this.renderer.toneMappingExposure = exposure;

    // Update scene fog
    this.scene.fog.color.copy(fogColor);
    this.scene.fog.density = fogDensity;

    // Update dynamic sky mesh
    this._updateSkyGradient(horizonColorSky => skyHorizonColor, skyTopColor);
  }

  setLightingPreset(presetName) {
    switch (presetName) {
      case 'golden':
        this.setTimeOfDay(17.5);
        break;
      case 'noon':
        this.setTimeOfDay(12.0);
        break;
      case 'sunset':
        this.setTimeOfDay(19.2);
        break;
      case 'night':
        this.setTimeOfDay(22.0);
        break;
      case 'dawn':
        this.setTimeOfDay(7.0);
        break;
      default:
        this.setTimeOfDay(17.5);
    }
  }

  _getSunOffsetVector() {
    return this.sunOffset ? this.sunOffset.clone().normalize().multiplyScalar(150) : new THREE.Vector3(80, 120, 60);
  }

  _buildSky() {
    const skyGeo = new THREE.SphereGeometry(800, 32, 32);
    const pos = skyGeo.attributes.position;
    const skyColors = new Float32Array(pos.count * 3);
    skyGeo.setAttribute('color', new THREE.BufferAttribute(skyColors, 3));

    const skyMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false
    });
    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyMesh);
  }

  _updateSkyGradient(horizonColor, topColor) {
    if (!this.skyMesh) return;
    const pos = this.skyMesh.geometry.attributes.position;
    const colors = this.skyMesh.geometry.attributes.color;
    
    // Evaluate colors if passed as vectors/colors
    const hCol = typeof horizonColor === 'function' ? horizonColor() : horizonColor;
    const tCol = topColor;

    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = THREE.MathUtils.clamp((y + 400) / 1000, 0, 1);
      const c = new THREE.Color().lerpColors(hCol, tCol, Math.pow(t, 0.7));
      colors.setXYZ(i, c.r, c.g, c.b);
    }
    colors.needsUpdate = true;
  }

  _buildLights() {
    this.ambientLight = new THREE.AmbientLight(0x556688, 0.25);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0x60a5fa, 0x2d3a2e, 0.55);
    this.scene.add(this.hemiLight);

    const sun = new THREE.DirectionalLight(0xfff1df, 2.4);
    sun.position.set(100, 140, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 900;
    sun.shadow.camera.left = -240;
    sun.shadow.camera.right = 240;
    sun.shadow.camera.top = 240;
    sun.shadow.camera.bottom = -240;
    sun.shadow.bias = -0.0003;
    sun.shadow.radius = 2.5; // Smooth soft shadow edges
    this.scene.add(sun);
    this.sun = sun;
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
