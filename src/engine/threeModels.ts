/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Production 3D Model Loaders & Procedural Geometries
 * Supports GLB, glTF, FBX, OBJ (+ MTL), STL, USD / USDZ, and PLY formats.
 * Integrates glTF-Transform for inspection and validation.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import type { Model3DPresetType, RayanAsset, Model3DMetadata } from '../types/studio';

export function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function dataUrlToText(dataUrl: string): string {
  const buf = dataUrlToArrayBuffer(dataUrl);
  return new TextDecoder().decode(buf);
}

let dracoLoaderInstance: DRACOLoader | null = null;
function getDracoLoader(): DRACOLoader {
  if (!dracoLoaderInstance) {
    dracoLoaderInstance = new DRACOLoader();
    dracoLoaderInstance.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    dracoLoaderInstance.preload();
  }
  return dracoLoaderInstance;
}

/**
 * Inspects a GLB/glTF binary buffer using glTF-Transform to extract genuine model metadata.
 */
export async function inspectGLTFMetadata(
  input: ArrayBuffer | Uint8Array | string
): Promise<Partial<Model3DMetadata>> {
  try {
    let uint8: Uint8Array;
    let jsonText: string | null = null;

    if (typeof input === 'string') {
      if (input.startsWith('data:')) {
        const ab = dataUrlToArrayBuffer(input);
        uint8 = new Uint8Array(ab);
      } else {
        jsonText = input;
        uint8 = new TextEncoder().encode(input);
      }
    } else if (input instanceof Uint8Array) {
      uint8 = input;
    } else {
      uint8 = new Uint8Array(input);
    }

    // Check if GLB binary magic (0x67 0x6c 0x54 0x46 = 'glTF')
    const isGlb =
      uint8.length >= 4 &&
      uint8[0] === 0x67 &&
      uint8[1] === 0x6c &&
      uint8[2] === 0x54 &&
      uint8[3] === 0x46;

    if (isGlb) {
      const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
      const doc = await io.readBinary(uint8);
      const root = doc.getRoot();

      const meshes = root.listMeshes();
      const materials = root.listMaterials();
      const animations = root.listAnimations();
      const textures = root.listTextures();

      let vertexCount = 0;
      let triangleCount = 0;

      for (const mesh of meshes) {
        for (const prim of mesh.listPrimitives()) {
          const position = prim.getAttribute('POSITION');
          if (position) {
            vertexCount += position.getCount();
          }
          const indices = prim.getIndices();
          if (indices) {
            triangleCount += indices.getCount() / 3;
          } else if (position) {
            triangleCount += position.getCount() / 3;
          }
        }
      }

      return {
        meshCount: meshes.length,
        materialCount: materials.length,
        animationCount: animations.length,
        animationNames: animations.map((a) => a.getName() || 'Animation'),
        hasTextures: textures.length > 0,
        vertexCount: Math.round(vertexCount),
        triangleCount: Math.round(triangleCount),
        hasSkeleton: root.listSkins().length > 0,
        nodeCount: root.listNodes().length,
      };
    }

    // Parse JSON glTF
    const text = jsonText || new TextDecoder().decode(uint8);
    const parsed = JSON.parse(text);

    const animationNames: string[] = Array.isArray(parsed.animations)
      ? parsed.animations.map((a: { name?: string }) => a.name || 'Animation')
      : [];

    return {
      generator: parsed.asset?.generator,
      nodeCount: Array.isArray(parsed.nodes) ? parsed.nodes.length : 0,
      meshCount: Array.isArray(parsed.meshes) ? parsed.meshes.length : 0,
      materialCount: Array.isArray(parsed.materials) ? parsed.materials.length : 0,
      animationCount: animationNames.length,
      animationNames,
      hasTextures: Array.isArray(parsed.textures) && parsed.textures.length > 0,
      hasSkeleton: Array.isArray(parsed.skins) && parsed.skins.length > 0,
    };
  } catch {
    return {};
  }
}

/**
 * Builds composite 3-12 part procedural 3D models with bottom-center pivot (y = 0)
 * and distinct PBR roughness/metalness contrast across sub-parts.
 */
export function buildProceduralPresetGroup(
  preset: Model3DPresetType,
  primaryHex: string
): THREE.Group {
  const group = new THREE.Group();
  const baseColor = new THREE.Color(primaryHex || '#F59E0B');

  const bodyMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.42,
    metalness: 0.25,
  });
  const darkMetalMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.25,
    metalness: 0.85,
  });
  const rubberMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.88,
    metalness: 0.05,
  });
  const accentEmissiveMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0ea5e9,
    emissiveIntensity: 0.9,
    roughness: 0.2,
    metalness: 0.3,
  });

  switch (preset) {
    case 'hero-bot': {
      const bootGeo = new THREE.BoxGeometry(0.28, 0.24, 0.38);
      const bootL = new THREE.Mesh(bootGeo, darkMetalMat);
      bootL.position.set(-0.22, 0.12, 0.03);
      const bootR = new THREE.Mesh(bootGeo, darkMetalMat);
      bootR.position.set(0.22, 0.12, 0.03);

      const legGeo = new THREE.CylinderGeometry(0.11, 0.12, 0.42, 12);
      const legL = new THREE.Mesh(legGeo, rubberMat);
      legL.position.set(-0.22, 0.45, 0);
      const legR = new THREE.Mesh(legGeo, rubberMat);
      legR.position.set(0.22, 0.45, 0);

      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.66, 0.46), bodyMat);
      torso.position.set(0, 0.96, 0);

      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 16), accentEmissiveMat);
      core.rotation.x = Math.PI / 2;
      core.position.set(0, 1.0, 0.24);

      const shoulderGeo = new THREE.SphereGeometry(0.16, 14, 12);
      const shL = new THREE.Mesh(shoulderGeo, darkMetalMat);
      shL.position.set(-0.5, 1.18, 0);
      const shR = new THREE.Mesh(shoulderGeo, darkMetalMat);
      shR.position.set(0.5, 1.18, 0);

      const armGeo = new THREE.BoxGeometry(0.18, 0.46, 0.2);
      const armL = new THREE.Mesh(armGeo, bodyMat);
      armL.position.set(-0.52, 0.88, 0);
      const armR = new THREE.Mesh(armGeo, bodyMat);
      armR.position.set(0.52, 0.88, 0);

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.38, 0.42), bodyMat);
      head.position.set(0, 1.52, 0);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.13, 0.06), accentEmissiveMat);
      visor.position.set(0, 1.54, 0.21);

      group.add(bootL, bootR, legL, legR, torso, core, shL, shR, armL, armR, head, visor);
      break;
    }

    case 'rover-car': {
      const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.2, 18);
      wheelGeo.rotateZ(Math.PI / 2);
      const rimGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.22, 12);
      rimGeo.rotateZ(Math.PI / 2);

      const wheelPositions: Array<[number, number, number]> = [
        [-0.65, 0.28, 0.65],
        [0.65, 0.28, 0.65],
        [-0.65, 0.28, -0.65],
        [0.65, 0.28, -0.65],
      ];
      wheelPositions.forEach(([wx, wy, wz]) => {
        const tire = new THREE.Mesh(wheelGeo, rubberMat);
        tire.position.set(wx, wy, wz);
        const rim = new THREE.Mesh(rimGeo, darkMetalMat);
        rim.position.set(wx, wy, wz);
        group.add(tire, rim);
      });

      const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.36, 1.88), bodyMat);
      chassis.position.set(0, 0.48, 0);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.36, 0.96), darkMetalMat);
      cabin.position.set(0, 0.82, -0.1);
      const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.22, 0.06), accentEmissiveMat);
      windshield.position.set(0, 0.82, 0.38);
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.14, 0.16), darkMetalMat);
      bumper.position.set(0, 0.36, 0.98);

      group.add(chassis, cabin, windshield, bumper);
      break;
    }

    case 'turret': {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.78, 0.26, 8), darkMetalMat);
      base.position.set(0, 0.13, 0);
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.45, 12), rubberMat);
      column.position.set(0, 0.48, 0);
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.52, 0.86), bodyMat);
      pod.position.set(0, 0.92, 0);
      const barrelGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.72, 10);
      barrelGeo.rotateX(Math.PI / 2);
      const b1 = new THREE.Mesh(barrelGeo, darkMetalMat);
      b1.position.set(-0.2, 0.92, 0.65);
      const b2 = new THREE.Mesh(barrelGeo, darkMetalMat);
      b2.position.set(0.2, 0.92, 0.65);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), accentEmissiveMat);
      eye.position.set(0, 1.18, 0.25);

      group.add(base, column, pod, b1, b2, eye);
      break;
    }

    case 'crystal-gem': {
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.46, 0.18, 6), darkMetalMat);
      pedestal.position.set(0, 0.09, 0);
      const gemMat = new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: baseColor,
        emissiveIntensity: 0.35,
        roughness: 0.12,
        metalness: 0.2,
      });
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), gemMat);
      crystal.scale.set(0.85, 1.45, 0.85);
      crystal.position.set(0, 0.86, 0);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.035, 8, 24), darkMetalMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, 0.24, 0);
      group.add(pedestal, crystal, ring);
      break;
    }

    case 'pine-tree': {
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.92, metalness: 0.02 });
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.9, 10), trunkMat);
      trunk.position.set(0, 0.45, 0);

      const leafMat1 = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.78, metalness: 0.02 });
      const leafMat2 = new THREE.MeshStandardMaterial({
        color: baseColor.clone().multiplyScalar(1.15),
        roughness: 0.72,
        metalness: 0.02,
      });

      const cone1 = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.1, 10), leafMat1);
      cone1.position.set(0, 1.25, 0);
      const cone2 = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.95, 10), leafMat2);
      cone2.position.set(0, 1.85, 0);
      const cone3 = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 10), leafMat1);
      cone3.position.set(0, 2.38, 0);

      group.add(trunk, cone1, cone2, cone3);
      break;
    }

    case 'crate': {
      const plankMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.8, metalness: 0.05 });
      const core = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), plankMat);
      core.position.set(0, 0.5, 0);

      const frameGeoH = new THREE.BoxGeometry(1.06, 0.1, 1.06);
      const topFrame = new THREE.Mesh(frameGeoH, darkMetalMat);
      topFrame.position.set(0, 0.96, 0);
      const botFrame = new THREE.Mesh(frameGeoH, darkMetalMat);
      botFrame.position.set(0, 0.05, 0);
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.14, 1.04), darkMetalMat);
      band.position.set(0, 0.5, 0);

      group.add(core, topFrame, botFrame, band);
      break;
    }

    case 'platform-block':
    default: {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.76, 1.0), bodyMat);
      slab.position.set(0, 0.38, 0);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.14, 1.04), darkMetalMat);
      cap.position.set(0, 0.83, 0);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.08, 1.08), accentEmissiveMat);
      trim.position.set(0, 0.94, 0);
      group.add(slab, cap, trim);
      break;
    }
  }

  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return group;
}

/**
 * Normalizes any loaded 3D object so its bottom rests flush at y = 0 and max dimension = 1.5
 */
export function normalizeLoadedObject(
  obj: THREE.Object3D,
  options: { animations?: THREE.AnimationClip[]; hasSkeleton?: boolean; format?: string } = {}
): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.name = obj.name || 'ModelContainer';

  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const scale = 1.5 / maxDim;

  obj.position.set(-center.x, -box.min.y, -center.z);
  obj.scale.multiplyScalar(scale);

  const scaledContainer = new THREE.Group();
  scaledContainer.add(obj);

  // Recalculate normalized bottom
  const normBox = new THREE.Box3().setFromObject(scaledContainer);
  scaledContainer.position.y -= normBox.min.y;

  let hasSkeleton = Boolean(options.hasSkeleton);

  scaledContainer.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
    if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
      hasSkeleton = true;
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  wrapper.add(scaledContainer);

  // Preserve animations & skeleton metadata on the root container
  if (options.animations && options.animations.length > 0) {
    wrapper.userData.animations = options.animations;
  }
  wrapper.userData.hasSkeleton = hasSkeleton;
  if (options.format) {
    wrapper.userData.modelFormat = options.format;
  }

  return wrapper;
}

/**
 * Loads custom 3D asset supporting:
 * - GLB / glTF (materials, textures, Draco, animations)
 * - FBX (skeleton, bones, skinned mesh, animations)
 * - OBJ (geometry, materials)
 * - STL (solid geometry, normals, PBR material)
 * - USD / USDZ (scenes, complex hierarchical assets)
 * - PLY (point clouds, polygon geometry)
 */
export async function loadCustom3DAsset(
  asset: RayanAsset,
  fallbackColor: string
): Promise<THREE.Group> {
  const format = asset.format.toLowerCase();

  // 1. GLB / glTF
  if (format === 'glb' || format === 'gltf') {
    const loader = new GLTFLoader();
    loader.setDRACOLoader(getDracoLoader());
    const buffer = dataUrlToArrayBuffer(asset.dataUrl);

    return new Promise((resolve, reject) => {
      loader.parse(
        buffer,
        '',
        (gltf) => {
          const group = normalizeLoadedObject(gltf.scene, {
            animations: gltf.animations,
            format: format.toUpperCase(),
          });
          resolve(group);
        },
        (err) => reject(err)
      );
    });
  }

  // 2. FBX (Skeletal animation, rigs, meshes)
  if (format === 'fbx') {
    const loader = new FBXLoader();
    const buffer = dataUrlToArrayBuffer(asset.dataUrl);
    const fbxObj = loader.parse(buffer, '');

    const group = normalizeLoadedObject(fbxObj, {
      animations: fbxObj.animations || [],
      format: 'FBX',
    });
    return group;
  }

  // 3. OBJ (Geometry + Materials)
  if (format === 'obj') {
    const loader = new OBJLoader();
    const text = dataUrlToText(asset.dataUrl);
    const obj = loader.parse(text);

    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (!mesh.material || Array.isArray(mesh.material) && mesh.material.length === 0) {
          mesh.material = new THREE.MeshStandardMaterial({
            color: fallbackColor,
            roughness: 0.5,
            metalness: 0.2,
          });
        }
      }
    });
    return normalizeLoadedObject(obj, { format: 'OBJ' });
  }

  // 4. STL (Geometric models)
  if (format === 'stl') {
    const loader = new STLLoader();
    const buffer = dataUrlToArrayBuffer(asset.dataUrl);
    const geometry = loader.parse(buffer);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: fallbackColor,
        roughness: 0.45,
        metalness: 0.35,
      })
    );
    return normalizeLoadedObject(mesh, { format: 'STL' });
  }

  // 5. USD / USDZ (Universal Scene Description - Complex assets)
  if (format === 'usd' || format === 'usdz') {
    const loader = new USDLoader();
    const buffer = dataUrlToArrayBuffer(asset.dataUrl);

    return new Promise((resolve, reject) => {
      try {
        const usdGroup = loader.parse(buffer);
        const group = normalizeLoadedObject(usdGroup, {
          format: format.toUpperCase(),
        });
        resolve(group);
      } catch (err) {
        reject(err);
      }
    });
  }

  // 6. PLY
  if (format === 'ply') {
    const loader = new PLYLoader();
    const buffer = dataUrlToArrayBuffer(asset.dataUrl);
    const geometry = loader.parse(buffer);
    geometry.computeVertexNormals();
    const hasColors = Boolean(geometry.getAttribute('color'));
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: hasColors ? 0xffffff : fallbackColor,
        vertexColors: hasColors,
        roughness: 0.5,
        metalness: 0.2,
      })
    );
    return normalizeLoadedObject(mesh, { format: 'PLY' });
  }

  return buildProceduralPresetGroup('crate', fallbackColor);
}
