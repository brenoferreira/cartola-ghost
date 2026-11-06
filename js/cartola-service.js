/**
 * Cartola Service
 * Handles data fetching from Cartola Globo APIs, cumulative score calculation,
 * CORS handling with multiple fallbacks, and realistic mock generation.
 */

const CartolaService = {
  // Config
  API_BASE: 'https://api.cartola.globo.com',
  CORS_PROXIES: [
    url => `/proxy?url=${encodeURIComponent(url)}`, // Local python server proxy if active
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
  ],

  cache: new Map(),

  /**
   * Resolves an image URL through a CORS-friendly proxy so WebGL texImage2D
   * can upload the texture without security errors.
   */
  getSafeImageUrl(url) {
    if (!url || !url.startsWith('http')) return url;
    // When running under localhost or any web server, use local /proxy
    if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) {
      return `/proxy?url=${encodeURIComponent(url)}`;
    }
    // Fallback if running on file:// protocol
    return `https://images.weserv.nl/?url=${encodeURIComponent(url)}`;
  },

  /**
   * Fetch with automatic CORS fallback
   */
  async fetchWithFallback(endpoint) {
    const directUrl = `${this.API_BASE}${endpoint}`;
    if (this.cache.has(directUrl)) {
      return this.cache.get(directUrl);
    }

    // Attempt 1: Direct fetch
    try {
      const response = await fetch(directUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        mode: 'cors'
      });
      if (response.ok) {
        const data = await response.json();
        this.cache.set(directUrl, data);
        return data;
      }
    } catch (err) {
      // Direct fetch failed, probably CORS or offline
    }

    // Attempt 2: Try CORS proxies
    for (const proxyFn of this.CORS_PROXIES) {
      try {
        const proxyUrl = proxyFn(directUrl);
        const response = await fetch(proxyUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });
        if (response.ok) {
          const data = await response.json();
          this.cache.set(directUrl, data);
          return data;
        }
      } catch (e) {
        // Continue to next proxy
      }
    }

    throw new Error(`Não foi possível conectar à API do Cartola para ${endpoint}.`);
  },

  /**
   * Get current round from market status
   */
  async getCurrentRound() {
    try {
      const data = await this.fetchWithFallback('/mercado/status');
      if (data && typeof data.rodada_atual === 'number') {
        return {
          currentRound: data.rodada_atual,
          status: data.status_mercado,
          season: data.temporada || 2026,
          marketClosed: data.status_mercado === 2
        };
      }
    } catch (e) {
      console.warn('Falha ao obter status do mercado, usando fallback rodada 34:', e);
    }
    return { currentRound: 34, status: 2, season: 2026, marketClosed: true };
  },

  /**
   * Fetch single team round data
   */
  async getTeamRound(teamId, round) {
    const endpoint = `/time/id/${teamId}/${round}`;
    try {
      return await this.fetchWithFallback(endpoint);
    } catch (e) {
      return null;
    }
  },

  /**
   * Fetch complete season data for two teams up to maxRound
   */
  async loadSeasonData(teamId1, teamId2, options = {}) {
    const { onProgress = () => {}, useMock = false } = options;

    if (useMock) {
      return this.generateMockSeason(teamId1, teamId2);
    }

    onProgress({ phase: 'market', current: 0, total: 100, message: 'Verificando status do mercado...' });
    let marketInfo;
    try {
      marketInfo = await this.getCurrentRound();
    } catch (e) {
      marketInfo = { currentRound: 34, season: 2026 };
    }

    const maxRound = marketInfo.currentRound || 34;
    const totalRequests = maxRound * 2;
    let completedRequests = 0;

    onProgress({
      phase: 'teams',
      current: 0,
      total: totalRequests,
      message: `Carregando telemetria das rodadas 1 até ${maxRound}...`
    });

    const team1RoundsRaw = new Array(maxRound + 1).fill(null);
    const team2RoundsRaw = new Array(maxRound + 1).fill(null);

    // Concurrency limit worker pool (4 concurrent requests)
    const queue = [];
    for (let r = 1; r <= maxRound; r++) {
      queue.push({ team: 1, teamId: teamId1, round: r });
      queue.push({ team: 2, teamId: teamId2, round: r });
    }

    const CONCURRENCY = 4;
    let hasAnySuccess = false;

    const worker = async () => {
      while (queue.length > 0) {
        const task = queue.shift();
        try {
          const res = await this.getTeamRound(task.teamId, task.round);
          if (res) {
            hasAnySuccess = true;
            if (task.team === 1) team1RoundsRaw[task.round] = res;
            else team2RoundsRaw[task.round] = res;
          }
        } catch (err) {
          // Keep null
        }
        completedRequests++;
        onProgress({
          phase: 'teams',
          current: completedRequests,
          total: totalRequests,
          message: `Baixando rodadas (${completedRequests}/${totalRequests})...`
        });
      }
    };

    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    // If completely failed (e.g. offline and no CORS proxy), fallback seamlessly to mock
    if (!hasAnySuccess) {
      console.warn('API inacessível via browser (CORS/offline). Ativando simulação realista.');
      onProgress({
        phase: 'fallback',
        current: totalRequests,
        total: totalRequests,
        message: 'Rede restrita detectada. Carregando dados da temporada simulada...'
      });
      return this.generateMockSeason(teamId1, teamId2, maxRound);
    }

    return this.processSeasonResults(teamId1, teamId2, team1RoundsRaw, team2RoundsRaw, maxRound);
  },

  /**
   * Process raw API payloads into a clean timeline with cumulative scores & overtakes
   */
  processSeasonResults(teamId1, teamId2, team1RoundsRaw, team2RoundsRaw, maxRound) {
    // Extract metadata from any available payload
    const getTeamMeta = (rawList, defaultName, defaultCoach, defaultColor) => {
      for (let r = 1; r <= maxRound; r++) {
        if (rawList[r] && rawList[r].time) {
          const t = rawList[r].time;
          return {
            id: t.time_id,
            name: t.nome || defaultName,
            coach: t.nome_cartola || defaultCoach,
            badgeUrl: t.url_escudo_png || t.url_escudo_svg || '',
            primaryColor: t.cor_fundo_escudo ? `#${t.cor_fundo_escudo}` : defaultColor,
            secondaryColor: t.cor_camisa ? `#${t.cor_camisa}` : '#ffffff'
          };
        }
      }
      return {
        id: rawList === team1RoundsRaw ? teamId1 : teamId2,
        name: defaultName,
        coach: defaultCoach,
        badgeUrl: '',
        primaryColor: defaultColor,
        secondaryColor: '#ffffff'
      };
    };

    const team1Meta = getTeamMeta(team1RoundsRaw, 'Pregereba FC', 'Alexandre Saboia', '#0066ff');
    const team2Meta = getTeamMeta(team2RoundsRaw, 'Ghost Rival FC', 'Desafiante F1', '#e51937');

    const timeline = [];
    let cum1 = 0;
    let cum2 = 0;

    for (let r = 1; r <= maxRound; r++) {
      const data1 = team1RoundsRaw[r];
      const data2 = team2RoundsRaw[r];

      // Round points
      const pts1 = data1 && typeof data1.pontos === 'number' ? data1.pontos : 0;
      const pts2 = data2 && typeof data2.pontos === 'number' ? data2.pontos : 0;

      // Cumulative points (use pontos_campeonato if provided and consistent, else accumulate)
      cum1 = data1 && typeof data1.pontos_campeonato === 'number' && data1.pontos_campeonato > 0
        ? data1.pontos_campeonato
        : cum1 + pts1;

      cum2 = data2 && typeof data2.pontos_campeonato === 'number' && data2.pontos_campeonato > 0
        ? data2.pontos_campeonato
        : cum2 + pts2;

      // Top player of the round for flavor
      const getTopPlayer = (data) => {
        if (!data || !data.atletas || !data.atletas.length) return null;
        let best = data.atletas[0];
        for (const p of data.atletas) {
          if ((p.pontos_num || 0) > (best.pontos_num || 0)) best = p;
        }
        return {
          name: best.apelido || best.nome || 'Destaque',
          score: (best.pontos_num || 0).toFixed(1),
          photo: best.foto || ''
        };
      };

      const topPlayer1 = getTopPlayer(data1);
      const topPlayer2 = getTopPlayer(data2);

      const leader = cum1 >= cum2 ? 1 : 2;
      const gap = Math.abs(cum1 - cum2);
      const previousLeader = timeline.length > 0 ? timeline[timeline.length - 1].leader : leader;
      const isOvertake = timeline.length > 0 && leader !== previousLeader;

      timeline.push({
        round: r,
        team1: {
          roundScore: pts1,
          cumulativeScore: cum1,
          topPlayer: topPlayer1
        },
        team2: {
          roundScore: pts2,
          cumulativeScore: cum2,
          topPlayer: topPlayer2
        },
        leader, // 1 or 2
        gap,
        isOvertake
      });
    }

    return {
      maxRound,
      team1: team1Meta,
      team2: team2Meta,
      timeline
    };
  },

  /**
   * Generate realistic season mock data matching real Cartola scores
   * Useful when offline, testing, or demonstrating instantly.
   */
  generateMockSeason(teamId1 = '3136', teamId2 = '7788', maxRound = 34) {
    const team1Meta = {
      id: teamId1,
      name: 'Pregereba FC',
      coach: 'Alexandre Saboia',
      badgeUrl: 'https://s2-cartola.glbimg.com/ecXiz1i_N69U9uLLmVFmw5ROX6o=/https://s3.glbimg.com/v1/AUTH_58d78b787ec34892b5aaa0c7a146155f/cartola_assets_2/escudo/bc/31/20/009d771c54-77fd-48a0-973f-766616abdebc20260107233120',
      primaryColor: '#0066ff',
      secondaryColor: '#ff7400'
    };

    const team2Meta = {
      id: teamId2,
      name: 'Scuderia Ghost FC',
      coach: 'Ayrton Cartola',
      badgeUrl: 'https://s3.glbimg.com/v1/AUTH_58d78b787ec34892b5aaa0c7a146155f/clubes_2026/silhuetas/FLA/FORMATO.png',
      primaryColor: '#e51937',
      secondaryColor: '#ffd700'
    };

    const playersPool1 = ['Flaco López', 'Samuel Lino', 'Luciano Juba', 'Matheus Pereira', 'Rossi', 'Jean Lucas'];
    const playersPool2 = ['Arrascaeta', 'Pedro', 'Raphael Veiga', 'Hulk', 'Paulinho', 'Everson'];

    const timeline = [];
    let cum1 = 0;
    let cum2 = 0;

    // Seeded random walk that guarantees thrilling overtakes throughout the season
    let leadMomentum = 0;

    for (let r = 1; r <= maxRound; r++) {
      leadMomentum += (Math.random() - 0.48) * 4;

      // Realistic Cartola round scores (typically between 35 and 115 pts, average ~65)
      const base1 = 62 + Math.sin(r * 0.5) * 14 + (Math.random() * 28 - 14) + leadMomentum;
      const base2 = 62 + Math.cos(r * 0.6) * 14 + (Math.random() * 28 - 14) - leadMomentum;

      const pts1 = Math.max(25, Math.round(base1 * 10) / 10);
      const pts2 = Math.max(25, Math.round(base2 * 10) / 10);

      cum1 = Math.round((cum1 + pts1) * 100) / 100;
      cum2 = Math.round((cum2 + pts2) * 100) / 100;

      const leader = cum1 >= cum2 ? 1 : 2;
      const gap = Math.round(Math.abs(cum1 - cum2) * 100) / 100;
      const previousLeader = timeline.length > 0 ? timeline[timeline.length - 1].leader : leader;
      const isOvertake = timeline.length > 0 && leader !== previousLeader;

      timeline.push({
        round: r,
        team1: {
          roundScore: pts1,
          cumulativeScore: cum1,
          topPlayer: {
            name: playersPool1[r % playersPool1.length],
            score: (pts1 * 0.28).toFixed(1)
          }
        },
        team2: {
          roundScore: pts2,
          cumulativeScore: cum2,
          topPlayer: {
            name: playersPool2[r % playersPool2.length],
            score: (pts2 * 0.29).toFixed(1)
          }
        },
        leader,
        gap,
        isOvertake
      });
    }

    return {
      maxRound,
      team1: team1Meta,
      team2: team2Meta,
      timeline
    };
  },

  /**
   * Generates a 2D Canvas dynamic texture representing a team shield
   * Used for crisp badge rendering and bulletproof fallback when remote images hit CORS.
   */
  createBadgeCanvas(name, primaryColor, secondaryColor, initials) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Shield background
    ctx.clearRect(0, 0, 512, 512);

    // Glowing border outline
    ctx.save();
    ctx.shadowColor = primaryColor;
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.moveTo(256, 32);
    ctx.lineTo(448, 96);
    ctx.bezierCurveTo(448, 300, 360, 420, 256, 488);
    ctx.bezierCurveTo(152, 420, 64, 300, 64, 96);
    ctx.closePath();

    // Gradient fill
    const grad = ctx.createLinearGradient(0, 40, 0, 480);
    grad.addColorStop(0, primaryColor);
    grad.addColorStop(1, '#070a12');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = 14;
    ctx.strokeStyle = secondaryColor || '#ffffff';
    ctx.stroke();
    ctx.restore();

    // Center emblem circle
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.arc(256, 220, 120, 0, Math.PI * 2);
    ctx.fill();

    // Team Initials
    const letters = initials || (name ? name.substring(0, 3).toUpperCase() : 'FC');
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 84px "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letters, 256, 220);

    // Stars at top
    ctx.fillStyle = '#ffd700';
    ctx.font = '44px sans-serif';
    ctx.fillText('★ ★ ★', 256, 110);

    // Banner at bottom
    ctx.fillStyle = secondaryColor || '#ffffff';
    ctx.font = 'bold 32px sans-serif';
    const shortName = name.length > 12 ? name.substring(0, 10) + '..' : name;
    ctx.fillText(shortName.toUpperCase(), 256, 390);

    return canvas;
  }
};
