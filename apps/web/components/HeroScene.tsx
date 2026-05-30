"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Float, MeshDistortMaterial, Stars } from "@react-three/drei";
import { useRef } from "react";
import type { Mesh } from "three";

function CoreOrb() {
  const ref = useRef<Mesh>(null);
  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.x = state.clock.elapsedTime * 0.15;
      ref.current.rotation.y = state.clock.elapsedTime * 0.22;
    }
  });

  return (
    <Float speed={2} rotationIntensity={0.4} floatIntensity={1.2}>
      <mesh ref={ref} scale={2.2}>
        <icosahedronGeometry args={[1, 4]} />
        <MeshDistortMaterial
          color="#6b6b78"
          emissive="#2a2a32"
          roughness={0.2}
          metalness={0.9}
          distort={0.45}
          speed={2.5}
        />
      </mesh>
    </Float>
  );
}

function Ring() {
  const ref = useRef<Mesh>(null);
  useFrame((state) => {
    if (ref.current) ref.current.rotation.z = state.clock.elapsedTime * 0.35;
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2.2, 0, 0]}>
      <torusGeometry args={[3.2, 0.04, 16, 120]} />
      <meshStandardMaterial color="#888894" metalness={1} roughness={0.15} />
    </mesh>
  );
}

function Particles() {
  return <Stars radius={80} depth={40} count={4000} factor={3} saturation={0} fade speed={0.8} />;
}

export default function HeroScene() {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
      <Canvas camera={{ position: [0, 0, 8], fov: 50 }} dpr={[1, 2]}>
        <color attach="background" args={["#0a0a0b"]} />
        <ambientLight intensity={0.35} />
        <pointLight position={[6, 6, 6]} intensity={1.2} color="#d0d0d8" />
        <pointLight position={[-4, -2, 4]} intensity={0.5} color="#505058" />
        <Particles />
        <CoreOrb />
        <Ring />
      </Canvas>
    </div>
  );
}
