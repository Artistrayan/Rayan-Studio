/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Live Interactive 3D Asset Preview & Inspector Modal
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  AlertCircle,
  Box,
  Grid,
  Pause,
  Play,
  RotateCw,
  X,
} from 'lucide-react';
import type { RayanAsset } from '../types/studio';
import { disposeObject3D, loadCustom3DAsset } from '../engine/threeModels';

interface Model3DPreviewModalProps {
  asset: RayanAsset;
  onClose: () => void;
  onSpawnToStudio?: () => void;
}

export const Model3DPreviewModal: React.FC<Model3DPreviewModalProps> = ({
  asset,
  onClose,
  onSpawnToStudio,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [playingAnim, setPlayingAnim] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const wireframeRef = useRef(wireframe);
  wireframeRef.current = wireframe;
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;
  const playingAnimRef = useRef(playingAnim);
  playingAnimRef.current = playingAnim;
  const loadedGroupRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    const grp = loadedGroupRef.current;
    if (!grp) return;
    grp.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          if (m && 'wireframe' in m) {
            (m as THREE.MeshStandardMaterial).wireframe = wireframe;
          }
        });
      }
    });
  }, [wireframe]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const w = container.clientWidth || 640;
    const h = container.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0e14);

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
    camera.position.set(2.8, 2.2, 3.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x0f172a, 0.75));
    const keyLight = new THREE.DirectionalLight(0xfffbeb, 1.4);
    keyLight.position.set(5, 8, 5);
    scene.add(keyLight);

    const grid = new THREE.GridHelper(10, 10, 0x38bdf8, 0x1e293b);
    scene.add(grid);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(0, 0.65, 0);

    let mixer: THREE.AnimationMixer | null = null;
    let disposed = false;

    void loadCustom3DAsset(asset, '#38bdf8')
      .then((group) => {
        if (disposed) {
          disposeObject3D(group);
          return;
        }
        loadedGroupRef.current = group;
        scene.add(group);

        if (group.userData?.animations && group.userData.animations.length > 0) {
          mixer = new THREE.AnimationMixer(group);
          (group.userData.animations as THREE.AnimationClip[]).forEach((clip) => {
            mixer!.clipAction(clip).play();
          });
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!disposed) {
          setLoadError(err instanceof Error ? err.message : 'خطا در رندر مدل سه‌بعدی');
          setLoading(false);
        }
      });

    const ro = new ResizeObserver(() => {
      if (!container) return;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (cw === 0 || ch === 0) return;
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      renderer.setSize(cw, ch);
    });
    ro.observe(container);

    const clock = new THREE.Clock();
    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const dt = clock.getDelta();
      if (mixer && playingAnimRef.current) {
        mixer.update(dt);
      }
      orbit.autoRotate = autoRotateRef.current;
      orbit.autoRotateSpeed = 2.0;
      orbit.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      ro.disconnect();
      if (loadedGroupRef.current) {
        disposeObject3D(loadedGroupRef.current);
        loadedGroupRef.current = null;
      }
      orbit.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, [asset]);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl rounded-2xl border border-slate-700 bg-[#0E121B] overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 bg-[#131823] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Box className="w-4 h-4 text-sky-400" />
            <span className="text-sm font-bold text-slate-100">{asset.name}</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-500/15 text-sky-300 border border-sky-500/30 uppercase">
              {asset.format}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Viewport + Metadata */}
        <div className="grid grid-cols-1 lg:grid-cols-3 h-[460px]">
          <div className="lg:col-span-2 relative bg-[#0B0E14]">
            <div ref={mountRef} className="w-full h-full" />
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-300 bg-[#0B0E14]/80">
                در حال بارگذاری مدل در موتور WebGL...
              </div>
            )}
            {loadError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center bg-[#0B0E14]/90 text-red-300 text-xs">
                <AlertCircle className="w-6 h-6" />
                <span>{loadError}</span>
              </div>
            )}

            {/* Preview Controls */}
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
              <div className="pointer-events-auto flex items-center gap-1.5 p-1 rounded-xl bg-[#0F1420]/95 border border-slate-700 text-[11px]">
                <button
                  type="button"
                  onClick={() => setAutoRotate((v) => !v)}
                  className={`px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer ${
                    autoRotate ? 'bg-sky-500 text-slate-950 font-bold' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <RotateCw className="w-3 h-3" />
                  چرخش خودکار
                </button>
                <button
                  type="button"
                  onClick={() => setWireframe((v) => !v)}
                  className={`px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer ${
                    wireframe ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <Grid className="w-3 h-3" />
                  وایرفریم
                </button>
                {(asset.modelMeta?.animationCount ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => setPlayingAnim((v) => !v)}
                    className={`px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer ${
                      playingAnim ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {playingAnim ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    انیمیشن
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="p-4 border-t lg:border-t-0 lg:border-r border-slate-800 bg-[#0E121B] flex flex-col justify-between text-xs overflow-y-auto">
            <div className="space-y-3">
              <h4 className="font-bold text-slate-200 border-b border-slate-800 pb-2">
                مشخصات فنی مدل (Three.js Inspection)
              </h4>
              <div className="space-y-1.5 text-slate-400">
                <div className="flex justify-between">
                  <span>فرمت فایل:</span>
                  <span className="font-mono text-slate-200 uppercase">{asset.format}</span>
                </div>
                <div className="flex justify-between">
                  <span>حجم باینری:</span>
                  <span className="font-mono text-slate-200">
                    {Math.max(1, Math.round(asset.sizeBytes / 1024))} KB
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>تعداد مش‌ها:</span>
                  <span className="font-mono text-slate-200">{asset.modelMeta?.meshCount ?? '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span>تعداد رأس‌ها (Vertices):</span>
                  <span className="font-mono text-slate-200">
                    {asset.modelMeta?.vertexCount?.toLocaleString() ?? '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>تعداد مثلث‌ها (Triangles):</span>
                  <span className="font-mono text-slate-200">
                    {asset.modelMeta?.triangleCount?.toLocaleString() ?? '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>تعداد متریال‌ها:</span>
                  <span className="font-mono text-slate-200">
                    {asset.modelMeta?.materialCount ?? '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>اسکلت و ریگ:</span>
                  <span className={asset.modelMeta?.hasSkeleton ? 'text-emerald-400' : 'text-slate-500'}>
                    {asset.modelMeta?.hasSkeleton ? 'دارد' : 'ندارد'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>انیمیشن‌ها:</span>
                  <span className="font-mono text-slate-200">
                    {asset.modelMeta?.animationCount ?? 0}
                  </span>
                </div>
              </div>

              {asset.modelMeta?.animationNames && asset.modelMeta.animationNames.length > 0 && (
                <div className="pt-2 border-t border-slate-800 space-y-1">
                  <span className="text-[11px] font-semibold text-emerald-400">لیست انیمیشن‌ها:</span>
                  <div className="max-h-24 overflow-y-auto space-y-0.5 text-[10px] font-mono text-slate-300">
                    {asset.modelMeta.animationNames.map((n, i) => (
                      <div key={i}>• {n}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {onSpawnToStudio && (
              <button
                type="button"
                onClick={() => {
                  onSpawnToStudio();
                  onClose();
                }}
                className="w-full mt-4 py-2.5 rounded-xl bg-sky-500 text-slate-950 font-bold hover:bg-sky-400 cursor-pointer"
              >
                ورود به استودیوی چیدمان سه‌بعدی
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
