"use client";

import React, {
  useRef, useMemo, useEffect, useState, Suspense, useCallback
} from "react";
import { Canvas, useFrame, useThree, extend } from "@react-three/fiber";
import * as THREE from "three";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const BH_RADIUS     = 2.0;
const STAR_COUNT    = 10000;
const SPAWN_RADIUS  = 90;
const PULL_STRENGTH = 0.00016;
const CURSOR_FORCE  = 10;

// Camera modes
const CAM_MODES = ["ORBIT", "ZOOM", "EDGE-ON", "FREE"];

// ─────────────────────────────────────────────────────────────────────────────
// GRAVITATIONAL LENSING — full-screen post-process quad
// Distorts UV around the BH screen position, bending background stars
// ─────────────────────────────────────────────────────────────────────────────
const lensingVert = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
`;
const lensingFrag = `
  uniform sampler2D uScene;
  uniform vec2  uBHScreen;   // BH position in NDC [-1,1]
  uniform float uBHRadius;   // screen-space radius of photon sphere
  uniform float uStrength;   // lensing strength (grows as camera nears BH)
  uniform float uTime;
  uniform float uBass;
  uniform vec2  uResolution;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;
    // Convert BH screen pos from NDC to UV
    vec2 bhUV = uBHScreen * 0.5 + 0.5;
    vec2 delta = uv - bhUV;
    // Correct for aspect ratio
    delta.x *= uResolution.x / uResolution.y;
    float dist = length(delta);

    // Lensing distortion — stronger closer to BH
    float lens = uStrength / (dist * dist + 0.001);
    lens = clamp(lens, 0.0, 0.8);

    // Bend UVs toward BH
    vec2 bentUV = uv - normalize(delta) * lens * 0.12;
    bentUV = clamp(bentUV, 0.0, 1.0);

    vec4 col = texture2D(uScene, bentUV);

    // Photon ring glow — bright ring at photon sphere radius
    float ringDist = abs(dist - uBHRadius);
    float ring = exp(-ringDist * ringDist * 800.0) * (2.5 + uBass * 2.0);
    // Doppler: left side blue, right side orange
    float side = sign(delta.x / (uResolution.x / uResolution.y));
    vec3 dopplerColor = mix(vec3(0.4, 0.7, 1.0), vec3(1.0, 0.55, 0.1), side * 0.5 + 0.5);
    col.rgb += ring * dopplerColor;

    // Secondary photon ring (dimmer, slightly larger)
    float ring2 = exp(-abs(dist - uBHRadius * 1.18) * abs(dist - uBHRadius * 1.18) * 1200.0) * 0.6;
    col.rgb += ring2 * vec3(1.0, 0.8, 0.5);

    // Event horizon — pure black disk
    float horizon = smoothstep(uBHRadius * 0.72, uBHRadius * 0.68, dist);
    col.rgb = mix(col.rgb, vec3(0.0), horizon);

    // Hawking glow at edge of horizon
    float hawking = exp(-abs(dist - uBHRadius * 0.7) * abs(dist - uBHRadius * 0.7) * 3000.0) * 0.4;
    col.rgb += hawking * vec3(0.5, 0.7, 1.0);

    // Vignette when close
    float vig = 1.0 - smoothstep(0.3, 0.9, dist) * uStrength * 0.5;
    col.rgb *= vig;

    gl_FragColor = col;
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// LENSING POST-PROCESS — renders scene to RT, then applies lensing shader
// ─────────────────────────────────────────────────────────────────────────────
function LensingPass({ audioData, camMode, zoomT }) {
  const { gl, scene, camera, size } = useThree();
  const rtRef    = useRef();
  const quadRef  = useRef();
  const matRef   = useRef();

  // Render target
  useMemo(() => {
    rtRef.current = new THREE.WebGLRenderTarget(size.width, size.height, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
  }, [size.width, size.height]);

  const uniforms = useMemo(() => ({
    uScene:      { value: null },
    uBHScreen:   { value: new THREE.Vector2(0, 0) },
    uBHRadius:   { value: 0.08 },
    uStrength:   { value: 0.0 },
    uTime:       { value: 0 },
    uBass:       { value: 0 },
    uResolution: { value: new THREE.Vector2(size.width, size.height) },
  }), [size.width, size.height]);

  useFrame(({ clock }) => {
    if (!rtRef.current || !matRef.current) return;

    // Render scene to RT
    gl.setRenderTarget(rtRef.current);
    gl.render(scene, camera);
    gl.setRenderTarget(null);

    // Project BH world pos (0,0,0) to screen
    const bhWorld = new THREE.Vector3(0, 0, 0);
    bhWorld.project(camera);
    uniforms.uBHScreen.value.set(bhWorld.x, bhWorld.y);

    // Lensing strength grows as camera nears BH
    const camDist = camera.position.length();
    const strength = Math.max(0, 1.0 - camDist / 35) * (1 + zoomT.current * 2.5);
    uniforms.uStrength.value += (strength - uniforms.uStrength.value) * 0.05;

    // Photon sphere screen radius (approximate)
    const fovRad = (camera.fov * Math.PI) / 180;
    const projRadius = (BH_RADIUS * 1.5 / camDist) / Math.tan(fovRad / 2) * 0.5;
    uniforms.uBHRadius.value = projRadius;

    uniforms.uScene.value = rtRef.current.texture;
    uniforms.uTime.value  = clock.getElapsedTime();

    let bass = 0;
    if (audioData.current) {
      const d = audioData.current;
      bass = d.slice(0, 8).reduce((a,b)=>a+b,0) / 8 / 255;
    }
    uniforms.uBass.value = bass;
    uniforms.uResolution.value.set(size.width, size.height);
  });

  return (
    <mesh ref={quadRef} position={[0, 0, 0]} renderOrder={999} frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={lensingVert}
        fragmentShader={lensingFrag}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCRETION DISK — Doppler-shifted, multi-layer, volumetric
// ─────────────────────────────────────────────────────────────────────────────
const diskVert = `
  varying vec2 vUv;
  varying float vDist;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vDist = length(position.xz);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const diskFrag = `
  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform vec3  uCamPos;
  varying vec2  vUv;
  varying float vDist;
  varying vec3  vWorldPos;

  void main() {
    float inner = ${(BH_RADIUS * 1.5).toFixed(1)}, outer = 9.0;
    float t = (vDist - inner) / (outer - inner);
    if (t < 0.0 || t > 1.0) discard;

    float fade = smoothstep(0.0, 0.12, t) * smoothstep(1.0, 0.55, t);

    // Swirling turbulence
    float angle = atan(vWorldPos.z, vWorldPos.x);
    float swirl  = sin(angle * 6.0 - uTime * 2.5 + vDist * 1.0) * 0.5 + 0.5;
    float swirl2 = sin(angle * 3.0 + uTime * 1.2 - vDist * 0.6) * 0.5 + 0.5;
    float turb   = sin(angle * 12.0 - uTime * 4.0 + vDist * 2.0) * 0.3 + 0.7;

    // Heat gradient: white-hot core → orange → deep red
    vec3 white  = vec3(1.0, 0.98, 0.92);
    vec3 orange = vec3(1.0, 0.45, 0.05);
    vec3 red    = vec3(0.7, 0.06, 0.0);
    vec3 dark   = vec3(0.15, 0.01, 0.0);
    vec3 color  = mix(white, orange, smoothstep(0.0, 0.3, t));
    color = mix(color, red,  smoothstep(0.3, 0.7, t));
    color = mix(color, dark, smoothstep(0.7, 1.0, t));
    color += swirl * 0.12 * (1.0 - t);
    color *= turb;

    // Doppler brightening: approaching side (positive x relative to cam) brighter
    vec3 toCenter = normalize(-vWorldPos);
    vec3 camDir   = normalize(uCamPos);
    float doppler = dot(normalize(vWorldPos.xz), camDir.xz);
    float dopplerFactor = 1.0 + doppler * 0.7;
    // Blue-shift approaching side, red-shift receding
    vec3 blueShift = vec3(0.8, 0.9, 1.2);
    vec3 redShift  = vec3(1.3, 0.8, 0.6);
    vec3 dopplerColor = mix(redShift, blueShift, doppler * 0.5 + 0.5);
    color *= dopplerColor * dopplerFactor;

    // Audio bass pulse
    color *= 1.0 + uBass * 0.8;
    float alpha = fade * (0.75 + swirl * 0.25) * (0.85 + uBass * 0.35);

    gl_FragColor = vec4(color, alpha);
  }
`;

function AccretionDisk({ audioData }) {
  const matRef  = useRef();
  const meshRef = useRef();
  const uniforms = useMemo(() => ({
    uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 },
    uCamPos: { value: new THREE.Vector3(0, 3, 28) },
  }), []);

  useFrame(({ clock, camera }) => {
    if (!matRef.current) return;
    uniforms.uTime.value = clock.getElapsedTime();
    uniforms.uCamPos.value.copy(camera.position);
    let bass = 0, mid = 0;
    if (audioData.current) {
      const d = audioData.current;
      bass = d.slice(0, 8).reduce((a,b)=>a+b,0) / 8 / 255;
      mid  = d.slice(20, 60).reduce((a,b)=>a+b,0) / 40 / 255;
    }
    uniforms.uBass.value = bass;
    uniforms.uMid.value  = mid;
    if (meshRef.current) meshRef.current.rotation.y += 0.002 + bass * 0.015;
  });

  return (
    <group rotation={[Math.PI * 0.05, 0, 0]}>
      {/* Main disk */}
      <mesh ref={meshRef}>
        <torusGeometry args={[5.5, 3.5, 3, 512]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={diskVert}
          fragmentShader={diskFrag}
          uniforms={uniforms}
          transparent depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {/* Inner hot ring */}
      <mesh rotation={[0, 0, 0]}>
        <torusGeometry args={[BH_RADIUS * 1.6, 0.35, 8, 256]} />
        <meshBasicMaterial
          color={new THREE.Color(4, 2.5, 1.0)}
          transparent opacity={0.9}
          blending={THREE.AdditiveBlending} depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BLACK HOLE MESH — event horizon + photon rings + rim glow
// ─────────────────────────────────────────────────────────────────────────────
const bhGlowFrag = `
  uniform float uBass;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vViewDir)));
    rim = pow(rim, 2.2);
    vec3 col = mix(vec3(1.0, 0.55, 0.05), vec3(0.6, 0.15, 1.0), rim);
    gl_FragColor = vec4(col, rim * (0.7 + uBass * 0.5));
  }
`;
const bhGlowVert = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal  = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

function BlackHoleMesh({ audioData }) {
  const ring1Ref = useRef(), ring2Ref = useRef(), ring3Ref = useRef(), haloRef = useRef();
  const uniforms = useMemo(() => ({ uBass: { value: 0 } }), []);

  useFrame(() => {
    let bass = 0;
    if (audioData.current) {
      const d = audioData.current;
      bass = d.slice(0, 8).reduce((a,b)=>a+b,0) / 8 / 255;
    }
    uniforms.uBass.value = bass;
    if (ring1Ref.current) { ring1Ref.current.material.opacity = 0.85 + bass * 0.15; ring1Ref.current.scale.setScalar(1 + bass * 0.06); }
    if (ring2Ref.current) { ring2Ref.current.material.opacity = 0.5  + bass * 0.3;  ring2Ref.current.scale.setScalar(1 + bass * 0.04); }
    if (ring3Ref.current) { ring3Ref.current.material.opacity = 0.25 + bass * 0.2;  ring3Ref.current.scale.setScalar(1 + bass * 0.02); }
    if (haloRef.current)  { haloRef.current.material.opacity  = 0.12 + bass * 0.25; haloRef.current.scale.setScalar(1 + bass * 0.15); }
  });

  return (
    <group>
      {/* Event horizon — pure black */}
      <mesh renderOrder={10}>
        <sphereGeometry args={[BH_RADIUS, 64, 64]} />
        <meshBasicMaterial color="#000000" depthWrite />
      </mesh>

      {/* Rim glow shader */}
      <mesh>
        <sphereGeometry args={[BH_RADIUS * 1.03, 64, 64]} />
        <shaderMaterial
          vertexShader={bhGlowVert} fragmentShader={bhGlowFrag}
          uniforms={uniforms} transparent depthWrite={false}
          side={THREE.BackSide} blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Photon ring — primary (brightest) */}
      <mesh ref={ring1Ref}>
        <torusGeometry args={[BH_RADIUS * 1.5, 0.06, 16, 512]} />
        <meshBasicMaterial
          color={new THREE.Color(5, 3, 0.8)}
          transparent opacity={0.9}
          blending={THREE.AdditiveBlending} depthWrite={false}
        />
      </mesh>

      {/* Photon ring — secondary image (slightly larger, dimmer) */}
      <mesh ref={ring2Ref}>
        <torusGeometry args={[BH_RADIUS * 1.62, 0.04, 16, 512]} />
        <meshBasicMaterial
          color={new THREE.Color(3, 1.8, 0.5)}
          transparent opacity={0.5}
          blending={THREE.AdditiveBlending} depthWrite={false}
        />
      </mesh>

      {/* Photon ring — tertiary image */}
      <mesh ref={ring3Ref}>
        <torusGeometry args={[BH_RADIUS * 1.72, 0.025, 16, 512]} />
        <meshBasicMaterial
          color={new THREE.Color(1.5, 0.9, 0.3)}
          transparent opacity={0.25}
          blending={THREE.AdditiveBlending} depthWrite={false}
        />
      </mesh>

      {/* Outer purple halo */}
      <mesh ref={haloRef}>
        <sphereGeometry args={[BH_RADIUS * 4, 32, 32]} />
        <meshBasicMaterial
          color={new THREE.Color(0.25, 0.04, 0.9)}
          transparent opacity={0.14}
          blending={THREE.AdditiveBlending} depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAR PARTICLES — instanced, gravitationally pulled, lensed near BH
// ─────────────────────────────────────────────────────────────────────────────
function StarParticles({ audioData, cursorWorld }) {
  const meshRef = useRef();
  const dummy   = useMemo(() => new THREE.Object3D(), []);

  const state = useMemo(() => {
    const pos    = new Float32Array(STAR_COUNT * 3);
    const vel    = new Float32Array(STAR_COUNT * 3);
    const sizes  = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = 15 + Math.random() * (SPAWN_RADIUS - 15);
      pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
      pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta) * 0.35;
      pos[i*3+2] = r * Math.cos(phi);
      const speed = Math.sqrt(PULL_STRENGTH * 60 / r) * r * 0.6;
      vel[i*3]   = -Math.sin(theta) * speed;
      vel[i*3+1] = (Math.random() - 0.5) * 0.02;
      vel[i*3+2] =  Math.cos(theta) * speed;
      sizes[i]   = 0.035 + Math.random() * 0.1;
    }
    return { pos, vel, sizes };
  }, []);

  const respawn = useCallback((i) => {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = SPAWN_RADIUS * (0.7 + Math.random() * 0.3);
    state.pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
    state.pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta) * 0.35;
    state.pos[i*3+2] = r * Math.cos(phi);
    const speed = Math.sqrt(PULL_STRENGTH * 60 / r) * r * 0.5;
    state.vel[i*3]   = -Math.sin(theta) * speed;
    state.vel[i*3+1] = (Math.random() - 0.5) * 0.01;
    state.vel[i*3+2] =  Math.cos(theta) * speed;
  }, [state]);

  useFrame(() => {
    if (!meshRef.current) return;
    let bass = 0, avg = 0;
    if (audioData.current) {
      const d = audioData.current;
      bass = d.slice(0, 8).reduce((a,b)=>a+b,0) / 8 / 255;
      avg  = d.reduce((a,b)=>a+b,0) / d.length / 255;
    }
    const pull = PULL_STRENGTH * (1 + bass * 4);
    const cx = cursorWorld.current.x, cy = cursorWorld.current.y;

    for (let i = 0; i < STAR_COUNT; i++) {
      const ix = i*3, iy = i*3+1, iz = i*3+2;
      const px = state.pos[ix], py = state.pos[iy], pz = state.pos[iz];
      const dist2 = px*px + py*py + pz*pz;
      const dist  = Math.sqrt(dist2) + 0.001;
      if (dist < BH_RADIUS * 0.75) { respawn(i); continue; }
      const f = pull / dist2;
      state.vel[ix] -= (px/dist)*f; state.vel[iy] -= (py/dist)*f*0.3; state.vel[iz] -= (pz/dist)*f;
      const cdx = px-cx, cdz = pz-cy, cd2 = cdx*cdx+cdz*cdz+1;
      const cf = CURSOR_FORCE/(cd2*Math.sqrt(cd2));
      state.vel[ix] += cdx*cf; state.vel[iz] += cdz*cf;
      state.vel[ix] *= 0.998; state.vel[iy] *= 0.995; state.vel[iz] *= 0.998;
      state.pos[ix] += state.vel[ix]; state.pos[iy] += state.vel[iy]; state.pos[iz] += state.vel[iz];
      if (dist > SPAWN_RADIUS * 1.3) respawn(i);
      const s = state.sizes[i] * (1 + avg * 0.5) * (1 + bass * 0.8 * (1 - dist/SPAWN_RADIUS));
      dummy.position.set(state.pos[ix], state.pos[iy], state.pos[iz]);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      const proximity = Math.max(0, 1 - dist/30);
      meshRef.current.setColorAt(i, new THREE.Color(1, 1 - proximity*0.7, 1 - proximity));
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, STAR_COUNT]} frustumCulled={false}>
      <sphereGeometry args={[1, 4, 4]} />
      <meshBasicMaterial color="#ffffff" blending={THREE.AdditiveBlending} depthWrite={false} transparent opacity={0.9} />
    </instancedMesh>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND STAR FIELD
// ─────────────────────────────────────────────────────────────────────────────
function BackgroundStars({ audioData }) {
  const ref = useRef();
  const { positions, colors } = useMemo(() => {
    const N = 6000;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const theta = Math.random() * Math.PI * 2, phi = Math.acos(2*Math.random()-1);
      const r = 95 + Math.random() * 55;
      pos[i*3] = r*Math.sin(phi)*Math.cos(theta); pos[i*3+1] = r*Math.sin(phi)*Math.sin(theta); pos[i*3+2] = r*Math.cos(phi);
      const t = Math.random();
      col[i*3] = 0.7+t*0.3; col[i*3+1] = 0.8+t*0.15; col[i*3+2] = 1.0;
    }
    return { positions: pos, colors: col };
  }, []);

  useFrame(() => {
    if (!ref.current) return;
    let bass = 0;
    if (audioData.current) { const d = audioData.current; bass = d.slice(0,8).reduce((a,b)=>a+b,0)/8/255; }
    ref.current.material.size    = 0.22 + bass * 0.3;
    ref.current.material.opacity = 0.65 + bass * 0.35;
    ref.current.rotation.y += 0.00006;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color"    args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.22} vertexColors transparent opacity={0.7} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NEBULA
// ─────────────────────────────────────────────────────────────────────────────
const nebulaFrag = `
  uniform float uTime; uniform float uBass; uniform vec3 uColor; varying vec2 vUv;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
  float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.1;a*=0.5;}return v;}
  void main(){
    vec2 uv=vUv-0.5;
    float n=fbm(uv*2.5+uTime*0.035),n2=fbm(uv*1.8-uTime*0.022+3.7);
    float cloud=smoothstep(0.3,0.7,n*n2*2.5);
    float fade=1.0-smoothstep(0.2,0.5,length(uv));
    gl_FragColor=vec4(uColor*cloud*fade*(0.5+uBass*0.5),cloud*fade*0.16);
  }
`;
const nebulaVert = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

function Nebula({ audioData }) {
  const layers = useMemo(() => [
    { pos: [22,5,-65],  rot:[0.1,0.2,0],   color:new THREE.Color(0.3,0.0,0.8), size:85 },
    { pos: [-28,-8,-72],rot:[-0.1,-0.15,0], color:new THREE.Color(0.8,0.1,0.4), size:75 },
    { pos: [5,16,-58],  rot:[0.05,0.1,0.1], color:new THREE.Color(0.0,0.4,0.9), size:95 },
  ], []);
  const uniformsList = useMemo(() => layers.map(l => ({ uTime:{value:0}, uBass:{value:0}, uColor:{value:l.color} })), [layers]);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    let bass = 0;
    if (audioData.current) { const d = audioData.current; bass = d.slice(0,8).reduce((a,b)=>a+b,0)/8/255; }
    uniformsList.forEach(u => { u.uTime.value=t; u.uBass.value=bass; });
  });
  return (
    <>{layers.map((l,i) => (
      <mesh key={i} position={l.pos} rotation={l.rot}>
        <planeGeometry args={[l.size,l.size]} />
        <shaderMaterial vertexShader={nebulaVert} fragmentShader={nebulaFrag} uniforms={uniformsList[i]} transparent depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
    ))}</>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVEFORM RING
// ─────────────────────────────────────────────────────────────────────────────
function WaveformRing({ audioData }) {
  const ref = useRef();
  const COUNT = 256;
  const positions = useMemo(() => new Float32Array(COUNT * 3), []);
  useFrame(() => {
    if (!ref.current) return;
    const d = audioData.current;
    const pos = ref.current.geometry.attributes.position.array;
    for (let i = 0; i < COUNT; i++) {
      const angle = (i/COUNT)*Math.PI*2, amp = d ? (d[i]/255)*2.8 : 0, r = 6.0+amp;
      pos[i*3]=Math.cos(angle)*r; pos[i*3+1]=amp*0.1; pos[i*3+2]=Math.sin(angle)*r;
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
    let bass = 0;
    if (d) bass = d.slice(0,8).reduce((a,b)=>a+b,0)/8/255;
    ref.current.material.opacity = 0.25 + bass * 0.55;
  });
  return (
    <lineLoop ref={ref} rotation={[Math.PI*0.05,0,0]}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions,3]} count={COUNT} /></bufferGeometry>
      <lineBasicMaterial color={new THREE.Color(0.4,0.85,1.0)} transparent opacity={0.35} blending={THREE.AdditiveBlending} />
    </lineLoop>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CURSOR RIPPLES
// ─────────────────────────────────────────────────────────────────────────────
function CursorRipples({ ripples }) {
  const refs = useRef([]);
  useFrame(() => {
    ripples.current = ripples.current.filter(r => r.life > 0);
    ripples.current.forEach((r,i) => {
      r.life -= 0.018; r.scale += 0.18;
      if (refs.current[i]) { refs.current[i].scale.setScalar(r.scale); refs.current[i].material.opacity = r.life * 0.55; }
    });
  });
  return (
    <>{ripples.current.map((r,i) => (
      <mesh key={r.id} ref={el=>refs.current[i]=el} position={[r.x,0,r.z]}>
        <ringGeometry args={[0.8,1.0,32]} />
        <meshBasicMaterial color={new THREE.Color(0.4,0.85,1.0)} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    ))}</>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMERA RIG — 4 modes: ORBIT, ZOOM, EDGE-ON, FREE
// ─────────────────────────────────────────────────────────────────────────────
function CameraRig({ audioData, cursorNDC, camMode, zoomT, isDragging, dragDelta, scrollDelta }) {
  const { camera } = useThree();
  const smooth = useRef({ x: 0, y: 0 });
  const freeAngles = useRef({ theta: 0, phi: Math.PI / 4 });
  const freeRadius = useRef(28);
  const zoomProgress = useRef(0);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    let bass = 0;
    if (audioData.current) { const d = audioData.current; bass = d.slice(0,8).reduce((a,b)=>a+b,0)/8/255; }

    smooth.current.x += (cursorNDC.current.x - smooth.current.x) * 0.03;
    smooth.current.y += (cursorNDC.current.y - smooth.current.y) * 0.03;

    const mode = camMode.current;

    if (mode === "ORBIT") {
      const orbit = t * 0.035;
      const baseZ = 28 - bass * 3;
      camera.position.x = Math.sin(orbit)*5 + smooth.current.x*6;
      camera.position.y = Math.cos(orbit*0.5)*2.5 - smooth.current.y*3 + 3;
      camera.position.z = Math.cos(orbit)*5 + baseZ;
      camera.lookAt(0, 0, 0);
      zoomT.current = 0;
    }

    else if (mode === "ZOOM") {
      // Cinematic dolly toward event horizon and back
      zoomProgress.current = (zoomProgress.current + 0.004) % (Math.PI * 2);
      const zp = zoomProgress.current;
      const dist = 28 - Math.sin(zp * 0.5) * 22; // oscillates 6 → 28
      zoomT.current = Math.max(0, 1 - dist / 28);
      const orbit = t * 0.015;
      camera.position.x = Math.sin(orbit) * dist * 0.15 + smooth.current.x * 3;
      camera.position.y = 2 + Math.sin(t*0.2)*1.5 - smooth.current.y*2;
      camera.position.z = dist;
      camera.lookAt(0, 0, 0);
    }

    else if (mode === "EDGE-ON") {
      // Camera in the equatorial plane, looking at BH from the side
      const orbit = t * 0.025;
      const dist  = 22 - bass * 3;
      camera.position.x = Math.sin(orbit) * dist;
      camera.position.y = 0.5 + smooth.current.y * 2;
      camera.position.z = Math.cos(orbit) * dist;
      camera.lookAt(0, 0, 0);
      zoomT.current = Math.max(0, 1 - dist / 28);
    }

    else if (mode === "FREE") {
      // Mouse drag to orbit, scroll to zoom
      if (isDragging.current) {
        freeAngles.current.theta -= dragDelta.current.x * 0.008;
        freeAngles.current.phi   = Math.max(0.1, Math.min(Math.PI - 0.1,
          freeAngles.current.phi + dragDelta.current.y * 0.008));
        dragDelta.current = { x: 0, y: 0 };
      }
      freeRadius.current = Math.max(4, Math.min(80, freeRadius.current - scrollDelta.current * 0.05));
      scrollDelta.current = 0;

      const r = freeRadius.current - bass * 2;
      camera.position.x = r * Math.sin(freeAngles.current.phi) * Math.sin(freeAngles.current.theta);
      camera.position.y = r * Math.cos(freeAngles.current.phi);
      camera.position.z = r * Math.sin(freeAngles.current.phi) * Math.cos(freeAngles.current.theta);
      camera.lookAt(0, 0, 0);
      zoomT.current = Math.max(0, 1 - r / 28);
    }
  });

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENE
// ─────────────────────────────────────────────────────────────────────────────
function Scene({ audioData, cursorWorld, cursorNDC, ripples, camMode, zoomT, isDragging, dragDelta, scrollDelta }) {
  return (
    <>
      <color attach="background" args={["#000002"]} />
      <ambientLight intensity={0.02} />
      <pointLight position={[0,0,0]} intensity={8}  color="#ff6010" distance={35} decay={2} />
      <pointLight position={[0,4,0]} intensity={2.5} color="#8833ff" distance={55} decay={2} />
      <CameraRig audioData={audioData} cursorNDC={cursorNDC} camMode={camMode} zoomT={zoomT} isDragging={isDragging} dragDelta={dragDelta} scrollDelta={scrollDelta} />
      <Nebula audioData={audioData} />
      <BackgroundStars audioData={audioData} />
      <AccretionDisk audioData={audioData} />
      <BlackHoleMesh audioData={audioData} />
      <StarParticles audioData={audioData} cursorWorld={cursorWorld} />
      <WaveformRing audioData={audioData} />
      <CursorRipples ripples={ripples} />
      <LensingPass audioData={audioData} camMode={camMode} zoomT={zoomT} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function BlackHoleUniverse() {
  const audioData   = useRef(new Uint8Array(256));
  const audioCtxRef = useRef(null);
  const sourceRef   = useRef(null);
  const streamRef   = useRef(null);
  const rafRef      = useRef(null);
  const cursorWorld = useRef({ x: 0, y: 0 });
  const cursorNDC   = useRef({ x: 0, y: 0 });
  const ripples     = useRef([]);
  const rippleId    = useRef(0);
  const camMode     = useRef("ORBIT");
  const zoomT       = useRef(0);
  const isDragging  = useRef(false);
  const dragDelta   = useRef({ x: 0, y: 0 });
  const scrollDelta = useRef(0);
  const lastMouse   = useRef({ x: 0, y: 0 });

  const [audioMode,    setAudioMode]    = useState("idle");
  const [showPicker,   setShowPicker]   = useState(false);
  const [error,        setError]        = useState(null);
  const [activeCamMode, setActiveCamMode] = useState("ORBIT");

  // ── Audio helpers ──
  const stopAudio = useCallback(() => {
    if (rafRef.current)    cancelAnimationFrame(rafRef.current);
    if (sourceRef.current) { try { sourceRef.current.disconnect(); } catch {} }
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} }
    audioCtxRef.current = sourceRef.current = streamRef.current = rafRef.current = null;
    audioData.current.fill(0);
    setAudioMode("idle");
  }, []);

  const connectStream = useCallback((stream) => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);
    audioCtxRef.current = ctx; sourceRef.current = source; streamRef.current = stream;
    const read = () => { analyser.getByteFrequencyData(audioData.current); rafRef.current = requestAnimationFrame(read); };
    read();
  }, []);

  const startMic = useCallback(async () => {
    stopAudio(); setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      connectStream(stream); setAudioMode("mic"); setShowPicker(false);
    } catch { setError("Microphone access denied."); }
  }, [stopAudio, connectStream]);

  const startSystem = useCallback(async () => {
    stopAudio(); setError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 44100 },
      });
      stream.getVideoTracks().forEach(t => t.stop());
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) { setError("No audio track. Tick 'Share tab audio' in the prompt."); stream.getTracks().forEach(t=>t.stop()); return; }
      const audioOnly = new MediaStream(audioTracks);
      connectStream(audioOnly); setAudioMode("system"); setShowPicker(false);
      audioTracks[0].addEventListener("ended", stopAudio);
    } catch (e) { if (e.name !== "NotAllowedError") setError("Could not capture system audio."); }
  }, [stopAudio, connectStream]);

  // ── Camera mode switch ──
  const switchCamMode = useCallback((mode) => {
    camMode.current = mode;
    setActiveCamMode(mode);
  }, []);

  // ── Mouse / touch events ──
  useEffect(() => {
    const onMove = (e) => {
      const nx = (e.clientX/window.innerWidth - 0.5)*2;
      const ny = (e.clientY/window.innerHeight - 0.5)*2;
      cursorNDC.current   = { x: nx, y: ny };
      cursorWorld.current = { x: nx*30, y: -ny*20 };
      if (isDragging.current) {
        dragDelta.current.x += e.clientX - lastMouse.current.x;
        dragDelta.current.y += e.clientY - lastMouse.current.y;
      }
      lastMouse.current = { x: e.clientX, y: e.clientY };
    };
    const onDown = (e) => { isDragging.current = true; lastMouse.current = { x: e.clientX, y: e.clientY }; };
    const onUp   = ()  => { isDragging.current = false; };
    const onWheel = (e) => { scrollDelta.current += e.deltaY; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup",   onUp);
    window.addEventListener("wheel",     onWheel, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup",   onUp);
      window.removeEventListener("wheel",     onWheel);
    };
  }, []);

  const handleClick = useCallback((e) => {
    if (e.target.closest("[data-ui]")) return;
    const nx = (e.clientX/window.innerWidth - 0.5)*2;
    const ny = (e.clientY/window.innerHeight - 0.5)*2;
    ripples.current.push({ id: rippleId.current++, x: nx*30, z: -ny*20, scale: 1, life: 1 });
  }, []);

  useEffect(() => () => stopAudio(), [stopAudio]);

  const modeLabel = audioMode === "mic" ? "MIC" : audioMode === "system" ? "SYSTEM AUDIO" : null;
  const modeColor = audioMode === "mic" ? "#64ff96" : "#60c8ff";

  return (
    <div
      style={{ position:"fixed", inset:0, width:"100vw", height:"100vh", background:"#000002", overflow:"hidden", cursor: activeCamMode==="FREE"?"grab":"crosshair", zIndex:9999 }}
      onClick={handleClick}
    >
      <Canvas
        style={{ display:"block", width:"100vw", height:"100vh" }}
        camera={{ position:[0,3,28], fov:55 }}
        gl={{ antialias:true, toneMapping:THREE.ACESFilmicToneMapping, toneMappingExposure:1.8 }}
      >
        <Suspense fallback={null}>
          <Scene
            audioData={audioData} cursorWorld={cursorWorld} cursorNDC={cursorNDC}
            ripples={ripples} camMode={camMode} zoomT={zoomT}
            isDragging={isDragging} dragDelta={dragDelta} scrollDelta={scrollDelta}
          />
        </Suspense>
      </Canvas>

      {/* ── Back button ── */}
      <a href="/" data-ui onClick={e=>e.stopPropagation()} style={{
        position:"fixed",top:24,left:24,zIndex:200,display:"flex",alignItems:"center",gap:8,
        color:"rgba(255,255,255,0.55)",fontSize:13,fontFamily:"monospace",textDecoration:"none",
        padding:"8px 16px",border:"1px solid rgba(255,255,255,0.12)",borderRadius:999,
        background:"rgba(0,0,0,0.4)",backdropFilter:"blur(12px)",transition:"color 0.2s,border-color 0.2s",
      }}
        onMouseEnter={e=>{e.currentTarget.style.color="#fff";e.currentTarget.style.borderColor="rgba(255,255,255,0.35)";}}
        onMouseLeave={e=>{e.currentTarget.style.color="rgba(255,255,255,0.55)";e.currentTarget.style.borderColor="rgba(255,255,255,0.12)";}}
      >← Back</a>

      {/* ── Title ── */}
      <div data-ui style={{ position:"fixed",top:24,left:"50%",transform:"translateX(-50%)",zIndex:200,textAlign:"center",pointerEvents:"none" }}>
        <div style={{ color:"rgba(255,255,255,0.7)",fontSize:11,fontFamily:"monospace",letterSpacing:"0.3em",textTransform:"uppercase" }}>SINGULARITY</div>
      </div>

      {/* ── Camera mode buttons ── */}
      <div data-ui onClick={e=>e.stopPropagation()} style={{
        position:"fixed",top:24,right:24,zIndex:200,
        display:"flex",flexDirection:"column",gap:6,
      }}>
        {CAM_MODES.map(mode => (
          <button key={mode} onClick={()=>switchCamMode(mode)} style={{
            padding:"7px 14px",fontFamily:"monospace",fontSize:10,letterSpacing:"0.12em",
            cursor:"pointer",borderRadius:999,transition:"all 0.2s",
            background: activeCamMode===mode ? "rgba(255,200,80,0.18)" : "rgba(0,0,0,0.45)",
            border: activeCamMode===mode ? "1px solid rgba(255,200,80,0.5)" : "1px solid rgba(255,255,255,0.1)",
            color: activeCamMode===mode ? "#ffc850" : "rgba(255,255,255,0.4)",
            backdropFilter:"blur(10px)",
          }}>
            {mode}
          </button>
        ))}
        {activeCamMode === "FREE" && (
          <div style={{ color:"rgba(255,255,255,0.25)",fontFamily:"monospace",fontSize:9,textAlign:"center",marginTop:4 }}>
            DRAG · SCROLL
          </div>
        )}
      </div>

      {/* ── Audio source picker modal ── */}
      {showPicker && (
        <div data-ui onClick={e=>e.stopPropagation()} style={{
          position:"fixed",inset:0,zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",
          background:"rgba(0,0,0,0.65)",backdropFilter:"blur(8px)",
        }}>
          <div style={{
            background:"rgba(5,5,15,0.97)",border:"1px solid rgba(255,255,255,0.12)",
            borderRadius:16,padding:"32px 40px",display:"flex",flexDirection:"column",alignItems:"center",gap:20,minWidth:320,
          }}>
            <div style={{ color:"rgba(255,255,255,0.8)",fontFamily:"monospace",fontSize:12,letterSpacing:"0.25em" }}>SELECT AUDIO SOURCE</div>
            <button onClick={startMic} style={{
              width:"100%",padding:"14px 24px",background:"rgba(100,255,150,0.08)",
              border:"1px solid rgba(100,255,150,0.3)",borderRadius:10,cursor:"pointer",
              color:"#64ff96",fontFamily:"monospace",fontSize:12,letterSpacing:"0.15em",
              display:"flex",alignItems:"center",gap:12,transition:"background 0.2s",
            }}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(100,255,150,0.18)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(100,255,150,0.08)"}
            >
              <span style={{fontSize:20}}>🎙️</span>
              <div style={{textAlign:"left"}}><div>MICROPHONE</div><div style={{fontSize:10,opacity:0.5,marginTop:3}}>React to your voice or nearby music</div></div>
            </button>
            <button onClick={startSystem} style={{
              width:"100%",padding:"14px 24px",background:"rgba(96,200,255,0.08)",
              border:"1px solid rgba(96,200,255,0.3)",borderRadius:10,cursor:"pointer",
              color:"#60c8ff",fontFamily:"monospace",fontSize:12,letterSpacing:"0.15em",
              display:"flex",alignItems:"center",gap:12,transition:"background 0.2s",
            }}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(96,200,255,0.18)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(96,200,255,0.08)"}
            >
              <span style={{fontSize:20}}>🔊</span>
              <div style={{textAlign:"left"}}><div>SYSTEM AUDIO</div><div style={{fontSize:10,opacity:0.5,marginTop:3}}>Capture audio from a browser tab or app</div></div>
            </button>
            <button onClick={()=>setShowPicker(false)} style={{ background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,0.3)",fontFamily:"monospace",fontSize:11,letterSpacing:"0.1em" }}>CANCEL</button>
            {error && <div style={{ color:"#ff6060",fontFamily:"monospace",fontSize:10,textAlign:"center",maxWidth:260 }}>{error}</div>}
          </div>
        </div>
      )}

      {/* ── Active audio indicator ── */}
      {audioMode !== "idle" && (
        <div data-ui onClick={e=>e.stopPropagation()} style={{
          position:"fixed",bottom:24,right:24,zIndex:200,display:"flex",alignItems:"center",gap:10,
          background:"rgba(0,0,0,0.5)",backdropFilter:"blur(10px)",
          border:`1px solid ${modeColor}33`,borderRadius:999,padding:"8px 14px",
        }}>
          <div style={{ width:6,height:6,borderRadius:"50%",background:modeColor,animation:"pulse 1.2s ease-in-out infinite" }} />
          <span style={{ color:modeColor,fontFamily:"monospace",fontSize:10,letterSpacing:"0.15em" }}>{modeLabel}</span>
          <button onClick={()=>{stopAudio();setShowPicker(true);}} style={{ background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:999,padding:"3px 10px",cursor:"pointer",color:"rgba(255,255,255,0.5)",fontFamily:"monospace",fontSize:9,letterSpacing:"0.1em" }}>SWITCH</button>
          <button onClick={stopAudio} style={{ background:"rgba(255,60,60,0.1)",border:"1px solid rgba(255,60,60,0.2)",borderRadius:999,padding:"3px 10px",cursor:"pointer",color:"rgba(255,100,100,0.7)",fontFamily:"monospace",fontSize:9,letterSpacing:"0.1em" }}>STOP</button>
        </div>
      )}

      {/* ── Idle hint + ACTIVATE button ── */}
      {audioMode === "idle" && !showPicker && (
        <div data-ui onClick={e=>e.stopPropagation()} style={{ position:"fixed",bottom:36,left:"50%",transform:"translateX(-50%)",zIndex:200,textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:14,animation:"fadeInUp 1s ease forwards" }}>
          <button
            onClick={()=>setShowPicker(true)}
            style={{
              padding:"13px 32px",
              fontFamily:"monospace",fontSize:12,letterSpacing:"0.2em",
              cursor:"pointer",borderRadius:999,
              background:"rgba(255,160,40,0.12)",
              border:"1px solid rgba(255,160,40,0.45)",
              color:"#ffb040",
              backdropFilter:"blur(12px)",
              boxShadow:"0 0 24px rgba(255,140,20,0.25), inset 0 0 12px rgba(255,140,20,0.08)",
              transition:"all 0.25s",
            }}
            onMouseEnter={e=>{ e.currentTarget.style.background="rgba(255,160,40,0.22)"; e.currentTarget.style.boxShadow="0 0 40px rgba(255,140,20,0.45), inset 0 0 16px rgba(255,140,20,0.14)"; }}
            onMouseLeave={e=>{ e.currentTarget.style.background="rgba(255,160,40,0.12)"; e.currentTarget.style.boxShadow="0 0 24px rgba(255,140,20,0.25), inset 0 0 12px rgba(255,140,20,0.08)"; }}
          >
            ◉ &nbsp;ACTIVATE AUDIO REACTIVITY
          </button>
          <div style={{ color:"rgba(255,255,255,0.18)",fontSize:10,fontFamily:"monospace",pointerEvents:"none" }}>USE CAMERA MODES TOP-RIGHT · FREE MODE: DRAG + SCROLL TO ZOOM</div>
        </div>
      )}

      <style>{`
        @keyframes fadeInUp { from{opacity:0;transform:translateX(-50%) translateY(10px);}to{opacity:1;transform:translateX(-50%) translateY(0);} }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1);}50%{opacity:0.4;transform:scale(0.7);} }
      `}</style>
    </div>
  );
}
