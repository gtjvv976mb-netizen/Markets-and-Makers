import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildPixelAvatar, isPixelAvatarStem, PIXEL_AVATAR_JOINTS, PIXEL_AVATAR_STEMS } from "../src/pixelAvatar";
import citizenManifest from "../public/assets/avatars/mercedonians/runtime/manifest.json";
import worldDesignManifest from "../public/assets/world/highlands-rivers-v1/world-designs-v1/manifest.json";

const citizens = (citizenManifest as { avatars: Array<{ file: string; rig: { joints: number } }> }).avatars;
const designAvatar = (worldDesignManifest as { assets: Array<{ category: string; file: string }> })
  .assets.find((asset) => asset.category === "avatar")!;
// Mirrors the loader: manifest files carry a directory, the catalogue is keyed by name.
const stem = (file: string): string => (file.split("/").pop() ?? "").replace(/\.glb$/i, "");

describe("pixel citizens", () => {
  // The GLBs are no longer shipped, so a name the builder does not answer would leave
  // that citizen invisible rather than raising an error.
  it("answers every citizen the runtime manifest declares", () => {
    const missing = citizens.map((avatar) => stem(avatar.file)).filter((name) => !isPixelAvatarStem(name));
    expect(missing).toEqual([]);
  });

  it("answers the civic player avatar too", () => {
    expect(isPixelAvatarStem(stem(designAvatar.file))).toBe(true);
  });

  it("covers exactly the ten avatars the game asks for", () => {
    expect(PIXEL_AVATAR_STEMS.length).toBe(citizens.length + 1);
  });

  it("builds a skinned mesh on the fifteen-joint rig the manifest declares", () => {
    expect(PIXEL_AVATAR_JOINTS).toBe(15);
    for (const avatar of citizens) expect(avatar.rig.joints).toBe(PIXEL_AVATAR_JOINTS);
    const { scene } = buildPixelAvatar("av02-urban-gardener");
    let skinned: THREE.SkinnedMesh | null = null;
    scene.traverse((object) => {
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) skinned = object as THREE.SkinnedMesh;
    });
    expect(skinned).not.toBeNull();
    expect(skinned!.skeleton.bones.length).toBe(15);
    expect(skinned!.geometry.attributes.skinIndex).toBeDefined();
    expect(skinned!.geometry.attributes.skinWeight).toBeDefined();
    expect(skinned!.geometry.attributes.color).toBeDefined();
  });

  it("ships the Idle and Walk clips the mixer looks up by name", () => {
    for (const name of PIXEL_AVATAR_STEMS) {
      const { animations } = buildPixelAvatar(name);
      expect(THREE.AnimationClip.findByName(animations, "Idle")).toBeTruthy();
      expect(THREE.AnimationClip.findByName(animations, "Walk")).toBeTruthy();
    }
  });

  it("stands the standard 1.82 m tall, so height normalisation is a no-op", () => {
    const { scene } = buildPixelAvatar("av01-civic-maker");
    const bounds = new THREE.Box3().setFromObject(scene, true);
    const height = bounds.max.y - bounds.min.y;
    expect(height).toBeGreaterThan(1.7);
    expect(height).toBeLessThan(1.95);
    // Feet on the floor: the figure is authored from zero up.
    expect(Math.abs(bounds.min.y)).toBeLessThan(0.05);
  });

  it("keeps the walk in place, because the world moves the character", () => {
    const { animations } = buildPixelAvatar("av03-solar-technician");
    const walk = THREE.AnimationClip.findByName(animations, "Walk")!;
    const hips = walk.tracks.find((track) => track.name === "Hips.position");
    expect(hips).toBeDefined();
    const values = Array.from(hips!.values);
    const xs = values.filter((_, index) => index % 3 === 0);
    const zs = values.filter((_, index) => index % 3 === 2);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(0);
    expect(Math.max(...zs) - Math.min(...zs)).toBe(0);
    // It should still bob, or the walk reads as a glide.
    const ys = values.filter((_, index) => index % 3 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.01);
  });

  it("gives the legs a real stride rather than a twitch", () => {
    const { animations } = buildPixelAvatar("av06-harbor-courier");
    const walk = THREE.AnimationClip.findByName(animations, "Walk")!;
    const thigh = walk.tracks.find((track) => track.name === "UpperLegL.quaternion")!;
    // Recover the swing angle from the quaternions rather than trusting the authored
    // numbers: 2*atan2(|xyz|, w) is the rotation each key actually carries.
    const angles: number[] = [];
    for (let i = 0; i < thigh.values.length; i += 4) {
      const [x, y, z, w] = [thigh.values[i]!, thigh.values[i + 1]!, thigh.values[i + 2]!, thigh.values[i + 3]!];
      angles.push(2 * Math.atan2(Math.hypot(x, y, z), w) * Math.sign(x || 1));
    }
    const swingDegrees = (Math.max(...angles) - Math.min(...angles)) * (180 / Math.PI);
    expect(swingDegrees).toBeGreaterThan(45);
    expect(swingDegrees).toBeLessThan(110);
  });

  it("gives each trade its own colours, so a crowd is not one person repeated", () => {
    const shirts = new Set<string>();
    for (const name of PIXEL_AVATAR_STEMS) {
      const { scene } = buildPixelAvatar(name);
      let signature = "";
      scene.traverse((object) => {
        const mesh = object as THREE.SkinnedMesh;
        if (!mesh.isSkinnedMesh) return;
        const colours = mesh.geometry.attributes.color!;
        signature = Array.from({ length: 12 }, (_, i) => colours.array[i * 97]!.toFixed(3)).join(",");
      });
      shirts.add(signature);
    }
    expect(shirts.size).toBe(PIXEL_AVATAR_STEMS.length);
  });
});
