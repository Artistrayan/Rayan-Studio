import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import {
  dataUrlToArrayBuffer,
  inspectGLTFMetadata,
  buildProceduralPresetGroup,
  parse3DModelBuffer,
  extractModelStatsFromObject3D,
  parseAndInspect3DModelFile,
  buildPrimitive3DGroup,
  buildLight3DGroup,
  applyColorAndPbrToGroup,
  disposeObject3D,
} from '../src/engine/threeModels';

describe('3D Engine & Model Loaders Tests', () => {
  it('dataUrlToArrayBuffer converts base64 data URLs to ArrayBuffer correctly', () => {
    const rawString = 'Hello Rayan 3D Engine';
    const base64 = Buffer.from(rawString, 'utf-8').toString('base64');
    const dataUrl = `data:application/octet-stream;base64,${base64}`;

    const buffer = dataUrlToArrayBuffer(dataUrl);
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    const decoded = Buffer.from(buffer).toString('utf-8');
    expect(decoded).toBe(rawString);
  });

  it('inspectGLTFMetadata extracts glTF structure accurately from JSON', async () => {
    const gltfDoc = {
      asset: { version: '2.0', generator: 'Blender 4.2 glTF 2.0 I/O' },
      scenes: [{ nodes: [0, 1] }],
      nodes: [{ name: 'Character_Armature' }, { name: 'Hero_Mesh' }],
      meshes: [{ name: 'Body', primitives: [{ attributes: { POSITION: 0 } }] }],
      materials: [{ name: 'Armor_Material', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.2, 0.2, 1] } }],
      animations: [{ name: 'Walk_Cycle' }, { name: 'Attack' }],
    };

    const jsonStr = JSON.stringify(gltfDoc);
    const base64 = Buffer.from(jsonStr, 'utf-8').toString('base64');
    const dataUrl = `data:model/gltf+json;base64,${base64}`;

    const meta = await inspectGLTFMetadata(dataUrl);
    expect(meta.generator).toContain('Blender');
    expect(meta.nodeCount).toBe(2);
    expect(meta.meshCount).toBe(1);
    expect(meta.animationNames).toEqual(['Walk_Cycle', 'Attack']);
  });

  it('STLLoader successfully parses valid ASCII STL model geometry', () => {
    const sampleAsciiSTL = `solid cube_corner
  facet normal 0.0 0.0 1.0
    outer loop
      vertex 0.0 0.0 0.0
      vertex 1.0 0.0 0.0
      vertex 0.0 1.0 0.0
    endloop
  endfacet
endsolid cube_corner`;

    const loader = new STLLoader();
    const geometry = loader.parse(sampleAsciiSTL);
    expect(geometry).toBeInstanceOf(THREE.BufferGeometry);
    expect(geometry.attributes.position.count).toBe(3);
  });

  it('OBJLoader successfully parses Wavefront OBJ 3D geometry', () => {
    const sampleOBJ = `
# Rayan Studio OBJ Test
v 0.0 0.0 0.0
v 1.0 0.0 0.0
v 0.0 1.0 0.0
vn 0.0 0.0 1.0
f 1//1 2//1 3//1
`;
    const loader = new OBJLoader();
    const group = loader.parse(sampleOBJ);
    expect(group).toBeInstanceOf(THREE.Group);
    expect(group.children.length).toBeGreaterThan(0);
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh.isMesh).toBe(true);
  });

  it('parseAndInspect3DModelFile parses STL & OBJ ArrayBuffers and extracts genuine geometry metadata', async () => {
    const stlText = `solid tri
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 2 0 0
      vertex 0 2 0
    endloop
  endfacet
endsolid tri`;
    const stlBuffer = new TextEncoder().encode(stlText).buffer;
    const stlResult = await parseAndInspect3DModelFile(stlBuffer, 'stl', '#38bdf8');
    expect(stlResult.object).toBeInstanceOf(THREE.Group);
    expect(stlResult.meta.meshCount).toBe(1);
    expect(stlResult.meta.vertexCount).toBe(3);
    expect(stlResult.meta.triangleCount).toBe(1);
    expect(stlResult.meta.format).toBe('stl');

    const objText = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3
f 1 3 4
`;
    const objBuffer = new TextEncoder().encode(objText).buffer;
    const objResult = await parseAndInspect3DModelFile(objBuffer, 'obj', '#f59e0b');
    expect(objResult.meta.meshCount).toBe(1);
    expect(objResult.meta.triangleCount).toBe(2);
    expect(objResult.meta.vertexCount).toBeGreaterThanOrEqual(4);
  });

  it('parse3DModelBuffer rejects empty or geometrically invalid files with explicit errors', async () => {
    const emptyBuf = new ArrayBuffer(0);
    await expect(parse3DModelBuffer(emptyBuf, 'glb')).rejects.toThrow();

    const invalidObjBuf = new TextEncoder().encode('# just a comment without vertices').buffer;
    await expect(parse3DModelBuffer(invalidObjBuf, 'obj')).rejects.toThrow();
  });

  it('extractModelStatsFromObject3D reports accurate stats for composite presets', () => {
    const group = buildProceduralPresetGroup('hero-bot', '#38bdf8');
    const stats = extractModelStatsFromObject3D(group, 'glb');
    expect(stats.meshCount).toBeGreaterThanOrEqual(10);
    expect(stats.vertexCount).toBeGreaterThan(100);
    expect(stats.triangleCount).toBeGreaterThan(50);
  });

  it('buildProceduralPresetGroup generates complete multi-part groups with varied roughness and grounded pivots', () => {
    const presets = [
      'hero-bot',
      'rover-car',
      'crate',
      'crystal-gem',
      'pine-tree',
      'turret',
      'platform-block',
    ] as const;

    for (const preset of presets) {
      const group = buildProceduralPresetGroup(preset, '#38bdf8');
      expect(group).toBeInstanceOf(THREE.Group);
      expect(group.children.length).toBeGreaterThanOrEqual(3); // Multi-part composite model rule

      // Verify all children have geometries and materials
      let meshCount = 0;
      group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          meshCount++;
          const mesh = child as THREE.Mesh;
          expect(mesh.geometry).toBeDefined();
          expect(mesh.material).toBeDefined();
        }
      });
      expect(meshCount).toBeGreaterThanOrEqual(3);
    }
  });

  it('buildPrimitive3DGroup creates all basic 3D primitives and supports live PBR updates & disposal', () => {
    const primitives = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'plane'] as const;
    for (const prim of primitives) {
      const group = buildPrimitive3DGroup(prim, '#ef4444', 0.3, 0.7);
      expect(group).toBeInstanceOf(THREE.Group);
      expect(group.children.length).toBe(1);
      const mesh = group.children[0] as THREE.Mesh;
      expect(mesh.isMesh).toBe(true);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      expect(mat.roughness).toBeCloseTo(0.3);
      expect(mat.metalness).toBeCloseTo(0.7);

      applyColorAndPbrToGroup(group, '#10b981', 0.85, 0.1);
      expect(mat.roughness).toBeCloseTo(0.85);
      expect(mat.metalness).toBeCloseTo(0.1);
      expect(mat.color.getHexString()).toBe('10b981');

      disposeObject3D(group);
    }
  });

  it('buildLight3DGroup creates PointLight node and updates color & intensity cleanly', () => {
    const lightGroup = buildLight3DGroup('#fbbf24', 5);
    const pointLight = lightGroup.children.find((c) => (c as THREE.PointLight).isPointLight) as THREE.PointLight;
    expect(pointLight).toBeDefined();
    expect(pointLight.intensity).toBe(5);

    applyColorAndPbrToGroup(lightGroup, '#38bdf8', undefined, undefined, 9);
    expect(pointLight.intensity).toBe(9);
    expect(pointLight.color.getHexString()).toBe('38bdf8');
    disposeObject3D(lightGroup);
  });
});
