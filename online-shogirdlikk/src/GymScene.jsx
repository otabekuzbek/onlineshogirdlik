import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/*
  Sahifa orqasidagi 3D zal. Skroll bo'yicha kamera zal bo'ylab harakatlanadi,
  shtangaga disklar birin-ketin kiradi, yorug'lik kayfiyati o'zgaradi.
  Bo'limlar `[data-scene]` atributi bilan belgilanadi (0,1,2...).
*/

const ease3 = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// Kamera kalitlari: har bir bo'lim uchun (indeks = data-scene)
// p: kamera, l: qaragan nuqta, s: gorizontal siljish (-1..1, shtanga qaysi tomonda ko'rinishi), lift: shtanga ko'tarilishi,
// mood: 0 iliq/sariq, 1 qizil (xavotir), 2 yorqin sariq
const KEYS = [
  { p: [3.4, 0.95, 3.9], l: [0.05, 0.3, 0], s: -0.9, lift: 0, mood: 0, spin: 0 },
  { p: [-2.6, 0.8, 3.0], l: [0.0, 0.32, 0], s: -0.85, lift: 0, mood: 0, spin: 0 },
  { p: [0.2, 3.4, 5.6], l: [0, 0.2, -0.4], s: 0, lift: 0, mood: 0, spin: 0 },
  { p: [2.2, 0.85, 3.0], l: [0.35, 0.28, 0], s: 0.9, lift: 0, mood: 0, spin: 0 },
  { p: [0.0, 0.6, 1.9], l: [0.55, 0.25, 0], s: 0, lift: 0, mood: 0, spin: 0 },
  { p: [0.0, 1.5, 4.6], l: [0, 0.3, 0], s: 0, lift: 0, mood: 2, spin: 0 },
  { p: [-3.2, 1.3, 3.6], l: [0, 0.2, 0], s: -0.85, lift: 0, mood: 1, spin: 0 },
  { p: [3.0, 1.9, 4.8], l: [0, 0.3, 0], s: 0.85, lift: 0, mood: 0, spin: 0 },
  { p: [0.8, 0.9, 3.3], l: [0.1, 0.62, 0], s: -0.8, lift: 0.55, mood: 2, spin: 1 },
];

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,214,90,1)');
    r.addColorStop(0.25, 'rgba(255,190,40,.55)');
    r.addColorStop(1, 'rgba(255,170,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });
}

function buildFloor(maxAniso) {
  const base = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#1a1710';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 18 + Math.random() * 30;
      g.fillStyle = `rgba(${v + 10},${v + 6},${v - 6},${Math.random() * 0.35})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, 'rgba(255,255,255,.045)');
    gr.addColorStop(1, 'rgba(0,0,0,.12)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,.75)';
    g.lineWidth = 6;
    g.strokeRect(0, 0, w, h);
  });
  const seams = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffc61a';
    g.lineWidth = 4;
    g.strokeRect(2, 2, w - 4, h - 4);
  });
  [base, seams].forEach((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(36, 36);
    t.anisotropy = maxAniso;
  });
  const mat = new THREE.MeshStandardMaterial({
    map: base,
    emissiveMap: seams,
    emissive: new THREE.Color(0xffa800),
    emissiveIntensity: 0.55,
    roughness: 0.5,
    metalness: 0.18,
    transparent: true,
    opacity: 0.82,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat);
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

function buildBarbell() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xd9d7d0, metalness: 1, roughness: 0.2 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x2a2822, metalness: 0.95, roughness: 0.38 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x14130f, roughness: 0.58, metalness: 0.2 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffc61a, roughness: 0.32, metalness: 0.25, emissive: 0x6a4500, emissiveIntensity: 0.7 });

  const cyl = (rt, rb, len, mat, seg = 40) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg), mat);
    m.rotation.z = Math.PI / 2;
    m.castShadow = true;
    return m;
  };
  g.add(cyl(0.0125, 0.0125, 2.2, steel, 32));
  // o'rtadagi nishon halqalari
  [-0.46, -0.42, 0.42, 0.46].forEach((x) => {
    const r = cyl(0.0138, 0.0138, 0.012, darkSteel, 24);
    r.position.x = x;
    g.add(r);
  });
  const knurl = cyl(0.0132, 0.0132, 0.86, darkSteel, 24);
  knurl.material = new THREE.MeshStandardMaterial({ color: 0x8d887a, metalness: 1, roughness: 0.55 });
  g.add(knurl);
  // yenglar
  [-1, 1].forEach((sd) => {
    const sl = cyl(0.025, 0.025, 0.42, steel, 40);
    sl.position.x = sd * 0.9;
    g.add(sl);
    const cap = cyl(0.022, 0.026, 0.02, darkSteel, 40);
    cap.position.x = sd * 1.11;
    g.add(cap);
    const base = cyl(0.03, 0.03, 0.02, darkSteel, 40);
    base.position.x = sd * 0.69;
    g.add(base);
  });

  // disklar
  const SPEC = [
    { r: 0.225, t: 0.058 },
    { r: 0.2, t: 0.042 },
    { r: 0.16, t: 0.034 },
    { r: 0.12, t: 0.028 },
  ];
  const plates = [];
  let off = 0.7;
  SPEC.forEach((s, i) => {
    const cx = off + s.t / 2 + 0.004;
    off += s.t + 0.006;
    const prof = [
      new THREE.Vector2(0.0265, -s.t / 2),
      new THREE.Vector2(s.r - 0.012, -s.t / 2),
      new THREE.Vector2(s.r - 0.002, -s.t / 2 + 0.006),
      new THREE.Vector2(s.r, -s.t / 2 + 0.014),
      new THREE.Vector2(s.r, s.t / 2 - 0.014),
      new THREE.Vector2(s.r - 0.002, s.t / 2 - 0.006),
      new THREE.Vector2(s.r - 0.012, s.t / 2),
      new THREE.Vector2(0.0265, s.t / 2),
      new THREE.Vector2(0.0265, -s.t / 2),
    ];
    const geo = new THREE.LatheGeometry(prof, 72);
    geo.rotateZ(Math.PI / 2);
    const mk = (side) => {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(geo, rubber);
      body.castShadow = true;
      body.receiveShadow = true;
      grp.add(body);
      // sariq halqa + metall gupchak
      [-1, 1].forEach((f) => {
        const ring = new THREE.Mesh(new THREE.RingGeometry(s.r * 0.66, s.r * 0.74, 72), yellow);
        ring.rotation.y = (f * Math.PI) / 2;
        ring.position.x = (f * s.t) / 2 + f * 0.0006;
        grp.add(ring);
        const hub = new THREE.Mesh(new THREE.RingGeometry(0.0265, 0.052, 48), darkSteel);
        hub.rotation.y = (f * Math.PI) / 2;
        hub.position.x = (f * s.t) / 2 + f * 0.0007;
        grp.add(hub);
      });
      grp.userData = { finalX: side * cx, side, idx: i };
      grp.position.x = side * cx;
      return grp;
    };
    const L = mk(-1);
    const R = mk(1);
    g.add(L, R);
    plates.push({ L, R });
  });
  // qisqichlar (kollar)
  const collars = [];
  [-1, 1].forEach((sd) => {
    const c = cyl(0.04, 0.04, 0.032, yellow, 40);
    const bolt = cyl(0.012, 0.012, 0.05, darkSteel, 16);
    bolt.rotation.z = 0;
    bolt.rotation.x = 0;
    const grp = new THREE.Group();
    grp.add(c);
    grp.userData = { finalX: sd * (off + 0.02), side: sd };
    grp.position.x = sd * (off + 0.02);
    g.add(grp);
    collars.push(grp);
  });
  g.userData = { plates, collars };
  return g;
}

function buildRack(mats) {
  const rack = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0x1a1915, metalness: 0.9, roughness: 0.45 });
  const W = 4.4;
  [0.38, 0.86].forEach((y) => {
    const sh = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, 0.55), frame);
    sh.position.set(0, y, 0);
    sh.castShadow = true;
    sh.receiveShadow = true;
    rack.add(sh);
  });
  [-W / 2 + 0.05, 0, W / 2 - 0.05].forEach((x) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.98, 0.07), frame);
    post.position.set(x, 0.49, -0.2);
    rack.add(post);
  });
  [0.38, 0.86].forEach((y, row) => {
    for (let i = 0; i < 8; i++) {
      const size = 0.075 + (i + row * 8) * 0.0065;
      const d = new THREE.Group();
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, size * 3.4, 16), mats.chrome);
      handle.rotation.z = Math.PI / 2;
      d.add(handle);
      [-1, 1].forEach((sd) => {
        const head = new THREE.Mesh(new THREE.CylinderGeometry(size, size, size * 1.15, 6), mats.iron);
        head.rotation.z = Math.PI / 2;
        head.position.x = sd * size * 1.25;
        head.castShadow = true;
        d.add(head);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(size * 1.02, size * 1.02, 0.01, 6), mats.yellow);
        band.rotation.z = Math.PI / 2;
        band.position.x = sd * (size * 1.25 - size * 0.62);
        d.add(band);
      });
      d.position.set(-W / 2 + 0.35 + i * ((W - 0.7) / 7), y + 0.025 + size, 0.02);
      rack.add(d);
    }
  });
  return rack;
}

function buildKettlebell(mats, s = 1) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.13 * s, 32, 24), mats.iron);
  body.position.y = 0.13 * s;
  body.scale.y = 0.94;
  body.castShadow = true;
  g.add(body);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.075 * s, 0.017 * s, 12, 32, Math.PI * 1.15), mats.iron);
  handle.position.y = 0.3 * s;
  handle.rotation.z = Math.PI * 0.43;
  g.add(handle);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.1 * s, 0.006 * s, 8, 40), mats.yellow);
  band.position.y = 0.115 * s;
  band.rotation.x = Math.PI / 2;
  g.add(band);
  return g;
}

export default function GymScene() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch {
      document.documentElement.setAttribute('data-gl', 'off');
      return undefined;
    }
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const small = () => window.innerWidth < 800;

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x080807, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x080807, 0.075);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.5;

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);

    // yorug'lik
    scene.add(new THREE.AmbientLight(0xfff0d0, 0.12));
    const key = new THREE.SpotLight(0xffe2a8, 140, 24, 0.55, 0.85, 1.6);
    key.position.set(2.4, 5.2, 3.2);
    key.target.position.set(0, 0.2, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    key.shadow.radius = 5;
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0xffb400, 1.6);
    rim.position.set(-3, 3, -5);
    scene.add(rim);
    const low = new THREE.PointLight(0xffc61a, 6, 7, 2);
    low.position.set(0.2, 0.35, 1.4);
    scene.add(low);

    // pol, devor
    scene.add(buildFloor(Math.min(8, renderer.capabilities.getMaxAnisotropy())));
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 12),
      new THREE.MeshStandardMaterial({
        color: 0x0e0d0a,
        roughness: 0.8,
        metalness: 0.2,
        map: canvasTexture(256, 64, (g, w, h) => {
          g.fillStyle = '#12100b';
          g.fillRect(0, 0, w, h);
          g.fillStyle = 'rgba(255,255,255,.05)';
          g.fillRect(0, 0, 3, h);
        }),
      })
    );
    wall.material.map.wrapS = THREE.RepeatWrapping;
    wall.material.map.repeat.set(30, 1);
    wall.position.set(0, 6, -9);
    scene.add(wall);

    // neon chiroqlar + yog'du
    const glow = glowTexture();
    const barMat = new THREE.MeshBasicMaterial({ color: 0xffd96a, fog: false });
    const bars = [];
    [
      [3.0, 12],
      [4.6, 8],
      [1.5, 6],
    ].forEach(([y, len], i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.07), barMat);
      m.position.set(0, y, -8.8);
      const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffb400, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      h.scale.set(len * 1.15, 1.8, 1);
      h.position.copy(m.position);
      h.position.z += 0.05;
      scene.add(m, h);
      bars.push({ m, h, ph: i * 2.1 });
    });

    // jihozlar: gantel javonlari, giryalar
    const mats = {
      chrome: new THREE.MeshStandardMaterial({ color: 0xd9d7d0, metalness: 1, roughness: 0.22 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x1b1a15, metalness: 0.85, roughness: 0.42 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xffc61a, roughness: 0.4, metalness: 0.3, emissive: 0x442b00, emissiveIntensity: 0.5 }),
    };
    const rack1 = buildRack(mats);
    rack1.position.set(-4.4, 0, -6.2);
    rack1.rotation.y = 0.35;
    const rack2 = buildRack(mats);
    rack2.position.set(4.6, 0, -6.6);
    rack2.rotation.y = -0.4;
    scene.add(rack1, rack2);
    [
      [-2.4, -2.2, 1.1],
      [-2.0, -2.9, 0.85],
      [2.5, -2.6, 1],
      [3.1, -1.8, 0.8],
      [-3.6, -0.6, 1.2],
    ].forEach(([x, z, s]) => {
      const k = buildKettlebell(mats, s);
      k.position.set(x, 0, z);
      k.rotation.y = x;
      scene.add(k);
    });

    // shtanga + akslanish
    const bb = buildBarbell();
    bb.position.y = 0.225;
    scene.add(bb);
    const bbMirror = bb.clone(true);
    bbMirror.scale.y = -1;
    bbMirror.position.y = -0.225;
    bbMirror.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
    scene.add(bbMirror);
    const syncMirror = () => {
      bbMirror.rotation.copy(bb.rotation);
      bbMirror.position.x = bb.position.x;
      bbMirror.position.z = bb.position.z;
      bbMirror.position.y = -bb.position.y;
      const src = [];
      bb.traverse((o) => src.push(o));
      let i = 0;
      bbMirror.traverse((o) => {
        const s0 = src[i++];
        if (s0 && s0 !== bb) {
          o.position.copy(s0.position);
          o.rotation.copy(s0.rotation);
          o.visible = s0.visible;
        }
      });
    };

    // magniy changi
    const N = small() ? 140 : 320;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 12;
      pos[i * 3 + 1] = Math.random() * 4.5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10;
      vel[i] = 0.03 + Math.random() * 0.07;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(dg, new THREE.PointsMaterial({ map: glow, size: 0.07, color: 0xffe27a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(dust);

    // ----- o'lchamlar
    let W = 0;
    let H = 0;
    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w === W && Math.abs(h - H) < 120) return;
      W = w;
      H = h;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small() ? 1.4 : 1.75));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 0.8 ? 46 : 34;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    // ----- sahna koordinatasi (bo'limlar bo'yicha)
    let tops = [];
    const measure = () => {
      tops = Array.from(document.querySelectorAll('[data-scene]')).map((el) => ({
        i: Number(el.getAttribute('data-scene')),
        top: el.getBoundingClientRect().top + window.scrollY,
        h: el.offsetHeight,
      }));
    };
    const sceneCoord = () => {
      if (!tops.length) return 0;
      const mid = window.scrollY + window.innerHeight * 0.5;
      let k = 0;
      for (let j = 0; j < tops.length; j++) if (mid >= tops[j].top) k = j;
      const a = tops[k];
      const b = tops[k + 1];
      if (!b) return a.i;
      const f = Math.min(1, Math.max(0, (mid - a.top) / Math.max(1, b.top - a.top)));
      return a.i + (b.i - a.i) * f;
    };
    measure();
    const mo = new ResizeObserver(measure);
    mo.observe(document.body);
    window.addEventListener('load', measure);
    const t0 = setTimeout(measure, 800);

    let ptx = 0;
    let pty = 0;
    const onMove = (e) => {
      ptx = (e.clientX / window.innerWidth - 0.5) * 2;
      pty = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    // ----- animatsiya
    const startT = performance.now();
    let sc = sceneCoord();
    let lastT = startT;
    let raf = 0;
    let px = 0;
    let py = 0;
    const tmpP = new THREE.Vector3();
    const tmpL = new THREE.Vector3();
    const keyCol = new THREE.Color();
    const cWarm = new THREE.Color(0xffe2a8);
    const cRed = new THREE.Color(0xff6a4a);
    const cSun = new THREE.Color(0xfff0b0);

    const place = (plate, p) => {
      const e = ease3(p);
      const away = (1 - e) * 2.3;
      [plate.L, plate.R].forEach((g) => {
        const sd = g.userData.side;
        g.position.x = g.userData.finalX + sd * away;
        g.rotation.x = (1 - e) * Math.PI * 2.2 * sd;
        g.visible = p > 0.001;
      });
    };

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      const el = (now - startT) / 1000;

      // silliq skroll koordinatasi
      const target = sceneCoord();
      sc += (target - sc) * (reduced ? 1 : Math.min(1, dt * 3.2));
      const i0 = Math.max(0, Math.min(KEYS.length - 2, Math.floor(sc)));
      const f = smooth(0, 1, sc - i0);
      const A = KEYS[i0];
      const B = KEYS[Math.min(KEYS.length - 1, i0 + 1)];
      const small_ = small();

      px += (ptx - px) * Math.min(1, dt * 2.5);
      py += (pty - py) * Math.min(1, dt * 2.5);
      const breathe = reduced ? 0 : Math.sin(el * 0.5) * 0.06;
      tmpP.set(lerp(A.p[0], B.p[0], f), lerp(A.p[1], B.p[1], f), lerp(A.p[2], B.p[2], f));
      tmpL.set(lerp(A.l[0], B.l[0], f), lerp(A.l[1], B.l[1], f), lerp(A.l[2], B.l[2], f));
      if (small_) tmpP.multiplyScalar(1.28);
      camera.position.set(tmpP.x + px * 0.18 + breathe, tmpP.y - py * 0.08, tmpP.z);
      camera.lookAt(tmpL);
      const shift = small_ ? 0 : lerp(A.s, B.s, f);
      const off = shift * W * 0.27;
      camera.setViewOffset(W, H, off, small_ ? H * 0.17 : 0, W, H);

      // shtanga: bo'lim holati
      const lift = lerp(A.lift, B.lift, f);
      const spinMode = lerp(A.spin, B.spin, f);
      bb.position.y = 0.225 + lift + (reduced ? 0 : Math.sin(el * 1.1) * 0.012 * (0.4 + lift));
      bb.rotation.y = (reduced ? 0 : Math.sin(el * 0.35) * 0.08) + spinMode * Math.sin(el * 0.6) * 0.18;
      bb.rotation.z = lift * -0.05;

      // disklar: 0-chi sahifa ochilganda kiradi, qolganlari skroll bilan
      const intro = reduced ? 1 : Math.min(1, Math.max(0, (el - 0.35) / 1.5));
      const P = bb.userData.plates;
      place(P[0], intro);
      place(P[1], smooth(2.55, 3.15, sc));
      place(P[2], smooth(3.1, 3.7, sc));
      place(P[3], smooth(3.65, 4.25, sc));
      const nLoaded = [P[1], P[2], P[3]].filter((p) => p.L.visible).length;
      bb.userData.collars.forEach((c) => {
        const sd = c.userData.side;
        const last = nLoaded >= 3 ? 3 : nLoaded;
        // qisqich oxirgi yuklangan diskdan keyin turadi
        const stackEnd = [0.7 + 0.058 + 0.004, 0.7 + 0.058 + 0.042 + 0.012, 0.7 + 0.058 + 0.042 + 0.034 + 0.018, 0.7 + 0.058 + 0.042 + 0.034 + 0.028 + 0.024][last];
        c.position.x += (sd * (stackEnd + 0.02) - c.position.x) * Math.min(1, dt * 8);
      });
      syncMirror();

      // yorug'lik kayfiyati
      const mood = lerp(A.mood, B.mood, f);
      keyCol.copy(cWarm);
      if (mood > 0 && mood <= 1) keyCol.lerp(cRed, mood);
      else if (mood > 1) keyCol.copy(cSun);
      key.color.lerp(keyCol, Math.min(1, dt * 3));
      low.color.setHex(mood > 0.5 && mood <= 1 ? 0xff5a3c : 0xffc61a);
      key.intensity = lerp(key.intensity, mood > 1 ? 190 : 140, Math.min(1, dt * 3));

      // neon pulsatsiya
      bars.forEach((b) => {
        const fl = reduced ? 1 : 0.92 + Math.sin(el * 1.3 + b.ph) * 0.05 + (Math.sin(el * 7 + b.ph) > 0.985 ? -0.25 : 0);
        b.h.material.opacity = 0.55 * fl;
      });

      // chang
      if (!reduced) {
        const a = dg.attributes.position;
        for (let i = 0; i < N; i++) {
          let y = a.getY(i) + vel[i] * dt;
          if (y > 4.6) y = 0;
          a.setY(i, y);
          a.setX(i, a.getX(i) + Math.sin(el * 0.4 + i) * 0.0008);
        }
        a.needsUpdate = true;
      }

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);
    if (reduced) {
      const onS = () => {
        /* kadr har safar chiziladi */
      };
      window.addEventListener('scroll', onS, { passive: true });
    }

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t0);
      mo.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('load', measure);
      window.removeEventListener('pointermove', onMove);
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      pmrem.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas className="gl" ref={ref} aria-hidden="true" />;
}
