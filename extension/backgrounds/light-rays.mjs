/**
 * Light Rays shader adapted from React Bits.
 * Source: https://www.reactbits.dev/backgrounds/light-rays
 *
 * The original React component uses OGL. This MV3 adaptation renders the
 * shader with the Three.js runtime that BrowseLoom already bundles.
 */
import * as THREE from "../vendor/three.module.min.js";

const VERTEX_SHADER = `
precision highp float;
attribute vec3 position;
varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform vec2 rayPos;
uniform vec2 rayDir;
uniform vec3 raysColor;
uniform float raysSpeed;
uniform float lightSpread;
uniform float rayLength;
uniform float pulsating;
uniform float fadeDistance;
uniform float saturation;
uniform vec2 mousePos;
uniform float mouseInfluence;
uniform float noiseAmount;
uniform float distortion;

varying vec2 vUv;

float noise(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

float rayStrength(
  vec2 raySource,
  vec2 rayRefDirection,
  vec2 coord,
  float seedA,
  float seedB,
  float speed
) {
  vec2 sourceToCoord = coord - raySource;
  vec2 dirNorm = normalize(sourceToCoord);
  float cosAngle = dot(dirNorm, rayRefDirection);
  float distortedAngle = cosAngle
    + distortion * sin(iTime * 2.0 + length(sourceToCoord) * 0.01) * 0.2;
  float spreadFactor = pow(max(distortedAngle, 0.0), 1.0 / max(lightSpread, 0.001));
  float distanceToSource = length(sourceToCoord);
  float maxDistance = iResolution.x * rayLength;
  float lengthFalloff = clamp((maxDistance - distanceToSource) / maxDistance, 0.0, 1.0);
  float fadeLimit = max(iResolution.x * fadeDistance, 1.0);
  float fadeFalloff = clamp((fadeLimit - distanceToSource) / fadeLimit, 0.5, 1.0);
  float pulse = pulsating > 0.5 ? 0.8 + 0.2 * sin(iTime * speed * 3.0) : 1.0;
  float baseStrength = clamp(
    (0.45 + 0.15 * sin(distortedAngle * seedA + iTime * speed))
      + (0.3 + 0.2 * cos(-distortedAngle * seedB + iTime * speed)),
    0.0,
    1.0
  );
  float beamContrast = smoothstep(0.5, 0.92, baseStrength);
  float bandedStrength = mix(baseStrength, beamContrast, 0.72);
  return bandedStrength * lengthFalloff * fadeFalloff * spreadFactor * pulse;
}

void main() {
  vec2 coord = vec2(gl_FragCoord.x, iResolution.y - gl_FragCoord.y);
  vec2 finalRayDir = rayDir;
  if (mouseInfluence > 0.0) {
    vec2 mouseDirection = normalize(mousePos * iResolution.xy - rayPos);
    finalRayDir = normalize(mix(rayDir, mouseDirection, mouseInfluence));
  }

  float rays1 = rayStrength(rayPos, finalRayDir, coord, 36.2214, 21.11349, 1.5 * raysSpeed);
  float rays2 = rayStrength(rayPos, finalRayDir, coord, 22.3991, 18.0234, 1.1 * raysSpeed);
  float strength = rays1 * 0.5 + rays2 * 0.4;

  if (noiseAmount > 0.0) {
    float n = noise(coord * 0.01 + iTime * 0.1);
    strength *= 1.0 - noiseAmount + noiseAmount * n;
  }

  float brightness = 1.0 - coord.y / iResolution.y;
  vec3 color = vec3(
    0.1 + brightness * 0.8,
    0.3 + brightness * 0.6,
    0.5 + brightness * 0.5
  );

  if (saturation != 1.0) {
    float gray = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(gray), color, saturation);
  }

  color = clamp(color * raysColor * 1.25, 0.0, 1.0);
  gl_FragColor = vec4(color, clamp(strength * 1.12, 0.0, 0.9));
}
`;

function getAnchorAndDirection(origin, width, height) {
  const outside = 0.2;
  const positions = {
    "top-left": { anchor: [0, -outside * height], direction: [0, 1] },
    "top-right": { anchor: [width, -outside * height], direction: [0, 1] },
    left: { anchor: [-outside * width, 0.5 * height], direction: [1, 0] },
    right: { anchor: [(1 + outside) * width, 0.5 * height], direction: [-1, 0] },
    "bottom-left": { anchor: [0, (1 + outside) * height], direction: [0, -1] },
    "bottom-center": { anchor: [0.5 * width, (1 + outside) * height], direction: [0, -1] },
    "bottom-right": { anchor: [width, (1 + outside) * height], direction: [0, -1] },
  };
  return positions[origin] || {
    anchor: [0.5 * width, -outside * height],
    direction: [0, 1],
  };
}

function readThemeColor(variableName, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

function getThemeRayColor() {
  const accent = new THREE.Color(readThemeColor("--accent-slate", "#8ea8c7"));
  return accent.lerp(new THREE.Color("#ffffff"), 0.68);
}

export function mountLightRays(container, options = {}) {
  if (!container) return { dispose() {} };

  const {
    raysOrigin = "top-center",
    raysSpeed = 0.68,
    lightSpread = 0.58,
    rayLength = 1.75,
    pulsating = false,
    fadeDistance = 1.05,
    saturation = 0.88,
    followMouse = true,
    mouseInfluence = 0.055,
    noiseAmount = 0.025,
    distortion = 0.035,
  } = options;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.setAttribute("aria-hidden", "true");
  container.replaceChildren(renderer.domElement);

  const uniforms = {
    iTime: { value: 0 },
    iResolution: { value: new THREE.Vector2(1, 1) },
    rayPos: { value: new THREE.Vector2() },
    rayDir: { value: new THREE.Vector2(0, 1) },
    raysColor: { value: getThemeRayColor() },
    raysSpeed: { value: raysSpeed },
    lightSpread: { value: lightSpread },
    rayLength: { value: rayLength },
    pulsating: { value: pulsating ? 1 : 0 },
    fadeDistance: { value: fadeDistance },
    saturation: { value: saturation },
    mousePos: { value: new THREE.Vector2(0.5, 0.5) },
    mouseInfluence: { value: followMouse ? mouseInfluence : 0 },
    noiseAmount: { value: noiseAmount },
    distortion: { value: distortion },
  };

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.RawShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  let animationFrame = 0;
  let resizeFrame = 0;
  let running = false;
  let visible = true;
  let disposed = false;
  let targetMouseX = 0.5;
  let targetMouseY = 0.5;
  let smoothMouseX = 0.5;
  let smoothMouseY = 0.5;

  const resize = () => {
    if (disposed) return;
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    const drawingSize = renderer.getDrawingBufferSize(new THREE.Vector2());
    uniforms.iResolution.value.copy(drawingSize);
    const { anchor, direction } = getAnchorAndDirection(raysOrigin, drawingSize.x, drawingSize.y);
    uniforms.rayPos.value.set(anchor[0], anchor[1]);
    uniforms.rayDir.value.set(direction[0], direction[1]);
  };

  const render = time => {
    uniforms.iTime.value = time * 0.001;
    smoothMouseX = smoothMouseX * 0.92 + targetMouseX * 0.08;
    smoothMouseY = smoothMouseY * 0.92 + targetMouseY * 0.08;
    uniforms.mousePos.value.set(smoothMouseX, smoothMouseY);
    renderer.render(scene, camera);
  };

  const loop = time => {
    if (!running || disposed) return;
    render(time);
    animationFrame = requestAnimationFrame(loop);
  };

  const start = () => {
    if (disposed || running || !visible || document.hidden || reducedMotion.matches) return;
    running = true;
    animationFrame = requestAnimationFrame(loop);
  };

  const pause = () => {
    running = false;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  };

  const renderReducedMotionFrame = () => {
    pause();
    render(1800);
  };

  const onPointerMove = event => {
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    targetMouseX = (event.clientX - rect.left) / rect.width;
    targetMouseY = (event.clientY - rect.top) / rect.height;
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

  if (followMouse && mouseInfluence > 0) {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
  }
  document.addEventListener("visibilitychange", onVisibilityChange);
  reducedMotion.addEventListener("change", onMotionPreferenceChange);

  resize();
  if (reducedMotion.matches) renderReducedMotionFrame();
  else start();

  return {
    updateTheme() {
      uniforms.raysColor.value.copy(getThemeRayColor());
      if (reducedMotion.matches) renderReducedMotionFrame();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pause();
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
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
