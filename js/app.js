/**
 * Main Application Coordinator
 * Binds UI, Cartola API data, WebGL 3D Renderer, and Audio FX.
 */

class CartolaGhostApp {
  constructor() {
    this.canvas = document.getElementById('gl-canvas');
    this.renderer = new WebGLRenderer(this.canvas);
    this.soundFX = new SoundFX();

    // State
    this.seasonData = null;
    this.isPlaying = false;
    this.playbackSpeed = 1.0;
    this.currentRoundFloat = 1.0; // 1.0 to maxRound
    this.maxRound = 34;
    this.lastTimestamp = 0;
    this.lastPassedRoundInt = 1;
    this.lastLeader = 1;

    // Cache DOM elements
    this.dom = {
      // Setup / Modal
      setupModal: document.getElementById('setup-modal'),
      teamId1Input: document.getElementById('team1-id-input'),
      teamId2Input: document.getElementById('team2-id-input'),
      btnStartRace: document.getElementById('btn-start-race'),
      btnDemoRace: document.getElementById('btn-demo-race'),
      loadingOverlay: document.getElementById('loading-overlay'),
      loadingMessage: document.getElementById('loading-message'),
      loadingBar: document.getElementById('loading-bar-fill'),

      // Playback Controls
      btnPlayPause: document.getElementById('btn-play-pause'),
      playIcon: document.getElementById('play-icon'),
      pauseIcon: document.getElementById('pause-icon'),
      btnReplay: document.getElementById('btn-replay'),
      roundSlider: document.getElementById('round-slider'),
      speedBtns: document.querySelectorAll('.speed-btn'),
      camBtns: document.querySelectorAll('.cam-btn'),
      btnMute: document.getElementById('btn-mute'),
      muteIcon: document.getElementById('mute-icon'),
      btnSettings: document.getElementById('btn-settings'),

      // Telemetry HUD
      hudRoundNum: document.getElementById('hud-round-num'),
      hudRoundTotal: document.getElementById('hud-round-total'),
      hudProgressBar: document.getElementById('hud-progress-fill'),
      hudGapValue: document.getElementById('hud-gap-value'),
      overtakeAlert: document.getElementById('overtake-alert'),
      overtakeText: document.getElementById('overtake-text'),

      // Team 1 Card
      t1Badge: document.getElementById('t1-badge-img'),
      t1Name: document.getElementById('t1-name'),
      t1Coach: document.getElementById('t1-coach'),
      t1RoundScore: document.getElementById('t1-round-score'),
      t1CumScore: document.getElementById('t1-cum-score'),
      t1RoleBadge: document.getElementById('t1-role-badge'),
      t1TopPlayer: document.getElementById('t1-top-player'),

      // Team 2 Card
      t2Badge: document.getElementById('t2-badge-img'),
      t2Name: document.getElementById('t2-name'),
      t2Coach: document.getElementById('t2-coach'),
      t2RoundScore: document.getElementById('t2-round-score'),
      t2CumScore: document.getElementById('t2-cum-score'),
      t2RoleBadge: document.getElementById('t2-role-badge'),
      t2TopPlayer: document.getElementById('t2-top-player'),

      // Floating 3D Car Telemetry Tag
      carLabelsLayer: document.getElementById('car-labels-layer'),
      carGhostTag: document.getElementById('car-ghost-tag'),
      carGhostBadgeImg: document.getElementById('car-ghost-badge-img'),
      carGhostName: document.getElementById('car-ghost-name'),
      carGhostRoleBadge: document.getElementById('car-ghost-role-badge')
    };

    this.bindEvents();
    this.startAnimationLoop();

    // Auto-load demo on startup so the user immediately sees the visualizer in action
    this.loadDemoSeason();
  }

  bindEvents() {
    // Start race with custom team IDs
    this.dom.btnStartRace.addEventListener('click', () => {
      const id1 = this.dom.teamId1Input.value.trim() || '3136';
      const id2 = this.dom.teamId2Input.value.trim() || '24763385';
      this.loadCartolaSeason(id1, id2);
    });

    // One-click instant Demo
    this.dom.btnDemoRace.addEventListener('click', () => {
      this.loadDemoSeason();
    });

    // Settings button opens modal
    this.dom.btnSettings.addEventListener('click', () => {
      this.dom.setupModal.classList.remove('hidden');
    });

    // Play / Pause
    this.dom.btnPlayPause.addEventListener('click', () => {
      this.togglePlay();
    });

    // Replay
    this.dom.btnReplay.addEventListener('click', () => {
      this.currentRoundFloat = 1.0;
      this.lastPassedRoundInt = 1;
      this.dom.roundSlider.value = 1.0;
      this.play();
    });

    // Round Slider Scrubbing
    this.dom.roundSlider.addEventListener('input', (e) => {
      this.currentRoundFloat = parseFloat(e.target.value);
      this.lastPassedRoundInt = Math.floor(this.currentRoundFloat);
      this.updateHUD();
    });

    // Speed selector buttons
    this.dom.speedBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.speedBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.playbackSpeed = parseFloat(btn.dataset.speed);
      });
    });

    // Camera selector buttons
    this.dom.camBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.camBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderer.cameraMode = btn.dataset.cam;
      });
    });

    // Audio Mute toggle
    this.dom.btnMute.addEventListener('click', () => {
      const isMuted = this.soundFX.toggleMute();
      this.dom.btnMute.classList.toggle('active', !isMuted);
      this.dom.muteIcon.textContent = isMuted ? '🔇' : '🔊';
    });
  }

  showLoading(show, message = '', percent = 0) {
    if (show) {
      this.dom.loadingOverlay.classList.remove('hidden');
      this.dom.loadingMessage.textContent = message;
      this.dom.loadingBar.style.width = `${percent}%`;
    } else {
      this.dom.loadingOverlay.classList.add('hidden');
    }
  }

  async loadDemoSeason() {
    this.dom.setupModal.classList.add('hidden');
    this.showLoading(true, 'Iniciando telemetria F1 do Cartola...', 30);

    const demo = CartolaService.generateMockSeason('3136', '7788', 34);
    this.applySeasonData(demo);

    setTimeout(() => {
      this.showLoading(false);
      this.play();
    }, 400);
  }

  async loadCartolaSeason(id1, id2) {
    this.dom.setupModal.classList.add('hidden');
    this.showLoading(true, 'Conectando às APIs do Cartola...', 10);

    try {
      const data = await CartolaService.loadSeasonData(id1, id2, {
        onProgress: (p) => {
          const percent = p.total > 0 ? Math.round((p.current / p.total) * 100) : 50;
          this.showLoading(true, p.message, percent);
        }
      });
      this.applySeasonData(data);
    } catch (e) {
      console.warn('Erro ao carregar dados live:', e);
      // Fallback cleanly to demo
      const demo = CartolaService.generateMockSeason(id1, id2, 34);
      this.applySeasonData(demo);
    } finally {
      this.showLoading(false);
      this.play();
    }
  }

  applySeasonData(data) {
    this.seasonData = data;
    this.maxRound = data.maxRound || 34;
    this.currentRoundFloat = 1.0;
    this.lastPassedRoundInt = 1;
    this.lastLeader = data.timeline[0] ? data.timeline[0].leader : 1;

    this.renderer.maxRounds = this.maxRound;
    this.dom.roundSlider.max = this.maxRound;
    this.dom.roundSlider.value = 1.0;
    this.dom.hudRoundTotal.textContent = String(this.maxRound).padStart(2, '0');

    // Setup Team Badges & Colors in WebGL Renderer
    this.renderer.loadTeamBadgeTexture(
      1,
      data.team1.badgeUrl,
      data.team1.name,
      data.team1.primaryColor,
      data.team1.secondaryColor
    );

    this.renderer.loadTeamBadgeTexture(
      2,
      data.team2.badgeUrl,
      data.team2.name,
      data.team2.primaryColor,
      data.team2.secondaryColor
    );

    // Setup 2D HUD Team Cards
    this.setupTeamHUD(1, data.team1);
    this.setupTeamHUD(2, data.team2);

    this.updateHUD();
  }

  setupTeamHUD(teamIdx, meta) {
    const isT1 = teamIdx === 1;
    const badgeEl = isT1 ? this.dom.t1Badge : this.dom.t2Badge;
    const nameEl = isT1 ? this.dom.t1Name : this.dom.t2Name;
    const coachEl = isT1 ? this.dom.t1Coach : this.dom.t2Coach;

    nameEl.textContent = meta.name;
    coachEl.textContent = meta.coach;

    if (meta.badgeUrl) {
      badgeEl.src = CartolaService.getSafeImageUrl(meta.badgeUrl);
      badgeEl.onerror = () => {
        // Fallback to vector canvas shield if image blocked
        const fallbackCanvas = CartolaService.createBadgeCanvas(meta.name, meta.primaryColor, meta.secondaryColor);
        badgeEl.src = fallbackCanvas.toDataURL();
      };
    } else {
      const fallbackCanvas = CartolaService.createBadgeCanvas(meta.name, meta.primaryColor, meta.secondaryColor);
      badgeEl.src = fallbackCanvas.toDataURL();
    }
  }

  togglePlay() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  play() {
    this.isPlaying = true;
    this.dom.playIcon.classList.add('hidden');
    this.dom.pauseIcon.classList.remove('hidden');
    this.soundFX.init();
  }

  pause() {
    this.isPlaying = false;
    this.dom.playIcon.classList.remove('hidden');
    this.dom.pauseIcon.classList.add('hidden');
  }

  startAnimationLoop() {
    const loop = (timestamp) => {
      if (!this.lastTimestamp) this.lastTimestamp = timestamp;
      const dt = Math.min((timestamp - this.lastTimestamp) / 1000, 0.1);
      this.lastTimestamp = timestamp;

      this.update(dt, timestamp / 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  update(dt, time) {
    if (this.isPlaying && this.seasonData) {
      // 1 round takes approx 2.2 seconds at 1x speed
      const roundRate = 0.45 * this.playbackSpeed;
      this.currentRoundFloat += dt * roundRate;

      // Loop or stop at finish
      if (this.currentRoundFloat >= this.maxRound) {
        this.currentRoundFloat = this.maxRound;
        this.pause();
      }

      this.dom.roundSlider.value = this.currentRoundFloat;

      // Checkpoint passing sound trigger
      const currentInt = Math.floor(this.currentRoundFloat);
      if (currentInt > this.lastPassedRoundInt) {
        this.lastPassedRoundInt = currentInt;
        this.soundFX.playRoundPass();
      }
    }

    // Interpolate current race telemetry values
    const currentTelemetry = this.computeInterpolatedTelemetry(this.currentRoundFloat);

    // Overtake detection
    if (currentTelemetry.leader !== this.lastLeader) {
      this.lastLeader = currentTelemetry.leader;
      this.triggerOvertakeAlert(currentTelemetry);
      this.soundFX.playOvertake();
    }

    // Audio engine pitch
    this.soundFX.updateEngine(this.isPlaying ? this.playbackSpeed : 0.2);

    // Render 3D Frame
    this.renderer.render({
      time,
      roundFloat: this.currentRoundFloat,
      leader: currentTelemetry.leader,
      scoreDelta: currentTelemetry.scoreDelta,
      t1Cum: currentTelemetry.t1Cum,
      t2Cum: currentTelemetry.t2Cum
    });

    // Update 2D HUD Telemetry
    this.updateHUD(currentTelemetry);

    // Update 3D Floating Car Tag (Ghost Leader)
    this.updateCarFloatingTag(currentTelemetry);
  }

  computeInterpolatedTelemetry(roundFloat) {
    if (!this.seasonData || !this.seasonData.timeline.length) {
      return {
        r: 1,
        t1Round: 0, t1Cum: 0, t1Player: null,
        t2Round: 0, t2Cum: 0, t2Player: null,
        leader: 1, gap: 0, scoreDelta: 0
      };
    }

    const timeline = this.seasonData.timeline;
    const clampedR = Math.max(1, Math.min(this.maxRound, roundFloat));
    const rBase = Math.floor(clampedR);
    const rFrac = clampedR - rBase;

    const data0 = timeline[Math.max(0, rBase - 1)];
    const data1 = timeline[Math.min(timeline.length - 1, rBase)];

    // Hermite-smooth easing between rounds
    const t = rFrac * rFrac * (3 - 2 * rFrac);

    const t1Cum = data0.team1.cumulativeScore + (data1.team1.cumulativeScore - data0.team1.cumulativeScore) * t;
    const t2Cum = data0.team2.cumulativeScore + (data1.team2.cumulativeScore - data0.team2.cumulativeScore) * t;

    const t1Round = data0.team1.roundScore + (data1.team1.roundScore - data0.team1.roundScore) * t;
    const t2Round = data0.team2.roundScore + (data1.team2.roundScore - data0.team2.roundScore) * t;

    const scoreDelta = t1Cum - t2Cum;
    const leader = scoreDelta >= 0 ? 1 : 2;
    const gap = Math.abs(scoreDelta);

    return {
      round: rBase,
      t1Round,
      t1Cum,
      t1Player: data0.team1.topPlayer,
      t2Round,
      t2Cum,
      t2Player: data0.team2.topPlayer,
      leader,
      gap,
      scoreDelta
    };
  }

  updateHUD(telemetry) {
    if (!telemetry) telemetry = this.computeInterpolatedTelemetry(this.currentRoundFloat);

    // Top progress
    this.dom.hudRoundNum.textContent = String(telemetry.round).padStart(2, '0');
    const progressPct = ((this.currentRoundFloat - 1) / Math.max(1, this.maxRound - 1)) * 100;
    this.dom.hudProgressBar.style.width = `${progressPct}%`;

    // Gap
    this.dom.hudGapValue.textContent = `${telemetry.gap.toFixed(1)} PTS`;

    // Team 1 Card
    this.dom.t1RoundScore.textContent = `${telemetry.t1Round >= 0 ? '+' : ''}${telemetry.t1Round.toFixed(1)}`;
    this.dom.t1CumScore.textContent = telemetry.t1Cum.toFixed(1);

    const isT1Leader = telemetry.leader === 1;
    this.dom.t1RoleBadge.textContent = isT1Leader ? 'LÍDER' : 'PERSEGUIDOR';
    this.dom.t1RoleBadge.className = `role-badge ${isT1Leader ? 'ghost' : 'solid'}`;

    if (telemetry.t1Player) {
      this.dom.t1TopPlayer.textContent = `★ ${telemetry.t1Player.name} (${telemetry.t1Player.score} pts)`;
    }

    // Team 2 Card
    this.dom.t2RoundScore.textContent = `${telemetry.t2Round >= 0 ? '+' : ''}${telemetry.t2Round.toFixed(1)}`;
    this.dom.t2CumScore.textContent = telemetry.t2Cum.toFixed(1);

    const isT2Leader = telemetry.leader === 2;
    this.dom.t2RoleBadge.textContent = isT2Leader ? 'LÍDER' : 'PERSEGUIDOR';
    this.dom.t2RoleBadge.className = `role-badge ${isT2Leader ? 'ghost' : 'solid'}`;

    if (telemetry.t2Player) {
      this.dom.t2TopPlayer.textContent = `★ ${telemetry.t2Player.name} (${telemetry.t2Player.score} pts)`;
    }
  }

  triggerOvertakeAlert(telemetry) {
    const leaderName = telemetry.leader === 1 ? this.seasonData.team1.name : this.seasonData.team2.name;
    this.dom.overtakeText.textContent = `OVERTAKE! ${leaderName.toUpperCase()} ASSUME A LIDERANÇA!`;
    this.dom.overtakeAlert.classList.remove('hidden');

    // Trigger CSS animation restart
    this.dom.overtakeAlert.style.animation = 'none';
    this.dom.overtakeAlert.offsetHeight; // reflow
    this.dom.overtakeAlert.style.animation = null;

    setTimeout(() => {
      this.dom.overtakeAlert.classList.add('hidden');
    }, 2800);
  }

  updateCarFloatingTag(telemetry) {
    if (!this.seasonData || !this.dom.carGhostTag) return;

    const leaderIdx = telemetry ? telemetry.leader : 1;
    const ghostPos = leaderIdx === 1 ? this.renderer.team1Pos : this.renderer.team2Pos;

    // Project world coordinates 3.8 units above vehicle position (centered above shield avatar)
    const proj = this.renderer.projectToScreen([ghostPos[0], ghostPos[1] + 3.8, ghostPos[2]]);

    if (!proj) {
      this.dom.carGhostTag.classList.add('hidden');
      return;
    }

    this.dom.carGhostTag.classList.remove('hidden');

    const meta = leaderIdx === 1 ? this.seasonData.team1 : this.seasonData.team2;
    const badgeSrc = leaderIdx === 1 ? this.dom.t1Badge.src : this.dom.t2Badge.src;

    if (this.dom.carGhostName.textContent !== meta.name) {
      this.dom.carGhostName.textContent = meta.name;
    }

    if (badgeSrc && this.dom.carGhostBadgeImg.src !== badgeSrc) {
      this.dom.carGhostBadgeImg.src = badgeSrc;
    }

    // Border and glow style matching the leader team (cyan for team 1, red for team 2)
    this.dom.carGhostTag.className = `car-floating-tag team-${leaderIdx}`;

    // Distance scale: gently scales from 0.72x to 1.12x based on depth from camera
    const scale = Math.max(0.72, Math.min(1.12, 24.0 / proj.distance));

    this.dom.carGhostTag.style.transform = `translate3d(${proj.x.toFixed(1)}px, ${proj.y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
  }
}

// Bootstrap on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new CartolaGhostApp();
});
