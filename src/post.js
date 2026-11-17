import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * 'high' quality post chain: scene -> bloom -> one "film" pass. The film pass replaces three's OutputPass
 * (tone mapping + sRGB) and folds the grade into the same full-screen draw, so the cinematic look costs
 * no extra pass: edge-only chromatic fringe, ACES, a gentle teal/orange split tone, vignette and fine grain.
 * 'low' never builds any of this and renders straight to the canvas.
 */
const BLOOM = { strength: 0.72, radius: 0.4, threshold: 0.9 };

/**
 * Bloom bright-pass with a soft knee: only the energy above the threshold glows, and very hot pixels
 * (engine cores, laser bolts at HDR 5-10) are compressed so their halo stays a soft glow instead of
 * flooding the hull around them. Same uniforms as three's LuminosityHighPassShader.
 */
const HIGH_PASS = /* glsl */`
uniform sampler2D tDiffuse;
uniform float luminosityThreshold;
uniform float smoothWidth;
varying vec2 vUv;
void main() {
  // a stray NaN/inf pixel (a sun glint past half-float range, a degenerate normal) would blur into a disc
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  c = clamp(c, 0.0, 1e4);
  float l = max(c.r, max(c.g, c.b));
  float k = clamp(l - luminosityThreshold + smoothWidth, 0.0, 2.0 * smoothWidth);
  k = k * k / (4.0 * smoothWidth + 1e-4);
  c *= max(k, l - luminosityThreshold) / max(l, 1e-4);
  float e = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c / (1.0 + e * 0.22), 1.0);
}`;

const FILM_VERT = /* glsl */`
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FILM_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform float uAspect;
uniform float uSeed;
varying vec2 vUv;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
// cheap sin-free hash (stable on mediump-ish mobile GPUs)
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d * vec2(uAspect, 1.0), d * vec2(uAspect, 1.0)) / (0.25 * uAspect * uAspect + 0.25); // 0 centre, 1 corner
  // lens fringe: red and blue drift apart radially, only toward the edges
  vec2 ca = d * (0.003 * r2 * r2);
  vec3 c = vec3(texture2D(tDiffuse, vUv - ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + ca).b);
  c = clamp(c, 0.0, 1e4);
  #ifdef ACES_FILMIC_TONE_MAPPING
    c = ACESFilmicToneMapping(c);
  #endif
  c = sRGBTransferOETF(vec4(c, 1.0)).rgb;
  // split tone: cool teal shadows, warm highlights, a touch more saturation in the mids
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float sh = 1.0 - smoothstep(0.0, 0.45, l), hi = smoothstep(0.45, 1.0, l);
  c += sh * vec3(-0.012, 0.010, 0.020) * (0.4 + l * 4.0) + hi * vec3(0.030, 0.008, -0.030);
  c = mix(vec3(l), c, 1.08);
  // vignette, round regardless of aspect
  c *= mix(1.0, smoothstep(1.25, 0.25, r2), 0.32);
  // fine grain, strongest in the mids, also dithers the 8-bit gradients of the nebula
  float n = hash12(gl_FragCoord.xy + uSeed) - 0.5;
  c += n * (0.022 * (1.0 - l * 0.7));
  gl_FragColor = vec4(max(c, 0.0), 1.0);
}`;

class FilmPass extends Pass {
  constructor() {
    super();
    this.uniforms = { tDiffuse: { value: null }, toneMappingExposure: { value: 1 }, uAspect: { value: 1 }, uSeed: { value: 0 } };
    // raw: three must not add its own tone-mapping chunk when this draws to the screen
    this.material = new THREE.RawShaderMaterial({ name: 'FilmPass', uniforms: this.uniforms, vertexShader: FILM_VERT, fragmentShader: FILM_FRAG, depthTest: false, depthWrite: false });
    this.fsQuad = new FullScreenQuad(this.material);
    this.toneMapping = null;
    this.exposure = 1.0; // relative to renderer.toneMappingExposure
  }

  setSize(w, h) { this.uniforms.uAspect.value = h > 0 ? w / h : 1; }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.toneMappingExposure.value = renderer.toneMappingExposure * this.exposure;
    u.uSeed.value = (u.uSeed.value + 97.31) % 4096; // new grain every frame
    // the tone-mapping define is set once per renderer setting (the game never changes it mid-fight)
    if (this.toneMapping !== renderer.toneMapping) {
      this.toneMapping = renderer.toneMapping;
      this.material.defines = renderer.toneMapping === THREE.ACESFilmicToneMapping ? { ACES_FILMIC_TONE_MAPPING: '' } : {};
      this.material.needsUpdate = true;
    }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }

  dispose() { this.material.dispose(); this.fsQuad.dispose(); }
}

/** Build the 'high' post chain for one camera (each split-screen pilot gets its own). */
export function makeComposer(renderer, scene, camera) {
  const c = new EffectComposer(renderer);
  c.addPass(new RenderPass(scene, camera));
  // the resolution is only the start value: the composer resizes the bloom chain to half the render size
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const bloom = new UnrealBloomPass(size, BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  bloom.highPassUniforms.smoothWidth.value = 0.35;
  bloom.materialHighPassFilter.fragmentShader = HIGH_PASS;
  bloom.materialHighPassFilter.needsUpdate = true;
  c.addPass(bloom);
  c.addPass(new FilmPass());
  return c;
}

export function disposeComposer(c) {
  if (!c) return;
  c.passes.forEach((p) => p.dispose?.());
  c.dispose();
}
