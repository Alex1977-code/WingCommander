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
// narrow knee: env.js caps planets/stars at 0.85 so they never glow; only HDR emitters (> 0.9) do
const BLOOM = { strength: 0.72, radius: 0.4, threshold: 0.9, knee: 0.05 };

/**
 * Bloom bright-pass with a narrow soft knee: only the energy above the threshold glows, and very hot pixels
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


/**
 * Upscaling (the browser has no DLSS: that needs NVIDIA tensor cores and a native DirectX/Vulkan app). Same idea
 * as AMD FSR 1, which runs on any GPU: draw the 3D scene at a lower resolution, then rebuild the full-size
 * picture in one pass - a 5-tap Catmull-Rom (bicubic) upsample, clamped to the local neighbourhood so edges
 * don't ring, then contrast-adaptive sharpening (CAS/RCAS) that sharpens flat detail more than strong edges.
 * Works on HDR input: the sharpening weights come from a compressed copy (c / (1 + c)).
 */
const UPSCALE_GLSL = /* glsl */`
uniform vec2 uSrcTexel;  // 1 / source size in texels
uniform float uUp;       // 1 while the source is smaller than the screen
uniform float uSharp;    // 0 soft .. 1 crisp
vec3 cmpC(vec3 c) { return c / (1.0 + c); }
vec3 decC(vec3 c) { return c / max(1.0 - c, 1e-3); }
vec3 catmullRom(sampler2D t, vec2 uv) {
  vec2 sp = uv / uSrcTexel;
  vec2 p1 = floor(sp - 0.5) + 0.5;
  vec2 f = sp - p1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (p1 - 1.0) * uSrcTexel, t3 = (p1 + 2.0) * uSrcTexel, t12 = (p1 + w2 / w12) * uSrcTexel;
  vec3 r = texture2D(t, vec2(t12.x, t0.y)).rgb * (w12.x * w0.y)
         + texture2D(t, vec2(t0.x, t12.y)).rgb * (w0.x * w12.y)
         + texture2D(t, t12).rgb * (w12.x * w12.y)
         + texture2D(t, vec2(t3.x, t12.y)).rgb * (w3.x * w12.y)
         + texture2D(t, vec2(t12.x, t3.y)).rgb * (w12.x * w3.y);
  float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return r / ws;
}
// base: the plain bilinear sample at uv (returned so callers can reuse it)
vec3 upscale(sampler2D t, vec2 uv, out vec3 base) {
  base = texture2D(t, uv).rgb;
  if (uUp < 0.5) return base;
  vec3 n = texture2D(t, uv + vec2(0.0, uSrcTexel.y)).rgb, s = texture2D(t, uv - vec2(0.0, uSrcTexel.y)).rgb;
  vec3 e = texture2D(t, uv + vec2(uSrcTexel.x, 0.0)).rgb, w = texture2D(t, uv - vec2(uSrcTexel.x, 0.0)).rgb;
  // de-ring: the bicubic may not leave the range of its neighbourhood (keeps single-pixel stars intact)
  vec3 lo = min(base, min(min(n, s), min(e, w))), hi = max(base, max(max(n, s), max(e, w)));
  vec3 c = clamp(catmullRom(t, uv), lo, hi);
  // contrast-adaptive sharpening on the compressed signal
  vec3 C = cmpC(c), N = cmpC(n), S = cmpC(s), E = cmpC(e), W = cmpC(w);
  vec3 mn = min(C, min(min(N, S), min(E, W))), mx = max(C, max(max(N, S), max(E, W)));
  vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
  vec3 k = -amp * mix(0.11, 0.2, uSharp);
  vec3 o = (C + k * (N + S + E + W)) / (1.0 + 4.0 * k);
  return decC(clamp(o, 0.0, 0.998));
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
${UPSCALE_GLSL}
// cheap sin-free hash (stable on mediump-ish mobile GPUs)
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d * vec2(uAspect, 1.0), d * vec2(uAspect, 1.0)) / (0.25 * uAspect * uAspect + 0.25); // 0 centre, 1 corner
  // lens fringe: red and blue drift apart radially, only toward the edges
  vec2 ca = d * (0.003 * r2 * r2);
  vec3 base;
  vec3 c = upscale(tDiffuse, vUv, base);
  // the fringe shifts red and blue by their bilinear offset from the centre sample
  c.r += texture2D(tDiffuse, vUv - ca).r - base.r;
  c.b += texture2D(tDiffuse, vUv + ca).b - base.b;
  c = clamp(c, 0.0, 1e4);
  // same ladder as three's OutputShader (the define follows renderer.toneMapping)
  #if defined( LINEAR_TONE_MAPPING )
    c = LinearToneMapping(c);
  #elif defined( REINHARD_TONE_MAPPING )
    c = ReinhardToneMapping(c);
  #elif defined( CINEON_TONE_MAPPING )
    c = CineonToneMapping(c);
  #elif defined( ACES_FILMIC_TONE_MAPPING )
    c = ACESFilmicToneMapping(c);
  #elif defined( AGX_TONE_MAPPING )
    c = AgXToneMapping(c);
  #elif defined( NEUTRAL_TONE_MAPPING )
    c = NeutralToneMapping(c);
  #endif
  c = sRGBTransferOETF(vec4(c, 1.0)).rgb;
  // split tone: cool teal shadows, warm highlights, a touch more saturation in the mids
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float sh = 1.0 - smoothstep(0.0, 0.45, l), hi = smoothstep(0.45, 1.0, l);
  c += sh * vec3(-0.012, 0.010, 0.020) * (0.4 + l * 4.0) + hi * vec3(0.030, 0.008, -0.030);
  c = mix(vec3(l), c, 1.08);
  // vignette, round regardless of aspect
  c *= mix(1.0, 1.0 - smoothstep(0.25, 1.25, r2), 0.32);
  // fine grain, strongest in the mids, also dithers the 8-bit gradients of the nebula
  float n = hash12(gl_FragCoord.xy + uSeed) - 0.5;
  c += n * (0.022 * (1.0 - l * 0.7));
  gl_FragColor = vec4(max(c, 0.0), 1.0);
}`;

const TONE_DEFINES = {
  [THREE.LinearToneMapping]: 'LINEAR_TONE_MAPPING',
  [THREE.ReinhardToneMapping]: 'REINHARD_TONE_MAPPING',
  [THREE.CineonToneMapping]: 'CINEON_TONE_MAPPING',
  [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING',
  [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING',
  [THREE.NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING',
};

class FilmPass extends Pass {
  constructor() {
    super();
    this.uniforms = { tDiffuse: { value: null }, toneMappingExposure: { value: 1 }, uAspect: { value: 1 }, uSeed: { value: 0 }, uSrcTexel: { value: new THREE.Vector2(1, 1) }, uUp: { value: 0 }, uSharp: { value: 0.35 } };
    // raw: three must not add its own tone-mapping chunk when this draws to the screen
    this.material = new THREE.RawShaderMaterial({ name: 'FilmPass', uniforms: this.uniforms, vertexShader: FILM_VERT, fragmentShader: FILM_FRAG, depthTest: false, depthWrite: false });
    this.fsQuad = new FullScreenQuad(this.material);
    this.toneMapping = null;
    this.exposure = 1.0; // relative to renderer.toneMappingExposure
    this.upscaling = false; // set by setRenderScale()
  }

  setSize(w, h) { this.uniforms.uAspect.value = h > 0 ? w / h : 1; }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.uSrcTexel.value.set(1 / Math.max(1, Math.floor(readBuffer.width)), 1 / Math.max(1, Math.floor(readBuffer.height))); // GL truncates fractional sizes
    u.uUp.value = this.upscaling ? 1 : 0;
    u.toneMappingExposure.value = renderer.toneMappingExposure * this.exposure;
    u.uSeed.value = (u.uSeed.value + 97.31) % 4096; // new grain every frame
    // the tone-mapping define is set once per renderer setting (the game never changes it mid-fight)
    if (this.toneMapping !== renderer.toneMapping) {
      this.toneMapping = renderer.toneMapping;
      const def = TONE_DEFINES[renderer.toneMapping];
      this.material.defines = def ? { [def]: '' } : {};
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
  bloom.highPassUniforms.smoothWidth.value = BLOOM.knee;
  bloom.materialHighPassFilter.fragmentShader = HIGH_PASS;
  bloom.materialHighPassFilter.needsUpdate = true;
  c.addPass(bloom);
  c.addPass(new FilmPass());
  return c;
}

/**
 * Compile the post programs and allocate their render targets now (e.g. during the start fade) instead
 * of on the first frame. Runs the chain once off-screen, without the scene pass (renderer.compile covers
 * the scene): the film pass is a raw shader, so its program does not depend on the target.
 */
export function warmComposer(c) {
  if (!c) return;
  const r = c.renderer, prev = r.getRenderTarget(), scenePass = c.passes[0], toScreen = c.renderToScreen;
  const was = scenePass.enabled;
  try {
    scenePass.enabled = false;
    c.renderToScreen = false;
    c.render(0);
  } catch { /* warming is only an optimisation */ } finally {
    scenePass.enabled = was;
    c.renderToScreen = toScreen;
    r.setRenderTarget(prev);
  }
}

/** Render the 'high' chain at a fraction of the output resolution; the film pass upscales and sharpens. */
export function setComposerScale(c, outPR, scale, w, h, msaa) {
  if (!c) return;
  // like FSR, the upscaler needs anti-aliased input: with upscaling enabled the scene gets 4x MSAA. The
  // sample count follows the setting, not the current scale, so the automatic steps only change the size.
  // Changing samples re-creates the targets on their next use.
  const samples = msaa && c.renderer.capabilities.isWebGL2 ? 4 : 0;
  if (c.renderTarget1.samples !== samples) {
    for (const rt of [c.renderTarget1, c.renderTarget2]) { rt.samples = samples; rt.dispose(); }
  }
  c.setPixelRatio(outPR * scale);
  c.setSize(w, h);
  const film = c.passes[c.passes.length - 1];
  // the real source/output ratio: the composer is capped at 1.5x while the canvas may use up to 2x
  if (film) film.upscaling = (outPR * scale) / c.renderer.getPixelRatio() < 0.999;
}

const UP_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
varying vec2 vUv;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
${UPSCALE_GLSL}
void main() {
  vec3 base;
  vec3 c = clamp(upscale(tDiffuse, vUv, base), 0.0, 1e4);
  #if defined( ACES_FILMIC_TONE_MAPPING )
    c = ACESFilmicToneMapping(c);
  #elif defined( AGX_TONE_MAPPING )
    c = AgXToneMapping(c);
  #elif defined( NEUTRAL_TONE_MAPPING )
    c = NeutralToneMapping(c);
  #elif defined( REINHARD_TONE_MAPPING )
    c = ReinhardToneMapping(c);
  #elif defined( CINEON_TONE_MAPPING )
    c = CineonToneMapping(c);
  #elif defined( LINEAR_TONE_MAPPING )
    c = LinearToneMapping(c);
  #endif
  gl_FragColor = vec4(sRGBTransferOETF(vec4(c, 1.0)).rgb, 1.0);
}`;

/**
 * 'low' quality upscaler: the scene goes into one reduced-size target (4x MSAA where WebGL2 allows it),
 * a single full-screen pass tone-maps, upscales and sharpens it into the current viewport.
 * Used for every frame while upscaling is enabled - even at 100 % - so the scene's shader variants
 * (linear, not tone-mapped) never change when the automatic mode steps the resolution.
 */
export class Upscaler {
  constructor(renderer) {
    this.renderer = renderer;
    const float = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: float ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: renderer.capabilities.isWebGL2 ? 4 : 0, depthBuffer: true });
    this.rt.resolveDepthBuffer = false; // only colour is read after the MSAA resolve
    this.uniforms = { tDiffuse: { value: this.rt.texture }, toneMappingExposure: { value: 1 }, uSrcTexel: { value: new THREE.Vector2(1, 1) }, uUp: { value: 0 }, uSharp: { value: 0.35 } };
    this.material = new THREE.RawShaderMaterial({ name: 'Upscale', uniforms: this.uniforms, vertexShader: FILM_VERT, fragmentShader: UP_FRAG, depthTest: false, depthWrite: false });
    this.fsQuad = new FullScreenQuad(this.material);
    this.toneMapping = null;
  }
  /** w, h: output size in CSS px; pr: output pixel ratio; scale: render fraction */
  setSize(w, h, pr, scale) {
    // floor like the canvas and its viewport, so 100 % maps texel to pixel
    const rw = Math.max(1, Math.floor(w * pr * scale)), rh = Math.max(1, Math.floor(h * pr * scale));
    if (rw !== this.rt.width || rh !== this.rt.height) this.rt.setSize(rw, rh);
    this.uniforms.uSrcTexel.value.set(1 / rw, 1 / rh);
    this.uniforms.uUp.value = scale < 0.999 ? 1 : 0;
  }
  render(scene, camera) {
    const r = this.renderer, u = this.uniforms;
    if (this.toneMapping !== r.toneMapping) {
      this.toneMapping = r.toneMapping;
      const def = TONE_DEFINES[r.toneMapping];
      this.material.defines = def ? { [def]: '' } : {};
      this.material.needsUpdate = true;
    }
    u.toneMappingExposure.value = r.toneMappingExposure;
    r.setRenderTarget(this.rt);
    r.render(scene, camera); // autoClear clears the target
    r.setRenderTarget(null);
    this.fsQuad.render(r);
  }
  dispose() { this.rt.dispose(); this.material.dispose(); this.fsQuad.dispose(); }
}

export function disposeComposer(c) {
  if (!c) return;
  c.passes.forEach((p) => p.dispose?.());
  c.dispose();
}
