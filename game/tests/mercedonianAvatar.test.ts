import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { STANDARD_CHARACTER_HEIGHT_M } from "../src/characterRig";
import interiorSource from "../src/interiorWorld.ts?raw";
import {
  CIVIC_PLAYER_AVATAR_GROUNDING,
  CIVIC_PLAYER_AVATAR_STEM,
  createPlayerMercedonian,
} from "../src/mercedonianAvatar";

const meshesIn = (root: THREE.Object3D): THREE.Mesh[] => {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
};

describe("shared player Mercedonian", () => {
  it("keeps one canonical civic identity, height and ground contact", () => {
    expect(CIVIC_PLAYER_AVATAR_STEM).toBe("av01-civic-maker");
    expect(CIVIC_PLAYER_AVATAR_GROUNDING).toMatchObject({
      baseAnchorXZ: [0.045, 0.012],
      groundClearanceM: 0.01,
      frontAxis: "+X",
      yawCorrectionDegrees: -90,
    });

    const { group } = createPlayerMercedonian(false);
    const bounds = new THREE.Box3().setFromObject(group, true);
    const height = bounds.max.y - bounds.min.y;

    expect(group.name).toBe("MM_CIVIC_MERCEDONIAN_PLAYER_MODEL");
    expect(group.userData.avatarStem).toBe(CIVIC_PLAYER_AVATAR_STEM);
    expect(group.userData.characterHeightM).toBe(STANDARD_CHARACTER_HEIGHT_M);
    // Skinning expands and contracts the posed bounds by a few millimetres; the
    // canonical authored target stays 1.82 m and rendered geometry stays within 2 cm.
    expect(Math.abs(height - STANDARD_CHARACTER_HEIGHT_M)).toBeLessThan(0.02);
    expect(bounds.min.y).toBeCloseTo(CIVIC_PLAYER_AVATAR_GROUNDING.groundClearanceM, 2);
  });

  it("wraps the authored +X figure as the actor's corrected +Z-facing visual", () => {
    const { group } = createPlayerMercedonian(false);
    const facing = group.getObjectByName("MM_CIVIC_MERCEDONIAN_FACING_CORRECTION");

    expect(group.userData.actorFrontAxis).toBe("+Z");
    expect(facing).toBeDefined();
    expect(facing!.parent).toBe(group);
    expect(facing!.rotation.y).toBeCloseTo(-Math.PI / 2, 8);
  });

  it("supplies the Idle and in-place Walk clips both renderers animate", () => {
    const { animations } = createPlayerMercedonian(false);

    expect(THREE.AnimationClip.findByName(animations, "Idle")).toBeTruthy();
    expect(THREE.AnimationClip.findByName(animations, "Walk")).toBeTruthy();
  });

  it("obeys the destination renderer's shadow gate for mobile", () => {
    const mobileMeshes = meshesIn(createPlayerMercedonian(false).group);
    const desktopMeshes = meshesIn(createPlayerMercedonian(true).group);

    expect(mobileMeshes.length).toBeGreaterThan(0);
    expect(mobileMeshes.every((mesh) => !mesh.castShadow && !mesh.receiveShadow)).toBe(true);
    expect(desktopMeshes.every((mesh) => mesh.castShadow && mesh.receiveShadow)).toBe(true);
  });

  it("gives the world and interior independent skeleton instances", () => {
    const first = createPlayerMercedonian(false).group;
    const second = createPlayerMercedonian(false).group;
    const firstSkin = meshesIn(first).find((mesh) => mesh instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh;
    const secondSkin = meshesIn(second).find((mesh) => mesh instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh;

    expect(first).not.toBe(second);
    expect(firstSkin).toBeDefined();
    expect(secondSkin).toBeDefined();
    expect(firstSkin.skeleton).not.toBe(secondSkin.skeleton);
    expect(firstSkin.skeleton.bones[0]).not.toBe(secondSkin.skeleton.bones[0]);
  });
});

describe("interior Mercedonian integration", () => {
  it("uses the shared factory and keeps the low-detail fallback inside its failure path", () => {
    expect(interiorSource).toContain('from "./mercedonianAvatar"');
    expect(interiorSource).toContain("createPlayerMercedonian(this.renderer.shadowMap.enabled)");

    const setupPlayer = interiorSource.match(/private setupPlayer\(\): void \{[\s\S]*?\n  \}\n\n  private /)?.[0] ?? "";
    const factoryCall = setupPlayer.indexOf("createPlayerMercedonian(");
    const catchClause = setupPlayer.indexOf("catch");
    const sharedPlayerAdded = setupPlayer.indexOf("this.player.add(mercedonian.group)");
    const fallbackFactory = setupPlayer.indexOf("this.createPlayerFallback()");
    const fallbackName = setupPlayer.indexOf('"interior-mercedonian-fallback"');

    expect(setupPlayer).not.toBe("");
    expect(factoryCall).toBeGreaterThanOrEqual(0);
    expect(catchClause).toBeGreaterThan(factoryCall);
    expect(sharedPlayerAdded).toBeGreaterThan(factoryCall);
    expect(sharedPlayerAdded).toBeLessThan(catchClause);
    expect(fallbackFactory).toBeGreaterThan(catchClause);
    expect(fallbackName).toBeGreaterThan(fallbackFactory);
    expect(setupPlayer.slice(0, catchClause)).not.toContain("createPlayerFallback");
    expect(setupPlayer.slice(0, catchClause)).not.toContain("interior-mercedonian-fallback");
  });
});
