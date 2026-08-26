import { TOOLS } from '../tools/tools.js';

export class UI {
  constructor({ onToolChange, onBrushRadius, onBrushStrength, onNoiseLevel, onSeaLevel, onBaseElevation, onSnowPack, onCloudAmount, onUndo, onRedo, onReset, onSave, onLoad, onTreeDensity, onToggleWireframe, onToggleSnow, onToggleClouds, onToggleSkierMode, onToggleTour, onToggleTrails, onResetCamera, onMobileControl, onTimeOfDay, onLightingPreset, onSmoothGlobal, onSmoothStart }) {
    this.callbacks = { onToolChange, onBrushRadius, onBrushStrength, onNoiseLevel, onSeaLevel, onBaseElevation, onSnowPack, onCloudAmount, onUndo, onRedo, onReset, onSave, onLoad, onTreeDensity, onToggleWireframe, onToggleSnow, onToggleClouds, onToggleSkierMode, onToggleTour, onToggleTrails, onResetCamera, onMobileControl, onTimeOfDay, onLightingPreset, onSmoothGlobal, onSmoothStart };
    this.activeToolKey = 'raise';
    this.presetKeys = ['golden', 'noon', 'sunset', 'night'];
    this.currentPresetIdx = 0;
    this._build();
    this._bindKeys();
  }

  _buildMobileDPad(parent) {
    const dpad = document.createElement('div');
    dpad.id = 'mobile-dpad';
    parent.appendChild(dpad);

    const dirs = [
      { id: 'up', icon: '▲', key: 'up' },
      { id: 'left', icon: '◀', key: 'left' },
      { id: 'right', icon: '▶', key: 'right' },
      { id: 'down', icon: '▼', key: 'down' }
    ];

    dirs.forEach(d => {
      const btn = document.createElement('button');
      btn.className = `dpad-btn dpad-${d.id}`;
      btn.innerHTML = d.icon;
      
      const handleStart = (e) => {
        e.preventDefault();
        console.log(`D-Pad press: ${d.key}`);
        if (this.callbacks.onMobileControl) this.callbacks.onMobileControl(d.key, true);
        btn.classList.add('active');
      };
      
      const handleEnd = (e) => {
        e.preventDefault();
        console.log(`D-Pad release: ${d.key}`);
        if (this.callbacks.onMobileControl) this.callbacks.onMobileControl(d.key, false);
        btn.classList.remove('active');
      };

      btn.addEventListener('mousedown', handleStart);
      btn.addEventListener('mouseup', handleEnd);
      btn.addEventListener('mouseleave', handleEnd);
      btn.addEventListener('touchstart', handleStart, { passive: false });
      btn.addEventListener('touchend', handleEnd);
      btn.addEventListener('touchcancel', handleEnd);
      
      dpad.appendChild(btn);
    });

    const actions = document.createElement('div');
    actions.id = 'mobile-actions';
    parent.appendChild(actions);

    const actionBtns = [
      { id: 'exit', icon: '❌', key: 'exit' },
      { id: 'jump', icon: '🚀', key: 'jump' },
      { id: 'parachute', icon: '🪂', key: 'parachute' }
    ];

    actionBtns.forEach(a => {
      const btn = document.createElement('button');
      btn.className = `action-btn action-${a.id}`;
      btn.innerHTML = a.icon;
      
      const handleStart = (e) => {
        e.preventDefault();
        if (a.key === 'exit') {
          if (this.callbacks.onToggleSkierMode) this.callbacks.onToggleSkierMode();
          return;
        }
        if (this.callbacks.onMobileControl) this.callbacks.onMobileControl(a.key, true);
        btn.classList.add('active');
      };
      
      const handleEnd = (e) => {
        e.preventDefault();
        if (a.key === 'exit') return;
        if (this.callbacks.onMobileControl) this.callbacks.onMobileControl(a.key, false);
        btn.classList.remove('active');
      };

      btn.addEventListener('mousedown', handleStart);
      btn.addEventListener('mouseup', handleEnd);
      btn.addEventListener('mouseleave', handleEnd);
      btn.addEventListener('touchstart', handleStart, { passive: false });
      btn.addEventListener('touchend', handleEnd);
      btn.addEventListener('touchcancel', handleEnd);
      
      actions.appendChild(btn);
    });
  }

  setUndoRedoState(canUndo, canRedo) {
    this.undoBtn.classList.toggle('disabled', !canUndo);
    this.redoBtn.classList.toggle('disabled', !canRedo);
  }

  setSeaLevelSlider(val) {
    this.seaLevelSlider.value = val;
    if (this.seaLevelSlider.valSpan) {
      this.seaLevelSlider.valSpan.textContent = Number.isInteger(val) ? val : parseFloat(val).toFixed(2);
    }
  }

  setBaseElevationSlider(val) {
    this.baseElevationSlider.value = val;
    if (this.baseElevationSlider.valSpan) {
      this.baseElevationSlider.valSpan.textContent = Number.isInteger(val) ? val : parseFloat(val).toFixed(2);
    }
  }

  setSnowPackSlider(val) {
    this.snowPackSlider.value = val;
    if (this.snowPackSlider.valSpan) {
      this.snowPackSlider.valSpan.textContent = Number.isInteger(val) ? val : parseFloat(val).toFixed(2);
    }
  }

  setTimeOfDaySlider(val) {
    if (this.timeOfDaySlider) {
      this.timeOfDaySlider.value = val;
      if (this.timeOfDaySlider.valSpan) {
        this.timeOfDaySlider.valSpan.textContent = Number.isInteger(val) ? val : parseFloat(val).toFixed(1);
      }
    }
  }

  setSmoothnessSlider(val) {
    if (this.smoothnessSlider) {
      this.smoothnessSlider.value = val;
      this._lastSmoothVal = val;
      if (this.smoothnessSlider.valSpan) {
        this.smoothnessSlider.valSpan.textContent = Number.isInteger(val) ? val : parseFloat(val).toFixed(0);
      }
    }
  }

  setLightingPreset(presetId, hours = null) {
    const presetHours = { golden: 17.5, noon: 12.0, sunset: 19.2, night: 22.0 };
    const h = hours ?? presetHours[presetId] ?? 17.5;
    this.setTimeOfDaySlider(h);
    if (this.callbacks.onLightingPreset) {
      this.callbacks.onLightingPreset(presetId);
    } else if (this.callbacks.onTimeOfDay) {
      this.callbacks.onTimeOfDay(h);
    }
  }

  _build() {
    const sidebar = document.getElementById('sidebar');

    // Create topbar
    const topbar = document.createElement('div');
    topbar.id = 'topbar';
    document.body.appendChild(topbar);

    // Actions container (right side)
    const topbarActions = document.createElement('div');
    topbarActions.id = 'topbar-actions';
    topbar.appendChild(topbarActions);

    // Ski Mode Button
    const skiBtn = document.createElement('button');
    skiBtn.className = 'ski-mode-btn';
    skiBtn.innerHTML = '🎿 Ski Mode';
    skiBtn.title = 'Enter 3rd person skiing! (ESC to exit)';
    skiBtn.style.height = '38px';
    skiBtn.style.display = 'flex';
    skiBtn.style.alignItems = 'center';
    skiBtn.style.justifyContent = 'center';
    skiBtn.style.lineHeight = '1';
    skiBtn.addEventListener('click', () => {
      if (this.callbacks.onToggleSkierMode) this.callbacks.onToggleSkierMode();
    });
    // Reset Camera Button
    const resetCamBtn = document.createElement('button');
    resetCamBtn.className = 'history-btn'; 
    resetCamBtn.style.padding = '0 16px';
    resetCamBtn.style.height = '38px';
    resetCamBtn.style.borderRadius = '10px';
    resetCamBtn.style.fontWeight = '700';
    resetCamBtn.style.fontSize = '0.75rem';
    resetCamBtn.style.cursor = 'pointer';
    resetCamBtn.style.display = 'flex';
    resetCamBtn.style.alignItems = 'center';
    resetCamBtn.style.justifyContent = 'center';
    resetCamBtn.style.lineHeight = '1';
    resetCamBtn.style.gap = '8px';
    resetCamBtn.style.pointerEvents = 'auto';
    resetCamBtn.style.whiteSpace = 'nowrap';
    resetCamBtn.style.overflow = 'hidden';
    resetCamBtn.innerHTML = '<span style="font-size:1.1rem; line-height:1">🔄</span> Reset View';
    resetCamBtn.title = 'Reset camera to starting position';
    resetCamBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.callbacks.onResetCamera) this.callbacks.onResetCamera();
    });
    topbarActions.appendChild(resetCamBtn);
    topbarActions.appendChild(skiBtn);

    // Tip / Donate Button (Topbar)
    const tipBtn = document.createElement('button');
    tipBtn.className = 'tip-me-btn';
    tipBtn.innerHTML = '<span>☕</span> Tip Me';
    tipBtn.title = 'Support GnarScaper development!';
    tipBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openTipModal();
    });
    topbarActions.appendChild(tipBtn);

    // Title
    const title = document.createElement('div');
    title.className = 'sidebar-title';
    title.innerHTML = '<span class="logo-icon">🏔️</span> GnarScaper';
    sidebar.appendChild(title);

    // Subtitle
    const sub = document.createElement('div');
    sub.className = 'sidebar-subtitle';
    sub.textContent = 'Create and Ski your own gnarscapes';
    sidebar.appendChild(sub);

    // Divider
    sidebar.appendChild(this._divider());

    // Tool grid
    const toolLabel = document.createElement('div');
    toolLabel.className = 'section-label';
    toolLabel.textContent = 'Tools';
    sidebar.appendChild(toolLabel);

    // Group tools by category
    const categories = ['Camera', 'Skiing', 'Mountains', 'Utility', 'Features', 'Nature'];
    this.orderedToolKeys = [];
    
    // Define all available shortcut keys in order
    const numberKeys = ['1','2','3','4','5','6','7','8','9','0'];
    const letterKeys = ['Q','E','R','Y','U','I','O','P','A','D','F','H','J','K','L'];
    this.allShortcutKeys = [...numberKeys, ...letterKeys];
    
    categories.forEach(category => {
      const categoryTools = Object.entries(TOOLS).filter(([_, t]) => t.category === category);
      if (categoryTools.length === 0) return;

      // Category Header
      const header = document.createElement('div');
      header.className = 'tool-category-header';
      header.innerHTML = category.toUpperCase();
      sidebar.appendChild(header);

      const toolGrid = document.createElement('div');
      toolGrid.className = 'tool-grid';
      
      categoryTools.forEach(([key, t]) => {
        const shortcutIdx = this.orderedToolKeys.length;
        this.orderedToolKeys.push(key);
        
        const shortcutKey = shortcutIdx < this.allShortcutKeys.length ? this.allShortcutKeys[shortcutIdx] : '';
        
        const btn = document.createElement('button');
        btn.className = 'tool-btn' + (key === this.activeToolKey ? ' active' : '');
        btn.dataset.tool = key;
        btn.innerHTML = `<span class="tool-icon">${t.icon}</span><span class="tool-name">${t.name}</span>`;
        btn.style.setProperty('--tool-color', t.color);
        btn.title = `${t.name} ${shortcutKey ? `(${shortcutKey})` : ''}`;
        btn.addEventListener('click', () => this._selectTool(key));
        toolGrid.appendChild(btn);
      });
      
      sidebar.appendChild(toolGrid);
    });

    sidebar.appendChild(this._divider());

    // Brush settings (dynamically moved between topbar and sidebar for responsiveness)
    const brushSettings = document.createElement('div');
    brushSettings.id = 'brush-settings';

    const slidersContainer = document.createElement('div');
    slidersContainer.id = 'brush-sliders-container';
    brushSettings.appendChild(slidersContainer);
    
    this.radiusSlider = this._slider(slidersContainer, 'Brush Size', 1, 100, 16, (v) => {
      this.callbacks.onBrushRadius(v);
    }, 1, '<kbd>[</kbd> and <kbd>]</kbd>');

    this.strengthSlider = this._slider(slidersContainer, 'Strength', 0.05, 2.0, 0.6, (v) => {
      this.callbacks.onBrushStrength(v);
    }, 0.05, '<kbd>Cmd/Ctrl + [</kbd> and <kbd>]</kbd>');

    this.noiseSlider = this._slider(slidersContainer, 'Noise Level', 0.0, 1.0, 0.1, (v) => {
      this.callbacks.onNoiseLevel(v);
    }, 0.05, '<kbd>Shift + [</kbd> and <kbd>]</kbd>');

    // Build D-Pad globally (floats above sheet)
    this._buildMobileDPad(document.body);

    // Handle dynamic repositioning based on screen size
    const repositionBrush = () => {
      const topbar = document.getElementById('topbar');
      const sidebar = document.getElementById('sidebar');
      if (!topbar || !sidebar) return;

      if (window.innerWidth <= 768) {
        if (brushSettings.parentElement !== sidebar) {
          sidebar.insertBefore(brushSettings, sidebar.firstChild);
        }
      } else {
        if (brushSettings.parentElement !== topbar) {
          topbar.insertBefore(brushSettings, topbar.firstChild);
        }
      }
    };
    window.addEventListener('resize', repositionBrush);
    repositionBrush();

    // Tree settings (in sidebar)
    this.treeDensitySlider = this._slider(sidebar, 'Boulder & Tree Density', 1, 10, 5, (v) => {
      this.callbacks.onTreeDensity(v);
    });
    this.treeDensitySlider.parentElement.style.marginBottom = '15px';

    sidebar.appendChild(this._divider());

    // Sea level
    const waterLabel = document.createElement('div');
    waterLabel.className = 'section-label';
    waterLabel.textContent = 'Global Height';
    sidebar.appendChild(waterLabel);

    this.baseElevationSlider = this._slider(sidebar, 'Base Elevation', -30, 60, 0, (v) => {
      this.callbacks.onBaseElevation(v);
    }, 1);

    this.seaLevelSlider = this._slider(sidebar, 'Sea Level', -10, 20, 1, (v) => {
      this.callbacks.onSeaLevel(v);
    }, 0.5);

    this.snowPackSlider = this._slider(sidebar, 'Snow Pack', 0, 100, 100, (v) => {
      this.callbacks.onSnowPack(v);
    }, 1);

    this.smoothnessSlider = this._slider(sidebar, 'Terrain Smoothness', 0, 100, 0, (val) => {
      if (this.callbacks.onSmoothGlobal) {
        this.callbacks.onSmoothGlobal(val);
      }
    }, 1);

    const notifyStart = () => {
      if (this.callbacks.onSmoothStart) this.callbacks.onSmoothStart();
    };

    this.smoothnessSlider.addEventListener('mousedown', notifyStart);
    this.smoothnessSlider.addEventListener('touchstart', notifyStart, { passive: true });

    this.cloudAmountSlider = this._slider(sidebar, 'Cloud Amount', 0, 100, 20, (v) => {
      if (this.callbacks.onCloudAmount) {
        this.callbacks.onCloudAmount(v);
      }
    }, 1);

    sidebar.appendChild(this._divider());

    // Lighting & Atmosphere
    const lightingLabel = document.createElement('div');
    lightingLabel.className = 'section-label';
    lightingLabel.textContent = 'Lighting & Atmosphere';
    sidebar.appendChild(lightingLabel);

    // Time of Day Slider
    this.timeOfDaySlider = this._slider(sidebar, 'Time of Day', 6, 23, 17.5, (v) => {
      if (this.callbacks.onTimeOfDay) {
        this.callbacks.onTimeOfDay(v);
      }
    }, 0.5, '<kbd>L</kbd> key to cycle presets');

    // Preset buttons row
    const presetRow = document.createElement('div');
    presetRow.className = 'lighting-preset-row';
    presetRow.style.display = 'grid';
    presetRow.style.gridTemplateColumns = '1fr 1fr';
    presetRow.style.gap = '6px';
    presetRow.style.marginBottom = '12px';

    const presets = [
      { id: 'golden', name: 'Golden Hour 🌅', hours: 17.5 },
      { id: 'noon', name: 'Alpine Noon ☀️', hours: 12.0 },
      { id: 'sunset', name: 'Sunset 🌇', hours: 19.2 },
      { id: 'night', name: 'Starlight 🌌', hours: 22.0 }
    ];

    presets.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'history-btn';
      btn.style.fontSize = '0.68rem';
      btn.style.padding = '6px 4px';
      btn.style.whiteSpace = 'nowrap';
      btn.innerText = p.name;
      btn.title = `Switch to ${p.name}`;
      btn.addEventListener('click', () => {
        this.setLightingPreset(p.id, p.hours);
      });
      presetRow.appendChild(btn);
    });
    sidebar.appendChild(presetRow);

    sidebar.appendChild(this._divider());

    const displayLabel = document.createElement('div');
    displayLabel.className = 'section-label';
    displayLabel.textContent = 'Display Settings';
    sidebar.appendChild(displayLabel);

    // Wireframe Toggle
    const wireframeRow = document.createElement('div');
    wireframeRow.className = 'slider-group';
    const wireframeLabel = document.createElement('label');
    wireframeLabel.style.display = 'flex';
    wireframeLabel.style.justifyContent = 'space-between';
    wireframeLabel.style.width = '100%';
    wireframeLabel.style.cursor = 'pointer';
    wireframeLabel.innerHTML = '<span>Show Grid <kbd style="margin-left:8px; opacity:0.6;">G</kbd></span>';
    this.wireframeCheckbox = document.createElement('input');
    this.wireframeCheckbox.type = 'checkbox';
    this.wireframeCheckbox.addEventListener('change', (e) => {
      if (this.callbacks.onToggleWireframe) {
        this.callbacks.onToggleWireframe(e.target.checked);
      }
    });
    wireframeLabel.appendChild(this.wireframeCheckbox);
    wireframeRow.appendChild(wireframeLabel);
    sidebar.appendChild(wireframeRow);

    // Snow Toggle
    const snowRow = document.createElement('div');
    snowRow.className = 'slider-group';
    const snowLabel = document.createElement('label');
    snowLabel.style.display = 'flex';
    snowLabel.style.justifyContent = 'space-between';
    snowLabel.style.width = '100%';
    snowLabel.style.cursor = 'pointer';
    snowLabel.innerHTML = '<span>❄️ Let it Snow!</span>';
    const snowCheckbox = document.createElement('input');
    snowCheckbox.type = 'checkbox';
    snowCheckbox.addEventListener('change', (e) => {
      if (this.callbacks.onToggleSnow) {
        this.callbacks.onToggleSnow(e.target.checked);
      }
    });
    snowLabel.appendChild(snowCheckbox);
    snowRow.appendChild(snowLabel);
    sidebar.appendChild(snowRow);

    // Clouds Toggle
    const cloudsRow = document.createElement('div');
    cloudsRow.className = 'slider-group';
    const cloudsLabel = document.createElement('label');
    cloudsLabel.style.display = 'flex';
    cloudsLabel.style.justifyContent = 'space-between';
    cloudsLabel.style.width = '100%';
    cloudsLabel.style.cursor = 'pointer';
    cloudsLabel.innerHTML = '<span>☁️ Snow Clouds</span>';
    const cloudsCheckbox = document.createElement('input');
    cloudsCheckbox.type = 'checkbox';
    cloudsCheckbox.addEventListener('change', (e) => {
      if (this.callbacks.onToggleClouds) {
        this.callbacks.onToggleClouds(e.target.checked);
      }
    });
    cloudsLabel.appendChild(cloudsCheckbox);
    cloudsRow.appendChild(cloudsLabel);
    sidebar.appendChild(cloudsRow);

    // Tour Toggle
    const tourRow = document.createElement('div');
    tourRow.className = 'slider-group';
    const tourLabel = document.createElement('label');
    tourLabel.style.display = 'flex';
    tourLabel.style.justifyContent = 'space-between';
    tourLabel.style.width = '100%';
    tourLabel.style.cursor = 'pointer';
    tourLabel.innerHTML = '<span>🚁 Terrain Tour</span>';
    const tourCheckbox = document.createElement('input');
    tourCheckbox.type = 'checkbox';
    tourCheckbox.addEventListener('change', (e) => {
      if (this.callbacks.onToggleTour) {
        this.callbacks.onToggleTour(e.target.checked);
      }
    });
    tourLabel.appendChild(tourCheckbox);
    tourRow.appendChild(tourLabel);
    sidebar.appendChild(tourRow);

    // Trails Toggle
    const trailsRow = document.createElement('div');
    trailsRow.className = 'slider-group';
    const trailsLabel = document.createElement('label');
    trailsLabel.style.display = 'flex';
    trailsLabel.style.justifyContent = 'space-between';
    trailsLabel.style.width = '100%';
    trailsLabel.style.cursor = 'pointer';
    trailsLabel.innerHTML = '<span>🎿 Skier Trails <kbd style="margin-left:8px; opacity:0.6;">T</kbd></span>';
    this.trailsCheckbox = document.createElement('input');
    this.trailsCheckbox.type = 'checkbox';
    this.trailsCheckbox.checked = true; // On by default
    this.trailsCheckbox.addEventListener('change', (e) => {
      if (this.callbacks.onToggleTrails) {
        this.callbacks.onToggleTrails(e.target.checked);
      }
    });
    trailsLabel.appendChild(this.trailsCheckbox);
    trailsRow.appendChild(trailsLabel);
    sidebar.appendChild(trailsRow);

    // Skier HUD (hidden by default, shown during ski mode)
    this._skierHud = document.createElement('div');
    this._skierHud.id = 'skier-hud';
    this._skierHud.style.display = 'none';
    this._skierHud.innerHTML = `
      <div class="skier-hud-bar">
        <div class="skier-hud-stat">
          <span class="skier-hud-label" id="skier-speed-label">SPEED</span>
          <span class="skier-hud-value" id="skier-speed">0</span>
          <span class="skier-hud-unit">mph</span>
        </div>
        <div class="skier-hud-divider"></div>
        <div class="skier-hud-stat">
          <span class="skier-hud-label">ELEV</span>
          <span class="skier-hud-subvalue" id="skier-elevation">0</span>
          <span class="skier-hud-unit">ft</span>
        </div>
        <div class="skier-hud-divider skier-hud-main-divider"></div>
        <div class="skier-hud-controls" id="skier-controls">
          <span><b>←/→</b> Steer / Air Spin · <b>↑/↓</b> Push / Flips · <b>Space</b> Jump · <b>Shift/Z</b> Air Grab · <b>X</b> Parachute</span>
          <span style="opacity:0.65; margin-left:6px;">(Press <b>ESC</b> to exit)</span>
        </div>
      </div>
    `;
    document.body.appendChild(this._skierHud);



    sidebar.appendChild(this._divider());

    // Undo / Redo
    const historyRow = document.createElement('div');
    historyRow.className = 'history-row';

    this.undoBtn = document.createElement('button');
    this.undoBtn.className = 'history-btn disabled';
    this.undoBtn.innerHTML = '↩ Undo';
    this.undoBtn.addEventListener('click', () => this.callbacks.onUndo());

    this.redoBtn = document.createElement('button');
    this.redoBtn.className = 'history-btn disabled';
    this.redoBtn.innerHTML = 'Redo ↪';
    this.redoBtn.addEventListener('click', () => this.callbacks.onRedo());

    historyRow.appendChild(this.undoBtn);
    historyRow.appendChild(this.redoBtn);
    sidebar.appendChild(historyRow);

    // Start Fresh button
    sidebar.appendChild(this._divider());

    const resetBtn = document.createElement('button');
    resetBtn.className = 'reset-btn';
    resetBtn.innerHTML = '🔄 Start Fresh';
    resetBtn.addEventListener('click', () => {
      if (confirm('Reset everything? This will clear the terrain and all trees.')) {
        this.callbacks.onReset();
      }
    });
    sidebar.appendChild(resetBtn);

    sidebar.appendChild(this._divider());

    // Save / Load Map
    const saveLoadRow = document.createElement('div');
    saveLoadRow.className = 'history-row';

    this.saveBtn = document.createElement('button');
    this.saveBtn.className = 'history-btn';
    this.saveBtn.innerHTML = '💾 Save';
    this.saveBtn.title = 'Saves to current file (Ctrl+S)';
    this.saveBtn.addEventListener('click', () => {
      if (this.callbacks.onSave) this.callbacks.onSave(false);
    });

    const saveAsBtn = document.createElement('button');
    saveAsBtn.className = 'history-btn';
    saveAsBtn.innerHTML = '💾 Save As...';
    saveAsBtn.style.fontSize = '0.75rem'; // Make it slightly smaller to fit
    saveAsBtn.addEventListener('click', () => {
      if (this.callbacks.onSave) this.callbacks.onSave(true);
    });

    const loadBtn = document.createElement('button');
    loadBtn.className = 'history-btn';
    loadBtn.innerHTML = '📂 Load';
    loadBtn.addEventListener('click', () => {
      if (this.callbacks.onLoad) this.callbacks.onLoad();
    });

    saveLoadRow.appendChild(this.saveBtn);
    saveLoadRow.appendChild(saveAsBtn);
    saveLoadRow.appendChild(loadBtn);
    sidebar.appendChild(saveLoadRow);

    // Instructions & Shortcuts
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.innerHTML = `
      <b>Camera Controls</b><br>
      • <b>Right Click Drag:</b> Pan Camera<br>
      • <b>Left Click Drag:</b> Rotate View (Alt/Cmd)<br>
      • <b>Scroll Wheel:</b> Zoom In/Out<br>
      • <b>Arrow Keys:</b> Pan View (Shift for slow)<br><br>
      <b>Editor Tips</b><br>
      • <b>Chairlifts:</b> Click once for start, again for end<br>
      • <b>River:</b> Click source (top), then mouth (bottom)<br>
      • <b>Ski Mode:</b> Drop a skier to test your mountain!
    `;
    sidebar.appendChild(hint);

    // Tip / Donate Button (Sidebar)
    sidebar.appendChild(this._divider());
    const sidebarTipBtn = document.createElement('button');
    sidebarTipBtn.className = 'sidebar-tip-btn';
    sidebarTipBtn.innerHTML = '💖 Support GnarScaper';
    sidebarTipBtn.title = 'Support creator & future updates';
    sidebarTipBtn.addEventListener('click', () => this.openTipModal());
    sidebar.appendChild(sidebarTipBtn);

    // Build modal DOM
    this._buildTipModal();
  }

  _buildTipModal() {
    if (document.getElementById('tip-modal-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'tip-modal-overlay';
    overlay.className = 'tip-modal-overlay';

    overlay.innerHTML = `
      <div class="tip-modal-content" id="tip-modal">
        <button class="tip-modal-close" id="tip-modal-close" title="Close">&times;</button>

        <div class="tip-modal-header">
          <div class="tip-modal-badge">☕ Support GnarScaper</div>
          <h2 class="tip-modal-title">Enjoying the Gnar?</h2>
          <p class="tip-modal-subtitle">
            Hope you are enjoying GnarScaper as much as I enjoyed making it! Your support helps fund future features and improvements.
          </p>
        </div>

        <div class="tip-tiers-section">
          <div class="tip-section-label">Select a Tip Amount</div>
          <div class="tip-tiers-grid">
            <button class="tip-tier-card" data-amount="3">
              <span class="tip-tier-emoji">🟢</span>
              <span class="tip-tier-price">$3</span>
              <span class="tip-tier-title">Green Circle</span>
            </button>
            <button class="tip-tier-card active" data-amount="5">
              <span class="tip-tier-emoji">🟦</span>
              <span class="tip-tier-price">$5</span>
              <span class="tip-tier-title">Blue Square</span>
            </button>
            <button class="tip-tier-card" data-amount="10">
              <span class="tip-tier-emoji" style="transform: rotate(45deg); transform-origin: center center;">⬛</span>
              <span class="tip-tier-price">$10</span>
              <span class="tip-tier-title">Black Diamond</span>
            </button>
            <button class="tip-tier-card" data-amount="25">
              <span style="display:flex;flex-direction:row;"><span class="tip-tier-emoji" style="transform: rotate(45deg); transform-origin: center center;">⬛</span><span class="tip-tier-emoji" style="transform: rotate(45deg); translateX:5px; transform-origin: center center; translate: 2px;">⬛</span></span>
              <span class="tip-tier-price">$25</span>
              <span class="tip-tier-title">Double Black Diamond</span>
            </button>
          </div>
        </div>

        <div class="tip-platforms-section">
          <div class="tip-section-label">Choose Payment Platform</div>
          <div class="tip-platforms-grid">
            <a href="https://paypal.me" target="_blank" rel="noopener noreferrer" class="tip-platform-btn paypal">
              <span class="platform-icon">🅿️</span> PayPal
            </a>
            <a href="https://venmo.com" target="_blank" rel="noopener noreferrer" class="tip-platform-btn venmo">
              <span class="platform-icon">📲</span> Venmo
            </a>
          </div>
        </div>

        <div class="tip-modal-footer">
          <button class="tip-copy-btn" id="tip-copy-btn">
            <span id="tip-copy-icon">🔗</span> <span id="tip-copy-text">Share / Copy Page Link</span>
          </button>
          <div class="tip-thank-you">Thank you for being part of the GnarScaper community! 🏔️</div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Event listeners
    const closeBtn = overlay.querySelector('#tip-modal-close');
    closeBtn.addEventListener('click', () => this.closeTipModal());

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeTipModal();
    });

    // Tier selection card highlight
    const tierCards = overlay.querySelectorAll('.tip-tier-card');
    tierCards.forEach(card => {
      card.addEventListener('click', () => {
        tierCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
      });
    });

    // Copy link button
    const copyBtn = overlay.querySelector('#tip-copy-btn');
    const copyText = overlay.querySelector('#tip-copy-text');
    const copyIcon = overlay.querySelector('#tip-copy-icon');

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        copyIcon.textContent = '✅';
        copyText.textContent = 'Link Copied to Clipboard!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyIcon.textContent = '🔗';
          copyText.textContent = 'Share / Copy Page Link';
          copyBtn.classList.remove('copied');
        }, 2500);
      } catch (err) {
        console.error('Clipboard copy failed:', err);
      }
    });

    this._tipOverlay = overlay;
  }

  openTipModal() {
    if (!this._tipOverlay) this._buildTipModal();
    this._tipOverlay.classList.add('active');

    this._escHandler = (e) => {
      if (e.key === 'Escape' && this._tipOverlay.classList.contains('active')) {
        this.closeTipModal();
      }
    };
    window.addEventListener('keydown', this._escHandler);
  }

  closeTipModal() {
    if (this._tipOverlay) {
      this._tipOverlay.classList.remove('active');
    }
    if (this._escHandler) {
      window.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
  }

  _selectTool(key) {
    this.activeToolKey = key;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.tool-btn[data-tool="${key}"]`).classList.add('active');
    this.callbacks.onToolChange(key);
  }

  _slider(parent, label, min, max, initial, onChange, step = 1, hintText = null) {
    const wrap = document.createElement('div');
    wrap.className = 'slider-group';

    const lblWrap = document.createElement('div');
    lblWrap.style.display = 'flex';
    lblWrap.style.flexDirection = 'column';
    lblWrap.style.gap = '2px';
    lblWrap.style.alignItems = 'flex-start';
    if (parent.id === 'topbar' || parent.parentElement?.id === 'topbar') {
      lblWrap.style.minWidth = '150px';
    }

    const lbl = document.createElement('label');
    lbl.style.gap = '8px'; // Add space between label and value
    const valSpan = document.createElement('span');
    valSpan.className = 'slider-value';
    valSpan.textContent = initial;
    lbl.innerHTML = `<span>${label}</span>`;
    lbl.appendChild(valSpan);
    lblWrap.appendChild(lbl);

    if (hintText) {
      const hint = document.createElement('div');
      hint.className = 'slider-hint';
      hint.innerHTML = hintText;
      hint.style.fontSize = '0.65rem';
      hint.style.color = 'var(--text-dim)';
      lblWrap.appendChild(hint);
    }

    const input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = initial;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      valSpan.textContent = Number.isInteger(v) ? v : v.toFixed(2);
      onChange(v);
    });

    input.valSpan = valSpan;

    wrap.appendChild(lblWrap);
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return input;
  }

  _divider() {
    const d = document.createElement('div');
    d.className = 'divider';
    return d;
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName && e.target.tagName.toLowerCase() === 'input') return;

      // Trails Toggle Shortcut (T key)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        if (this.trailsCheckbox) {
          this.trailsCheckbox.checked = !this.trailsCheckbox.checked;
          this.trailsCheckbox.dispatchEvent(new Event('change'));
        }
        return;
      }

      // Grid Toggle Shortcut (G key)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (this.wireframeCheckbox) {
          this.wireframeCheckbox.checked = !this.wireframeCheckbox.checked;
          this.wireframeCheckbox.dispatchEvent(new Event('change'));
        }
        return;
      }

      // Lighting Cycle Shortcut (L key)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        this.currentPresetIdx = (this.currentPresetIdx + 1) % this.presetKeys.length;
        const nextPreset = this.presetKeys[this.currentPresetIdx];
        this.setLightingPreset(nextPreset);
        return;
      }

      // Handle tool shortcuts (Number keys and specific Letter keys)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key.toUpperCase();
        const idx = this.allShortcutKeys.indexOf(key);
        
        if (idx !== -1 && idx < this.orderedToolKeys.length) {
          e.preventDefault();
          this._selectTool(this.orderedToolKeys[idx]);
          return;
        }
      }
      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.callbacks.onRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.callbacks.onUndo();
      }
      // Save Shortcut
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.callbacks.onSave();
      }
      // Brush size with [ ] or strength with Cmd+[ ] or noise with Shift+[ ]
      if (e.code === 'BracketLeft') {
        e.preventDefault();
        if (e.metaKey || e.ctrlKey) {
          const v = Math.max(0.05, parseFloat(this.strengthSlider.value) - 0.1);
          this.strengthSlider.value = v;
          this.strengthSlider.dispatchEvent(new Event('input'));
        } else if (e.shiftKey) {
          const v = Math.max(0.0, parseFloat(this.noiseSlider.value) - 0.05);
          this.noiseSlider.value = v;
          this.noiseSlider.dispatchEvent(new Event('input'));
        } else {
          const v = Math.max(1, parseFloat(this.radiusSlider.value) - 4);
          this.radiusSlider.value = v;
          this.radiusSlider.dispatchEvent(new Event('input'));
        }
      } else if (e.code === 'BracketRight') {
        e.preventDefault();
        if (e.metaKey || e.ctrlKey) {
          const v = Math.min(2.0, parseFloat(this.strengthSlider.value) + 0.1);
          this.strengthSlider.value = v;
          this.strengthSlider.dispatchEvent(new Event('input'));
        } else if (e.shiftKey) {
          const v = Math.min(1.0, parseFloat(this.noiseSlider.value) + 0.05);
          this.noiseSlider.value = v;
          this.noiseSlider.dispatchEvent(new Event('input'));
        } else {
          const v = Math.min(100, parseFloat(this.radiusSlider.value) + 4);
          this.radiusSlider.value = v;
          this.radiusSlider.dispatchEvent(new Event('input'));
        }
      }
    });
  }

  showSaveSuccess() {
    if (this.saveBtn) {
      const oldText = this.saveBtn.innerHTML;
      this.saveBtn.innerHTML = '✅ Saved!';
      setTimeout(() => {
        this.saveBtn.innerHTML = oldText;
      }, 2000);
    }
  }

  showSkierHUD(show) {
    if (this._skierHud) {
      this._skierHud.style.display = show ? 'flex' : 'none';
    }

    // Hide sidebar and topbar during ski mode
    const sidebar = document.getElementById('sidebar');
    const topbar = document.getElementById('topbar');
    if (sidebar) sidebar.style.display = show ? 'none' : '';
    if (topbar) topbar.style.display = show ? 'none' : '';

    const dpad = document.getElementById('mobile-dpad');
    const actions = document.getElementById('mobile-actions');
    if (dpad) dpad.classList.toggle('in-ski-mode', show);
    if (actions) actions.classList.toggle('in-ski-mode', show);
  }

  updateSkierSpeed(speed, isClimbing = false, elevation = 0) {
    const el = document.getElementById('skier-speed');
    if (el) {
      // Convert to mph feel
      el.textContent = Math.round(speed * 5.0);
    }
    const labelEl = document.getElementById('skier-speed-label') || document.querySelector('.skier-hud-label');
    if (labelEl) {
      labelEl.textContent = isClimbing ? 'CLIMBING' : 'SPEED';
      labelEl.style.color = isClimbing ? '#ffb703' : ''; // Sleek gold color for climbing!
    }
    const elevEl = document.getElementById('skier-elevation');
    if (elevEl) {
      const elevFt = Math.max(0, Math.round(elevation * 10));
      elevEl.textContent = elevFt.toLocaleString();
    }
  }

  setSkierControlsText(state) {
    const el = document.getElementById('skier-controls');
    if (!el) return;
    if (state === 'riding') {
      el.innerHTML = `
        <span><b>←/→/W/S</b> Look Around · <b>Space</b> Drop Skier</span>
        <span style="opacity:0.65; margin-left:6px;">(Press <b>ESC</b> to exit)</span>
      `;
    } else {
      el.innerHTML = `
        <span><b>←/→</b> Steer / Air Spin · <b>↑/↓</b> Push / Flips · <b>Space</b> Jump · <b>Shift/Z</b> Air Grab · <b>X</b> Parachute</span>
        <span style="opacity:0.65; margin-left:6px;">(Press <b>ESC</b> to exit)</span>
      `;
    }
  }

  showSkierPlacement(show) {
    // Show a hint banner when in placement mode
    if (show) {
      if (!this._placementHint) {
        this._placementHint = document.createElement('div');
        this._placementHint.id = 'skier-placement-hint';
        this._placementHint.innerHTML = '🎿 Click anywhere on the terrain to drop in!';
        document.body.appendChild(this._placementHint);
      }
      this._placementHint.style.display = 'block';
    } else if (this._placementHint) {
      this._placementHint.style.display = 'none';
    }
  }

  /**
   * Show or hide the river placement hint banner.
   * Pass a string to show, null/falsy to hide.
   * @param {string|null} msg
   */
  showRiverHint(msg) {
    if (msg) {
      if (!this._riverHint) {
        this._riverHint = document.createElement('div');
        this._riverHint.id = 'river-placement-hint';
        document.body.appendChild(this._riverHint);
      }
      this._riverHint.innerHTML = msg;
      this._riverHint.style.display = 'block';
    } else if (this._riverHint) {
      this._riverHint.style.display = 'none';
    }
  }

  /**
   * Show or hide the chairlift placement hint banner.
   * Pass a string to show, null/falsy to hide.
   * @param {string|null} msg
   */
  showChairliftHint(msg) {
    if (msg) {
      if (!this._chairliftHint) {
        this._chairliftHint = document.createElement('div');
        this._chairliftHint.id = 'chairlift-placement-hint';
        document.body.appendChild(this._chairliftHint);
      }
      this._chairliftHint.innerHTML = msg;
      this._chairliftHint.style.display = 'block';
    } else if (this._chairliftHint) {
      this._chairliftHint.style.display = 'none';
    }
  }
}
