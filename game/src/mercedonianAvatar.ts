import * as THREE from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import {
  STANDARD_CHARACTER_HEIGHT_M,
  characterHeightScale,
  yawCorrectionFor,
  type CharacterFrontAxis,
} from "./characterRig";
import { buildPixelAvatar } from "./pixelAvatar";

/** Stable internal asset identity retained for manifest and save compatibility. */
export const CIVIC_PLAYER_AVATAR_STEM = "av01-civic-maker";

/**
 * One canonical grounding/facing contract for the player's Mercedonian everywhere.
 * The values mirror the world-design manifest, but live here so interiors and the
 * open world cannot silently prepare the same character in two different ways.
 */
export const CIVIC_PLAYER_AVATAR_GROUNDING = {
  baseAnchorXZ: [0.045, 0.012] as const,
  groundClearanceM: 0.01,
  frontAxis: "+X" as CharacterFrontAxis,
  yawCorrectionDegrees: -90,
};

export interface PreparedMercedonianAvatar {
  group: THREE.Group;
  animations: THREE.AnimationClip[];
}

export interface PrepareMercedonianAvatarOptions {
  baseAnchorXZ: readonly [x: number, z: number];
  groundClearanceM: number;
  frontAxis: CharacterFrontAxis;
  yawCorrectionDegrees?: number;
  dynamicShadows: boolean;
}

/**
 * Normalize a rigged Mercedonian to the same scale, ground contact, facing axis and
 * shadow policy in every renderer. SkeletonUtils is required: a normal deep clone
 * leaves skinned meshes bound to the source skeleton.
 */
export function prepareMercedonianAvatar(
  source: THREE.Object3D,
  animations: THREE.AnimationClip[],
  options: PrepareMercedonianAvatarOptions,
): PreparedMercedonianAvatar {
  const avatar = cloneSkeleton(source) as THREE.Group;
  const bounds = new THREE.Box3().setFromObject(avatar, true);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = characterHeightScale(size.y);
  avatar.scale.setScalar(scale);
  avatar.position.set(
    -(bounds.min.x + bounds.max.x) * 0.5 * scale - options.baseAnchorXZ[0],
    -bounds.min.y * scale + options.groundClearanceM,
    -(bounds.min.z + bounds.max.z) * 0.5 * scale - options.baseAnchorXZ[1],
  );
  avatar.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = options.dynamicShadows;
    object.receiveShadow = options.dynamicShadows;
    object.frustumCulled = true;
  });

  const wrapper = new THREE.Group();
  wrapper.name = "MM_CIVIC_MERCEDONIAN_PLAYER_MODEL";
  wrapper.userData.characterHeightM = STANDARD_CHARACTER_HEIGHT_M;
  wrapper.userData.avatarStem = CIVIC_PLAYER_AVATAR_STEM;
  wrapper.userData.actorFrontAxis = "+Z";

  const facing = new THREE.Group();
  facing.name = "MM_CIVIC_MERCEDONIAN_FACING_CORRECTION";
  facing.rotation.y = Number.isFinite(options.yawCorrectionDegrees)
    ? THREE.MathUtils.degToRad(options.yawCorrectionDegrees ?? 0)
    : yawCorrectionFor(options.frontAxis);
  facing.add(avatar);
  wrapper.add(facing);

  return { group: wrapper, animations };
}

/**
 * Build the exact player Mercedonian used by the live open world. It is intentionally
 * generated in-browser: the old GLB-shaped manifest URL is only a stable asset key and
 * no avatar GLB is shipped in the public build.
 */
export function createPlayerMercedonian(dynamicShadows: boolean): PreparedMercedonianAvatar {
  const generated = buildPixelAvatar(CIVIC_PLAYER_AVATAR_STEM);
  return prepareMercedonianAvatar(generated.scene, generated.animations, {
    ...CIVIC_PLAYER_AVATAR_GROUNDING,
    dynamicShadows,
  });
}
