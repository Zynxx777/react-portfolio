"use client";

import React, { useRef, useEffect, useMemo, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Environment } from "@react-three/drei";
import * as THREE from "three";

// ─────────────────────────────────────────────────────────
// CURSOR SMOKE CANVAS OVERLAY
// ─────────────────────────────────────────────────────────
const SMOKE_COLORS = [
  [255, 0, 120],    // hot pink
  [120, 0, 255],    // violet
  [0, 200, 255],    // cyan
  [255, 80, 0],     // orange
  [0, 255, 160],    // mint
  [255, 220, 0],    // gold
  [200, 0, 255],    // purple
  [0, 120, 255],    // blue
];

function CursorSmoke() {
  const canvasRef = useRef(null);
  const particles = useRef([]);
  const animRef   = useRef(null);
  const mouse     = useRef({ x: 0, y: 0 });
  const lastPos   = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Spawn a burst of smoke puffs at (x, y)
    const spawnBurst = (x, y, intensity = 1) => {
      const count = Math.floor(6 + intensity * 8);
      for (let i = 0; i < count; i++) {
        const color = SMOKE_COLORS[Math.floor(Math.random() * SMOKE_COLORS.length)];
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.4 + Math.random() * 2.5 * intensity;
        particles.current.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.5 * intensity, // bias upward
          r: color[0], g: color[1], b: color[2],
          size: 8 + Math.random() * 28 * intensity,
          maxSize: 30 + Math.random() * 60 * intensity,
          alpha: 0.7 + Math.random() * 0.3,
          decay: 0.012 + Math.random() * 0.018,
          grow: 0.6 + Math.random() * 1.2,
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.06,
          blur: 4 + Math.random() * 12,
        });
      }
    };

    const onMouseMove = (e) => {
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      mouse.current = { x: e.clientX, y: e.clientY };

      if (dist > 4) {
        const intensity = Math.min(dist / 30, 2);
        spawnBurst(e.clientX, e.clientY, intensity);
        lastPos.current = { x: e.clientX, y: e.clientY };
      }
    };

    const onClick = (e) => {
      spawnBurst(e.clientX, e.clientY, 3);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("click", onClick);

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      const W = canvas.width, H = canvas.height;

      // Fade trail
      ctx.fillStyle = "rgba(0,0,0,0.04)";
      ctx.fillRect(0, 0, W, H);

      // Draw and update particles
      particles.current = particles.current.filter(p => p.alpha > 0.01);

      for (const p of particles.current) {
        // Physics
        p.x  += p.vx;
        p.y  += p.vy;
        p.vx *= 0.97;
        p.vy *= 0.97;
        p.vy -= 0.03; // gentle upward drift
        p.size = Math.min(p.size + p.grow, p.maxSize);
        p.alpha -= p.decay;
        p.rotation += p.rotSpeed;

        // Draw smoke puff
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.filter = `blur(${p.blur}px)`;

        // Outer glow
        const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
        grd.addColorStop(0,   `rgba(${p.r},${p.g},${p.b},${p.alpha * 0.9})`);
        grd.addColorStop(0.4, `rgba(${p.r},${p.g},${p.b},${p.alpha * 0.5})`);
        grd.addColorStop(0.8, `rgba(${p.r},${p.g},${p.b},${p.alpha * 0.15})`);
        grd.addColorStop(1,   `rgba(${p.r},${p.g},${p.b},0)`);

        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        ctx.restore();
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed", top: 0, left: 0,
        width: "100vw", height: "100vh",
        pointerEvents: "none",
        zIndex: 10,
        mixBlendMode: "screen",
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────
// NEON GRID FLOOR
// ─────────────────────────────────────────────────────────
function NeonGrid() {
  const mesh = useRef();
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
  }), []);

  const vertexShader = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `;
  const fragmentShader = `
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec2 grid = fract(vUv * 20.0);
      float line = step(0.96, grid.x) + step(0.96, grid.y);
      float pulse = 0.5 + 0.5 * sin(uTime * 1.5 + vUv.x * 10.0 + vUv.y * 8.0);
      vec3 neonCyan  = vec3(0.0, 1.0, 1.0);
      vec3 neonPink  = vec3(1.0, 0.0, 0.8);
      vec3 gridColor = mix(neonCyan, neonPink, pulse);
      float dist = length(vUv - 0.5);
      float fade = 1.0 - smoothstep(0.2, 0.7, dist);
      gl_FragColor = vec4(gridColor * line * fade, line * fade * 0.85);
    }
  `;

  useFrame(({ clock }) => {
    if (mesh.current) mesh.current.material.uniforms.uTime.value = clock.getElapsedTime();
  });

  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, -2, 0]} receiveShadow>
      <planeGeometry args={[30, 30, 1, 1]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ─────────────────────────────────────────────────────────
// NEON TUBE LIGHT
// ─────────────────────────────────────────────────────────
function NeonTube({ position, rotation, color, length = 3 }) {
  const mesh = useRef();
  useFrame(({ clock }) => {
    if (mesh.current) {
      const t = clock.getElapsedTime();
      mesh.current.material.emissiveIntensity = 1.5 + Math.sin(t * 2.3 + position[0]) * 0.4;
    }
  });
  return (
    <mesh ref={mesh} position={position} rotation={rotation} castShadow>
      <cylinderGeometry args={[0.04, 0.04, length, 8]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={1.8}
        toneMapped={false}
      />
    </mesh>
  );
}

// ─────────────────────────────────────────────────────────
// FLOATING HOLOGRAM PANEL
// ─────────────────────────────────────────────────────────
function HologramPanel({ position, rotation = [0, 0, 0] }) {
  const mesh = useRef();
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  const frag = `
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      float scan = fract(vUv.y * 30.0 - uTime * 0.5);
      float scanLine = step(0.92, scan) * 0.4;
      float glitch = step(0.98, fract(sin(uTime * 3.0 + vUv.y * 50.0) * 43758.5)) * 0.3;
      vec3 col = vec3(0.0, 0.8, 1.0) + vec3(glitch);
      float alpha = 0.15 + scanLine + glitch * 0.2;
      float edge = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x)
                 * smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.95, vUv.y);
      gl_FragColor = vec4(col, alpha * edge);
    }
  `;
  const vert = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

  useFrame(({ clock }) => {
    if (mesh.current) mesh.current.material.uniforms.uTime.value = clock.getElapsedTime();
  });

  return (
    <mesh ref={mesh} position={position} rotation={rotation}>
      <planeGeometry args={[2.5, 1.5]} />
      <shaderMaterial uniforms={uniforms} vertexShader={vert} fragmentShader={frag} transparent side={THREE.DoubleSide} />
    </mesh>
  );
}

// ─────────────────────────────────────────────────────────
// FLOATING PARTICLES (ambient dust)
// ─────────────────────────────────────────────────────────
function AmbientParticles() {
  const points = useRef();
  const count = 300;

  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const palette = [
      [0, 1, 1], [1, 0, 0.8], [0.5, 0, 1], [1, 0.3, 0], [0, 0.8, 1]
    ];
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 20;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 8;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 20;
      const c = palette[Math.floor(Math.random() * palette.length)];
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    return { positions: pos, colors: col };
  }, []);

  useFrame(({ clock }) => {
    if (!points.current) return;
    const t = clock.getElapsedTime();
    const pos = points.current.geometry.attributes.position.array;
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 1] += Math.sin(t * 0.3 + i * 0.5) * 0.003;
    }
    points.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color"    args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.04} vertexColors transparent opacity={0.7} sizeAttenuation />
    </points>
  );
}

// ─────────────────────────────────────────────────────────
// ROOM WALLS
// ─────────────────────────────────────────────────────────
function RoomWalls() {
  const wallMat = (
    <meshStandardMaterial
      color="#050510"
      roughness={0.8}
      metalness={0.2}
    />
  );

  return (
    <group>
      {/* Back wall */}
      <mesh position={[0, 2, -8]} receiveShadow>
        <planeGeometry args={[20, 8]} />
        {wallMat}
      </mesh>
      {/* Left wall */}
      <mesh position={[-8, 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[16, 8]} />
        {wallMat}
      </mesh>
      {/* Right wall */}
      <mesh position={[8, 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[16, 8]} />
        {wallMat}
      </mesh>
      {/* Ceiling */}
      <mesh position={[0, 6, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 16]} />
        {wallMat}
      </mesh>
    </group>
  );
}

// ─────────────────────────────────────────────────────────
// MAIN 3D SCENE
// ─────────────────────────────────────────────────────────
function CyberpunkScene() {
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.05} />
      <pointLight position={[0, 4, 0]} intensity={0.3} color="#0088ff" />
      <pointLight position={[-5, 3, -5]} intensity={2} color="#ff00aa" distance={12} />
      <pointLight position={[5, 3, -5]}  intensity={2} color="#00ffcc" distance={12} />
      <pointLight position={[0, 5, 2]}   intensity={1} color="#8800ff" distance={10} />

      {/* Room */}
      <RoomWalls />
      <NeonGrid />

      {/* Neon tubes on walls */}
      <NeonTube position={[-7.8, 4, -3]} rotation={[0, 0, Math.PI / 2]} color="#ff00aa" length={4} />
      <NeonTube position={[-7.8, 4,  3]} rotation={[0, 0, Math.PI / 2]} color="#00ffcc" length={4} />
      <NeonTube position={[ 7.8, 4, -3]} rotation={[0, 0, Math.PI / 2]} color="#00ffcc" length={4} />
      <NeonTube position={[ 7.8, 4,  3]} rotation={[0, 0, Math.PI / 2]} color="#ff00aa" length={4} />
      <NeonTube position={[-3, 5.8, -7.8]} rotation={[0, 0, 0]} color="#8800ff" length={6} />
      <NeonTube position={[ 3, 5.8, -7.8]} rotation={[0, 0, 0]} color="#ff4400" length={6} />
      <NeonTube position={[0, 5.8, -7.8]}  rotation={[0, 0, 0]} color="#00ccff" length={3} />

      {/* Hologram panels */}
      <HologramPanel position={[-3, 1.5, -7.7]} />
      <HologramPanel position={[ 3, 1.5, -7.7]} />
      <HologramPanel position={[-7.7, 2, -2]} rotation={[0, Math.PI / 2, 0]} />

      {/* Ambient dust */}
      <AmbientParticles />

      {/* Camera controls */}
      <OrbitControls
        enablePan={false}
        minDistance={3}
        maxDistance={12}
        maxPolarAngle={Math.PI * 0.75}
        minPolarAngle={Math.PI * 0.1}
        autoRotate
        autoRotateSpeed={0.4}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────
export default function CyberpunkRoom() {
  return (
    <div
      style={{
        position: "fixed", top: 0, left: 0,
        width: "100vw", height: "100vh",
        background: "#000008",
        overflow: "hidden",
        zIndex: 9999,
        cursor: "none",
      }}
    >
      {/* 3D Scene */}
      <Canvas
        shadows
        style={{ position: "absolute", inset: 0, width: "100vw", height: "100vh" }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 }}
      >
        <PerspectiveCamera makeDefault position={[0, 1.5, 6]} fov={70} />
        <Suspense fallback={null}>
          <CyberpunkScene />
        </Suspense>
      </Canvas>

      {/* Cursor smoke overlay */}
      <CursorSmoke />

      {/* Custom cursor dot */}
      <CursorDot />

      {/* UI overlay */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 20, padding: "24px 32px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", pointerEvents: "none" }}>
        <div>
          <p style={{ color: "rgba(0,255,255,0.5)", fontSize: "10px", letterSpacing: "0.3em", textTransform: "uppercase", fontFamily: "monospace", margin: 0 }}>
            CYBERPUNK ROOM
          </p>
          <h1 style={{ color: "white", fontSize: "22px", fontWeight: 300, letterSpacing: "0.15em", margin: "4px 0 0", textTransform: "uppercase" }}>
            Immersive Environment
          </h1>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ color: "rgba(255,0,170,0.6)", fontSize: "9px", letterSpacing: "0.25em", fontFamily: "monospace", margin: 0, textTransform: "uppercase" }}>
            Move cursor · Click for burst
          </p>
          <p style={{ color: "rgba(255,255,255,0.2)", fontSize: "9px", letterSpacing: "0.2em", fontFamily: "monospace", margin: "4px 0 0", textTransform: "uppercase" }}>
            Drag to orbit · Scroll to zoom
          </p>
        </div>
      </div>

      {/* Back button */}
      <a
        href="/"
        style={{
          position: "fixed", bottom: 32, left: 32, zIndex: 20,
          color: "rgba(0,255,255,0.6)", fontSize: "11px",
          letterSpacing: "0.25em", textTransform: "uppercase",
          fontFamily: "monospace", textDecoration: "none",
          border: "1px solid rgba(0,255,255,0.2)",
          padding: "8px 20px", borderRadius: "100px",
          background: "rgba(0,0,0,0.4)", backdropFilter: "blur(10px)",
          transition: "all 0.2s",
          pointerEvents: "auto",
        }}
      >
        ← Back
      </a>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// CUSTOM CURSOR DOT
// ─────────────────────────────────────────────────────────
function CursorDot() {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const pos = useRef({ x: 0, y: 0 });
  const ring = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e) => {
      pos.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", onMove);

    let raf;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      // Lag the ring
      ring.current.x += (pos.current.x - ring.current.x) * 0.12;
      ring.current.y += (pos.current.y - ring.current.y) * 0.12;

      if (dotRef.current) {
        dotRef.current.style.transform = `translate(${pos.current.x - 4}px, ${pos.current.y - 4}px)`;
      }
      if (ringRef.current) {
        ringRef.current.style.transform = `translate(${ring.current.x - 16}px, ${ring.current.y - 16}px)`;
      }
    };
    animate();
    return () => { window.removeEventListener("mousemove", onMove); cancelAnimationFrame(raf); };
  }, []);

  return (
    <>
      {/* Inner dot */}
      <div
        ref={dotRef}
        style={{
          position: "fixed", top: 0, left: 0, zIndex: 9999,
          width: 8, height: 8, borderRadius: "50%",
          background: "white",
          boxShadow: "0 0 8px rgba(0,255,255,0.8), 0 0 20px rgba(0,255,255,0.4)",
          pointerEvents: "none",
          willChange: "transform",
        }}
      />
      {/* Outer ring */}
      <div
        ref={ringRef}
        style={{
          position: "fixed", top: 0, left: 0, zIndex: 9998,
          width: 32, height: 32, borderRadius: "50%",
          border: "1px solid rgba(0,255,255,0.5)",
          pointerEvents: "none",
          willChange: "transform",
        }}
      />
    </>
  );
}
