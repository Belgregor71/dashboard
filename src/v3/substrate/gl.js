/* ═══════════════════════════════════════════════════════════════════════════
   SUBSTRATE — WebGL backend.

   Rendered to a 480x270 backing store and upscaled by the compositor to the
   full 1920x1080 panel. That is 6% of the pixels of a full-viewport CSS paint
   animation, which is the entire performance argument: this house has already
   measured a full-viewport background-color transition at ~5.6 GPU points, and
   the shader touches a sixteenth of the area.

   Verified on the kiosk before any of this was written:
     ANGLE (AMD, AMD Radeon Graphics (radeonsi raven ACO), OpenGL 4.6)
   Real hardware, not SwiftShader. The missing dma-buf/EGL-image export that
   makes hardware VIDEO decode impossible on this X11+ANGLE stack does not
   affect WebGL — different path entirely.

   THE SHADER BELOW IS BYTE-FOR-BYTE WHAT WAS MEASURED. If it changes, the
   measurement is void and must be retaken.
   ═══════════════════════════════════════════════════════════════════════════ */

const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision mediump float;
out vec4 fragColor;
uniform vec2  uRes;
uniform float uTime;
uniform float uSunAlt;
uniform float uSunAz;
uniform vec2  uWind;
uniform float uCloud;
uniform float uRain;

float hash(vec2 v){ return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 v){
  vec2 i = floor(v), f = fract(v);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 v){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++){ s += a * noise(v); v *= 2.02; a *= 0.5; }
  return s;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 drift = uWind * uTime * 0.015;
  float f = fbm(uv * 3.0 + drift + fbm(uv * 1.7 - drift * 0.5) * 0.6);

  vec3 warm = vec3(0.29, 0.20, 0.13);
  vec3 cool = vec3(0.08, 0.09, 0.13);
  float horizon = smoothstep(0.0, 0.85, uv.y + (f - 0.5) * 0.22);
  vec3 col = mix(warm, cool, horizon);

  vec2 sunPos = vec2(0.5 + cos(uSunAz) * 0.42, clamp(uSunAlt, -0.2, 1.0) * 0.7 + 0.12);
  float d = distance(uv, sunPos);
  float glow = exp(-d * d * 9.0) * smoothstep(-0.15, 0.35, uSunAlt);
  col += vec3(0.42, 0.28, 0.14) * glow * (1.0 - uCloud * 0.7);

  col = mix(col, vec3(0.13, 0.13, 0.15), uCloud * (0.25 + f * 0.35));
  col = mix(col, vec3(0.09, 0.10, 0.12), uRain * 0.5);
  col *= 1.0 - smoothstep(0.35, 1.15, distance(uv, vec2(0.5))) * 0.55;

  // Dither. Large near-black gradients band visibly on an 8-bit panel, and the
  // banding is far more noticeable than the effect it interrupts.
  float dq = (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  fragColor = vec4(col + dq, 1.0);
}`;

/* Every uniform is an EXTERNAL CAUSE. There is no uniform here that exists to
   make the surface move on its own; uTime only advances the wind's drift, and
   wind is a thing the room can look out of a window and verify. That is the
   one clause of the calm law that survives V3 intact. */
const DEFAULTS = { sunAlt: 0, sunAz: 0, wind: [0, 0], cloud: 0.3, rain: 0 };

export function createGlSubstrate(canvas) {
  const gl = canvas.getContext("webgl2", {
    antialias: false, depth: false, stencil: false,
    powerPreference: "low-power", preserveDrawingBuffer: false
  });
  if (!gl) return null;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("substrate: shader compile failed", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };

  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("substrate: link failed", gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  for (const n of ["uRes", "uTime", "uSunAlt", "uSunAz", "uWind", "uCloud", "uRain"]) {
    U[n] = gl.getUniformLocation(prog, n);
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(U.uRes, canvas.width, canvas.height);

  let causes = { ...DEFAULTS };
  let raf = null;
  let last = 0;
  let frames = 0;
  const t0 = performance.now();

  /* Cause-driven, not free-running. The loop runs ONLY while something is
     actually moving — wind or rain. On a still, clear day the substrate is
     drawn once and then costs literally nothing, which is what the <=8%
     quiescent budget is for. A 60fps loop that nobody asked for is the single
     most common way an ambient surface becomes expensive. */
  const moving = () => causes.rain > 0.02 || Math.hypot(causes.wind[0], causes.wind[1]) > 0.05;

  function draw() {
    gl.uniform1f(U.uTime, (performance.now() - t0) / 1000);
    gl.uniform1f(U.uSunAlt, causes.sunAlt);
    gl.uniform1f(U.uSunAz, causes.sunAz);
    gl.uniform2f(U.uWind, causes.wind[0], causes.wind[1]);
    gl.uniform1f(U.uCloud, causes.cloud);
    gl.uniform1f(U.uRain, causes.rain);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    frames++;
  }

  // 15fps ceiling. The field is a slow atmosphere; above ~15 nothing in it is
  // perceptibly different and every extra frame is pure cost.
  const FRAME_MS = 66;

  function loop(now) {
    if (!moving()) { raf = null; return; }
    if (now - last >= FRAME_MS) { last = now; draw(); }
    raf = requestAnimationFrame(loop);
  }

  return {
    backend: "webgl2",
    renderer: (() => {
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    })(),
    update(next) {
      causes = { ...causes, ...next };
      draw();                                   // a cause changed: show it once
      if (moving() && raf === null) raf = requestAnimationFrame(loop);
    },
    stats: () => ({ frames, seconds: (performance.now() - t0) / 1000, animating: raf !== null }),
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  };
}
