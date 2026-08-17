/**
 * Prism shader adapted from React Bits.
 * Source: https://www.reactbits.dev/backgrounds/prism
 *
 * The original React component uses OGL. This MV3 adaptation reuses the
 * bundled Three.js runtime and caps render cost for an always-open new tab.
 */
import * as THREE from "../vendor/three.module.min.js";

const VERTEX_SHADER = `
precision highp float;
attribute vec3 position;

void main() {
  gl_Position = vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 iResolution;
uniform float iTime;
uniform mat3 uRot;
uniform float uGlow;
uniform vec2 uOffsetPx;
uniform float uNoise;
uniform float uSaturation;
uniform float uColorFreq;
uniform float uBloom;
uniform float uCenterShift;
uniform float uInvBaseHalf;
uniform float uInvHeight;
uniform float uMinAxis;
uniform float uPxScale;
uniform float uTimeScale;

vec4 tanh4(vec4 x) {
  vec4 e2x = exp(2.0 * x);
  return (e2x - 1.0) / (e2x + 1.0);
}

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453123);
}

float sdOctaAnisoInv(vec3 p) {
  vec3 q = vec3(
    abs(p.x) * uInvBaseHalf,
    abs(p.y) * uInvHeight,
    abs(p.z) * uInvBaseHalf
  );
  float m = q.x + q.y + q.z - 1.0;
  return m * uMinAxis * 0.5773502691896258;
}

float sdPyramidUpInv(vec3 p) {
  return max(sdOctaAnisoInv(p), -p.y);
}

void main() {
  vec2 f = (gl_FragCoord.xy - 0.5 * iResolution.xy - uOffsetPx) * uPxScale;
  float z = 5.0;
  float d = 0.0;
  vec3 p;
  vec4 outputColor = vec4(0.0);

  float t = iTime * uTimeScale;
  float c0 = cos(t);
  mat2 wobble = mat2(c0, cos(t + 33.0), cos(t + 11.0), c0);

  const int STEPS = 72;
  for (int i = 0; i < STEPS; i++) {
    p = vec3(f, z);
    p.xz = p.xz * wobble;
    p = uRot * p;
    vec3 q = p;
    q.y += uCenterShift;
    d = 0.1 + 0.2 * abs(sdPyramidUpInv(q));
    z -= d;
    outputColor += (
      sin((p.y + z) * uColorFreq + vec4(0.0, 1.0, 2.0, 3.0)) + 1.0
    ) / d;
  }

  outputColor = tanh4(outputColor * outputColor * (uGlow * uBloom) / 1e5);
  vec3 color = outputColor.rgb;
  float grain = rand(gl_FragCoord.xy + vec2(iTime));
  color += (grain - 0.5) * uNoise;
  color = clamp(color, 0.0, 1.0);

  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = clamp(mix(vec3(luminance), color, uSaturation), 0.0, 1.0);
  gl_FragColor = vec4(color, clamp(outputColor.a, 0.0, 0.92));
}
`;

function setIdentityMatrix(target) {
  target.set(
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  );
}

export function mountPrism(container, options = {}) {
  if (!container) return { dispose() {} };

  const {
    height = 3.5,
    baseWidth = 5.5,
    glow = 0.92,
    offset = { x: 0, y: 0 },
    noise = 0.12,
    scale = 3.7,
    colorFrequency = 1,
    bloom = 0.92,
    timeScale = 0.34,
    saturation = 1.22,
    framesPerSecond = 30,
  } = options;

  const prismHeight = Math.max(0.001, height);
  const baseHalf = Math.max(0.001, baseWidth) * 0.5;
  const renderScale = Math.max(0.001, scale);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25) * 0.78);
  renderer.domElement.setAttribute("aria-hidden", "true");
  container.replaceChildren(renderer.domElement);

  const rotation = new THREE.Matrix3();
  setIdentityMatrix(rotation);
  const uniforms = {
    iResolution: { value: new THREE.Vector2(1, 1) },
    iTime: { value: 0 },
    uRot: { value: rotation },
    uGlow: { value: Math.max(0, glow) },
    uOffsetPx: { value: new THREE.Vector2() },
    uNoise: { value: Math.max(0, noise) },
    uSaturation: { value: Math.max(0, saturation) },
    uColorFreq: { value: Math.max(0, colorFrequency) },
    uBloom: { value: Math.max(0, bloom) },
    uCenterShift: { value: prismHeight * 0.25 },
    uInvBaseHalf: { value: 1 / baseHalf },
    uInvHeight: { value: 1 / prismHeight },
    uMinAxis: { value: Math.min(baseHalf, prismHeight) },
    uPxScale: { value: 1 },
    uTimeScale: { value: Math.max(0, timeScale) },
  };

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.RawShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    transparent: false,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  scene.add(new THREE.Mesh(geometry, material));

  let animationFrame = 0;
  let resizeFrame = 0;
  let running = false;
  let visible = true;
  let disposed = false;
  let lastRenderTime = 0;
  const startedAt = performance.now();
  const frameInterval = 1000 / Math.max(1, framesPerSecond);

  const resize = () => {
    if (disposed) return;
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const heightPx = Math.max(1, Math.floor(rect.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25) * 0.78);
    renderer.setSize(width, heightPx, false);
    const drawingSize = renderer.getDrawingBufferSize(new THREE.Vector2());
    uniforms.iResolution.value.copy(drawingSize);
    const pixelRatio = renderer.getPixelRatio();
    uniforms.uOffsetPx.value.set((offset?.x || 0) * pixelRatio, (offset?.y || 0) * pixelRatio);
    uniforms.uPxScale.value = 1 / (Math.max(1, drawingSize.y) * 0.1 * renderScale);
  };

  const render = time => {
    uniforms.iTime.value = Math.max(0, time - startedAt) * 0.001;
    renderer.render(scene, camera);
  };

  const loop = time => {
    if (!running || disposed) return;
    if (time - lastRenderTime >= frameInterval) {
      lastRenderTime = time;
      render(time);
    }
    animationFrame = requestAnimationFrame(loop);
  };

  const pause = () => {
    running = false;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  };

  const start = () => {
    if (disposed || running || !visible || document.hidden || reducedMotion.matches) return;
    running = true;
    animationFrame = requestAnimationFrame(loop);
  };

  const renderReducedMotionFrame = () => {
    pause();
    render(startedAt + 2200);
  };

  const onVisibilityChange = () => {
    if (document.hidden) pause();
    else if (reducedMotion.matches) renderReducedMotionFrame();
    else start();
  };

  const onMotionPreferenceChange = () => {
    if (reducedMotion.matches) renderReducedMotionFrame();
    else start();
  };

  const resizeObserver = new ResizeObserver(() => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      resize();
      if (reducedMotion.matches) renderReducedMotionFrame();
    });
  });
  resizeObserver.observe(container);

  const intersectionObserver = new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting !== false;
    if (visible) start();
    else pause();
  }, { threshold: [0, 0.01] });
  intersectionObserver.observe(container);

  document.addEventListener("visibilitychange", onVisibilityChange);
  reducedMotion.addEventListener("change", onMotionPreferenceChange);
  resize();
  if (reducedMotion.matches) renderReducedMotionFrame();
  else start();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      pause();
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotion.removeEventListener("change", onMotionPreferenceChange);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
