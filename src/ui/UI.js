import { TOOLS } from '../tools/tools.js';

export class UI {
  constructor({ onToolChange, onBrushRadius, onBrushStrength, onNoiseLevel, onSeaLevel, onBaseElevation, onUndo, onRedo, onReset, onSave, onLoad, onTreeDensity, onToggleWireframe, onToggleSnow, onToggleClouds, onToggleSkierMode, onToggleTour }) {
    this.callbacks = { onToolChange, onBrushRadius, onBrushStrength, onNoiseLevel, onSeaLevel, onBaseElevation, onUndo, onRedo, onReset, onSave, onLoad, onTreeDensity, onToggleWireframe, onToggleSnow, onToggleClouds, onToggleSkierMode, onToggleTour };
    this.activeToolKey = 'raise';
    this._build();
    this._bindKeys();
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
    skiBtn.addEventListener('click', () => {
      if (this.callbacks.onToggleSkierMode) this.callbacks.onToggleSkierMode();
    });
    topbarActions.appendChild(skiBtn);

    // Title
    const title = document.createElement('div');
    title.className = 'sidebar-title';
    title.innerHTML = '<span class="logo-icon">🏔️</span> LandScraper';
    sidebar.appendChild(title);

    // Subtitle
    const sub = document.createElement('div');
    sub.className = 'sidebar-subtitle';
    sub.textContent = 'Terrain Sculptor and Ski Simulator';
    sidebar.appendChild(sub);

    // Divider
    sidebar.appendChild(this._divider());

    // Tool grid
    const toolLabel = document.createElement('div');
    toolLabel.className = 'section-label';
    toolLabel.textContent = 'Tools';
    sidebar.appendChild(toolLabel);

    // Group tools by category
    const categories = ['Skiing', 'Mountains', 'Utility', 'Features', 'Nature'];
    this.orderedToolKeys = [];
    
    // Define all available shortcut keys in order
    const numberKeys = ['1','2','3','4','5','6','7','8','9','0'];
    const letterKeys = ['Q','E','R','T','Y','U','I','O','P','A','D','F','H','J','K','L'];
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

    // Brush settings (in topbar)
    const topbarSliders = document.createElement('div');
    topbarSliders.style.display = 'flex';
    topbarSliders.style.flexDirection = 'row';
    topbarSliders.style.gap = '20px';
    topbar.insertBefore(topbarSliders, topbar.firstChild);

    this.radiusSlider = this._slider(topbarSliders, 'Brush Size', 1, 100, 16, (v) => {
      this.callbacks.onBrushRadius(v);
    }, 1, '<kbd>[</kbd> and <kbd>]</kbd>');

    this.strengthSlider = this._slider(topbarSliders, 'Strength', 0.05, 2.0, 0.6, (v) => {
      this.callbacks.onBrushStrength(v);
    }, 0.05, '<kbd>Cmd/Ctrl + [</kbd> and <kbd>]</kbd>');

    this.noiseSlider = this._slider(topbarSliders, 'Noise Level', 0.0, 1.0, 0.5, (v) => {
      this.callbacks.onNoiseLevel(v);
    }, 0.05, '<kbd>Shift + [</kbd> and <kbd>]</kbd>');

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

    this.seaLevelSlider = this._slider(sidebar, 'Sea Level', -10, 20, -1, (v) => {
      this.callbacks.onSeaLevel(v);
    }, 0.5);

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
    wireframeLabel.innerHTML = '<span>Show Grid <kbd style="margin-left:8px; opacity:0.6;">Cmd+G</kbd></span>';
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

    // Skier HUD (hidden by default, shown during ski mode)
    this._skierHud = document.createElement('div');
    this._skierHud.id = 'skier-hud';
    this._skierHud.style.display = 'none';
    this._skierHud.innerHTML = `
      <div class="skier-hud-speed">
        <span class="skier-hud-label">SPEED</span>
        <span class="skier-hud-value" id="skier-speed">0</span>
        <span class="skier-hud-unit">mph</span>
      </div>
      <div class="skier-hud-controls">
        <span><b>←/→</b> Steer · <b>↑</b> Push · <b>↓</b> Brake · <b>W/S</b> Look · <b>Space</b> Jump</span>
        <span style="opacity:0.6">Press <b>ESC</b> to exit</span>
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
      • <b>Ski Mode:</b> Drop a skier to test your mountain!
    `;
    sidebar.appendChild(hint);
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
      // Grid Toggle Shortcut
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (this.wireframeCheckbox) {
          this.wireframeCheckbox.checked = !this.wireframeCheckbox.checked;
          this.wireframeCheckbox.dispatchEvent(new Event('change'));
        }
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
  }

  updateSkierSpeed(speed) {
    const el = document.getElementById('skier-speed');
    if (el) {
      // Convert to mph feel
      el.textContent = Math.round(speed * 7.5);
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
}
