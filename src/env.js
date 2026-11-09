import * as THREE from 'three';
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

function skyMaterial(a, b, seed) {
  return new THREE.ShaderMaterial({
    uniforms: { uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) }, uSeed: { value: seed } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 uA,uB; uniform float uSeed;
      ${NOISE}
      void main(){
        vec3 d = normalize(vDir);
        float n = fbm(d*2.2+uSeed);
        float n2 = fbm(d*4.5-uSeed+n*1.7);
        float cloud = smoothstep(.38,.85,n);
        vec3 col = mix(uA,uB,smoothstep(.3,.7,n2))*cloud*cloud*.55;
        col *= .45+.9*smoothstep(.25,.75,fbm(d*7.+3.+uSeed));
        col += vec3(.004,.006,.011);
        gl_FragColor = vec4(col,1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

function planetMaterial(c1, c2, sunDir) {
  return new THREE.ShaderMaterial({
    uniforms: { uC1: { value: new THREE.Color(c1) }, uC2: { value: new THREE.Color(c2) }, uSun: { value: sunDir.clone() } },
    vertexShader: `varying vec3 vN; varying vec3 vP; varying vec3 vV;
      void main(){ vN = normalize(mat3(modelMatrix)*normal); vP = position;
        vec4 w = modelMatrix*vec4(position,1.0); vV = normalize(cameraPosition-w.xyz);
        gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      varying vec3 vN; varying vec3 vP; varying vec3 vV; uniform vec3 uC1,uC2,uSun;
      ${NOISE}
      void main(){
        vec3 p = normalize(vP);
        float bands = fbm(vec3(p.x*1.5, p.y*7.0, p.z*1.5) + fbm(p*4.0)*1.2);
        vec3 base = mix(uC1,uC2,smoothstep(.3,.7,bands));
        float l = max(0.0,dot(vN,uSun));
        float rim = pow(1.0-max(0.0,dot(vN,vV)),3.0);
        vec3 col = base*(l*1.1+.015) + mix(uC2,vec3(.5,.7,1.),.5)*rim*(l*.9+.05);
        gl_FragColor = vec4(col,1.0);
      }`,
  });
}

function asteroidGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 2.1 + seed) * Math.cos(v.y * 2.7 + seed * 1.3) * 0.22
      + Math.sin(v.z * 5.3 + v.x * 4.1 + seed * 2.1) * 0.09
      + Math.cos(v.y * 9.0 + v.z * 7.0 + seed) * 0.04;
    v.multiplyScalar(1 + n);
    p.setXYZ(i, v.x, v.y * 0.82, v.z);
  }
  g.computeVertexNormals();
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

  // stars
  const N = 3500;
  const sp = new Float32Array(N * 3), sc = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * 6.283, s = Math.sqrt(1 - u * u);
    sp[i * 3] = s * Math.cos(th) * 30000; sp[i * 3 + 1] = u * 30000; sp[i * 3 + 2] = s * Math.sin(th) * 30000;
    const br = Math.pow(Math.random(), 3) * 1.6 + 0.25, t = Math.random();
    sc[i * 3] = br * (0.8 + t * 0.4); sc[i * 3 + 1] = br * 0.92; sc[i * 3 + 2] = br * (1.2 - t * 0.4);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({
    size: 2.2, sizeAttenuation: false, vertexColors: true, depthWrite: false, map: glowTexture(),
    transparent: true, blending: THREE.AdditiveBlending,
  }));
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
    const pm = new THREE.Mesh(new THREE.SphereGeometry(7000, 64, 40), planetMaterial(planet[0], planet[1], sunDir));
    const pd = new THREE.Vector3(...(opts.planetDir || [-0.6, -0.25, 0.75])).normalize();
    pm.position.copy(pd).multiplyScalar(24000);
    pm.rotation.set(0.3, 0, 0.35);
    pm.renderOrder = -7;
    skyGroup.add(pm);
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

  return {
    sunDir,
    update(camera) {
      skyGroup.position.copy(camera.position);
      dustMat.uniforms.uCam.value.copy(camera.position);
    },
    dispose() { envRT.dispose(); },
  };
}

const ROCK_GEOS = [];
let rockMat = null;
export function createAsteroids(scene, center, count, spread = 1500) {
  if (!ROCK_GEOS.length) {
    for (let i = 0; i < 4; i++) ROCK_GEOS.push(asteroidGeometry(i * 3.7 + 1));
    rockMat = new THREE.MeshStandardMaterial({ color: 0x6b6258, roughness: 0.95, metalness: 0.1, flatShading: true });
  }
  const list = [];
  for (let i = 0; i < count; i++) {
    const r = 18 + Math.pow(Math.random(), 2.2) * 150;
    const m = new THREE.Mesh(ROCK_GEOS[i % 4], rockMat);
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
