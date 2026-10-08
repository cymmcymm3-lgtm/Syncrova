import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import toast from 'react-hot-toast';
import { Orbit, Radar, RotateCcw, Shield, Sparkles, Trophy, Zap } from 'lucide-react';
import api from '../services/api';
import GameOverModal from './GameOverModal';

const START_LIVES = 3;
const MAX_X = 4.2;
const MAX_Y = 2.45;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const disposeObject = (object) => {
  object.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach(material => material.dispose?.());
    else child.material?.dispose?.();
  });
};

const standardMaterial = (color, emissive = '#000000', emissiveIntensity = 0.45) => (
  new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: emissive === '#000000' ? 0 : emissiveIntensity,
    roughness: 0.48,
    metalness: 0.22
  })
);

const createShip = () => {
  const ship = new THREE.Group();
  const bodyMat = standardMaterial('#e5f3ff', '#0ea5e9', 0.28);
  const cockpitMat = standardMaterial('#111827', '#22d3ee', 0.65);
  const wingMat = standardMaterial('#2563eb', '#1d4ed8', 0.42);
  const engineMat = new THREE.MeshBasicMaterial({ color: '#f97316' });

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.38, 1.7, 24), bodyMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -0.42;
  nose.castShadow = true;
  ship.add(nose);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.42, 1.45), bodyMat);
  body.position.z = 0.18;
  body.castShadow = true;
  ship.add(body);

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.25, 18, 12), cockpitMat);
  cockpit.scale.set(0.85, 0.45, 1.15);
  cockpit.position.set(0, 0.28, -0.18);
  cockpit.castShadow = true;
  ship.add(cockpit);

  [-1, 1].forEach(side => {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 1.35), wingMat);
    wing.position.set(side * 0.68, -0.08, 0.26);
    wing.rotation.z = side * -0.32;
    wing.rotation.y = side * 0.12;
    wing.castShadow = true;
    ship.add(wing);

    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.5), wingMat);
    fin.position.set(side * 0.32, 0.18, 0.7);
    fin.rotation.z = side * -0.18;
    fin.castShadow = true;
    ship.add(fin);
  });

  const engine = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 20), engineMat);
  engine.rotation.x = Math.PI / 2;
  engine.position.z = 1.12;
  ship.add(engine);

  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(1.12, 32, 18),
    new THREE.MeshBasicMaterial({ color: '#67e8f9', transparent: true, opacity: 0.08, wireframe: true })
  );
  ship.add(shield);
  ship.userData.shield = shield;
  ship.position.set(0, 0, 3.4);
  return ship;
};

const createAsteroid = () => {
  const geometry = new THREE.IcosahedronGeometry(0.48 + Math.random() * 0.34, 1);
  const material = standardMaterial(Math.random() > 0.5 ? '#78716c' : '#57534e', '#7c2d12', 0.18);
  const asteroid = new THREE.Mesh(geometry, material);
  asteroid.position.set((Math.random() - 0.5) * MAX_X * 1.8, (Math.random() - 0.5) * MAX_Y * 1.8, -74);
  asteroid.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  asteroid.castShadow = true;
  asteroid.userData = {
    id: uid(),
    radius: 0.68,
    passed: false,
    spin: new THREE.Vector3(Math.random() * 1.6, Math.random() * 1.6, Math.random() * 1.6)
  };
  return asteroid;
};

const createEnergyCore = () => {
  const group = new THREE.Group();
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.38, 0),
    new THREE.MeshStandardMaterial({ color: '#a7f3d0', emissive: '#10b981', emissiveIntensity: 1.2, roughness: 0.25, metalness: 0.15 })
  );
  group.add(crystal);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.035, 10, 32),
    new THREE.MeshBasicMaterial({ color: '#67e8f9', transparent: true, opacity: 0.9 })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  group.position.set((Math.random() - 0.5) * MAX_X * 1.65, (Math.random() - 0.5) * MAX_Y * 1.65, -78);
  group.userData = { id: uid(), radius: 0.68 };
  return group;
};

const createPulse = (x, y, z, color = '#67e8f9') => {
  const pulse = new THREE.Mesh(
    new THREE.SphereGeometry(0.06 + Math.random() * 0.06, 8, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })
  );
  pulse.position.set(x, y, z);
  pulse.userData = {
    life: 0.44 + Math.random() * 0.26,
    velocity: new THREE.Vector3((Math.random() - 0.5) * 0.14, (Math.random() - 0.5) * 0.14, 0.12 + Math.random() * 0.16)
  };
  return pulse;
};

export default function SpaceRunnerGame({ stats, onScoreSaved, onExit }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const worldRef = useRef(null);
  const rafRef = useRef(null);
  const lastHudSyncRef = useRef(0);
  const targetRef = useRef({ x: 0, y: 0 });
  const runningRef = useRef(false);
  const gameOverRef = useRef(false);
  const scoreRef = useRef(0);
  const livesRef = useRef(START_LIVES);
  const distanceRef = useRef(0);
  const coresRef = useRef(0);
  const nearMissesRef = useRef(0);
  const levelRef = useRef(1);
  const startedAtRef = useRef(Date.now());
  const savedRef = useRef(false);

  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [distance, setDistance] = useState(0);
  const [cores, setCores] = useState(0);
  const [level, setLevel] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hitFlash, setHitFlash] = useState(0);
  const [renderWarning, setRenderWarning] = useState('');
  const [rendererResetKey, setRendererResetKey] = useState(0);

  const syncHud = useCallback(() => {
    setScore(scoreRef.current);
    setLives(livesRef.current);
    setDistance(distanceRef.current);
    setCores(coresRef.current);
    setLevel(levelRef.current);
  }, []);

  const saveScore = useCallback(async () => {
    if (savedRef.current || scoreRef.current <= 0) return;
    savedRef.current = true;
    setSaving(true);
    try {
      await api.post('/games/space-runner/submit', {
        score: scoreRef.current,
        distance: distanceRef.current,
        cores: coresRef.current,
        nearMisses: nearMissesRef.current,
        lives: livesRef.current,
        level: levelRef.current,
        elapsedMs: Date.now() - startedAtRef.current
      });
      setSaved(true);
      toast.success('Space Runner score saved');
      onScoreSaved?.();
    } catch (err) {
      savedRef.current = false;
      toast.error(err.response?.data?.msg || 'Could not save Space Runner score');
    } finally {
      setSaving(false);
    }
  }, [onScoreSaved]);

  const endGame = useCallback(() => {
    if (gameOverRef.current) return;
    runningRef.current = false;
    gameOverRef.current = true;
    setRunning(false);
    setGameOver(true);
    syncHud();
    saveScore();
  }, [saveScore, syncHud]);

  const resetGame = useCallback(() => {
    const world = worldRef.current;
    if (world) {
      [...world.asteroids, ...world.cores, ...world.pulses].forEach(object => {
        world.scene.remove(object);
        disposeObject(object);
      });
      world.asteroids = [];
      world.cores = [];
      world.pulses = [];
      world.spawnClock = 0;
      world.coreClock = 0;
      if (world.ship) {
        world.ship.position.set(0, 0, 3.4);
        world.ship.rotation.set(0, 0, 0);
      }
    }

    targetRef.current = { x: 0, y: 0 };
    scoreRef.current = 0;
    livesRef.current = START_LIVES;
    distanceRef.current = 0;
    coresRef.current = 0;
    nearMissesRef.current = 0;
    levelRef.current = 1;
    startedAtRef.current = Date.now();
    savedRef.current = false;
    runningRef.current = true;
    gameOverRef.current = false;
    setGameOver(false);
    setSaved(false);
    setRunning(true);
    syncHud();
  }, [syncHud]);

  const moveToPointer = useCallback((clientX, clientY, target) => {
    const rect = target.getBoundingClientRect();
    const xRatio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const yRatio = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    targetRef.current = {
      x: clamp((xRatio - 0.5) * MAX_X * 2, -MAX_X, MAX_X),
      y: clamp((0.5 - yRatio) * MAX_Y * 2, -MAX_Y, MAX_Y)
    };
    if (!runningRef.current && !gameOverRef.current) resetGame();
  }, [resetGame]);

  useEffect(() => {
    const handleKey = (event) => {
      if (event.code === 'Space' && !runningRef.current && !gameOverRef.current) resetGame();
      const next = { ...targetRef.current };
      if (event.code === 'ArrowLeft') next.x -= 0.85;
      if (event.code === 'ArrowRight') next.x += 0.85;
      if (event.code === 'ArrowUp') next.y += 0.65;
      if (event.code === 'ArrowDown') next.y -= 0.65;
      targetRef.current = { x: clamp(next.x, -MAX_X, MAX_X), y: clamp(next.y, -MAX_Y, MAX_Y) };
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [resetGame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapRef.current;
    if (!canvas || !wrapper) return undefined;
    const isTouchViewport = window.matchMedia?.('(max-width: 767px), (pointer: coarse)')?.matches;
    let contextLost = false;

    const handleContextLost = (event) => {
      event.preventDefault();
      contextLost = true;
      setRenderWarning('Graphics paused');
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    const handleContextRestored = () => {
      contextLost = false;
      setRenderWarning('');
      setRendererResetKey(value => value + 1);
    };
    canvas.addEventListener('webglcontextlost', handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', handleContextRestored, false);
    setRenderWarning('');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#020617');
    scene.fog = new THREE.FogExp2('#050816', 0.026);

    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 150);
    camera.position.set(0, 0.35, 9.6);
    camera.lookAt(0, 0, -22);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !isTouchViewport,
      powerPreference: isTouchViewport ? 'default' : 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouchViewport ? 1.35 : 2));
    renderer.setClearColor('#020617', 1);
    renderer.shadowMap.enabled = true;

    scene.add(new THREE.HemisphereLight('#e0f2fe', '#020617', 1.2));
    const keyLight = new THREE.DirectionalLight('#ffffff', 1.65);
    keyLight.position.set(4, 7, 8);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const blueLight = new THREE.PointLight('#38bdf8', 2.4, 24);
    blueLight.position.set(-4.5, 2.5, -8);
    scene.add(blueLight);
    const violetLight = new THREE.PointLight('#a855f7', 1.8, 25);
    violetLight.position.set(4.5, -1.6, -15);
    scene.add(violetLight);

    const starGroup = new THREE.Group();
    const starMat = new THREE.MeshBasicMaterial({ color: '#dbeafe', transparent: true, opacity: 0.82 });
    const stars = [];
    for (let index = 0; index < 130; index += 1) {
      const star = new THREE.Mesh(new THREE.SphereGeometry(index % 7 === 0 ? 0.035 : 0.022, 6, 6), starMat);
      star.position.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 10, -96 + Math.random() * 108);
      starGroup.add(star);
      stars.push(star);
    }
    scene.add(starGroup);

    const tunnelRings = [];
    const ringColors = ['#0ea5e9', '#7c3aed', '#ec4899'];
    for (let index = 0; index < 24; index += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(5.55, 0.025, 8, 72),
        new THREE.MeshBasicMaterial({ color: ringColors[index % ringColors.length], transparent: true, opacity: 0.26 })
      );
      ring.position.z = -94 + index * 4.5;
      ring.rotation.z = index * 0.16;
      scene.add(ring);
      tunnelRings.push(ring);
    }

    const ship = createShip();
    scene.add(ship);

    const clock = new THREE.Clock();
    const world = {
      scene,
      camera,
      renderer,
      ship,
      stars,
      tunnelRings,
      asteroids: [],
      cores: [],
      pulses: [],
      spawnClock: 0,
      coreClock: 0,
      clock
    };
    worldRef.current = world;

    const resize = () => {
      const rect = wrapper.getBoundingClientRect();
      const width = Math.max(280, Math.round(rect.width));
      const height = Math.max(430, Math.round(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);

    const animate = () => {
      if (contextLost) return;
      const dt = Math.min(0.05, clock.getDelta());
      const now = performance.now();
      const level = levelRef.current;
      const speed = runningRef.current ? 0.2 + level * 0.018 : 0.07;
      const travel = speed * dt * 60;

      tunnelRings.forEach((ring, index) => {
        ring.position.z += travel;
        ring.rotation.z += dt * (0.25 + index * 0.004);
        if (ring.position.z > 8) ring.position.z -= 108;
      });

      stars.forEach((star) => {
        star.position.z += travel * 1.28;
        if (star.position.z > 8) {
          star.position.z -= 108;
          star.position.x = (Math.random() - 0.5) * 18;
          star.position.y = (Math.random() - 0.5) * 10;
        }
      });

      const target = targetRef.current;
      ship.position.x += (target.x - ship.position.x) * Math.min(1, dt * 6.5);
      ship.position.y += (target.y - ship.position.y) * Math.min(1, dt * 6.5);
      ship.rotation.z += ((target.x - ship.position.x) * -0.12 - ship.rotation.z) * Math.min(1, dt * 7);
      ship.rotation.x += ((target.y - ship.position.y) * 0.08 - ship.rotation.x) * Math.min(1, dt * 6);
      ship.userData.shield.material.opacity = 0.06 + Math.sin(now * 0.006) * 0.025;

      camera.position.x += (ship.position.x * 0.12 - camera.position.x) * Math.min(1, dt * 2.2);
      camera.position.y += (ship.position.y * 0.08 + 0.35 - camera.position.y) * Math.min(1, dt * 2.2);
      camera.lookAt(ship.position.x * 0.08, ship.position.y * 0.08, -22);

      if (runningRef.current) {
        world.spawnClock += dt * 1000;
        world.coreClock += dt * 1000;
        distanceRef.current += Math.round(travel * 8.2);
        scoreRef.current += Math.max(1, Math.round(level * 0.08 + travel * 2.9));
        levelRef.current = Math.min(14, Math.floor(distanceRef.current / 880) + 1);

        if (world.spawnClock > Math.max(280, 820 - levelRef.current * 42)) {
          const asteroid = createAsteroid();
          scene.add(asteroid);
          world.asteroids.push(asteroid);
          world.spawnClock = 0;
        }

        if (world.coreClock > Math.max(1000, 2400 - levelRef.current * 65)) {
          const core = createEnergyCore();
          scene.add(core);
          world.cores.push(core);
          world.coreClock = 0;
        }
      }

      world.asteroids = world.asteroids.filter((asteroid) => {
        asteroid.position.z += travel;
        asteroid.rotation.x += dt * asteroid.userData.spin.x;
        asteroid.rotation.y += dt * asteroid.userData.spin.y;
        asteroid.rotation.z += dt * asteroid.userData.spin.z;
        const distanceToShip = asteroid.position.distanceTo(ship.position);
        if (!asteroid.userData.passed && asteroid.position.z > ship.position.z + 0.85) {
          asteroid.userData.passed = true;
          nearMissesRef.current += distanceToShip < 1.7 ? 1 : 0;
          scoreRef.current += distanceToShip < 1.7 ? 74 + levelRef.current * 5 : 32 + levelRef.current * 2;
        }

        const hit = runningRef.current && distanceToShip < 0.82;
        if (hit) {
          livesRef.current -= 1;
          setHitFlash(value => value + 1);
          for (let index = 0; index < 22; index += 1) {
            const pulse = createPulse(ship.position.x, ship.position.y, ship.position.z - 0.25, '#fb7185');
            scene.add(pulse);
            world.pulses.push(pulse);
          }
          scene.remove(asteroid);
          disposeObject(asteroid);
          if (livesRef.current <= 0) endGame();
          return false;
        }

        if (asteroid.position.z > 10) {
          scene.remove(asteroid);
          disposeObject(asteroid);
          return false;
        }
        return true;
      });

      world.cores = world.cores.filter((core) => {
        core.position.z += travel;
        core.rotation.x += dt * 2.2;
        core.rotation.y += dt * 2.8;
        const collected = runningRef.current && core.position.distanceTo(ship.position) < 0.96;
        if (collected) {
          coresRef.current += 1;
          scoreRef.current += 210 + levelRef.current * 16;
          for (let index = 0; index < 16; index += 1) {
            const pulse = createPulse(core.position.x, core.position.y, core.position.z, '#67e8f9');
            scene.add(pulse);
            world.pulses.push(pulse);
          }
          scene.remove(core);
          disposeObject(core);
          return false;
        }
        if (core.position.z > 10) {
          scene.remove(core);
          disposeObject(core);
          return false;
        }
        return true;
      });

      world.pulses = world.pulses.filter((pulse) => {
        pulse.userData.life -= dt;
        pulse.position.addScaledVector(pulse.userData.velocity, dt * 60);
        pulse.material.opacity = clamp(pulse.userData.life / 0.5, 0, 0.9);
        if (pulse.userData.life <= 0) {
          scene.remove(pulse);
          disposeObject(pulse);
          return false;
        }
        return true;
      });

      if (now - lastHudSyncRef.current > 110) {
        lastHudSyncRef.current = now;
        syncHud();
      }

      try {
        renderer.render(scene, camera);
      } catch {
        setRenderWarning('Graphics reset');
        setRendererResetKey(value => value + 1);
        return;
      }
      rafRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', handleContextLost, false);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored, false);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      disposeObject(scene);
      renderer.dispose();
      worldRef.current = null;
    };
  }, [endGame, rendererResetKey, syncHud]);

  const highScore = stats?.spaceRunnerStats?.highScore || 0;

  return (
    <section className="three-game-panel overflow-hidden rounded-3xl border border-indigo-900/50 bg-slate-950 text-white shadow-2xl shadow-indigo-500/10">
      <div className="relative overflow-hidden border-b border-white/10 p-4 sm:p-5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(59,130,246,0.24),transparent_30%),radial-gradient(circle_at_88%_22%,rgba(168,85,247,0.24),transparent_34%)]" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-blue-500 via-violet-600 to-cyan-400 shadow-lg shadow-blue-500/20">
              <Orbit size={28} />
            </div>
            <div>
              <p className="text-xs font-black uppercase text-blue-200">3D Space Tunnel</p>
              <h2 className="text-2xl font-black tracking-normal">Space Runner</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-white/60">Pilot through asteroid lanes, collect energy cores, and skim past danger for bonus points.</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs font-black">
            {[
              ['Score', score],
              ['Lives', lives],
              ['Cores', cores],
              ['Level', level]
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2">
                <p className="uppercase text-white/40">{label}</p>
                <p className="mt-1 text-lg text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="three-game-body grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <button
          ref={wrapRef}
          type="button"
          onPointerDown={event => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            moveToPointer(event.clientX, event.clientY, event.currentTarget);
          }}
          onPointerMove={event => moveToPointer(event.clientX, event.clientY, event.currentTarget)}
          className="three-game-stage relative min-h-[31rem] touch-none overflow-hidden rounded-[1.75rem] border border-blue-300/15 bg-slate-950 text-left shadow-2xl shadow-blue-500/20"
          aria-label="Space Runner 3D canvas"
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          <div className="pointer-events-none absolute left-4 top-4 rounded-2xl bg-black/30 px-4 py-3 text-sm font-black text-white/90 backdrop-blur-md">
            <p>Distance {distance}m</p>
            <p className="text-white/55">Near skim {nearMissesRef.current}</p>
          </div>
          {renderWarning && (
            <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-2xl border border-blue-200/30 bg-slate-950/86 px-4 py-3 text-sm font-black text-blue-50 shadow-2xl">
              {renderWarning}. Tap the stage to continue.
            </div>
          )}
          {hitFlash > 0 && <div key={hitFlash} className="absolute inset-0 animate-pulse bg-rose-500/18" />}
          {!running && !gameOver && (
            <div className="absolute inset-0 grid place-items-center bg-slate-950/25 p-5 text-center backdrop-blur-[1px]">
              <div className="rounded-3xl border border-white/15 bg-white/95 p-5 text-slate-950 shadow-2xl">
                <p className="text-2xl font-black">Tap to launch</p>
                <p className="mt-2 text-sm font-bold text-slate-600">Drag anywhere to steer in 3D space.</p>
              </div>
            </div>
          )}
        </button>

        <aside className="grid gap-4 md:grid-cols-2 xl:block xl:space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-4">
            <p className="flex items-center gap-2 text-sm font-black">
              <Trophy size={17} className="text-yellow-200" />
              Space Best
            </p>
            <p className="mt-2 text-3xl font-black">{highScore}</p>
            <p className="mt-2 text-xs leading-5 text-white/45">Score rewards distance, cores, survival, and close asteroid skims.</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <p className="flex items-center gap-2 text-sm font-black">
              <Radar size={17} className="text-blue-200" />
              Controls
            </p>
            <p className="mt-2 text-xs leading-5 text-white/45">Drag inside the canvas to fly up, down, left, or right. Collect cyan energy cores.</p>
            <button
              type="button"
              onClick={resetGame}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-blue-50"
            >
              {running ? <Zap size={17} /> : <RotateCcw size={17} />}
              {running ? 'New Flight' : 'Start Flight'}
            </button>
          </div>
        </aside>
      </div>

      <GameOverModal
        open={gameOver}
        title="Flight ended"
        score={score}
        detail={`${distance}m cleared with ${cores} energy cores.`}
        saving={saving}
        saved={saved}
        onRetry={resetGame}
        onExit={() => {
          gameOverRef.current = false;
          setGameOver(false);
        }}
      />
    </section>
  );
}
