/**
 * WebGL 3D Racing Engine (Pure WebGL - Zero External Libraries)
 * Renders the 3D straight-line F1 Ghost Race with dynamic cameras,
 * custom shaders, procedural track, round arches, and holographic ghost effects.
 */

class WebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { antialias: true, alpha: false }) ||
              canvas.getContext('experimental-webgl', { antialias: true, alpha: false });

    if (!this.gl) {
      throw new Error('WebGL não é suportado pelo seu navegador.');
    }

    const gl = this.gl;
    gl.clearColor(0.04, 0.06, 0.1, 1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // Matrices
    this.matProj = Mat4.create();
    this.matView = Mat4.create();
    this.matModel = Mat4.create();
    this.matNormal = Mat4.create();
    this.cameraPos = Vec3.create(0, 5, 12);
    this.cameraTarget = Vec3.create(0, 1.2, 0);

    // Camera modes
    this.cameraMode = 'CHASE'; // 'CHASE', 'COCKPIT', 'SIDE_TV', 'DRONE'
    this.orbitAngles = { yaw: 0, pitch: 0.15, distance: 15 };
    this.isDragging = false;
    this.lastMouse = { x: 0, y: 0 };

    // Simulation & Race State
    this.trackRoundDist = 140.0; // Distance units between consecutive rounds
    this.maxRounds = 34;
    this.currentRoundFloat = 1.0;
    this.team1Pos = Vec3.create(-2.8, 0.8, -140);
    this.team2Pos = Vec3.create(2.8, 0.8, -140);

    // Ghost factors (0.0 = solid, 1.0 = ghost)
    this.t1Ghost = 1.0;
    this.t2Ghost = 0.0;

    // Team textures & colors
    this.team1Texture = null;
    this.team2Texture = null;
    this.team1Color = [0.0, 0.4, 1.0, 1.0];
    this.team2Color = [0.9, 0.1, 0.2, 1.0];

    // Gate textures cache
    this.gateTextures = new Map();

    // Speed lines & particles
    this.initParticles();

    // Init Shaders & Meshes
    this.initShaders();
    this.initMeshes();
    this.setupEventListeners();
    this.resize();
  }

  setupEventListeners() {
    window.addEventListener('resize', () => this.resize());

    // Mouse drag for free view
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.lastMouse = { x: e.clientX, y: e.clientY };

      this.orbitAngles.yaw -= dx * 0.006;
      this.orbitAngles.pitch = Math.max(-0.4, Math.min(1.2, this.orbitAngles.pitch + dy * 0.006));
    });

    // Touch controls for mobile
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    });

    window.addEventListener('touchend', () => {
      this.isDragging = false;
    });

    window.addEventListener('touchmove', (e) => {
      if (!this.isDragging || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - this.lastMouse.x;
      const dy = e.touches[0].clientY - this.lastMouse.y;
      this.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };

      this.orbitAngles.yaw -= dx * 0.008;
      this.orbitAngles.pitch = Math.max(-0.4, Math.min(1.2, this.orbitAngles.pitch + dy * 0.008));
    });
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }
  }

  initShaders() {
    const gl = this.gl;

    // --- Main Shader (PBR-lite, Ghost effect, Textures, Fog) ---
    const vsSource = `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      attribute vec2 aTexCoord;
      attribute vec4 aColor;

      uniform mat4 uModel;
      uniform mat4 uView;
      uniform mat4 uProjection;
      uniform mat4 uNormalMatrix;

      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec2 vTexCoord;
      varying vec4 vColor;

      void main() {
        vec4 worldPos = uModel * vec4(aPosition, 1.0);
        vWorldPos = worldPos.xyz;
        vNormal = normalize((uNormalMatrix * vec4(aNormal, 0.0)).xyz);
        vTexCoord = aTexCoord;
        vColor = aColor;
        gl_Position = uProjection * uView * worldPos;
      }
    `;

    const fsSource = `
      precision mediump float;

      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec2 vTexCoord;
      varying vec4 vColor;

      uniform vec3 uCameraPos;
      uniform sampler2D uTexture;
      uniform int uUseTexture;
      uniform vec4 uBaseColor;
      uniform float uIsGhost;       // 0.0 = solid, 1.0 = ghost
      uniform float uTime;
      uniform vec3 uEmission;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(uCameraPos - vWorldPos);

        // Base surface color
        vec4 col = uBaseColor * vColor;
        if (uUseTexture == 1) {
          vec4 tex = texture2D(uTexture, vTexCoord);
          col *= tex;
          // Discard transparent pixels of PNG badge shield
          if (col.a < 0.05) discard;
        }

        // --- GHOST RENDERING MODE (F1 Leader) ---
        if (uIsGhost > 0.05) {
          vec3 lightDir = normalize(vec3(0.3, 0.9, 0.4));
          float diff = max(dot(N, lightDir), 0.0) * 0.75 + 0.25;

          // Specular highlight for metallic/glossy reflection
          vec3 R = reflect(-lightDir, N);
          float spec = pow(max(dot(V, R), 0.0), 24.0) * 0.5;

          // Subtle Fresnel rim glow on grazing angles
          float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.8);

          // Subtle holographic scanlines
          float scanline = sin(vWorldPos.y * 32.0 - uTime * 6.0) * 0.03 +
                           cos(vWorldPos.z * 10.0 + uTime * 4.0) * 0.02;

          vec3 ghostAura = vec3(0.0, 0.85, 1.0);
          vec3 ghostRGB;
          float ghostAlpha;

          if (uUseTexture == 1) {
            // Emblazoned team escudo badge: keep shield colors vibrant and accurate
            ghostRGB = col.rgb * (diff + 0.12) + vec3(spec * 0.3) + ghostAura * (fresnel * 0.20 + scanline) + uEmission;
            ghostAlpha = clamp(col.a * 0.80, 0.0, 1.0);
          } else {
            // Car chassis / body: preserve rich team color with diffuse lighting, plus delicate ghost rim
            vec3 litBody = col.rgb * diff + vec3(spec * 0.5);
            ghostRGB = litBody + ghostAura * (fresnel * 0.28 + scanline) + uEmission;
            ghostAlpha = 0.80; // Leve transparência (~80% opacidade)
          }

          // Atmospheric distance fog
          float dist = distance(uCameraPos, vWorldPos);
          float fogFactor = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
          ghostRGB = mix(ghostRGB, uFogColor, fogFactor * 0.85);

          // Blend with solid state if transitioning
          if (uIsGhost < 0.95) {
            vec3 solidRGB = col.rgb * diff + vec3(spec) + uEmission;
            solidRGB = mix(solidRGB, uFogColor, fogFactor * 0.85);
            gl_FragColor = vec4(mix(solidRGB, ghostRGB, uIsGhost), mix(col.a, ghostAlpha, uIsGhost));
          } else {
            gl_FragColor = vec4(ghostRGB, ghostAlpha);
          }
          return;
        }

        // --- SOLID RENDERING MODE (Pursuer / Follower) ---
        vec3 lightDir = normalize(vec3(0.3, 0.9, 0.4));
        float diff = max(dot(N, lightDir), 0.0) * 0.75 + 0.25;

        // Specular highlight
        vec3 R = reflect(-lightDir, N);
        float spec = pow(max(dot(V, R), 0.0), 24.0) * 0.6;

        vec3 finalRGB = col.rgb * diff + vec3(spec) + uEmission;

        // Atmospheric distance fog
        float dist = distance(uCameraPos, vWorldPos);
        float fogFactor = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
        finalRGB = mix(finalRGB, uFogColor, fogFactor * 0.85);

        gl_FragColor = vec4(finalRGB, col.a);
      }
    `;

    this.program = this.createShaderProgram(vsSource, fsSource);

    // Uniform locations
    this.uLocations = {
      uModel: gl.getUniformLocation(this.program, 'uModel'),
      uView: gl.getUniformLocation(this.program, 'uView'),
      uProjection: gl.getUniformLocation(this.program, 'uProjection'),
      uNormalMatrix: gl.getUniformLocation(this.program, 'uNormalMatrix'),
      uCameraPos: gl.getUniformLocation(this.program, 'uCameraPos'),
      uTexture: gl.getUniformLocation(this.program, 'uTexture'),
      uUseTexture: gl.getUniformLocation(this.program, 'uUseTexture'),
      uBaseColor: gl.getUniformLocation(this.program, 'uBaseColor'),
      uIsGhost: gl.getUniformLocation(this.program, 'uIsGhost'),
      uTime: gl.getUniformLocation(this.program, 'uTime'),
      uEmission: gl.getUniformLocation(this.program, 'uEmission'),
      uFogColor: gl.getUniformLocation(this.program, 'uFogColor'),
      uFogNear: gl.getUniformLocation(this.program, 'uFogNear'),
      uFogFar: gl.getUniformLocation(this.program, 'uFogFar')
    };

    // Attribute locations
    this.aLocations = {
      aPosition: gl.getAttribLocation(this.program, 'aPosition'),
      aNormal: gl.getAttribLocation(this.program, 'aNormal'),
      aTexCoord: gl.getAttribLocation(this.program, 'aTexCoord'),
      aColor: gl.getAttribLocation(this.program, 'aColor')
    };
  }

  createShaderProgram(vsSrc, fsSrc) {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      throw new Error('Vertex shader error: ' + gl.getShaderInfoLog(vs));
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      throw new Error('Fragment shader error: ' + gl.getShaderInfoLog(fs));
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Shader link error: ' + gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  initMeshes() {
    this.meshCar = this.buildF1CarMesh();
    this.meshShieldAvatar = this.buildShieldAvatarMesh();
    this.meshUnderglow = this.buildUnderglowMesh();
    this.meshTrackSegment = this.buildTrackSegmentMesh();
    this.meshArch = this.buildArchMesh();
    this.meshBillboard = this.buildBillboardMesh();
    this.meshSpeedStreak = this.buildSpeedStreakMesh();
  }

  initParticles() {
    this.maxParticles = 160;
    this.particles = [];
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push({
        pos: Vec3.create(0, 0, 0),
        vel: Vec3.create(0, 0, 0),
        color: [0, 0.8, 1, 1],
        life: 0,
        maxLife: 1
      });
    }

    // Speed lines around camera
    this.speedLines = [];
    for (let i = 0; i < 90; i++) {
      this.speedLines.push({
        offset: Vec3.create(
          (Math.random() - 0.5) * 35,
          Math.random() * 12 + 0.5,
          (Math.random() - 0.5) * 60
        ),
        length: 8 + Math.random() * 15,
        speed: 1.2 + Math.random() * 0.8
      });
    }
  }

  // --- 3D Mesh Builders ---

  buildBillboardMesh() {
    // 2D Quad with UVs facing +Z (v=1 at top, v=0 at bottom)
    const vertices = [
      -1, -1, 0,   0, 0, 1,   0, 0,   1, 1, 1, 1,
       1, -1, 0,   0, 0, 1,   1, 0,   1, 1, 1, 1,
       1,  1, 0,   0, 0, 1,   1, 1,   1, 1, 1, 1,
      -1,  1, 0,   0, 0, 1,   0, 1,   1, 1, 1, 1
    ];
    const indices = [0, 1, 2, 0, 2, 3];
    return this.createGLBuffers(vertices, indices);
  }

  buildShieldAvatarMesh() {
    // 3D Double-Sided Shield Avatar embodying url_escudo_png
    const W = 1.35; // Total width = 2.7
    const H = 1.60; // Total height = 3.2
    const vertices = [];
    const indices = [];

    // 1. REAR FACE (Facing +Z, viewed directly from behind in Chase / Cockpit Cam)
    const baseIdx0 = vertices.length / 12;
    vertices.push(
      -W, -H, 0.04,   0, 0, 1,   0, 0,   1, 1, 1, 1, // Bottom-left
       W, -H, 0.04,   0, 0, 1,   1, 0,   1, 1, 1, 1, // Bottom-right
       W,  H, 0.04,   0, 0, 1,   1, 1,   1, 1, 1, 1, // Top-right
      -W,  H, 0.04,   0, 0, 1,   0, 1,   1, 1, 1, 1  // Top-left
    );
    indices.push(baseIdx0, baseIdx0 + 1, baseIdx0 + 2, baseIdx0, baseIdx0 + 2, baseIdx0 + 3);

    // 2. FRONT FACE (Facing -Z, viewed from front of vehicle)
    const baseIdx1 = vertices.length / 12;
    vertices.push(
       W, -H, -0.04,   0, 0, -1,   0, 0,   1, 1, 1, 1, // Bottom-left
      -W, -H, -0.04,   0, 0, -1,   1, 0,   1, 1, 1, 1, // Bottom-right
      -W,  H, -0.04,   0, 0, -1,   1, 1,   1, 1, 1, 1, // Top-right
       W,  H, -0.04,   0, 0, -1,   0, 1,   1, 1, 1, 1  // Top-left
    );
    indices.push(baseIdx1, baseIdx1 + 1, baseIdx1 + 2, baseIdx1, baseIdx1 + 2, baseIdx1 + 3);

    return this.createGLBuffers(vertices, indices);
  }

  buildUnderglowMesh() {
    // Soft underglow projection quad on track asphalt
    const vertices = [
      -1.8, 0,  2.2,   0, 1, 0,   0, 0,   1, 1, 1, 0.7,
       1.8, 0,  2.2,   0, 1, 0,   1, 0,   1, 1, 1, 0.7,
       1.8, 0, -3.2,   0, 1, 0,   1, 1,   1, 1, 1, 0.7,
      -1.8, 0, -3.2,   0, 1, 0,   0, 1,   1, 1, 1, 0.7
    ];
    const indices = [0, 1, 2, 0, 2, 3];
    return this.createGLBuffers(vertices, indices);
  }

  buildTrackSegmentMesh() {
    // Road runway: width 20, length 140 (one round length)
    // Subdivided with curb edges, center dashed line, guardrail posts
    const w = 11.0;
    const l = 140.0;
    const vertices = [];
    const indices = [];

    // Helper to add quad
    const addQuad = (p1, p2, p3, p4, norm, col, uvs) => {
      const baseIdx = vertices.length / 12;
      const pts = [p1, p2, p3, p4];
      for (let i = 0; i < 4; i++) {
        vertices.push(
          pts[i][0], pts[i][1], pts[i][2],
          norm[0], norm[1], norm[2],
          uvs[i][0], uvs[i][1],
          col[0], col[1], col[2], col[3]
        );
      }
      indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
    };

    // 1. Main dark asphalt strip
    addQuad(
      [-w, 0, 0], [-w, 0, -l], [w, 0, -l], [w, 0, 0],
      [0, 1, 0], [0.07, 0.09, 0.13, 1.0],
      [[0, 0], [0, l / 10], [1, l / 10], [1, 0]]
    );

    // 2. Left Curb (Red & White alternating kerbs)
    const curbW = 1.0;
    const curbSteps = 28;
    const stepL = l / curbSteps;
    for (let i = 0; i < curbSteps; i++) {
      const z0 = -i * stepL;
      const z1 = -(i + 1) * stepL;
      const isRed = i % 2 === 0;
      const curbCol = isRed ? [0.9, 0.1, 0.1, 1.0] : [0.95, 0.95, 0.95, 1.0];

      // Left curb
      addQuad(
        [-w - curbW, 0.05, z0], [-w - curbW, 0.05, z1], [-w, 0.05, z1], [-w, 0.05, z0],
        [0, 1, 0], curbCol,
        [[0, 0], [0, 1], [1, 1], [1, 0]]
      );
      // Right curb
      addQuad(
        [w, 0.05, z0], [w, 0.05, z1], [w + curbW, 0.05, z1], [w + curbW, 0.05, z0],
        [0, 1, 0], curbCol,
        [[0, 0], [0, 1], [1, 1], [1, 0]]
      );
    }

    // 3. Center line (neon white dashed)
    const dashSteps = 14;
    const dashL = l / dashSteps;
    for (let i = 0; i < dashSteps; i++) {
      const z0 = -i * dashL - dashL * 0.2;
      const z1 = -i * dashL - dashL * 0.8;
      addQuad(
        [-0.15, 0.02, z0], [-0.15, 0.02, z1], [0.15, 0.02, z1], [0.15, 0.02, z0],
        [0, 1, 0], [0.9, 0.95, 1.0, 1.0],
        [[0, 0], [0, 1], [1, 1], [1, 0]]
      );
    }

    // 4. Side glowing neon barrier tubes
    addQuad(
      [-w - curbW, 0.25, 0], [-w - curbW, 0.25, -l], [-w - curbW + 0.1, 0.25, -l], [-w - curbW + 0.1, 0.25, 0],
      [0, 1, 0], [0.1, 0.85, 1.0, 1.0],
      [[0, 0], [0, 1], [1, 1], [1, 0]]
    );
    addQuad(
      [w + curbW - 0.1, 0.25, 0], [w + curbW - 0.1, 0.25, -l], [w + curbW, 0.25, -l], [w + curbW, 0.25, 0],
      [0, 1, 0], [1.0, 0.2, 0.3, 1.0],
      [[0, 0], [0, 1], [1, 1], [1, 0]]
    );

    return this.createGLBuffers(vertices, indices);
  }

  buildArchMesh() {
    // Overhead gantry spanning the track at each round checkpoint
    const vertices = [];
    const indices = [];

    const addBox = (center, size, col) => {
      const [cx, cy, cz] = center;
      const [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];

      const faces = [
        // Front
        { n: [0, 0, 1], pts: [[cx - sx, cy - sy, cz + sz], [cx + sx, cy - sy, cz + sz], [cx + sx, cy + sy, cz + sz], [cx - sx, cy + sy, cz + sz]] },
        // Back
        { n: [0, 0, -1], pts: [[cx + sx, cy - sy, cz - sz], [cx - sx, cy - sy, cz - sz], [cx - sx, cy + sy, cz - sz], [cx + sx, cy + sy, cz - sz]] },
        // Top
        { n: [0, 1, 0], pts: [[cx - sx, cy + sy, cz + sz], [cx + sx, cy + sy, cz + sz], [cx + sx, cy + sy, cz - sz], [cx - sx, cy + sy, cz - sz]] },
        // Bottom
        { n: [0, -1, 0], pts: [[cx - sx, cy - sy, cz - sz], [cx + sx, cy - sy, cz - sz], [cx + sx, cy - sy, cz + sz], [cx - sx, cy - sy, cz + sz]] },
        // Left
        { n: [-1, 0, 0], pts: [[cx - sx, cy - sy, cz - sz], [cx - sx, cy - sy, cz + sz], [cx - sx, cy + sy, cz + sz], [cx - sx, cy + sy, cz - sz]] },
        // Right
        { n: [1, 0, 0], pts: [[cx + sx, cy - sy, cz + sz], [cx + sx, cy - sy, cz - sz], [cx + sx, cy + sy, cz - sz], [cx + sx, cy + sy, cz + sz]] }
      ];

      for (const f of faces) {
        const baseIdx = vertices.length / 12;
        const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
        for (let i = 0; i < 4; i++) {
          vertices.push(
            f.pts[i][0], f.pts[i][1], f.pts[i][2],
            f.n[0], f.n[1], f.n[2],
            uvs[i][0], uvs[i][1],
            col[0], col[1], col[2], col[3]
          );
        }
        indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
      }
    };

    const pillarCol = [0.18, 0.22, 0.3, 1.0];
    const beamCol = [0.12, 0.15, 0.22, 1.0];
    const accentCol = [0.1, 0.9, 1.0, 1.0];

    // Left Pillar
    addBox([-12.5, 4.5, 0], [1.2, 9.0, 1.4], pillarCol);
    addBox([-12.5, 4.5, 0.75], [0.3, 8.8, 0.2], accentCol); // Neon strip

    // Right Pillar
    addBox([12.5, 4.5, 0], [1.2, 9.0, 1.4], pillarCol);
    addBox([12.5, 4.5, 0.75], [0.3, 8.8, 0.2], accentCol); // Neon strip

    // Overhead Bridge Beam
    addBox([0, 9.2, 0], [26.2, 1.6, 1.4], beamCol);
    addBox([0, 8.4, 0.75], [24.0, 0.25, 0.1], accentCol); // Neon strip under beam

    // Ground Checkpoint Laser Line
    addBox([0, 0.08, 0], [24.0, 0.05, 0.6], [1.0, 0.85, 0.1, 1.0]);

    return this.createGLBuffers(vertices, indices);
  }

  buildF1CarMesh() {
    // Sleek streamlined F1 Aerodynamic Hovercraft Chassis
    const vertices = [];
    const indices = [];

    const addBox = (center, size, col, uvScale = [1, 1]) => {
      const [cx, cy, cz] = center;
      const [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];

      const faces = [
        { n: [0, 0, 1], pts: [[cx - sx, cy - sy, cz + sz], [cx + sx, cy - sy, cz + sz], [cx + sx, cy + sy, cz + sz], [cx - sx, cy + sy, cz + sz]] },
        { n: [0, 0, -1], pts: [[cx + sx, cy - sy, cz - sz], [cx - sx, cy - sy, cz - sz], [cx - sx, cy + sy, cz - sz], [cx + sx, cy + sy, cz - sz]] },
        { n: [0, 1, 0], pts: [[cx - sx, cy + sy, cz + sz], [cx + sx, cy + sy, cz + sz], [cx + sx, cy + sy, cz - sz], [cx - sx, cy + sy, cz - sz]] },
        { n: [0, -1, 0], pts: [[cx - sx, cy - sy, cz - sz], [cx + sx, cy - sy, cz - sz], [cx + sx, cy - sy, cz + sz], [cx - sx, cy - sy, cz + sz]] },
        { n: [-1, 0, 0], pts: [[cx - sx, cy - sy, cz - sz], [cx - sx, cy - sy, cz + sz], [cx - sx, cy + sy, cz + sz], [cx - sx, cy + sy, cz - sz]] },
        { n: [1, 0, 0], pts: [[cx + sx, cy - sy, cz + sz], [cx + sx, cy - sy, cz - sz], [cx + sx, cy + sy, cz - sz], [cx + sx, cy + sy, cz + sz]] }
      ];

      for (const f of faces) {
        const baseIdx = vertices.length / 12;
        const uvs = [[0, 0], [uvScale[0], 0], [uvScale[0], uvScale[1]], [0, uvScale[1]]];
        for (let i = 0; i < 4; i++) {
          vertices.push(
            f.pts[i][0], f.pts[i][1], f.pts[i][2],
            f.n[0], f.n[1], f.n[2],
            uvs[i][0], uvs[i][1],
            col[0], col[1], col[2], col[3]
          );
        }
        indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
      }
    };

    const cBody = [0.94, 0.94, 0.96, 1.0];   // Metallic finish (tints with team color)
    const cCarbon = [0.08, 0.10, 0.14, 1.0]; // Carbon fiber aero
    const cCockpit = [0.03, 0.05, 0.08, 1.0];
    const cNeon = [0.1, 0.9, 1.0, 1.0];

    // 1. Aerodynamic Main Fuselage
    addBox([0, 0.22, 0.0], [1.6, 0.28, 3.2], cBody);

    // 2. Streamlined Tapered Nosecone (Extends down the track towards -Z)
    addBox([0, 0.20, -1.9], [1.0, 0.22, 1.6], cBody);
    addBox([0, 0.16, -2.8], [0.65, 0.14, 0.8], cCarbon);

    // 3. Low F1 Front Wing & Apex Endplates
    addBox([0, 0.10, -3.0], [2.8, 0.06, 0.45], cCarbon);
    addBox([-1.42, 0.22, -3.0], [0.06, 0.28, 0.45], cBody);
    addBox([1.42, 0.22, -3.0], [0.06, 0.28, 0.45], cBody);
    addBox([0, 0.12, -3.22], [2.7, 0.03, 0.04], cNeon);

    // 4. Cockpit Driver Intake / Halo Canopy
    addBox([0, 0.46, -0.6], [0.65, 0.22, 0.8], cCockpit);

    // 5. Sculpted Side Aero Pods (Left & Right)
    addBox([-1.02, 0.24, 0.0], [0.55, 0.30, 1.8], cBody);
    addBox([1.02, 0.24, 0.0], [0.55, 0.30, 1.8], cBody);
    addBox([-1.02, 0.24, -0.85], [0.45, 0.22, 0.06], cCarbon);
    addBox([1.02, 0.24, -0.85], [0.45, 0.22, 0.06], cCarbon);

    // 6. Rear Wing Assembly (Elevated behind the shield avatar)
    addBox([-0.6, 0.72, 1.3], [0.08, 0.85, 0.3], cCarbon);
    addBox([0.6, 0.72, 1.3], [0.08, 0.85, 0.3], cCarbon);
    addBox([0, 1.15, 1.3], [2.6, 0.08, 0.55], cCarbon);
    addBox([-1.32, 1.12, 1.3], [0.06, 0.44, 0.65], cBody);
    addBox([1.32, 1.12, 1.3], [0.06, 0.44, 0.65], cBody);

    // 7. Twin Jet Thruster Exhaust Nozzles
    addBox([-0.42, 0.30, 1.35], [0.34, 0.34, 0.55], [0.18, 0.20, 0.24, 1.0]);
    addBox([0.42, 0.30, 1.35], [0.34, 0.34, 0.55], [0.18, 0.20, 0.24, 1.0]);
    addBox([-0.42, 0.30, 1.64], [0.28, 0.28, 0.06], cNeon);
    addBox([0.42, 0.30, 1.64], [0.28, 0.28, 0.06], cNeon);

    // 8. Shield Avatar Carbon Cradle / Brackets (locking the shield in place)
    addBox([-0.85, 0.80, 0.0], [0.12, 1.0, 0.25], cCarbon);
    addBox([0.85, 0.80, 0.0], [0.12, 1.0, 0.25], cCarbon);
    addBox([0, 0.36, 0.0], [1.7, 0.08, 0.25], cCarbon);

    return this.createGLBuffers(vertices, indices);
  }

  buildSpeedStreakMesh() {
    const vertices = [
      0, 0, -2,   0, 1, 0,   0, 0,   1, 1, 1, 0.8,
      0, 0,  2,   0, 1, 0,   0, 1,   1, 1, 1, 0.0
    ];
    const indices = [0, 1];
    return this.createGLLineBuffers(vertices, indices);
  }

  createGLBuffers(vertices, indices) {
    const gl = this.gl;
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    return {
      vbo,
      ibo,
      count: indices.length,
      stride: 12 * 4 // 3 pos + 3 norm + 2 uv + 4 col = 12 floats * 4 bytes
    };
  }

  createGLLineBuffers(vertices, indices) {
    const gl = this.gl;
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    return {
      vbo,
      ibo,
      count: indices.length,
      stride: 12 * 4,
      isLine: true
    };
  }

  // --- Texture Helpers ---

  createTextureFromCanvas(canvas) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  loadTeamBadgeTexture(teamIndex, url, teamName, primaryColor, secondaryColor) {
    // 1. Instantly create dynamic 512x512 canvas badge as bulletproof base
    const canvas = CartolaService.createBadgeCanvas(teamName, primaryColor, secondaryColor);
    const tex = this.createTextureFromCanvas(canvas);

    if (teamIndex === 1) {
      this.team1Texture = tex;
      this.team1Color = this.hexToVec4(primaryColor);
    } else {
      this.team2Texture = tex;
      this.team2Color = this.hexToVec4(primaryColor);
    }

    // 2. If real image URL is provided, load via proxy to eliminate browser CORS blocks
    if (url && url.startsWith('http')) {
      const safeUrl = CartolaService.getSafeImageUrl(url);
      const img = new Image();
      img.crossOrigin = 'anonymous';

      const applyImageToTexture = (loadedImg) => {
        try {
          const gl = this.gl;
          const potCanvas = document.createElement('canvas');
          potCanvas.width = 512;
          potCanvas.height = 512;
          const ctx = potCanvas.getContext('2d');
          ctx.clearRect(0, 0, 512, 512);

          // Draw the team shield centered onto 512x512 POT canvas
          ctx.drawImage(loadedImg, 16, 16, 480, 480);

          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, potCanvas);
          gl.generateMipmap(gl.TEXTURE_2D);

          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          console.log(`[Cartola 3D] Escudo oficial carregado com sucesso para Time ${teamIndex}:`, url);
        } catch (e) {
          console.warn(`[Cartola 3D] Erro ao aplicar textura para Time ${teamIndex}:`, e);
        }
      };

      img.onload = () => applyImageToTexture(img);

      img.onerror = () => {
        if (safeUrl !== url) {
          const directImg = new Image();
          directImg.crossOrigin = 'anonymous';
          directImg.onload = () => applyImageToTexture(directImg);
          directImg.src = url;
        }
      };

      img.src = safeUrl;
    }
  }

  getOrCreateGateTexture(roundNum) {
    if (this.gateTextures.has(roundNum)) {
      return this.gateTextures.get(roundNum);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // LED sign background
    ctx.fillStyle = '#060a12';
    ctx.fillRect(0, 0, 512, 128);

    // Glowing border
    ctx.strokeStyle = '#00ddff';
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 500, 116);

    // LED Grid dots
    ctx.fillStyle = 'rgba(0, 220, 255, 0.08)';
    for (let x = 12; x < 500; x += 10) {
      for (let y = 12; y < 116; y += 10) {
        ctx.fillRect(x, y, 4, 4);
      }
    }

    // Text: "RODADA 01" / "CHECKPOINT"
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 54px "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = `RODADA ${String(roundNum).padStart(2, '0')}`;
    ctx.fillText(text, 256, 64);

    const tex = this.createTextureFromCanvas(canvas);
    this.gateTextures.set(roundNum, tex);
    return tex;
  }

  hexToVec4(hex) {
    if (!hex || hex[0] !== '#') return [0.2, 0.5, 1.0, 1.0];
    const r = parseInt(hex.substring(1, 3), 16) / 255;
    const g = parseInt(hex.substring(3, 5), 16) / 255;
    const b = parseInt(hex.substring(5, 7), 16) / 255;
    return [r, g, b, 1.0];
  }

  // --- Rendering Loop ---

  render(state) {
    const gl = this.gl;
    const time = state.time || 0;
    this.currentRoundFloat = state.roundFloat || 1.0;

    // Viewport & Clear
    this.resize();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Projection Matrix (60 deg FOV)
    const aspect = this.canvas.width / this.canvas.height;
    Mat4.perspective(this.matProj, (55 * Math.PI) / 180, aspect, 0.5, 450.0);

    // Smoothly update positions from race state
    this.updateVehiclePositions(state);

    // Update Camera
    this.updateCamera(state);

    // Use Main Program
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uLocations.uProjection, false, this.matProj);
    gl.uniformMatrix4fv(this.uLocations.uView, false, this.matView);
    gl.uniform3fv(this.uLocations.uCameraPos, this.cameraPos);
    gl.uniform1f(this.uLocations.uTime, time);

    // Atmosphere Fog settings
    gl.uniform3f(this.uLocations.uFogColor, 0.04, 0.06, 0.1);
    gl.uniform1f(this.uLocations.uFogNear, 70.0);
    gl.uniform1f(this.uLocations.uFogFar, 320.0);

    // 1. Render Track
    this.renderTrack();

    // 2. Render Checkpoint Round Arches
    this.renderArches();

    // 3. Render Solid Follower Car first (for correct alpha blending)
    const isTeam1Leader = state.leader === 1;
    // Smooth transition for ghost factor
    const targetT1Ghost = isTeam1Leader ? 1.0 : 0.0;
    const targetT2Ghost = isTeam1Leader ? 0.0 : 1.0;
    this.t1Ghost += (targetT1Ghost - this.t1Ghost) * 0.12;
    this.t2Ghost += (targetT2Ghost - this.t2Ghost) * 0.12;

    if (this.t1Ghost <= this.t2Ghost) {
      // Team 1 is solid (or transitioning), render T1 first then T2 ghost
      this.renderCar(1, this.team1Pos, this.t1Ghost, this.team1Color, this.team1Texture, time);
      this.renderCar(2, this.team2Pos, this.t2Ghost, this.team2Color, this.team2Texture, time);
    } else {
      // Team 2 is solid, render T2 first then T1 ghost
      this.renderCar(2, this.team2Pos, this.t2Ghost, this.team2Color, this.team2Texture, time);
      this.renderCar(1, this.team1Pos, this.t1Ghost, this.team1Color, this.team1Texture, time);
    }

    // 4. Render Speed Streaks & Particle Exhaust
    this.renderSpeedStreaks(time);
  }

  updateVehiclePositions(state) {
    const r = this.currentRoundFloat;
    // Base position moves smoothly along -Z straight line
    const zBase = -r * this.trackRoundDist;

    // Delta points determines lead distance
    // 1 point delta = 0.55 track units, clamped to keep both within camera frame
    const maxGapOffset = 32.0;
    const gapOffset = Math.max(-maxGapOffset, Math.min(maxGapOffset, (state.scoreDelta || 0) * 0.55));

    // Bobbing hover float
    const hoverY = 0.78 + Math.sin(state.time * 7.0) * 0.04;

    // Team 1 runs on Left Lane (X = -2.8), Team 2 runs on Right Lane (X = +2.8)
    // When a team leads, it can drift slightly toward center (racing line)
    const t1Drift = state.leader === 1 ? 0.7 : 0.0;
    const t2Drift = state.leader === 2 ? -0.7 : 0.0;

    const t1Z = zBase - gapOffset / 2;
    const t2Z = zBase + gapOffset / 2;

    Vec3.set(this.team1Pos, -2.8 + t1Drift, hoverY, t1Z);
    Vec3.set(this.team2Pos, 2.8 + t2Drift, hoverY, t2Z);
  }

  updateCamera(state) {
    const midX = (this.team1Pos[0] + this.team2Pos[0]) * 0.5;
    const midY = (this.team1Pos[1] + this.team2Pos[1]) * 0.5;
    const midZ = (this.team1Pos[2] + this.team2Pos[2]) * 0.5;

    // Chase Leader or Trailing car
    const trailingZ = Math.max(this.team1Pos[2], this.team2Pos[2]);
    const leadingZ = Math.min(this.team1Pos[2], this.team2Pos[2]);

    if (this.cameraMode === 'CHASE') {
      // Dynamic third person chase camera positioned behind trailing car,
      // looking forward at both cars and the straight track
      const eyeX = midX + Math.sin(this.orbitAngles.yaw) * 16.0;
      const eyeY = 5.2 + this.orbitAngles.pitch * 8.0;
      const eyeZ = trailingZ + 14.5 + Math.cos(this.orbitAngles.yaw) * 6.0;

      Vec3.set(this.cameraPos, eyeX, eyeY, eyeZ);
      Vec3.set(this.cameraTarget, midX, midY + 1.2, leadingZ - 10.0);
    } else if (this.cameraMode === 'COCKPIT') {
      // Camera mounted on the nose of the chasing (solid) car looking at the ghost leader
      const chaserPos = state.leader === 1 ? this.team2Pos : this.team1Pos;
      Vec3.set(this.cameraPos, chaserPos[0], chaserPos[1] + 0.6, chaserPos[2] - 1.2);
      Vec3.set(this.cameraTarget, midX, midY + 0.9, leadingZ - 15.0);
    } else if (this.cameraMode === 'SIDE_TV') {
      // Trackside camera pacing the cars
      Vec3.set(this.cameraPos, -14.0, 4.0, midZ + 6.0);
      Vec3.set(this.cameraTarget, midX, midY + 1.0, midZ - 4.0);
    } else if (this.cameraMode === 'DRONE') {
      // High angle drone overview
      Vec3.set(this.cameraPos, 0, 18.0, midZ + 12.0);
      Vec3.set(this.cameraTarget, 0, 0, midZ - 20.0);
    }

    Mat4.lookAt(this.matView, this.cameraPos, this.cameraTarget, [0, 1, 0]);
  }

  /**
   * Projects a 3D world position to 2D screen coordinates (pixels).
   * Returns { x, y, distance } or null if behind camera / far outside viewport.
   */
  projectToScreen(pos3D) {
    const vx = pos3D[0], vy = pos3D[1], vz = pos3D[2];
    const v = this.matView;

    // 1. Transform to View / Eye Space
    const eyeX = v[0] * vx + v[4] * vy + v[8] * vz + v[12];
    const eyeY = v[1] * vx + v[5] * vy + v[9] * vz + v[13];
    const eyeZ = v[2] * vx + v[6] * vy + v[10] * vz + v[14];
    const eyeW = v[3] * vx + v[7] * vy + v[11] * vz + v[15];

    // In WebGL view space, camera looks down -Z. Reject points behind camera plane.
    if (eyeZ >= -0.2) {
      return null;
    }

    // 2. Transform to Clip Space via Projection Matrix
    const p = this.matProj;
    const clipX = p[0] * eyeX + p[4] * eyeY + p[8] * eyeZ + p[12] * eyeW;
    const clipY = p[1] * eyeX + p[5] * eyeY + p[9] * eyeZ + p[13] * eyeW;
    const clipZ = p[2] * eyeX + p[6] * eyeY + p[10] * eyeZ + p[14] * eyeW;
    const clipW = p[3] * eyeX + p[7] * eyeY + p[11] * eyeZ + p[15] * eyeW;

    if (clipW <= 0.001) {
      return null;
    }

    // 3. Normalized Device Coordinates (NDC)
    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;

    // Off-screen rejection margin
    if (ndcX < -1.4 || ndcX > 1.4 || ndcY < -1.4 || ndcY > 1.4) {
      return null;
    }

    // 4. Map NDC to CSS Canvas Coordinates
    const rect = this.canvas.getBoundingClientRect();
    const screenX = (ndcX * 0.5 + 0.5) * rect.width;
    const screenY = (-ndcY * 0.5 + 0.5) * rect.height;

    return {
      x: screenX,
      y: screenY,
      distance: clipW
    };
  }

  // --- Draw Calls ---

  renderTrack() {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    const startRound = Math.max(0, Math.floor(this.currentRoundFloat - 2));
    const endRound = Math.min(this.maxRounds + 1, Math.ceil(this.currentRoundFloat + 5));

    for (let r = startRound; r <= endRound; r++) {
      Mat4.identity(this.matModel);
      Mat4.translate(this.matModel, this.matModel, [0, 0, -r * this.trackRoundDist]);

      gl.uniformMatrix4fv(this.uLocations.uModel, false, this.matModel);
      this.computeNormalMatrix();

      gl.uniform1i(this.uLocations.uUseTexture, 0);
      gl.uniform4f(this.uLocations.uBaseColor, 1, 1, 1, 1);
      gl.uniform1f(this.uLocations.uIsGhost, 0.0);
      gl.uniform3f(this.uLocations.uEmission, 0, 0, 0);

      this.drawMesh(this.meshTrackSegment);
    }
  }

  renderArches() {
    const gl = this.gl;
    const startRound = Math.max(1, Math.floor(this.currentRoundFloat - 1));
    const endRound = Math.min(this.maxRounds, Math.ceil(this.currentRoundFloat + 4));

    for (let r = startRound; r <= endRound; r++) {
      const archZ = -r * this.trackRoundDist;

      // 1. Structure
      Mat4.identity(this.matModel);
      Mat4.translate(this.matModel, this.matModel, [0, 0, archZ]);
      gl.uniformMatrix4fv(this.uLocations.uModel, false, this.matModel);
      this.computeNormalMatrix();

      gl.uniform1i(this.uLocations.uUseTexture, 0);
      gl.uniform4f(this.uLocations.uBaseColor, 1, 1, 1, 1);
      gl.uniform1f(this.uLocations.uIsGhost, 0.0);
      gl.uniform3f(this.uLocations.uEmission, 0.05, 0.15, 0.25);

      this.drawMesh(this.meshArch);

      // 2. Dynamic Round Signboard Billboard
      const signTex = this.getOrCreateGateTexture(r);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, signTex);

      Mat4.identity(this.matModel);
      Mat4.translate(this.matModel, this.matModel, [0, 9.2, archZ + 0.72]);
      Mat4.scale(this.matModel, this.matModel, [5.5, 1.35, 1.0]);

      gl.uniformMatrix4fv(this.uLocations.uModel, false, this.matModel);
      this.computeNormalMatrix();

      gl.uniform1i(this.uLocations.uUseTexture, 1);
      gl.uniform1i(this.uLocations.uTexture, 0);
      gl.uniform4f(this.uLocations.uBaseColor, 1, 1, 1, 1);
      gl.uniform3f(this.uLocations.uEmission, 0.4, 0.8, 1.0);

      this.drawMesh(this.meshBillboard);
    }
  }

  renderCar(teamIdx, pos, ghostFactor, teamColor, texture, time) {
    const gl = this.gl;
    const isGhost = ghostFactor > 0.05;

    // Slight bank tilt when turning/overtaking
    const steerTilt = (teamIdx === 1 ? 1 : -1) * 0.035;

    // 1. Ground Underglow Projection (Soft neon puddle on track asphalt)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive neon glow
    gl.depthMask(false);

    Mat4.identity(this.matModel);
    Mat4.translate(this.matModel, this.matModel, [pos[0], 0.04, pos[2]]);
    gl.uniformMatrix4fv(this.uLocations.uModel, false, this.matModel);
    this.computeNormalMatrix();

    gl.uniform1i(this.uLocations.uUseTexture, 0);
    const underglowCol = isGhost ? [0.15, 0.9, 1.0, 0.55] : [teamColor[0], teamColor[1], teamColor[2], 0.75];
    gl.uniform4fv(this.uLocations.uBaseColor, underglowCol);
    gl.uniform1f(this.uLocations.uIsGhost, 0.0);
    gl.uniform3f(this.uLocations.uEmission, underglowCol[0] * 0.9, underglowCol[1] * 0.9, underglowCol[2] * 0.9);
    this.drawMesh(this.meshUnderglow);

    // 2. F1 Aerodynamic Chassis Body
    if (isGhost) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(true);
    } else {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }

    Mat4.identity(this.matModel);
    Mat4.translate(this.matModel, this.matModel, [pos[0], pos[1], pos[2]]);
    Mat4.rotateZ(this.matModel, this.matModel, steerTilt);

    gl.uniformMatrix4fv(this.uLocations.uModel, false, this.matModel);
    this.computeNormalMatrix();

    gl.uniform1i(this.uLocations.uUseTexture, 0);
    gl.uniform4f(this.uLocations.uBaseColor, teamColor[0], teamColor[1], teamColor[2], 1.0);
    gl.uniform1f(this.uLocations.uIsGhost, ghostFactor);
    gl.uniform3f(this.uLocations.uEmission, isGhost ? 0.03 : 0.02, isGhost ? 0.05 : 0.02, isGhost ? 0.07 : 0.02);

    this.drawMesh(this.meshCar);

    // 3. The 3D Shield Avatar (Embodying url_escudo_png)
    if (texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);

      // Centered proudly on the craft, upright and prominent
      Mat4.identity(this.matModel);
      Mat4.translate(this.matModel, this.matModel, [pos[0], pos[1] + 1.88, pos[2] + 0.05]);
      Mat4.rotateZ(this.matModel, this.matModel, steerTilt);

      gl.uniformMatrix4fv(this.uLocations.uModel, false, this.matModel);
      this.computeNormalMatrix();

      gl.uniform1i(this.uLocations.uUseTexture, 1);
      gl.uniform1i(this.uLocations.uTexture, 0);
      gl.uniform4f(this.uLocations.uBaseColor, 1.0, 1.0, 1.0, 1.0);
      gl.uniform1f(this.uLocations.uIsGhost, ghostFactor);
      gl.uniform3f(this.uLocations.uEmission, isGhost ? 0.04 : 0.04, isGhost ? 0.06 : 0.04, isGhost ? 0.08 : 0.04);

      this.drawMesh(this.meshShieldAvatar);

      // Nosecone badge decal on front hood
      Mat4.identity(this.matModel);
      Mat4.translate(this.matModel, this.matModel, [pos[0], pos[1] + 0.32, pos[2] - 1.7]);
      Mat4.rotateX(this.matModel, this.matModel, -Math.PI * 0.45);
      Mat4.scale(this.matModel, this.matModel, [0.65, 0.65, 0.65]);

      gl.uniformMatrix4fv(this.uLocations.uModel, false, this.matModel);
      this.computeNormalMatrix();
      this.drawMesh(this.meshBillboard);
    }

    // 4. Dual Jet Thruster Exhaust Plumes
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive fire glow
    gl.depthMask(false);

    const thrusterColor = isGhost ? [0.15, 0.9, 1.0, 0.85] : [1.0, 0.45, 0.1, 0.95];
    const flameLen = 1.8 + Math.sin(time * 36.0 + teamIdx * 3.0) * 0.4;
    const flameW = 0.32 + Math.sin(time * 28.0) * 0.04;

    [-0.42, 0.42].forEach(offsetX => {
      Mat4.identity(this.matModel);
      Mat4.translate(this.matModel, this.matModel, [pos[0] + offsetX, pos[1] + 0.30, pos[2] + 1.66 + flameLen * 0.5]);
      Mat4.scale(this.matModel, this.matModel, [flameW, flameW, flameLen]);

      gl.uniformMatrix4fv(this.uLocations.uModel, false, this.matModel);
      this.computeNormalMatrix();

      gl.uniform1i(this.uLocations.uUseTexture, 0);
      gl.uniform4fv(this.uLocations.uBaseColor, thrusterColor);
      gl.uniform1f(this.uLocations.uIsGhost, 0.0);
      gl.uniform3f(this.uLocations.uEmission, thrusterColor[0], thrusterColor[1], thrusterColor[2]);

      this.drawMesh(this.meshBillboard);
    });

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  renderSpeedStreaks(time) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    const midZ = (this.team1Pos[2] + this.team2Pos[2]) * 0.5;

    for (const streak of this.speedLines) {
      // Warp streaks along Z towards viewer
      const wrappedZ = midZ - ((streak.offset[2] + time * streak.speed * 45.0) % 90.0) + 20.0;

      Mat4.identity(this.matModel);
      Mat4.translate(this.matModel, this.matModel, [streak.offset[0], streak.offset[1], wrappedZ]);
      Mat4.scale(this.matModel, this.matModel, [0.06, 0.06, streak.length]);

      gl.uniformMatrix4fv(this.uLocations.uModel, false, this.matModel);
      this.computeNormalMatrix();

      gl.uniform1i(this.uLocations.uUseTexture, 0);
      gl.uniform4f(this.uLocations.uBaseColor, 0.4, 0.8, 1.0, 0.4);
      gl.uniform1f(this.uLocations.uIsGhost, 0.0);
      gl.uniform3f(this.uLocations.uEmission, 0.2, 0.6, 1.0);

      this.drawMesh(this.meshBillboard);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  computeNormalMatrix() {
    Mat4.invert(this.matNormal, this.matModel);
    Mat4.transpose(this.matNormal, this.matNormal);
    this.gl.uniformMatrix4fv(this.uLocations.uNormalMatrix, false, this.matNormal);
  }

  drawMesh(mesh) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);

    // aPosition: offset 0, 3 floats
    gl.enableVertexAttribArray(this.aLocations.aPosition);
    gl.vertexAttribPointer(this.aLocations.aPosition, 3, gl.FLOAT, false, mesh.stride, 0);

    // aNormal: offset 12, 3 floats
    gl.enableVertexAttribArray(this.aLocations.aNormal);
    gl.vertexAttribPointer(this.aLocations.aNormal, 3, gl.FLOAT, false, mesh.stride, 12);

    // aTexCoord: offset 24, 2 floats
    gl.enableVertexAttribArray(this.aLocations.aTexCoord);
    gl.vertexAttribPointer(this.aLocations.aTexCoord, 2, gl.FLOAT, false, mesh.stride, 24);

    // aColor: offset 32, 4 floats
    gl.enableVertexAttribArray(this.aLocations.aColor);
    gl.vertexAttribPointer(this.aLocations.aColor, 4, gl.FLOAT, false, mesh.stride, 32);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    gl.drawElements(mesh.isLine ? gl.LINES : gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  }
}
