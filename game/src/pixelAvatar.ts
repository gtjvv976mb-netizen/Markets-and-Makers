import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Blocky pixel-art citizens, generated in the browser.
//
// These stand in for the rigged Mercedonian GLBs. They keep the contract the rest of
// the game relies on — a MercedonianHumanoid skeleton of fifteen joints, an Idle and a
// Walk clip, +X front axis, in-place root motion — so the mixer, the yaw correction and
// the height normalisation all work unchanged.
//
// Every part is a box bound rigidly to one bone, which is what gives the chunky
// pixel-toy silhouette and also makes the skinning exact: no blending, no stretching.

/** The fifteen joints the runtime manifest declares, in a fixed order. */
const JOINTS = [
  "Hips", "Spine", "Chest", "Neck", "Head",
  "ShoulderL", "UpperArmL", "LowerArmL",
  "ShoulderR", "UpperArmR", "LowerArmR",
  "UpperLegL", "LowerLegL", "UpperLegR", "LowerLegR",
] as const;
type Joint = (typeof JOINTS)[number];

export const PIXEL_AVATAR_JOINTS = JOINTS.length;

/** Rest pose, in metres, for a 1.82 m citizen standing with feet at zero. */
const REST: Readonly<Record<Joint, [number, number, number]>> = {
  Hips: [0, 0.86, 0],
  Spine: [0, 1.02, 0],
  Chest: [0, 1.18, 0],
  Neck: [0, 1.40, 0],
  Head: [0, 1.47, 0],
  ShoulderL: [0, 1.36, 0.20],
  UpperArmL: [0, 1.32, 0.26],
  LowerArmL: [0, 1.11, 0.26],
  ShoulderR: [0, 1.36, -0.20],
  UpperArmR: [0, 1.32, -0.26],
  LowerArmR: [0, 1.11, -0.26],
  UpperLegL: [0, 0.84, 0.10],
  LowerLegL: [0, 0.44, 0.10],
  UpperLegR: [0, 0.84, -0.10],
  LowerLegR: [0, 0.44, -0.10],
};

const PARENT: Readonly<Partial<Record<Joint, Joint>>> = {
  Spine: "Hips", Chest: "Spine", Neck: "Chest", Head: "Neck",
  ShoulderL: "Chest", UpperArmL: "ShoulderL", LowerArmL: "UpperArmL",
  ShoulderR: "Chest", UpperArmR: "ShoulderR", LowerArmR: "UpperArmR",
  UpperLegL: "Hips", LowerLegL: "UpperLegL", UpperLegR: "Hips", LowerLegR: "UpperLegR",
};

export interface AvatarPalette {
  skin: number;
  hair: number;
  shirt: number;
  trousers: number;
  apron: number;
  boots: number;
}

// Solarpunk workwear, read off the citizens they replace: light shirts, dark teal
// trousers, a working apron in the trade's colour, and hair from black to auburn.
const PALETTES: Readonly<Record<string, AvatarPalette>> = {
  "av01-civic-maker": { skin: 0xd9a074, hair: 0x2e2622, shirt: 0xf2ead6, trousers: 0x2f4f5a, apron: 0xc8863c, boots: 0x4a3b2e },
  "av02-urban-gardener": { skin: 0xc98c5f, hair: 0x4a2f1e, shirt: 0xf0e7d2, trousers: 0x33565c, apron: 0x5f9445, boots: 0x453629 },
  "av03-solar-technician": { skin: 0xe0b088, hair: 0x1f1b18, shirt: 0xeae2cc, trousers: 0x2c4653, apron: 0xe0b040, boots: 0x3f342a },
  "av04-market-grocer": { skin: 0xb87a4e, hair: 0x6a3620, shirt: 0xf4ecd8, trousers: 0x395a60, apron: 0xa9705c, boots: 0x4a3b2e },
  "av05-fabricator-engineer": { skin: 0xd2996d, hair: 0x2a2320, shirt: 0xe6dcc0, trousers: 0x35434c, apron: 0x8d9298, boots: 0x3a322b },
  "av06-harbor-courier": { skin: 0xa9714a, hair: 0x35211a, shirt: 0xf2ead6, trousers: 0x2b5560, apron: 0x3fb2c0, boots: 0x42352b },
  "av07-community-chef": { skin: 0xe3b98f, hair: 0x1d1916, shirt: 0xfbf6e8, trousers: 0x3d4d55, apron: 0xd7758f, boots: 0x453629 },
  "av08-cooperative-shopkeeper": { skin: 0xc08653, hair: 0x7a4526, shirt: 0xf0e7d2, trousers: 0x304a52, apron: 0xd8a63a, boots: 0x4a3b2e },
  "av10-repair-mechanic": { skin: 0xb5784c, hair: 0x2c2420, shirt: 0xe4d9bf, trousers: 0x3a4750, apron: 0x9a7350, boots: 0x39302a },
  "av12-water-systems-biologist": { skin: 0xdba97f, hair: 0x4e2a1c, shirt: 0xeff0e2, trousers: 0x2f5f66, apron: 0x2f9fb0, boots: 0x403428 },
};

const DEFAULT_PALETTE: AvatarPalette = PALETTES["av01-civic-maker"]!;

interface Part {
  joint: Joint;
  size: [number, number, number];
  centre: [number, number, number];
  colour: number;
}

/**
 * The body, as boxes. Sizes are deliberately chunky and axis-aligned — this is meant to
 * read as a pixel toy, not as a person. The figure faces +X, which is the front axis the
 * manifest declares, so the yaw correction downstream is unchanged.
 */
function parts(palette: AvatarPalette): Part[] {
  const { skin, hair, shirt, trousers, apron, boots } = palette;
  return [
    // Head: a cube, a hair slab, and two pixels for eyes on the +X face.
    { joint: "Head", size: [0.30, 0.30, 0.30], centre: [0, 1.62, 0], colour: skin },
    { joint: "Head", size: [0.32, 0.09, 0.32], centre: [0, 1.79, 0], colour: hair },
    { joint: "Head", size: [0.04, 0.05, 0.30], centre: [-0.15, 1.70, 0], colour: hair },
    { joint: "Head", size: [0.02, 0.05, 0.05], centre: [0.155, 1.65, 0.07], colour: 0x2a2320 },
    { joint: "Head", size: [0.02, 0.05, 0.05], centre: [0.155, 1.65, -0.07], colour: 0x2a2320 },
    { joint: "Neck", size: [0.14, 0.06, 0.14], centre: [0, 1.42, 0], colour: skin },

    // Torso: shirt with an apron panel across the front.
    { joint: "Chest", size: [0.24, 0.26, 0.42], centre: [0, 1.28, 0], colour: shirt },
    { joint: "Spine", size: [0.24, 0.20, 0.40], centre: [0, 1.06, 0], colour: shirt },
    { joint: "Spine", size: [0.03, 0.30, 0.28], centre: [0.13, 1.06, 0], colour: apron },
    { joint: "Chest", size: [0.03, 0.16, 0.20], centre: [0.13, 1.30, 0], colour: apron },
    { joint: "Hips", size: [0.24, 0.14, 0.38], centre: [0, 0.90, 0], colour: trousers },

    // Arms: upper sleeve in shirt, forearm and hand in skin.
    { joint: "UpperArmL", size: [0.13, 0.22, 0.13], centre: [0, 1.22, 0.26], colour: shirt },
    { joint: "LowerArmL", size: [0.12, 0.24, 0.12], centre: [0, 0.98, 0.26], colour: skin },
    { joint: "UpperArmR", size: [0.13, 0.22, 0.13], centre: [0, 1.22, -0.26], colour: shirt },
    { joint: "LowerArmR", size: [0.12, 0.24, 0.12], centre: [0, 0.98, -0.26], colour: skin },

    // Legs: trousers to the ankle, then a boot.
    { joint: "UpperLegL", size: [0.16, 0.40, 0.16], centre: [0, 0.64, 0.10], colour: trousers },
    { joint: "LowerLegL", size: [0.15, 0.34, 0.15], centre: [0, 0.27, 0.10], colour: trousers },
    { joint: "LowerLegL", size: [0.20, 0.09, 0.17], centre: [0.02, 0.05, 0.10], colour: boots },
    { joint: "UpperLegR", size: [0.16, 0.40, 0.16], centre: [0, 0.64, -0.10], colour: trousers },
    { joint: "LowerLegR", size: [0.15, 0.34, 0.15], centre: [0, 0.27, -0.10], colour: trousers },
    { joint: "LowerLegR", size: [0.20, 0.09, 0.17], centre: [0.02, 0.05, -0.10], colour: boots },
  ];
}

function buildSkeleton(): { bones: THREE.Bone[]; root: THREE.Bone; index: Map<Joint, number> } {
  const bones = new Map<Joint, THREE.Bone>();
  const index = new Map<Joint, number>();
  const ordered: THREE.Bone[] = [];
  for (const joint of JOINTS) {
    const bone = new THREE.Bone();
    bone.name = joint;
    bones.set(joint, bone);
    index.set(joint, ordered.length);
    ordered.push(bone);
  }
  for (const joint of JOINTS) {
    const bone = bones.get(joint)!;
    const parent = PARENT[joint];
    const rest = REST[joint];
    if (parent) {
      const parentRest = REST[parent];
      bone.position.set(rest[0] - parentRest[0], rest[1] - parentRest[1], rest[2] - parentRest[2]);
      bones.get(parent)!.add(bone);
    } else {
      bone.position.set(rest[0], rest[1], rest[2]);
    }
  }
  return { bones: ordered, root: bones.get("Hips")!, index };
}

function buildGeometry(palette: AvatarPalette, index: Map<Joint, number>): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const colour = new THREE.Color();
  for (const part of parts(palette)) {
    const geometry = new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
    geometry.translate(part.centre[0], part.centre[1], part.centre[2]);
    const count = geometry.attributes.position!.count;

    const colours = new Float32Array(count * 3);
    colour.setHex(part.colour, THREE.SRGBColorSpace);
    const skinIndices = new Uint16Array(count * 4);
    const skinWeights = new Float32Array(count * 4);
    const bone = index.get(part.joint)!;
    for (let i = 0; i < count; i += 1) {
      colours[i * 3] = colour.r;
      colours[i * 3 + 1] = colour.g;
      colours[i * 3 + 2] = colour.b;
      // Rigid binding: one bone, full weight. Blocky parts should not deform.
      skinIndices[i * 4] = bone;
      skinWeights[i * 4] = 1;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndices, 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeights, 4));
    geometry.deleteAttribute("uv");
    pieces.push(geometry);
  }
  const merged = mergeGeometries(pieces, false);
  if (!merged) throw new Error("pixel avatar: geometry merge failed");
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

const quaternionTrack = (joint: Joint, times: number[], eulers: Array<[number, number, number]>): THREE.QuaternionKeyframeTrack => {
  const values: number[] = [];
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  for (const [x, y, z] of eulers) {
    quaternion.setFromEuler(euler.set(x, y, z));
    values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${joint}.quaternion`, times, values);
};

/** Feet stay planted and the hips carry the motion — root motion is in-place. */
function walkClip(): THREE.AnimationClip {
  const times = [0, 0.25, 0.5, 0.75, 1];
  const swing = 0.62;
  const arm = 0.48;
  // The figure faces +X, so forward-and-back is rotation about Z. About X it would
  // swing sideways, which is a jumping jack, not a walk. For a bone hanging down,
  // a positive Z rotation carries its tip toward +X, so positive is a step forward
  // and the knee and elbow, which fold backward, stay negative.
  const tracks = [
    quaternionTrack("UpperLegL", times, [[0, 0, swing], [0, 0, 0], [0, 0, -swing], [0, 0, 0], [0, 0, swing]]),
    quaternionTrack("UpperLegR", times, [[0, 0, -swing], [0, 0, 0], [0, 0, swing], [0, 0, 0], [0, 0, -swing]]),
    // The knee folds as the trailing leg lifts, and stays almost straight on the plant.
    quaternionTrack("LowerLegL", times, [[0, 0, -0.08], [0, 0, -0.75], [0, 0, -0.08], [0, 0, -0.18], [0, 0, -0.08]]),
    quaternionTrack("LowerLegR", times, [[0, 0, -0.08], [0, 0, -0.18], [0, 0, -0.08], [0, 0, -0.75], [0, 0, -0.08]]),
    quaternionTrack("UpperArmL", times, [[0, 0, -arm], [0, 0, 0], [0, 0, arm], [0, 0, 0], [0, 0, -arm]]),
    quaternionTrack("UpperArmR", times, [[0, 0, arm], [0, 0, 0], [0, 0, -arm], [0, 0, 0], [0, 0, arm]]),
    quaternionTrack("LowerArmL", times, [[0, 0, -0.30], [0, 0, -0.16], [0, 0, -0.30], [0, 0, -0.16], [0, 0, -0.30]]),
    quaternionTrack("LowerArmR", times, [[0, 0, -0.16], [0, 0, -0.30], [0, 0, -0.16], [0, 0, -0.30], [0, 0, -0.16]]),
    quaternionTrack("Chest", times, [[0, 0.09, 0], [0, 0, 0], [0, -0.09, 0], [0, 0, 0], [0, 0.09, 0]]),
    // Two bobs per stride: one for each footfall.
    new THREE.VectorKeyframeTrack("Hips.position", times,
      [0, 0.86, 0, 0, 0.895, 0, 0, 0.86, 0, 0, 0.895, 0, 0, 0.86, 0]),
  ];
  return new THREE.AnimationClip("Walk", 1, tracks);
}

function idleClip(): THREE.AnimationClip {
  const times = [0, 1, 2];
  const tracks = [
    new THREE.VectorKeyframeTrack("Hips.position", times, [0, 0.86, 0, 0, 0.874, 0, 0, 0.86, 0]),
    // A breath rocks forward about Z; the arms drift outward about X, away from the ribs.
    quaternionTrack("Chest", times, [[0, 0, 0], [0, 0, 0.035], [0, 0, 0]]),
    quaternionTrack("UpperArmL", times, [[0.04, 0, 0], [0.09, 0, 0], [0.04, 0, 0]]),
    quaternionTrack("UpperArmR", times, [[-0.04, 0, 0], [-0.09, 0, 0], [-0.04, 0, 0]]),
    quaternionTrack("Head", times, [[0, 0.05, 0], [0, -0.05, 0], [0, 0.05, 0]]),
  ];
  return new THREE.AnimationClip("Idle", 2, tracks);
}

/** The palette for an avatar file name, falling back to the civic maker's. */
export function avatarPalette(stem: string): AvatarPalette {
  return PALETTES[stem] ?? DEFAULT_PALETTE;
}

export function isPixelAvatarStem(stem: string): boolean {
  return Object.hasOwn(PALETTES, stem);
}

/**
 * A skinned pixel citizen with Idle and Walk clips, shaped like the GLB it replaces:
 * one SkinnedMesh under a group, bound to a fifteen-joint MercedonianHumanoid.
 */
export function buildPixelAvatar(stem: string): { scene: THREE.Group; animations: THREE.AnimationClip[] } {
  const palette = avatarPalette(stem);
  const { bones, root, index } = buildSkeleton();
  const geometry = buildGeometry(palette, index);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  material.name = `MAT_PIXEL_${stem.toUpperCase().replace(/-/g, "_")}`;

  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = `MESH_PIXEL_${stem.toUpperCase().replace(/-/g, "_")}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;

  const scene = new THREE.Group();
  scene.name = `MM_PIXEL_${stem.toUpperCase().replace(/-/g, "_")}`;
  scene.add(root);
  scene.add(mesh);
  // Bind matrices come from the rest pose, so world matrices must be current first.
  scene.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton, new THREE.Matrix4());

  return { scene, animations: [idleClip(), walkClip()] };
}

export const PIXEL_AVATAR_STEMS = Object.keys(PALETTES);
