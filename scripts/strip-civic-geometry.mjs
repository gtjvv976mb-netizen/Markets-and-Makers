// Removes the baked civic landmark geometry from the Highlands world.
//
// The nine government buildings are ~32k triangles each, 293k in total, and the client
// now generates them (src/proceduralAssets.ts) rather than drawing the baked ones. They
// were still being downloaded, because they live inside the shared terrain buffers.
//
// This excises those nodes and compacts everything that becomes unreachable: meshes,
// accessors, buffer views, materials, textures and images, then rewrites the buffers
// with only the retained ranges. The civic nodes are scene roots and no buffer view is
// interleaved, so no other node's geometry moves.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../game/public/assets/world/highlands-rivers-v1");
const gltf = JSON.parse(readFileSync(resolve(root, "world.gltf"), "utf8"));
const buffers = gltf.buffers.map((b) => readFileSync(resolve(root, b.uri)));

const isCivic = (node) => typeof node.name === "string" && node.name.startsWith("MM_CIVIC_");
const doomed = new Set(gltf.nodes.map((n, i) => (isCivic(n) ? i : -1)).filter((i) => i >= 0));
if (doomed.size !== 9) throw new Error(`expected 9 civic nodes, found ${doomed.size}`);

// Everything a civic node owns, including its descendants.
const collect = (index, out) => {
  out.add(index);
  for (const child of gltf.nodes[index].children ?? []) collect(child, out);
};
const removedNodes = new Set();
for (const index of doomed) collect(index, removedNodes);

// --- what survives ---------------------------------------------------------
const keptNodes = gltf.nodes.map((_, i) => i).filter((i) => !removedNodes.has(i));
const nodeMap = new Map(keptNodes.map((old, next) => [old, next]));

const usedMeshes = new Set();
for (const index of keptNodes) {
  const mesh = gltf.nodes[index].mesh;
  if (Number.isInteger(mesh)) usedMeshes.add(mesh);
}
const keptMeshes = [...usedMeshes].sort((a, b) => a - b);
const meshMap = new Map(keptMeshes.map((old, next) => [old, next]));

const usedAccessors = new Set();
const usedMaterials = new Set();
for (const index of keptMeshes) {
  for (const primitive of gltf.meshes[index].primitives ?? []) {
    for (const accessor of Object.values(primitive.attributes ?? {})) usedAccessors.add(accessor);
    if (Number.isInteger(primitive.indices)) usedAccessors.add(primitive.indices);
    if (Number.isInteger(primitive.material)) usedMaterials.add(primitive.material);
  }
}
const keptAccessors = [...usedAccessors].sort((a, b) => a - b);
const accessorMap = new Map(keptAccessors.map((old, next) => [old, next]));

const usedViews = new Set();
for (const index of keptAccessors) {
  const view = gltf.accessors[index].bufferView;
  if (Number.isInteger(view)) usedViews.add(view);
}
const keptViews = [...usedViews].sort((a, b) => a - b);
const viewMap = new Map(keptViews.map((old, next) => [old, next]));

const keptMaterials = [...usedMaterials].sort((a, b) => a - b);
const materialMap = new Map(keptMaterials.map((old, next) => [old, next]));

const usedTextures = new Set();
// A glTF texture reference is {index, texCoord?} and texCoord is optional — keying on
// its presence found nothing and silently dropped every image. Key on the slot name.
const isTextureSlot = (key) => key.endsWith("Texture");
const walkTextures = (value) => {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const entry of value) walkTextures(entry); return; }
  for (const [key, entry] of Object.entries(value)) {
    if (isTextureSlot(key) && entry && Number.isInteger(entry.index)) usedTextures.add(entry.index);
    walkTextures(entry);
  }
};
for (const index of keptMaterials) walkTextures(gltf.materials[index]);
const keptTextures = [...usedTextures].sort((a, b) => a - b);
const textureMap = new Map(keptTextures.map((old, next) => [old, next]));

const usedImages = new Set();
for (const index of keptTextures) {
  const source = gltf.textures[index].source;
  if (Number.isInteger(source)) usedImages.add(source);
}
const keptImages = [...usedImages].sort((a, b) => a - b);
const imageMap = new Map(keptImages.map((old, next) => [old, next]));

// --- rebuild the buffers ---------------------------------------------------
const align = (n) => (n + 3) & ~3;
const rebuilt = gltf.buffers.map(() => []);
const lengths = gltf.buffers.map(() => 0);
const newViews = [];
for (const index of keptViews) {
  const view = gltf.bufferViews[index];
  const source = buffers[view.buffer];
  const start = view.byteOffset ?? 0;
  const slice = source.subarray(start, start + view.byteLength);
  const offset = align(lengths[view.buffer]);
  if (offset > lengths[view.buffer]) rebuilt[view.buffer].push(Buffer.alloc(offset - lengths[view.buffer]));
  rebuilt[view.buffer].push(slice);
  lengths[view.buffer] = offset + view.byteLength;
  const next = { ...view, byteOffset: offset };
  delete next.name;
  newViews.push(next);
}

// --- reindex ---------------------------------------------------------------
gltf.bufferViews = newViews;
gltf.accessors = keptAccessors.map((index) => {
  const accessor = { ...gltf.accessors[index] };
  if (Number.isInteger(accessor.bufferView)) accessor.bufferView = viewMap.get(accessor.bufferView);
  return accessor;
});
gltf.meshes = keptMeshes.map((index) => {
  const mesh = { ...gltf.meshes[index] };
  mesh.primitives = (mesh.primitives ?? []).map((primitive) => {
    const next = { ...primitive };
    next.attributes = Object.fromEntries(
      Object.entries(primitive.attributes ?? {}).map(([name, accessor]) => [name, accessorMap.get(accessor)]),
    );
    if (Number.isInteger(primitive.indices)) next.indices = accessorMap.get(primitive.indices);
    if (Number.isInteger(primitive.material)) next.material = materialMap.get(primitive.material);
    return next;
  });
  return mesh;
});
const remapTextureRefs = (value) => {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(remapTextureRefs);
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isTextureSlot(key) && entry && Number.isInteger(entry.index)) {
      next[key] = { ...entry, index: textureMap.get(entry.index) };
    } else {
      next[key] = remapTextureRefs(entry);
    }
  }
  return next;
};
gltf.materials = keptMaterials.map((index) => remapTextureRefs(gltf.materials[index]));
gltf.textures = keptTextures.map((index) => {
  const texture = { ...gltf.textures[index] };
  if (Number.isInteger(texture.source)) texture.source = imageMap.get(texture.source);
  return texture;
});
gltf.images = keptImages.map((index) => gltf.images[index]);
gltf.nodes = keptNodes.map((index) => {
  const node = { ...gltf.nodes[index] };
  if (Number.isInteger(node.mesh)) node.mesh = meshMap.get(node.mesh);
  if (node.children) {
    const children = node.children.filter((c) => nodeMap.has(c)).map((c) => nodeMap.get(c));
    if (children.length > 0) node.children = children; else delete node.children;
  }
  return node;
});
gltf.scenes = gltf.scenes.map((scene) => ({
  ...scene,
  nodes: (scene.nodes ?? []).filter((n) => nodeMap.has(n)).map((n) => nodeMap.get(n)),
}));

gltf.buffers = gltf.buffers.map((buffer, i) => ({ ...buffer, byteLength: lengths[i] }));

// --- write and re-lock -----------------------------------------------------
if (keptImages.length === 0 && gltf.images.length > 0) {
  throw new Error("every image became unreachable — texture reference detection is wrong, refusing to write");
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const packageManifest = JSON.parse(readFileSync(resolve(root, "browser-package.json"), "utf8"));
const before = { gltf: readFileSync(resolve(root, "world.gltf")).length, buffers: buffers.map((b) => b.length) };

gltf.buffers.forEach((buffer, i) => {
  const bytes = Buffer.concat(rebuilt[i]);
  writeFileSync(resolve(root, buffer.uri), bytes);
  const entry = packageManifest.files.find((f) => f.file === buffer.uri);
  if (entry) { entry.bytes = bytes.length; entry.sha256 = sha(bytes); }
});
const gltfText = JSON.stringify(gltf);
writeFileSync(resolve(root, "world.gltf"), gltfText);
const gltfEntry = packageManifest.files.find((f) => f.file === "world.gltf");
if (gltfEntry) { gltfEntry.bytes = Buffer.byteLength(gltfText); gltfEntry.sha256 = sha(Buffer.from(gltfText)); }
// The manifest also declares the graph's shape, and the validator checks it.
packageManifest.counts = {
  ...packageManifest.counts,
  nodes: gltf.nodes.length,
  meshes: gltf.meshes.length,
  materials: gltf.materials.length,
  images: gltf.images.length,
  buffers: gltf.buffers.length,
  bufferViews: gltf.bufferViews.length,
};
writeFileSync(resolve(root, "browser-package.json"), JSON.stringify(packageManifest, null, 2) + "\n");

const after = { gltf: Buffer.byteLength(gltfText), buffers: lengths };
const mb = (n) => (n / 1048576).toFixed(2);
console.log(`  nodes      ${gltf.nodes.length + removedNodes.size} -> ${gltf.nodes.length}  (removed ${removedNodes.size})`);
console.log(`  meshes     ${keptMeshes.length + (276 - keptMeshes.length)} -> ${keptMeshes.length}`);
console.log(`  accessors  ${keptAccessors.length} kept`);
console.log(`  images     ${keptImages.length} kept`);
console.log(`  world.gltf ${mb(before.gltf)} MB -> ${mb(after.gltf)} MB`);
before.buffers.forEach((b, i) => console.log(`  ${gltf.buffers[i].uri}  ${mb(b)} MB -> ${mb(after.buffers[i])} MB`));
const saved = before.gltf + before.buffers.reduce((a, b) => a + b, 0) - after.gltf - after.buffers.reduce((a, b) => a + b, 0);
console.log(`  total saved ${mb(saved)} MB`);
