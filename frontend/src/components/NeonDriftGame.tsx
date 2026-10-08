import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import toast from 'react-hot-toast';
import { Gauge, RotateCcw, Shield, Sparkles, Trophy, Zap } from 'lucide-react';
import api from '../services/api';
import GameOverModal from './GameOverModal';

const LANES = [-3.15, 0, 3.15];
const MAX_X = 4.05;
const START_LIVES = 3;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const disposeObject = (object) => {
  object.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach(material => material.dispose?.());
    else child.material?.dispose?.();
  });
};

const makeMaterial = (color, emissive = '#000000', roughness = 0.55, metalness = 0.15) => (
  new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: emissive === '#000000' ? 0 : 0.7,
    roughness,
    metalness
  })
);

const createHoverCar = () => {
  const car = new THREE.Group();
  const bodyMat = makeMaterial('#0ea5e9', '#0369a1', 0.34, 0.45);
  const trimMat = makeMaterial('#f8fafc', '#67e8f9', 0.28, 0.3);
  const darkMat = makeMaterial('#020617', '#0f172a', 0.7, 0.2);
  const pinkMat = makeMaterial('#f472b6', '#ec4899', 0.4, 0.35);

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.34, 2.05), bodyMat);
  body.position.y = 0.35;
  body.castShadow = true;
  car.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.95, 4), trimMat);
  nose.rotation.x = Math.PI / 2;
  nose.rotation.z = Math.PI / 4;
  nose.position.set(0, 0.38, -1.45);
  nose.castShadow = true;
  car.add(nose);

  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.24, 0.72), darkMat);
  canopy.position.set(0, 0.66, -0.25);
  canopy.castShadow = true;
  car.add(canopy);

  [-0.78, 0.78].forEach(side => {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 1.35), pinkMat);
    wing.position.set(side, 0.32, 0.08);
    wing.rotation.z = side > 0 ? -0.16 : 0.16;
    wing.castShadow = true;
    car.add(wing);

    const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.34, 18), darkMat);
    thruster.rotation.x = Math.PI / 2;
    thruster.position.set(side * 0.72, 0.3, 1.05);
    car.add(thruster);
  });

  const underglow = new THREE.Mesh(
    new THREE.CircleGeometry(1.1, 36),
    new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending })
  );
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = 0.08;
  car.add(underglow);

  car.position.set(0, 0.12, 3.1);
  return car;
};

const createBarrier = (x) => {
  const group = new THREE.Group();
  const baseMat = makeMaterial('#111827', '#7f1d1d', 0.62, 0.22);
  const glowMat = new THREE.MeshBasicMaterial({ color: '#fb7185' });
  const pylonMat = makeMaterial('#f97316', '#ef4444', 0.48, 0.2);

  const base = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.5, 0.8), baseMat);
  base.position.y = 0.28;
  base.castShadow = true;
  group.add(base);

  [-0.42, 0.42].forEach(side => {
    const pylon = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.9, 6), pylonMat);
    pylon.position.set(side, 0.68, 0);
    pylon.castShadow = true;
    group.add(pylon);
  });

  const light = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.05, 0.06), glowMat);
  light.position.set(0, 0.56, -0.43);
  group.add(light);

  group.position.set(x, 0, -78);
  group.userData = { id: uid(), type: 'barrier', passed: false, radius: 0.92 };
  return group;
};

const createBoostRing = (x) => {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.46, 0.045, 10, 36),
    new THREE.MeshBasicMaterial({ color: '#67e8f9', transparent: true, opacity: 0.92 })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.18, 0),
    new THREE.MeshStandardMaterial({ color: '#fef3c7', emissive: '#f59e0b', emissiveIntensity: 1.2, roughness: 0.28, metalness: 0.2 })
  );
  group.add(core);

  group.position.set(x, 0.82, -82);
  group.userData = { id: uid(), type: 'boost', radius: 0.7 };
  return group;
};

const createSpark = (x, y, z, color = '#67e8f9') => {
  const spark = new THREE.Mesh(
    new THREE.SphereGeometry(0.04 + Math.random() * 0.05, 8, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
  );
  spark.position.set(x, y, z);
  spark.userData = {
    life: 0.36 + Math.random() * 0.26,
    velocity: new THREE.Vector3((Math.random() - 0.5) * 0.12, Math.random() * 0.08, 0.04 + Math.random() * 0.12)
  };
  return spark;
};

export default function NeonDriftGame({ stats, onScoreSaved, onExit }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const worldRef = useRef(null);
  const rafRef = useRef(null);
  const lastHudSyncRef = useRef(0);
  const targetXRef = useRef(0);
  const runningRef = useRef(false);
  const gameOverRef = useRef(false);
  const scoreRef = useRef(0);
  const livesRef = useRef(START_LIVES);
  const distanceRef = useRef(0);
  const boostsRef = useRef(0);
  const dodgesRef = useRef(0);
  const levelRef = useRef(1);
  const startedAtRef = useRef(Date.now());
  const savedRef = useRef(false);

  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [distance, setDistance] = useState(0);
  const [boosts, setBoosts] = useState(0);
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
    setBoosts(boostsRef.current);
    setLevel(levelRef.current);
  }, []);

  const saveScore = useCallback(async () => {
    if (savedRef.current || scoreRef.current <= 0) return;
    savedRef.current = true;
    setSaving(true);
    try {
      await api.post('/games/neon-drift/submit', {
        score: scoreRef.current,
        distance: distanceRef.current,
        boosts: boostsRef.current,
        dodges: dodgesRef.current,
        lives: livesRef.current,
        level: levelRef.current,
        elapsedMs: Date.now() - startedAtRef.current
      });
      setSaved(true);
      toast.success('Neon Drift score saved');
      onScoreSaved?.();
    } catch (err) {
      savedRef.current = false;
      toast.error(err.response?.data?.msg || 'Could not save Neon Drift score');
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
      world.obstacles.forEach(object => {
        world.scene.remove(object);
        disposeObject(object);
      });
      world.boosts.forEach(object => {
        world.scene.remove(object);
        disposeObject(object);
      });
      world.sparks.forEach(object => {
        world.scene.remove(object);
        disposeObject(object);
      });
      world.obstacles = [];
      world.boosts = [];
      world.sparks = [];
      if (world.car) {
        world.car.position.x = 0;
        world.car.rotation.set(0, 0, 0);
      }
      world.spawnClock = 0;
      world.boostClock = 0;
    }

    targetXRef.current = 0;
    scoreRef.current = 0;
    livesRef.current = START_LIVES;
    distanceRef.current = 0;
    boostsRef.current = 0;
    dodgesRef.current = 0;
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

  const moveToClientX = useCallback((clientX, target) => {
    const rect = target.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    targetXRef.current = clamp((ratio - 0.5) * MAX_X * 2, -MAX_X, MAX_X);
    if (!runningRef.current && !gameOverRef.current) resetGame();
  }, [resetGame]);

  useEffect(() => {
    const handleKey = (event) => {
      if (event.code === 'Space' && !runningRef.current && !gameOverRef.current) resetGame();
      if (event.code === 'ArrowLeft') targetXRef.current = clamp(targetXRef.current - 1.05, -MAX_X, MAX_X);
      if (event.code === 'ArrowRight') targetXRef.current = clamp(targetXRef.current + 1.05, -MAX_X, MAX_X);
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
    scene.fog = new THREE.FogExp2('#030712', 0.027);

    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 140);
    camera.position.set(0, 5.2, 9.6);
    camera.lookAt(0, 0.35, -18);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !isTouchViewport,
      powerPreference: isTouchViewport ? 'default' : 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouchViewport ? 1.35 : 2));
    renderer.setClearColor('#020617', 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene.add(new THREE.HemisphereLight('#dbeafe', '#0f172a', 1.15));
    const keyLight = new THREE.DirectionalLight('#f8fafc', 1.8);
    keyLight.position.set(-4, 8, 6);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const cyanLight = new THREE.PointLight('#22d3ee', 2.2, 18);
    cyanLight.position.set(-4.5, 2, -8);
    scene.add(cyanLight);
    const pinkLight = new THREE.PointLight('#ec4899', 1.9, 18);
    pinkLight.position.set(4.5, 2, -13);
    scene.add(pinkLight);

    const road = new THREE.Mesh(
      new THREE.BoxGeometry(9.4, 0.12, 108),
      new THREE.MeshStandardMaterial({ color: '#050816', roughness: 0.64, metalness: 0.15 })
    );
    road.position.set(0, -0.08, -35);
    road.receiveShadow = true;
    scene.add(road);

    const laneLines = [];
    const lineMat = new THREE.MeshBasicMaterial({ color: '#67e8f9', transparent: true, opacity: 0.78 });
    [-1.58, 1.58].forEach(x => {
      for (let index = 0; index < 18; index += 1) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 2.2), lineMat);
        line.position.set(x, 0.02, -82 + index * 5.7);
        scene.add(line);
        laneLines.push(line);
      }
    });

    const guardRails = [];
    ['#06b6d4', '#ec4899'].forEach((color, sideIndex) => {
      const side = sideIndex === 0 ? -1 : 1;
      const railMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.86 });
      for (let index = 0; index < 18; index += 1) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 2.8), railMat);
        rail.position.set(side * 4.85, 0.22, -84 + index * 6);
        scene.add(rail);
        guardRails.push(rail);
      }
    });

    const city = [];
    const cityColors = ['#0f172a', '#111827', '#1e293b'];
    for (let index = 0; index < 42; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const h = 1.2 + Math.random() * 4.5;
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(0.7 + Math.random() * 1.1, h, 0.7 + Math.random() * 1.2),
        makeMaterial(cityColors[index % cityColors.length], index % 3 === 0 ? '#0ea5e9' : '#000000', 0.68, 0.05)
      );
      building.position.set(side * (6.8 + Math.random() * 4.5), h / 2 - 0.05, -82 + index * 3.8);
      scene.add(building);
      city.push(building);
    }

    const car = createHoverCar();
    scene.add(car);

    const clock = new THREE.Clock();
    const world = {
      scene,
      camera,
      renderer,
      car,
      laneLines,
      guardRails,
      city,
      obstacles: [],
      boosts: [],
      sparks: [],
      spawnClock: 0,
      boostClock: 0,
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
      const speed = runningRef.current ? 0.18 + level * 0.018 + Math.min(0.12, boostsRef.current * 0.002) : 0.055;
      const travel = speed * dt * 60;

      [...laneLines, ...guardRails].forEach((line) => {
        line.position.z += travel;
        if (line.position.z > 8) line.position.z -= 103;
      });

      city.forEach((building) => {
        building.position.z += travel * 0.52;
        if (building.position.z > 14) building.position.z -= 166;
      });

      car.position.x += (targetXRef.current - car.position.x) * Math.min(1, dt * 7);
      car.rotation.z += ((targetXRef.current - car.position.x) * -0.12 - car.rotation.z) * Math.min(1, dt * 7);
      car.rotation.y = Math.sin(now * 0.003) * 0.025;
      camera.position.x += (car.position.x * 0.18 - camera.position.x) * Math.min(1, dt * 2.6);
      camera.lookAt(car.position.x * 0.08, 0.25, -18);

      if (runningRef.current) {
        world.spawnClock += dt * 1000;
        world.boostClock += dt * 1000;
        distanceRef.current += Math.round(travel * 7.5);
        scoreRef.current += Math.max(1, Math.round(level * 0.08 + travel * 2.6));
        levelRef.current = Math.min(12, Math.floor(distanceRef.current / 950) + 1);

        const spawnDelay = Math.max(360, 940 - levelRef.current * 48);
        if (world.spawnClock > spawnDelay) {
          const obstacle = createBarrier(LANES[Math.floor(Math.random() * LANES.length)]);
          world.scene.add(obstacle);
          world.obstacles.push(obstacle);
          world.spawnClock = 0;
        }

        if (world.boostClock > Math.max(900, 2100 - levelRef.current * 70)) {
          const boost = createBoostRing(LANES[Math.floor(Math.random() * LANES.length)]);
          world.scene.add(boost);
          world.boosts.push(boost);
          world.boostClock = 0;
        }
      }

      world.obstacles = world.obstacles.filter((obstacle) => {
        obstacle.position.z += travel;
        obstacle.rotation.y += dt * 1.6;
        if (!obstacle.userData.passed && obstacle.position.z > car.position.z + 0.9) {
          obstacle.userData.passed = true;
          dodgesRef.current += 1;
          scoreRef.current += 34 + levelRef.current * 3;
        }

        const hit = runningRef.current
          && Math.abs(obstacle.position.z - car.position.z) < 0.95
          && Math.abs(obstacle.position.x - car.position.x) < 0.98;
        if (hit) {
          livesRef.current -= 1;
          setHitFlash(value => value + 1);
          for (let index = 0; index < 18; index += 1) {
            const spark = createSpark(car.position.x, 0.55, car.position.z - 0.4, '#fb7185');
            scene.add(spark);
            world.sparks.push(spark);
          }
          scene.remove(obstacle);
          disposeObject(obstacle);
          if (livesRef.current <= 0) endGame();
          return false;
        }

        if (obstacle.position.z > 10) {
          scene.remove(obstacle);
          disposeObject(obstacle);
          return false;
        }
        return true;
      });

      world.boosts = world.boosts.filter((boost) => {
        boost.position.z += travel;
        boost.rotation.z += dt * 3.2;
        boost.rotation.y += dt * 2.4;
        const collected = runningRef.current
          && Math.abs(boost.position.z - car.position.z) < 1.05
          && Math.abs(boost.position.x - car.position.x) < 0.9;
        if (collected) {
          boostsRef.current += 1;
          scoreRef.current += 180 + levelRef.current * 12;
          for (let index = 0; index < 14; index += 1) {
            const spark = createSpark(boost.position.x, boost.position.y, boost.position.z, '#67e8f9');
            scene.add(spark);
            world.sparks.push(spark);
          }
          scene.remove(boost);
          disposeObject(boost);
          return false;
        }
        if (boost.position.z > 10) {
          scene.remove(boost);
          disposeObject(boost);
          return false;
        }
        return true;
      });

      world.sparks = world.sparks.filter((spark) => {
        spark.userData.life -= dt;
        spark.position.addScaledVector(spark.userData.velocity, dt * 60);
        spark.material.opacity = clamp(spark.userData.life / 0.5, 0, 0.9);
        if (spark.userData.life <= 0) {
          scene.remove(spark);
          disposeObject(spark);
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

  const highScore = stats?.neonDriftStats?.highScore || 0;

  return (
    <section className="three-game-panel overflow-hidden rounded-3xl border border-cyan-900/50 bg-slate-950 text-white shadow-2xl shadow-cyan-500/10">
      <div className="relative overflow-hidden border-b border-white/10 p-4 sm:p-5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(34,211,238,0.24),transparent_30%),radial-gradient(circle_at_88%_24%,rgba(236,72,153,0.22),transparent_34%)]" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 via-blue-600 to-pink-500 shadow-lg shadow-cyan-500/20">
              <Gauge size={28} />
            </div>
            <div>
              <p className="text-xs font-black uppercase text-cyan-200">3D Neon Racer</p>
              <h2 className="text-2xl font-black tracking-normal">Neon Drift</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-white/60">Steer the hovercar through a glowing city lane, dodge barriers, and grab boost cores.</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs font-black">
            {[
              ['Score', score],
              ['Lives', lives],
              ['Boost', boosts],
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
            moveToClientX(event.clientX, event.currentTarget);
          }}
          onPointerMove={event => moveToClientX(event.clientX, event.currentTarget)}
          className="three-game-stage relative min-h-[31rem] touch-none overflow-hidden rounded-[1.75rem] border border-cyan-300/15 bg-slate-950 text-left shadow-2xl shadow-cyan-500/20"
          aria-label="Neon Drift 3D canvas"
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          <div className="pointer-events-none absolute left-4 top-4 rounded-2xl bg-black/30 px-4 py-3 text-sm font-black text-white/90 backdrop-blur-md">
            <p>Distance {distance}m</p>
            <p className="text-white/55">Dodges {dodgesRef.current}</p>
          </div>
          {renderWarning && (
            <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-2xl border border-cyan-200/30 bg-slate-950/86 px-4 py-3 text-sm font-black text-cyan-50 shadow-2xl">
              {renderWarning}. Tap the stage to continue.
            </div>
          )}
          {hitFlash > 0 && <div key={hitFlash} className="absolute inset-0 animate-pulse bg-rose-500/18" />}
          {!running && !gameOver && (
            <div className="absolute inset-0 grid place-items-center bg-slate-950/25 p-5 text-center backdrop-blur-[1px]">
              <div className="rounded-3xl border border-white/15 bg-white/95 p-5 text-slate-950 shadow-2xl">
                <p className="text-2xl font-black">Tap to drift</p>
                <p className="mt-2 text-sm font-bold text-slate-600">Drag left or right. Arrow keys work on laptop.</p>
              </div>
            </div>
          )}
        </button>

        <aside className="grid gap-4 md:grid-cols-2 xl:block xl:space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-4">
            <p className="flex items-center gap-2 text-sm font-black">
              <Trophy size={17} className="text-yellow-200" />
              Neon Best
            </p>
            <p className="mt-2 text-3xl font-black">{highScore}</p>
            <p className="mt-2 text-xs leading-5 text-white/45">Score rewards distance, dodges, boost cores, and surviving at higher speed.</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <p className="flex items-center gap-2 text-sm font-black">
              <Shield size={17} className="text-cyan-200" />
              Controls
            </p>
            <p className="mt-2 text-xs leading-5 text-white/45">Drag anywhere inside the canvas. Stay between rails and avoid red barriers.</p>
            <button
              type="button"
              onClick={resetGame}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-50"
            >
              {running ? <Zap size={17} /> : <RotateCcw size={17} />}
              {running ? 'New Run' : 'Start Run'}
            </button>
          </div>
        </aside>
      </div>

      <GameOverModal
        open={gameOver}
        title="Drift ended"
        score={score}
        detail={`${distance}m cleared with ${boosts} boost cores.`}
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
