import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowTexture } from './fx.js';

const NOISE = `
float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.03+7.1; a*=.5; } return s; }
`;

/** galactic plane of a sky (stars bunch along it, the Milky Way band follows it) */
function galaxyNormal(seed) {
  return new THREE.Vector3(Math.sin(seed * 1.31), Math.cos(seed * 2.07) * 0.8 + 0.4, Math.sin(seed * 0.73 + 1.1)).normalize();
}

function skyMaterial(a, b, seed) {
  return new THREE.ShaderMaterial({
    uniforms: { uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) }, uSeed: { value: seed }, uG: { value: galaxyNormal(seed) } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 uA,uB,uG; uniform float uSeed;
      ${NOISE}
      void main(){
        vec3 d = normalize(vDir);
        // nebula: wispy, filamentary gas instead of soft blobs
        float w = fbm(d*1.6+uSeed);
        float n = fbm(d*2.2+uSeed+w*1.4);
        float n2 = fbm(d*4.5-uSeed+n*1.7);
        float cloud = smoothstep(.42,.9,n);
        float fil = smoothstep(.55,.75,fbm(d*9.+n*3.+uSeed));
        vec3 col = mix(uA,uB,smoothstep(.3,.7,n2))*cloud*cloud*(.38+.3*fil);
        col *= .4+.9*smoothstep(.25,.75,fbm(d*7.+3.+uSeed));
        // galaxy band: diffuse star glow along the plane, a brighter core region, dark dust lanes
        float lat = dot(d,uG);
        float band = exp(-lat*lat*55.0);
        vec3 c0 = normalize(cross(uG, vec3(0.31,0.94,0.12)));
        float core = pow(max(0.0, dot(d,c0)), 6.0);
        float glow = band*(.55+.45*fbm(d*5.+uSeed*2.))*(.35+core*1.4) + exp(-lat*lat*14.0)*core*.25;
        float dustL = smoothstep(.48,.7,fbm(d*7.5+uSeed*3.))*exp(-lat*lat*240.0);
        vec3 milky = vec3(.075,.068,.06)*glow*(1.0-.85*dustL);
        col = col*(1.0-.6*dustL*band) + milky;
        col += vec3(.0025,.0035,.007);
        gl_FragColor = vec4(col,1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

/**
 * Planet: a banded gas giant with turbulent belts and a storm, or a rocky world with highlands,
 * craters, ice caps and a cloud layer. Soft terminator, limb darkening and atmospheric scattering.
 */
function planetMaterial(c1, c2, sunDir, seed, rocky) {
  return new THREE.ShaderMaterial({
    uniforms: { uC1: { value: new THREE.Color(c1) }, uC2: { value: new THREE.Color(c2) }, uSun: { value: sunDir.clone() }, uSeed: { value: seed }, uRocky: { value: rocky ? 1 : 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vP; varying vec3 vV;
      void main(){ vN = normalize(mat3(modelMatrix)*normal); vP = position;
        vec4 w = modelMatrix*vec4(position,1.0); vV = normalize(cameraPosition-w.xyz);
        gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      varying vec3 vN; varying vec3 vP; varying vec3 vV; uniform vec3 uC1,uC2,uSun; uniform float uSeed, uRocky;
      ${NOISE}
      void main(){
        vec3 p = normalize(vP);
        vec3 base; float clouds = 0.0;
        if (uRocky < .5) {
          // gas giant: latitude bands bent by turbulence, fine streaks, an oval storm
          float warp = fbm(p*3.0+uSeed);
          float lat = p.y + (warp-.5)*.16 + (fbm(p*11.0+uSeed)-.5)*.035;
          // many narrow zones on top of a few broad belts, smeared along the latitude by the winds
          float zones = sin(lat*34.0 + fbm(p*2.0+uSeed)*2.5)*.5+.5;
          float belts = sin(lat*11.0 + uSeed)*.5+.5;
          float streak = fbm(vec3(p.x*5., p.y*52., p.z*5.) + warp*2.5);
          float t = zones*.42 + belts*.28 + streak*.3;
          base = mix(uC1, uC2, smoothstep(.12,.88,t));
          base = mix(base, mix(uC1,uC2,.5)*vec3(1.08,1.04,1.0), .25); // softer contrast, like real cloud decks
          base *= .86 + .26*fbm(p*18.0+uSeed);
          base *= mix(1.0, .72, smoothstep(.62,.97,abs(p.y))); // darker, hazier poles
          vec3 sc = normalize(vec3(.62,-.28,.73));
          vec3 sp = p - sc; float ds = length(sp*vec3(1.,2.2,1.));
          float storm = smoothstep(.2,.02,ds);
          float swirl = fbm(p*30.0 + vec3(ds*14.0));
          base = mix(base, mix(uC2*1.25, uC1*.8+vec3(.25,.08,.04), swirl), storm*.8);
        } else {
          // rocky world: lowlands/highlands, craters, polar ice, thin clouds
          float h = fbm(p*2.6+uSeed) + .5*fbm(p*7.0-uSeed);
          base = mix(uC1, uC2, smoothstep(.55,1.05,h));
          base *= .75 + .4*fbm(p*22.0+uSeed);
          float cr = fbm(p*13.0+uSeed*2.);
          base *= 1.0 - .25*smoothstep(.62,.7,cr) + .15*smoothstep(.7,.74,cr);
          float ice = smoothstep(.86,.95,abs(p.y)+(fbm(p*6.)-.5)*.15);
          base = mix(base, vec3(.6,.63,.67), ice); // polar ice
          // thin, wind-streaked cloud bands
          clouds = smoothstep(.58,.85,fbm(vec3(p.x*3.0, p.y*9.0, p.z*3.0)+fbm(p*3.0+uSeed)*2.0+uSeed*3.0))*.45;
          base = mix(base, vec3(.66,.68,.7), clouds);
        }
        float nl = dot(normalize(vN),uSun);
        float day = smoothstep(-.06,.3,nl);
        float mu = max(dot(normalize(vN),vV),0.0);
        float limb = .5 + .5*pow(mu,.45);
        vec3 col = min(base*day*limb*1.2, vec3(.85)); // stay under the bloom threshold: no blown-out ice caps
        // atmosphere: scattering brightens the lit limb and tints the terminator
        float rim = pow(1.0-mu, 3.5);
        vec3 atm = mix(uC2, vec3(.45,.68,1.0), .55);
        col += atm*rim*smoothstep(-.25,.35,nl)*1.1;
        col += vec3(1.0,.45,.2)*smoothstep(.12,0.0,abs(nl))*.06*(1.0-clouds);
        col += base*.003;
        gl_FragColor = vec4(col,1.0);
      }`,
  });
}

/** soft halo of the planet's atmosphere outside its limb, lit from the sun side */
function haloMaterial(color, sunDir, scale) {
  return new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color(color) }, uSun: { value: sunDir.clone() }, uZ: { value: Math.sqrt(1 - 1 / (scale * scale)) } },
    vertexShader: `varying vec3 vN; varying vec3 vVN; varying vec3 vRay;
      void main(){ vN = normalize(mat3(modelMatrix)*normal); vVN = normalize(normalMatrix*normal);
        vec4 mv = modelViewMatrix*vec4(position,1.0); vRay = mv.xyz;
        gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vVN; varying vec3 vRay; uniform vec3 uC,uSun; uniform float uZ;
      void main(){
        // back faces seen just outside the planet: along the view ray n·v is uZ at the limb, 0 at the halo's edge
        float k = pow(clamp(abs(dot(normalize(vVN), normalize(vRay)))/uZ, 0.0, 1.0), 2.2);
        float lit = smoothstep(-.35,.45,dot(normalize(vN),uSun));
        gl_FragColor = vec4(uC*k*lit*.75,1.0);
      }`,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
}

// ---- asteroids: lumpy, cratered, smooth-shaded rock with baked albedo variation and cavity shading ----
function rand(seed) { let t = seed >>> 0; return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
function hash3(x, y, z) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), fx), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), fx), fy),
    l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), fx), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), fx), fy), fz);
}
function fbm3(x, y, z, oct = 5) { let a = 0.5, s = 0; for (let i = 0; i < oct; i++) { s += a * vnoise(x, y, z); x = x * 2.03 + 7.1; y = y * 2.03 + 3.3; z = z * 2.03 + 1.7; a *= 0.5; } return s; }

// linear albedo: asteroids are dark (coal-black to dusty brown), only lifted a little so they read in the game
const ROCK_TYPES = [
  [0.07, 0.066, 0.062], // carbonaceous: dark grey
  [0.15, 0.12, 0.095], // stony: brownish
  [0.12, 0.115, 0.11], // grey silicate
  [0.17, 0.12, 0.085], // iron-rich, rusty
];
function rockGeometry(seed, detail) {
  const R = rand(seed * 9973 + 17);
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g); // shared vertices: smooth normals, no cracks
  const p = g.attributes.position, n = p.count;
  const sx = 1, sy = 0.62 + R() * 0.3, sz = 0.75 + R() * 0.35; // elongated, flattened bodies
  const craters = [];
  for (let i = 0, k = 7 + Math.floor(R() * 8); i < k; i++) {
    const c = new THREE.Vector3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1).normalize();
    craters.push({ c, r: 0.1 + Math.pow(R(), 1.6) * 0.38, d: 0.08 + R() * 0.13 });
  }
  const o = R() * 50, v = new THREE.Vector3(), hgt = new Float32Array(n), crat = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let h = (fbm3(v.x * 1.4 + o, v.y * 1.4, v.z * 1.4, 3) - 0.5) * 0.55 // big lumps
      + (fbm3(v.x * 4 + o, v.y * 4, v.z * 4, 4) - 0.5) * 0.16 // knobs and ridges
      + (fbm3(v.x * 13 + o, v.y * 13, v.z * 13, 3) - 0.5) * 0.05; // grit
    let cr = 0;
    for (const C of craters) {
      const x = Math.acos(Math.min(1, v.dot(C.c))) / C.r;
      if (x < 1) cr += (x * x - 1) * C.d; // bowl
      const q = (x - 1) * 3.2;
      cr += Math.exp(-q * q) * C.d * 0.35; // raised rim
    }
    h += cr; hgt[i] = h; crat[i] = cr;
    v.multiplyScalar(1 + h);
    p.setXYZ(i, v.x * sx, v.y * sy, v.z * sz);
  }
  g.computeVertexNormals();
  // albedo: rock type, mottling, darker crater floors and cavities, lighter fresh rims
  const t = ROCK_TYPES[seed % ROCK_TYPES.length], col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(p, i);
    const m = 0.78 + 0.44 * fbm3(v.x * 6 + o, v.y * 6, v.z * 6, 4);
    const cav = THREE.MathUtils.clamp(0.75 + hgt[i] * 1.6, 0.45, 1.15);
    const rim = 1 + Math.max(0, crat[i]) * 2.5;
    const k = m * cav * rim * (crat[i] < -0.02 ? 0.85 : 1);
    const tint = 0.94 + 0.12 * vnoise(v.x * 3 + o, v.y * 3, v.z * 3);
    col[i * 3] = t[0] * k * tint; col[i * 3 + 1] = t[1] * k; col[i * 3 + 2] = t[2] * k * (2 - tint);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.userData.shared = true;
  return g;
}

/**
 * Builds sky, stars, sun, planet and dust. Returns handles used by the game loop.
 */
export function createEnvironment(scene, renderer, opts) {
  const { a = '#2b5fff', b = '#b03cff', seed = 1, planet = ['#31506b', '#c9a37a'] } = opts;
  const sunDir = new THREE.Vector3(...(opts.sun || [0.55, 0.3, 0.78])).normalize();

  const skyGroup = new THREE.Group();
  scene.add(skyGroup);
  const skyMat = skyMaterial(a, b, seed);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(40000, 32, 20), skyMat);
  sky.renderOrder = -10;
  skyGroup.add(sky);

  // stars: realistic colours (blackbody: mostly white/yellow, some orange/red, few blue-white), a steep
  // brightness distribution (many faint, few bright) and a concentration along the galactic plane.
  // No twinkling - there is no atmosphere out here.
  const G = galaxyNormal(seed), gu = new THREE.Vector3(), gv = new THREE.Vector3();
  gu.crossVectors(G, Math.abs(G.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize(); gv.crossVectors(G, gu);
  const TEMP = [[1, 0.58, 0.36], [1, 0.76, 0.52], [1, 0.9, 0.76], [1, 0.97, 0.92], [0.9, 0.94, 1], [0.7, 0.8, 1]];
  const TW = [0.12, 0.2, 0.24, 0.22, 0.15, 0.07];
  const N = 9000;
  const sp = new Float32Array(N * 3), sc = new Float32Array(N * 3), ss = new Float32Array(N);
  const dir = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    if (Math.random() < 0.4) { // in the band
      const a = Math.random() * 6.283, lat = (Math.random() + Math.random() + Math.random() - 1.5) * 0.16;
      dir.copy(gu).multiplyScalar(Math.cos(a)).addScaledVector(gv, Math.sin(a)).addScaledVector(G, lat).normalize();
    } else dir.randomDirection();
    sp[i * 3] = dir.x * 30000; sp[i * 3 + 1] = dir.y * 30000; sp[i * 3 + 2] = dir.z * 30000;
    let r = Math.random(), ti = 0;
    while (ti < TW.length - 1 && r > TW[ti]) { r -= TW[ti]; ti++; }
    const c = TEMP[ti], mag = Math.pow(Math.random(), 5.5); // 0 faint … 1 brightest
    const br = 0.13 + mag * 0.72; // kept under the bloom threshold: bright stars are bigger, not blown out
    sc[i * 3] = c[0] * br; sc[i * 3 + 1] = c[1] * br; sc[i * 3 + 2] = c[2] * br;
    ss[i] = 1.3 + mag * 4.2;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  sg.setAttribute('aSize', new THREE.BufferAttribute(ss, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uPR: { value: Math.min(2, renderer.getPixelRatio()) } },
    vertexShader: `attribute float aSize; attribute vec3 color; uniform float uPR; varying vec3 vC;
      void main(){ vC = color; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize*uPR; }`,
    fragmentShader: `varying vec3 vC;
      void main(){ float d = length(gl_PointCoord-.5)*2.0; float k = exp(-d*d*10.0) + exp(-d*4.0)*.18; if (k < .01) discard; gl_FragColor = vec4(vC*k,1.0); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const stars = new THREE.Points(sg, starMat);
  stars.renderOrder = -9;
  skyGroup.add(stars);

  // sun
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: new THREE.Color(3.2, 2.7, 2.0), blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sun.position.copy(sunDir).multiplyScalar(28000);
  sun.scale.setScalar(5200);
  sun.renderOrder = -8;
  skyGroup.add(sun);

  // planet
  if (planet) {
    // every other sky gets a rocky world instead of a gas giant
    const rocky = Math.floor(seed) % 3 === 0;
    const pm = new THREE.Mesh(new THREE.SphereGeometry(7000, 96, 64), planetMaterial(planet[0], planet[1], sunDir, seed, rocky));
    const pd = new THREE.Vector3(...(opts.planetDir || [-0.6, -0.25, 0.75])).normalize();
    pm.position.copy(pd).multiplyScalar(24000);
    pm.rotation.set(0.3, 0, 0.35);
    pm.renderOrder = -7;
    skyGroup.add(pm);
    const hs = rocky ? 1.035 : 1.05;
    const halo = new THREE.Mesh(new THREE.SphereGeometry(7000 * hs, 64, 40), haloMaterial(new THREE.Color(planet[1]).lerp(new THREE.Color('#8fb8ff'), 0.55), sunDir, hs));
    halo.position.copy(pm.position);
    halo.renderOrder = -6;
    skyGroup.add(halo);
  }

  // lights
  const light = new THREE.DirectionalLight(0xfff1dd, 2.3);
  light.position.copy(sunDir);
  scene.add(light);
  scene.add(light.target);
  const hemi = new THREE.HemisphereLight(new THREE.Color(a).lerp(new THREE.Color('#ffffff'), 0.3), new THREE.Color(b).multiplyScalar(0.4), 0.55);
  scene.add(hemi);

  // reflection environment from the nebula
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 16), skyMaterial(a, b, seed)));
  const sunBall = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(30, 26, 20) }));
  sunBall.position.copy(sunDir).multiplyScalar(40);
  envScene.add(sunBall);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(envScene, 0.02, 0.1, 200);
  envScene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  scene.environment = envRT.texture;
  scene.environmentIntensity = 1.0;
  pmrem.dispose();

  // dust for speed sensation
  const DN = 420;
  const dp = new Float32Array(DN * 3);
  for (let i = 0; i < DN * 3; i++) dp[i] = Math.random() * 700;
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dustMat = new THREE.ShaderMaterial({
    uniforms: { uCam: { value: new THREE.Vector3() } },
    vertexShader: `uniform vec3 uCam; varying float vA;
      void main(){ vec3 p = mod(position - uCam, 700.0) - 350.0;
        vec4 mv = viewMatrix * vec4(p + uCam, 1.0);
        vA = smoothstep(350.0, 120.0, length(p)) * smoothstep(4.0, 30.0, -mv.z);
        gl_PointSize = clamp(260.0 / max(1.0,-mv.z), 1.0, 5.0);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord-.5)*2.; gl_FragColor = vec4(vec3(.55,.7,.9)*vA*smoothstep(1.,0.,d)*.7,1.); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const dust = new THREE.Points(dg, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  const pDir = planet ? new THREE.Vector3(...(opts.planetDir || [-0.6, -0.25, 0.75])).normalize() : null;
  const pAng = Math.asin(7000 / 24000);
  return {
    sunDir,
    /** 0 when the planet hides the sun, 1 when it is in plain view (for the HUD's lens flare) */
    sunVisible() {
      if (!pDir) return 1;
      const a = Math.acos(THREE.MathUtils.clamp(pDir.dot(sunDir), -1, 1));
      return THREE.MathUtils.smoothstep(a, pAng - 0.02, pAng + 0.06);
    },
    update(camera) {
      skyGroup.position.copy(camera.position);
      dustMat.uniforms.uCam.value.copy(camera.position);
    },
    dispose() { envRT.dispose(); },
  };
}

/** fine surface relief the mesh can't carry: grit, pits and ridges as a procedural bump, plus albedo mottling */
function rockShader(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vRockP;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRockP = position;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vRockP;
      float rkHash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float rkNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(rkHash(i),rkHash(i+vec3(1,0,0)),f.x),mix(rkHash(i+vec3(0,1,0)),rkHash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(rkHash(i+vec3(0,0,1)),rkHash(i+vec3(1,0,1)),f.x),mix(rkHash(i+vec3(0,1,1)),rkHash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float rkRelief(vec3 p){
        float h = 0.0, a = .5;
        vec3 q = p;
        for (int i = 0; i < 3; i++) { h += a*rkNoise(p); p = p*2.1 + 3.7; a *= .5; }
        float pits = smoothstep(.6,.78,rkNoise(q*1.7));
        return h - pits*.6;
      }`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      float rkM = rkNoise(vRockP*4.0)*.6 + rkNoise(vRockP*11.0)*.4;
      diffuseColor.rgb *= .72 + .56*rkM;`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        // fade the relief where a pixel covers more than a feature, or it turns into sparkling noise
        float fw = length(fwidth(vRockP))*6.0;
        float h = rkRelief(vRockP*6.0) * (1.0 - smoothstep(.15,.6,fw));
        vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
        vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
        float det = dot(sx, r1);
        vec2 dh = vec2(dFdx(h), dFdy(h)) * 1.2;
        normal = normalize(abs(det)*normal - sign(det)*(dh.x*r1 + dh.y*r2));
      }`);
}

const ROCK_GEOS = [];
let rockMat = null;
export function createAsteroids(scene, center, count, spread = 1500) {
  if (!ROCK_GEOS.length) {
    // per shape: a detailed mesh for close passes and a lighter one for distance
    for (let i = 0; i < 6; i++) ROCK_GEOS.push([rockGeometry(i + 1, 5), rockGeometry(i + 1, 3)]);
    rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.03, envMapIntensity: 0.25 });
    rockMat.onBeforeCompile = rockShader;
    rockMat.userData.shared = true;
  }
  const list = [];
  for (let i = 0; i < count; i++) {
    const r = 18 + Math.pow(Math.random(), 2.2) * 150;
    const [hi, lo] = ROCK_GEOS[i % ROCK_GEOS.length];
    const m = new THREE.LOD();
    m.addLevel(new THREE.Mesh(hi, rockMat), 0);
    m.addLevel(new THREE.Mesh(lo, rockMat), r * 14);
    const u = Math.random() * 2 - 1, th = Math.random() * 6.283, s = Math.sqrt(1 - u * u);
    const d = (0.25 + Math.random() * 0.75) * spread;
    m.position.set(center.x + s * Math.cos(th) * d, center.y + u * d * 0.45, center.z + s * Math.sin(th) * d);
    m.scale.setScalar(r);
    m.quaternion.random();
    scene.add(m);
    list.push({ mesh: m, pos: m.position, radius: r * 1.05, axis: new THREE.Vector3().randomDirection(), rate: (Math.random() - 0.5) * 0.12 });
  }
  return list;
}
