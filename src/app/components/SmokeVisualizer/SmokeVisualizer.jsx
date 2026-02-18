"use client";

import React, { useRef, useMemo, useEffect, useState, Suspense, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// ═══════════════════════════════════════════════════════
// VISUALIZER 1: Retro OS Terminal (CRT oscilloscope)
// ═══════════════════════════════════════════════════════
const RetroTerminal = ({ analyserRef }) => {
  const canvasRef = useRef(null);
  const animRef   = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    const fftData  = new Uint8Array(256);
    const waveData = new Uint8Array(256);
    let time = 0;
    let glitchTimer = 0;

    const drawScanlines = (W, H) => {
      ctx.save();
      ctx.globalAlpha = 0.07;
      for (let y = 0; y < H; y += 3) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, y, W, 1);
      }
      ctx.restore();
    };

    const drawCRTVignette = (W, H) => {
      const vg = ctx.createRadialGradient(W/2, H/2, H*0.3, W/2, H/2, H*0.85);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.65)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    };

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      const W = canvas.width, H = canvas.height;
      time += 0.016;
      glitchTimer += 0.016;

      // Dark phosphor background
      ctx.fillStyle = "rgba(0, 8, 2, 0.55)";
      ctx.fillRect(0, 0, W, H);

      if (analyserRef.current) {
        analyserRef.current.getByteFrequencyData(fftData);
        analyserRef.current.getByteTimeDomainData(waveData);
      }

      const avgVol = fftData.reduce((a,b)=>a+b,0) / fftData.length / 255;

      // ── Window chrome ──
      const PAD = 40, TITLE_H = 32;
      const winX = PAD, winY = PAD, winW = W - PAD*2, winH = H - PAD*2;

      // Window border
      ctx.strokeStyle = `rgba(0,255,80,${0.4 + avgVol * 0.4})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(winX, winY, winW, winH);

      // Title bar
      ctx.fillStyle = `rgba(0,255,80,${0.08 + avgVol * 0.05})`;
      ctx.fillRect(winX, winY, winW, TITLE_H);

      // Traffic lights
      const dots = ["#ff5f57","#febc2e","#28c840"];
      dots.forEach((c, i) => {
        ctx.beginPath();
        ctx.arc(winX + 16 + i * 20, winY + TITLE_H/2, 6, 0, Math.PI*2);
        ctx.fillStyle = c;
        ctx.fill();
      });

      // Title text
      ctx.fillStyle = `rgba(0,255,80,0.8)`;
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.fillText("AUDIO_ANALYZER v2.4 — SPECTRUM MONITOR", W/2, winY + TITLE_H/2 + 4);
      ctx.textAlign = "left";

      // ── Glitch effect ──
      const doGlitch = glitchTimer > 3 + Math.random() * 5;
      if (doGlitch) {
        glitchTimer = 0;
        const glitchH = 2 + Math.random() * 8;
        const glitchY = winY + TITLE_H + Math.random() * (winH - TITLE_H);
        ctx.save();
        ctx.globalAlpha = 0.6;
        const imgData = ctx.getImageData(winX, glitchY, winW, glitchH);
        ctx.putImageData(imgData, winX + (Math.random()-0.5)*20, glitchY);
        ctx.restore();
      }

      const innerX = winX + 20;
      const innerW = winW - 40;
      const innerY = winY + TITLE_H + 20;
      const innerH = winH - TITLE_H - 40;

      // ── FFT Spectrum (top half) ──
      const specH = innerH * 0.45;
      const barW  = innerW / fftData.length;

      // Grid lines
      ctx.strokeStyle = "rgba(0,255,80,0.08)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = innerY + (specH / 4) * i;
        ctx.beginPath(); ctx.moveTo(innerX, y); ctx.lineTo(innerX + innerW, y); ctx.stroke();
      }
      for (let i = 0; i <= 8; i++) {
        const x = innerX + (innerW / 8) * i;
        ctx.beginPath(); ctx.moveTo(x, innerY); ctx.lineTo(x, innerY + specH); ctx.stroke();
      }

      // Bars
      for (let i = 0; i < fftData.length; i++) {
        const val  = fftData[i] / 255;
        const bH   = val * specH;
        const x    = innerX + i * barW;
        const glow = 0.5 + val * 0.5;
        // Phosphor green with brightness based on level
        const bright = Math.floor(80 + val * 175);
        ctx.fillStyle = `rgba(0,${bright},${Math.floor(bright * 0.3)},${glow})`;
        ctx.fillRect(x, innerY + specH - bH, Math.max(barW - 1, 1), bH);

        // Peak dot
        if (val > 0.6) {
          ctx.fillStyle = `rgba(180,255,180,${val})`;
          ctx.fillRect(x, innerY + specH - bH - 2, Math.max(barW - 1, 1), 2);
        }
      }

      // Spectrum label
      ctx.fillStyle = "rgba(0,255,80,0.4)";
      ctx.font = "10px monospace";
      ctx.fillText("FFT SPECTRUM  [0Hz ──────────────────── 22kHz]", innerX, innerY + specH + 14);

      // ── Oscilloscope waveform (bottom half) ──
      const waveY = innerY + specH + 30;
      const waveH = innerH - specH - 30;
      const midY  = waveY + waveH / 2;

      // Waveform grid
      ctx.strokeStyle = "rgba(0,255,80,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(innerX, midY); ctx.lineTo(innerX + innerW, midY); ctx.stroke();

      // Draw waveform
      ctx.save();
      ctx.shadowColor = "#00ff50";
      ctx.shadowBlur  = 6 + avgVol * 10;
      ctx.strokeStyle = `rgba(0,255,80,${0.7 + avgVol * 0.3})`;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      for (let i = 0; i < waveData.length; i++) {
        const x = innerX + (i / waveData.length) * innerW;
        const y = midY + ((waveData[i] / 128.0) - 1.0) * (waveH * 0.45);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();

      // Waveform label
      ctx.fillStyle = "rgba(0,255,80,0.4)";
      ctx.font = "10px monospace";
      ctx.fillText("OSCILLOSCOPE  [TIME DOMAIN]", innerX, waveY + waveH + 14);

      // ── Status bar ──
      const vol = Math.round(avgVol * 100);
      const peak = Math.round(Math.max(...fftData) / 255 * 100);
      ctx.fillStyle = "rgba(0,255,80,0.5)";
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`VOL: ${String(vol).padStart(3,"0")}%  PEAK: ${String(peak).padStart(3,"0")}%  T: ${time.toFixed(1)}s`, winX + winW - 20, winY + winH - 12);
      ctx.textAlign = "left";
      ctx.fillText(`● REC  SAMPLE_RATE: 44100Hz  FFT: 512pt`, winX + 20, winY + winH - 12);

      // CRT effects
      drawScanlines(W, H);
      drawCRTVignette(W, H);

      // Phosphor flicker
      if (Math.random() < 0.015) {
        ctx.fillStyle = `rgba(0,255,80,${Math.random() * 0.03})`;
        ctx.fillRect(0, 0, W, H);
      }
    };

    draw();
    return () => { cancelAnimationFrame(animRef.current); window.removeEventListener("resize", resize); };
  }, [analyserRef]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ background: "#000802" }} />;
};

// ═══════════════════════════════════════════════════════
// VISUALIZER 3: Classic Smoke (original teal/cyan look)
// ═══════════════════════════════════════════════════════
const ClassicSmokeScene = ({ analyserRef }) => {
  const mesh = useRef();
  const { mouse, size, viewport } = useThree();
  const dataArray = useMemo(() => new Uint8Array(128), []);

  const uniforms = useMemo(() => ({
    uTime:       { value: 0 },
    uMouse:      { value: new THREE.Vector2(0, 0) },
    uResolution: { value: new THREE.Vector2(size.width, size.height) },
    uAudioLow:   { value: 0 },
    uAudioMid:   { value: 0 },
    uAudioHigh:  { value: 0 },
  }), [size]);

  const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    uniform float uTime;
    uniform vec2 uMouse;
    uniform vec2 uResolution;
    uniform float uAudioLow;
    uniform float uAudioMid;
    uniform float uAudioHigh;
    varying vec2 vUv;

    vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
    float snoise(vec2 v){
      const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1;
      i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod(i, 289.0);
      vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
      m = m*m; m = m*m;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314*(a0*a0+h*h);
      vec3 g;
      g.x  = a0.x  * x0.x  + h.x  * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    void main() {
      vec2 st = vUv;
      float aspect = uResolution.x / uResolution.y;
      st.x *= aspect;
      vec2 mouse = uMouse;
      mouse.x *= aspect;
      float dist = distance(st, mouse);
      float mouseEffect = smoothstep(0.4, 0.0, dist);
      float time = uTime * 0.2;
      vec2 q = vec2(0.);
      q.x = snoise(st + vec2(0.0, time));
      q.y = snoise(st + vec2(1.0, time));
      vec2 r = vec2(0.);
      r.x = snoise(st + 1.0*q + vec2(1.7,9.2) + 0.15*time + uAudioLow * 0.5);
      r.y = snoise(st + 1.0*q + vec2(8.3,2.8) + 0.126*time + uAudioMid * 0.5);
      float f = snoise(st + r + mouseEffect + uAudioHigh * 0.2);
      vec3 color = mix(vec3(0.101961,0.619608,0.666667), vec3(0.666667,0.666667,0.498039), clamp((f*f)*4.0,0.0,1.0));
      color = mix(color, vec3(0,0,0.164706), clamp(length(q),0.0,1.0));
      color = mix(color, vec3(0.666667,1,1), clamp(length(r.x),0.0,1.0));
      color += vec3(0.2, 0.5, 1.0) * mouseEffect * (1.5 + uAudioHigh * 2.0);
      color += vec3(uAudioLow * 0.2, uAudioMid * 0.1, uAudioHigh * 0.3);
      float alpha = clamp((f*f*f+.6*f*f+.5*f), 0.3, 0.9);
      gl_FragColor = vec4(color, alpha);
    }
  `;

  useFrame((state) => {
    if (!mesh.current) return;
    const u = mesh.current.material.uniforms;
    u.uTime.value = state.clock.getElapsedTime();
    u.uMouse.value.set((mouse.x + 1) / 2, (mouse.y + 1) / 2);
    if (analyserRef.current) {
      analyserRef.current.getByteFrequencyData(dataArray);
      const low  = dataArray.slice(0, 5).reduce((a,b)=>a+b,0) / 5 / 255;
      const mid  = dataArray.slice(10, 20).reduce((a,b)=>a+b,0) / 10 / 255;
      const high = dataArray.slice(40, 50).reduce((a,b)=>a+b,0) / 10 / 255;
      u.uAudioLow.value  = THREE.MathUtils.lerp(u.uAudioLow.value,  low,  0.1);
      u.uAudioMid.value  = THREE.MathUtils.lerp(u.uAudioMid.value,  mid,  0.1);
      u.uAudioHigh.value = THREE.MathUtils.lerp(u.uAudioHigh.value, high, 0.1);
    }
  });

  return (
    <mesh ref={mesh} scale={[viewport.width, viewport.height, 1]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
};

// ═══════════════════════════════════════════════════════
// VISUALIZER 2: Enhanced Smoke (rich multi-color)
// ═══════════════════════════════════════════════════════
const EnhancedSmokeScene = ({ analyserRef }) => {
  const mesh = useRef();
  const { mouse, size, viewport } = useThree();
  const dataArray = useMemo(() => new Uint8Array(256), []);

  const uniforms = useMemo(() => ({
    uTime:       { value: 0 },
    uMouse:      { value: new THREE.Vector2(0.5, 0.5) },
    uResolution: { value: new THREE.Vector2(size.width, size.height) },
    uAudioLow:   { value: 0 },
    uAudioMid:   { value: 0 },
    uAudioHigh:  { value: 0 },
  }), [size]);

  const vertexShader = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `;

  const fragmentShader = `
    uniform float uTime;
    uniform vec2 uMouse;
    uniform vec2 uResolution;
    uniform float uAudioLow;
    uniform float uAudioMid;
    uniform float uAudioHigh;
    varying vec2 vUv;

    vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
    float snoise(vec2 v) {
      const vec4 C = vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
      vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
      i = mod(i, 289.0);
      vec3 p = permute(permute(i.y + vec3(0.0,i1.y,1.0)) + i.x + vec3(0.0,i1.x,1.0));
      vec3 m = max(0.5 - vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)), 0.0);
      m = m*m; m = m*m;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314*(a0*a0+h*h);
      vec3 g;
      g.x  = a0.x  * x0.x  + h.x  * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    void main() {
      vec2 st = vUv;
      float aspect = uResolution.x / uResolution.y;
      st.x *= aspect;
      vec2 mouse = uMouse; mouse.x *= aspect;
      float dist = distance(st, mouse);
      float mouseEffect = smoothstep(0.5, 0.0, dist) * (1.0 + uAudioLow * 3.0);
      float t = uTime * 0.25 + uAudioLow * 0.8;
      vec2 q; q.x = snoise(st + vec2(0.0, t)); q.y = snoise(st + vec2(1.7, t * 0.9));
      vec2 r;
      r.x = snoise(st + 2.0*q + vec2(1.7,9.2) + 0.2*t + uAudioLow*0.8);
      r.y = snoise(st + 2.0*q + vec2(8.3,2.8) + 0.18*t + uAudioMid*0.8);
      vec2 s;
      s.x = snoise(st + 1.5*r + vec2(3.1,5.4) + 0.12*t + uAudioHigh*0.5);
      s.y = snoise(st + 1.5*r + vec2(6.7,1.2) + 0.11*t);
      float f = snoise(st + s + mouseEffect*0.3 + uAudioHigh*0.3);
      vec3 col1 = vec3(0.05,0.02,0.25);
      vec3 col2 = vec3(0.6,0.0,0.8);
      vec3 col3 = vec3(0.0,0.7,1.0);
      vec3 col4 = vec3(1.0,0.2,0.5);
      vec3 col5 = vec3(1.0,0.6,0.0);
      vec3 color = mix(col1, col2, clamp(f*f*4.0,0.0,1.0));
      color = mix(color, col3, clamp(length(q),0.0,1.0)*0.7);
      color = mix(color, col4, clamp(length(r),0.0,1.0)*0.5*(0.5+uAudioMid));
      color = mix(color, col5, clamp(length(s),0.0,1.0)*0.3*(0.5+uAudioHigh));
      color += col3 * mouseEffect * 0.8;
      color += col4 * uAudioLow * 0.4;
      color += col5 * uAudioHigh * 0.3;
      float alpha = clamp(f*f*f+0.6*f*f+0.5*f+0.2, 0.15, 1.0);
      gl_FragColor = vec4(color, alpha);
    }
  `;

  useFrame((state) => {
    if (!mesh.current) return;
    const u = mesh.current.material.uniforms;
    u.uTime.value = state.clock.getElapsedTime();
    u.uMouse.value.set((mouse.x + 1) / 2, (mouse.y + 1) / 2);
    if (analyserRef.current) {
      analyserRef.current.getByteFrequencyData(dataArray);
      const low  = dataArray.slice(0, 8).reduce((a,b)=>a+b,0) / 8 / 255;
      const mid  = dataArray.slice(10, 30).reduce((a,b)=>a+b,0) / 20 / 255;
      const high = dataArray.slice(40, 80).reduce((a,b)=>a+b,0) / 40 / 255;
      u.uAudioLow.value  = THREE.MathUtils.lerp(u.uAudioLow.value,  low,  0.12);
      u.uAudioMid.value  = THREE.MathUtils.lerp(u.uAudioMid.value,  mid,  0.12);
      u.uAudioHigh.value = THREE.MathUtils.lerp(u.uAudioHigh.value, high, 0.12);
    }
  });

  return (
    <mesh ref={mesh} scale={[viewport.width, viewport.height, 1]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
};



// ═══════════════════════════════════════════════════════
// VISUALIZER 4: Black Hole Space — Full 3D Three.js
// ═══════════════════════════════════════════════════════

// 3D Star Field — reacts to bass
function StarField3D({ audioRef: analyserRef }) {
  const points = useRef();
  const COUNT = 3000;
  const { positions, sizes, colors } = useMemo(() => {
    const pos  = new Float32Array(COUNT * 3);
    const sz   = new Float32Array(COUNT);
    const col  = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      // Distribute in a large sphere shell
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = 40 + Math.random() * 120;
      pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
      pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i*3+2] = r * Math.cos(phi);
      sz[i] = 0.3 + Math.random() * 1.2;
      // Slight color variation: white, blue-white, warm
      const t = Math.random();
      col[i*3]   = 0.8 + t * 0.2;
      col[i*3+1] = 0.85 + t * 0.1;
      col[i*3+2] = 1.0;
    }
    return { positions: pos, sizes: sz, colors: col };
  }, []);

  const dataArr = useMemo(() => new Uint8Array(256), []);

  useFrame(({ clock }) => {
    if (!points.current) return;
    const t = clock.getElapsedTime();
    let bass = 0;
    if (analyserRef.current) {
      analyserRef.current.getByteFrequencyData(dataArr);
      bass = dataArr.slice(0, 8).reduce((a,b)=>a+b,0) / 8 / 255;
    }
    // Pulse scale on bass
    const pulse = 1 + bass * 0.08;
    points.current.scale.setScalar(pulse);
    // Slow rotation for parallax depth feel
    points.current.rotation.y = t * 0.012;
    points.current.rotation.x = Math.sin(t * 0.007) * 0.05;
    // Twinkle via material opacity
    points.current.material.opacity = 0.7 + bass * 0.3;
    points.current.material.size = 0.35 + bass * 0.4;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color"    args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.35} vertexColors transparent opacity={0.8}
        sizeAttenuation depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// Accretion Disk — flat torus ring with audio-reactive glow
function AccretionDisk({ analyserRef }) {
  const mesh  = useRef();
  const inner = useRef();
  const dataArr = useMemo(() => new Uint8Array(256), []);

  const diskMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.0, 0.35, 0.05),
    transparent: true, opacity: 0.85,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), []);

  useFrame(({ clock }) => {
    if (!mesh.current) return;
    const t = clock.getElapsedTime();
    let bass = 0, mid = 0;
    if (analyserRef.current) {
      analyserRef.current.getByteFrequencyData(dataArr);
      bass = dataArr.slice(0, 8).reduce((a,b)=>a+b,0) / 8 / 255;
      mid  = dataArr.slice(10, 40).reduce((a,b)=>a+b,0) / 30 / 255;
    }
    // Spin faster on bass
    mesh.current.rotation.z  += 0.004 + bass * 0.025;
    if (inner.current) inner.current.rotation.z -= 0.007 + bass * 0.04;
    // Pulse glow
    diskMat.opacity = 0.6 + bass * 0.4;
    diskMat.color.setHSL(0.07 + mid * 0.05, 1.0, 0.5 + bass * 0.3);
    // Slight warp on beat
    mesh.current.scale.y = 1 + bass * 0.12;
  });

  return (
    <group rotation={[Math.PI * 0.08, 0, 0]}>
      {/* Outer disk */}
      <mesh ref={mesh}>
        <torusGeometry args={[3.2, 0.9, 2, 180]} />
        <primitive object={diskMat} attach="material" />
      </mesh>
      {/* Inner hot ring */}
      <mesh ref={inner}>
        <torusGeometry args={[2.2, 0.35, 2, 180]} />
        <meshBasicMaterial
          color={new THREE.Color(2.5, 1.0, 0.2)}
          transparent opacity={0.9}
          blending={THREE.AdditiveBlending} depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

// Black Hole Event Horizon — sphere + shader glow layers
function BlackHole({ analyserRef }) {
  const glowRef = useRef();
  const haloRef = useRef();
  const dataArr = useMemo(() => new Uint8Array(256), []);

  useFrame(() => {
    let bass = 0;
    if (analyserRef.current) {
      analyserRef.current.getByteFrequencyData(dataArr);
      bass = dataArr.slice(0, 8).reduce((a,b)=>a+b,0) / 8 / 255;
    }
    if (glowRef.current) glowRef.current.material.opacity = 0.55 + bass * 0.45;
    if (haloRef.current) {
      haloRef.current.material.opacity = 0.2 + bass * 0.35;
      haloRef.current.scale.setScalar(1 + bass * 0.15);
    }
  });

  return (
    <group>
      {/* Event horizon — pure black sphere */}
      <mesh>
        <sphereGeometry args={[1.5, 64, 64]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      {/* Photon sphere glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[1.65, 64, 64]} />
        <meshBasicMaterial
          color={new THREE.Color(2.5, 0.8, 0.1)}
          transparent opacity={0.6}
          blending={THREE.AdditiveBlending} depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
      {/* Outer halo */}
      <mesh ref={haloRef}>
        <sphereGeometry args={[2.8, 32, 32]} />
        <meshBasicMaterial
          color={new THREE.Color(0.4, 0.1, 1.2)}
          transparent opacity={0.25}
          blending={THREE.AdditiveBlending} depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
    </group>
  );
}

// Nebula Clouds — large transparent spheres with additive blending
function Nebula({ analyserRef }) {
  const refs = [useRef(), useRef(), useRef()];
  const dataArr = useMemo(() => new Uint8Array(256), []);
  const configs = useMemo(() => [
    { pos: [15, 8, -30],  color: new THREE.Color(0.15, 0.0, 0.6),  r: 18, speed: 0.003 },
    { pos: [-20, -5, -25], color: new THREE.Color(0.5, 0.0, 0.8),  r: 14, speed: 0.004 },
    { pos: [5, -12, -35],  color: new THREE.Color(0.0, 0.2, 0.7),  r: 20, speed: 0.002 },
  ], []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    let bass = 0;
    if (analyserRef.current) {
      analyserRef.current.getByteFrequencyData(dataArr);
      bass = dataArr.slice(0, 8).reduce((a,b)=>a+b,0) / 8 / 255;
    }
    refs.forEach((r, i) => {
      if (!r.current) return;
      r.current.material.opacity = 0.04 + bass * 0.06;
      r.current.rotation.y = t * configs[i].speed;
      r.current.rotation.x = t * configs[i].speed * 0.5;
    });
  });

  return (
    <>
      {configs.map((c, i) => (
        <mesh key={i} ref={refs[i]} position={c.pos}>
          <sphereGeometry args={[c.r, 16, 16]} />
          <meshBasicMaterial
            color={c.color} transparent opacity={0.05}
            blending={THREE.AdditiveBlending} depthWrite={false}
            side={THREE.BackSide}
          />
        </mesh>
      ))}
    </>
  );
}

// Orbiting Planets — real 3D spheres
function Planets({ analyserRef }) {
  const groupRef = useRef();
  const dataArr  = useMemo(() => new Uint8Array(256), []);
  const planets  = useMemo(() => [
    { r: 7,  speed: 0.18, phase: 0,           size: 0.35, color: "#c87941", tilt: 0.2  },
    { r: 10, speed: 0.11, phase: Math.PI,     size: 0.28, color: "#4a90d9", tilt: -0.3 },
    { r: 14, speed: 0.07, phase: Math.PI/2,   size: 0.22, color: "#e8c87a", tilt: 0.15 },
    { r: 18, speed: 0.04, phase: Math.PI*1.5, size: 0.4,  color: "#7a4ae8", tilt: -0.1 },
  ], []);
  const planetRefs = [useRef(), useRef(), useRef(), useRef()];

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    let avg = 0;
    if (analyserRef.current) {
      analyserRef.current.getByteFrequencyData(dataArr);
      avg = dataArr.reduce((a,b)=>a+b,0) / dataArr.length / 255;
    }
    planets.forEach((p, i) => {
      if (!planetRefs[i].current) return;
      const angle = t * p.speed + p.phase;
      planetRefs[i].current.position.set(
        Math.cos(angle) * p.r,
        Math.sin(angle * 0.4) * 1.5 + p.tilt * 2,
        Math.sin(angle) * p.r
      );
      const s = p.size * (1 + avg * 0.4);
      planetRefs[i].current.scale.setScalar(s);
    });
  });

  return (
    <>
      {planets.map((p, i) => (
        <mesh key={i} ref={planetRefs[i]}>
          <sphereGeometry args={[1, 24, 24]} />
          <meshStandardMaterial
            color={p.color} roughness={0.7} metalness={0.2}
            emissive={p.color} emissiveIntensity={0.3}
          />
        </mesh>
      ))}
    </>
  );
}

// Audio Waveform Ring — 3D line loop that morphs with frequency
function WaveformRing({ analyserRef }) {
  const lineRef = useRef();
  const COUNT   = 256;
  const dataArr = useMemo(() => new Uint8Array(COUNT), []);
  const positions = useMemo(() => new Float32Array(COUNT * 3), []);

  useFrame(() => {
    if (!lineRef.current) return;
    if (analyserRef.current) analyserRef.current.getByteFrequencyData(dataArr);
    const geo = lineRef.current.geometry;
    const pos = geo.attributes.position.array;
    const BASE_R = 4.5;
    for (let i = 0; i < COUNT; i++) {
      const angle = (i / COUNT) * Math.PI * 2;
      const amp   = (dataArr[i] / 255) * 1.8;
      const r     = BASE_R + amp;
      pos[i*3]   = Math.cos(angle) * r;
      pos[i*3+1] = Math.sin(angle) * 0.15 + amp * 0.1;
      pos[i*3+2] = Math.sin(angle) * r;
    }
    geo.attributes.position.needsUpdate = true;
  });

  return (
    <lineLoop ref={lineRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={COUNT} />
      </bufferGeometry>
      <lineBasicMaterial
        color={new THREE.Color(0.3, 0.7, 1.0)}
        transparent opacity={0.5}
        blending={THREE.AdditiveBlending}
      />
    </lineLoop>
  );
}

// Camera rig — follows cursor for 3D parallax
function CameraRig({ analyserRef }) {
  const { camera } = useThree();
  const mouse  = useRef({ x: 0, y: 0 });
  const target = useRef({ x: 0, y: 0 });
  const dataArr = useMemo(() => new Uint8Array(256), []);

  useEffect(() => {
    const onMove = (e) => {
      mouse.current.x = (e.clientX / window.innerWidth  - 0.5) * 2;
      mouse.current.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    let bass = 0;
    if (analyserRef.current) {
      analyserRef.current.getByteFrequencyData(dataArr);
      bass = dataArr.slice(0, 8).reduce((a,b)=>a+b,0) / 8 / 255;
    }
    // Smooth follow
    target.current.x += (mouse.current.x - target.current.x) * 0.04;
    target.current.y += (mouse.current.y - target.current.y) * 0.04;

    // Camera orbits slightly + cursor tilt
    camera.position.x = target.current.x * 6 + Math.sin(t * 0.08) * 2;
    camera.position.y = -target.current.y * 4 + Math.sin(t * 0.05) * 1;
    camera.position.z = 22 - bass * 3; // zoom in on bass hits
    camera.lookAt(0, 0, 0);
  });

  return null;
}

// Main Black Hole 3D Scene
function BlackHoleScene({ analyserRef }) {
  return (
    <>
      <color attach="background" args={["#000004"]} />
      <ambientLight intensity={0.05} />
      <pointLight position={[0, 0, 0]} intensity={3} color="#ff6010" distance={25} />
      <pointLight position={[0, 5, 0]} intensity={1} color="#8833ff" distance={40} />

      <CameraRig analyserRef={analyserRef} />
      <StarField3D audioRef={analyserRef} />
      <Nebula analyserRef={analyserRef} />
      <AccretionDisk analyserRef={analyserRef} />
      <BlackHole analyserRef={analyserRef} />
      <WaveformRing analyserRef={analyserRef} />
      <Planets analyserRef={analyserRef} />
    </>
  );
}

const BlackHoleSpace = ({ analyserRef }) => (
  <Canvas
    style={{ display: "block", width: "100vw", height: "100vh" }}
    camera={{ position: [0, 0, 22], fov: 65 }}
    gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.4 }}
  >
    <Suspense fallback={null}>
      <BlackHoleScene analyserRef={analyserRef} />
    </Suspense>
  </Canvas>
);



// ═══════════════════════════════════════════════════════
// ICONS
// ═══════════════════════════════════════════════════════
const IconClassic = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 2C6 8 4 12 6 16s6 6 6 6 4-2 6-6-0-8-6-14z"/>
  </svg>
);
const IconSmoke = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M8 22c0-4 4-5 4-9a4 4 0 0 0-8 0c0 4 4 5 4 9z"/>
    <path d="M16 22c0-3-2-4-2-7"/>
    <path d="M20 22c0-2-1-3-1-5"/>
  </svg>
);
const IconTerminal = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="2" y="3" width="20" height="14" rx="2"/>
    <polyline points="8 21 12 17 16 21"/>
    <polyline points="6 8 9 11 6 14" strokeLinecap="round" strokeLinejoin="round"/>
    <line x1="12" y1="14" x2="16" y2="14"/>
  </svg>
);
const IconBlackHole = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.8"/>
    <ellipse cx="12" cy="12" rx="9" ry="3.5" strokeDasharray="3 2"/>
    <circle cx="12" cy="12" r="6" strokeDasharray="1 3" opacity="0.5"/>
  </svg>
);

const VISUALIZERS = [
  { id: "bars",     label: "Terminal", Icon: IconTerminal },
  { id: "smoke",    label: "Smoke",    Icon: IconSmoke    },
  { id: "classic",  label: "Classic",  Icon: IconClassic  },
  { id: "orbit",    label: "Space",    Icon: IconBlackHole},
];

// ═══════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════
export default function SmokeVisualizer() {
  const [isPlaying,    setIsPlaying]    = useState(false);
  const [showOverlay,  setShowOverlay]  = useState(true);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [playlist,     setPlaylist]     = useState([]);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [progress,     setProgress]     = useState(0);
  const [duration,     setDuration]     = useState(0);
  const [vizMode,      setVizMode]      = useState("bars");
  const [showControls, setShowControls] = useState(false);

  const audioRef    = useRef(null);
  const analyserRef = useRef(null);

  // ── Fetch playlist ──
  useEffect(() => {
    fetch("/api/music")
      .then(r => r.json())
      .then(data => {
        const tracks = Array.isArray(data) ? data : (data?.tracks ?? []);
        if (tracks.length > 0) { setPlaylist(tracks); setCurrentTrack(tracks[0]); }
      })
      .catch(err => console.error("Playlist fetch failed:", err));
  }, []);

  // ── Init audio ──
  useEffect(() => {
    if (typeof window === "undefined" || audioRef.current) return;
    const audio = new Audio();
    audio.loop = true;
    audio.addEventListener("loadedmetadata", () => setDuration(audio.duration));
    audio.addEventListener("timeupdate",     () => setProgress(audio.currentTime));
    audioRef.current = audio;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaElementSource(audio).connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
    } catch (e) { console.error("AudioContext error:", e); }
  }, []);

  // ── Track change ──
  useEffect(() => {
    if (!currentTrack || !audioRef.current) return;
    const wasPlaying = isPlaying;
    audioRef.current.src = currentTrack.path;
    audioRef.current.load();
    if (wasPlaying) audioRef.current.play().catch(console.error);
  }, [currentTrack]);

  const togglePlay = useCallback(async () => {
    const ctx = analyserRef.current?.context;
    if (ctx?.state === "suspended") await ctx.resume();
    if (isPlaying) {
      audioRef.current?.pause();
    } else {
      audioRef.current?.play().catch(console.error);
      setShowOverlay(false);
    }
    setIsPlaying(p => !p);
  }, [isPlaying]);

  const playTrack = useCallback((track) => {
    setCurrentTrack(track);
    setIsPlaying(true);
    setShowOverlay(false);
    if (audioRef.current) {
      audioRef.current.src = track.path;
      audioRef.current.play().catch(console.error);
    }
  }, []);

  const skipTrack = useCallback((dir) => {
    const idx = playlist.findIndex(t => t.path === currentTrack?.path);
    const next = playlist[idx + dir];
    if (next) playTrack(next);
  }, [playlist, currentTrack, playTrack]);

  const handleSeek = (e) => {
    const t = parseFloat(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = t;
    setProgress(t);
  };

  const fmt = (t) => {
    if (!t || isNaN(t)) return "0:00";
    return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  };

  const isThreeViz = vizMode === "classic" || vizMode === "smoke";

  return (
    <div
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', background: '#000', overflow: 'hidden', zIndex: 9999 }}
      onClick={(e) => {
        // Don't toggle when clicking interactive controls themselves
        if (e.target.closest('button, input, [data-no-toggle]')) return;
        setShowControls(v => !v);
        if (showControls) setShowPlaylist(false);
      }}
    >

      {/* ── Visualizer Layer ── */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 0 }}>
        {isThreeViz ? (
          <Canvas camera={{ position: [0, 0, 1] }} style={{ display: 'block', width: '100vw', height: '100vh' }}>
            <color attach="background" args={["#000"]} />
            <Suspense fallback={null}>
              {vizMode === "classic" && <ClassicSmokeScene analyserRef={analyserRef} />}
              {vizMode === "smoke"   && <EnhancedSmokeScene analyserRef={analyserRef} />}
            </Suspense>
          </Canvas>
        ) : vizMode === "bars" ? (
          <RetroTerminal  analyserRef={analyserRef} />
        ) : (
          <BlackHoleSpace analyserRef={analyserRef} />
        )}
      </div>

      {/* ── UI Overlay ── */}
      <div className="absolute inset-0 z-50 pointer-events-none">

        {/* Enter overlay */}
        <div className={`absolute inset-0 flex items-center justify-center z-[60] transition-opacity duration-700 ${showOverlay && !isPlaying ? "opacity-100 pointer-events-auto bg-black/75" : "opacity-0 pointer-events-none"}`}>
          <button
            onClick={togglePlay}
            className="group relative px-14 py-5 rounded-full border border-white/20 bg-white/5 backdrop-blur-xl text-white text-xl font-light tracking-[0.25em] uppercase hover:bg-white/15 hover:border-white/40 transition-all duration-300 shadow-[0_0_60px_rgba(100,60,255,0.35)]"
          >
            Enter Visions
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-purple-500/20 via-cyan-500/20 to-pink-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </button>
        </div>

        {/* ── Bottom Bar: Tabs + Player ── */}
        <div
          style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, transition: 'opacity 0.4s ease, transform 0.4s ease', opacity: showControls ? 1 : 0, transform: showControls ? 'translateY(0)' : 'translateY(12px)', pointerEvents: showControls ? 'auto' : 'none' }}
        >
          <div className="bg-gradient-to-t from-black via-black/90 to-transparent px-6 pb-8 pt-16">
            <div className="max-w-2xl mx-auto flex flex-col gap-4">

              {/* Visualizer Tabs */}
              <div className="flex justify-center">
                <div className="flex items-center gap-0.5 bg-black/50 backdrop-blur-xl border border-white/10 rounded-full p-1">
                  {VISUALIZERS.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      onClick={() => setVizMode(id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-200 whitespace-nowrap ${
                        vizMode === id ? "bg-white text-black shadow" : "text-white/45 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      <Icon />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Seek bar */}
              <div className="flex items-center gap-3 group">
                <span className="text-[10px] text-white/35 font-mono w-8 text-right tabular-nums">{fmt(progress)}</span>
                <div className="flex-1 relative h-6 flex items-center">
                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-white/60 pointer-events-none"
                    style={{ width: `${duration ? (progress / duration) * 100 : 0}%` }}
                  />
                  <input
                    type="range" min="0" max={duration || 100} value={progress}
                    onChange={handleSeek}
                    className="w-full h-[3px] rounded-full appearance-none cursor-pointer bg-white/15 relative z-10
                      [&::-webkit-slider-thumb]:appearance-none
                      [&::-webkit-slider-thumb]:w-0 [&::-webkit-slider-thumb]:h-0
                      group-hover:[&::-webkit-slider-thumb]:w-3 group-hover:[&::-webkit-slider-thumb]:h-3
                      [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                      [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:shadow-md
                      transition-all"
                  />
                </div>
                <span className="text-[10px] text-white/35 font-mono w-8 tabular-nums">{fmt(duration)}</span>
              </div>

              {/* Controls row */}
              <div className="flex items-center justify-between gap-4">

                {/* Track title */}
                <div className="text-white/40 text-[11px] font-light tracking-widest uppercase truncate flex-1">
                  {currentTrack ? currentTrack.title : "No Track"}
                </div>

                {/* Playback controls */}
                <div className="flex items-center gap-5 flex-shrink-0">
                  <button onClick={() => skipTrack(-1)} disabled={!playlist.length} className="text-white/35 hover:text-white transition-colors disabled:opacity-20">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>
                  </button>
                  <button onClick={togglePlay} className="w-[50px] h-[50px] flex items-center justify-center bg-white text-black rounded-full hover:scale-105 active:scale-95 transition-all shadow-[0_0_25px_rgba(255,255,255,0.2)]">
                    {isPlaying
                      ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                      : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    }
                  </button>
                  <button onClick={() => skipTrack(1)} disabled={!playlist.length} className="text-white/35 hover:text-white transition-colors disabled:opacity-20">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
                  </button>
                </div>

                {/* Tracks button */}
                <div className="relative flex-1 flex justify-end">
                  <button
                    onClick={() => setShowPlaylist(p => !p)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all text-[11px] tracking-widest uppercase backdrop-blur-xl ${showPlaylist ? "border-white/30 bg-white/15 text-white" : "border-white/10 bg-black/30 text-white/45 hover:text-white hover:bg-white/10"}`}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    Tracks
                  </button>

                  {/* Playlist — opens upward */}
                  <div className={`absolute bottom-14 right-0 w-72 bg-black/92 backdrop-blur-2xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 ${showPlaylist ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-2 pointer-events-none"}`}>
                    <div className="px-4 py-3 border-b border-white/10 bg-white/[0.04] flex items-center justify-between">
                      <p className="text-white text-[11px] font-semibold tracking-widest uppercase">Playlist</p>
                      <span className="text-white/30 text-[10px]">{playlist.length} tracks</span>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {playlist.length > 0 ? playlist.map((track, i) => (
                        <button
                          key={i}
                          onClick={() => { playTrack(track); setShowPlaylist(false); }}
                          className={`w-full text-left px-4 py-3 flex items-center gap-3 text-sm border-b border-white/[0.05] last:border-0 transition-all ${currentTrack?.path === track.path ? "bg-white/15 text-white" : "text-white/50 hover:bg-white/[0.07] hover:text-white"}`}
                        >
                          <span className="text-[10px] font-mono opacity-35 w-5 flex-shrink-0">{i + 1}</span>
                          <span className="truncate flex-1">{track.title}</span>
                          {currentTrack?.path === track.path && (
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isPlaying ? "bg-green-400 animate-pulse" : "bg-white/40"}`} />
                          )}
                        </button>
                      )) : (
                        <div className="p-6 text-center text-white/25 text-xs italic leading-relaxed">
                          No tracks found.<br />
                          <span className="text-white/40 font-mono text-[10px]">public/music/*.mp3</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              </div>

            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
