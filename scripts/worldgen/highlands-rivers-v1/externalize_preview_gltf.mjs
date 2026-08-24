#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const MAX_BUFFER_BYTES = 18 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function align4(value) {
  return (value + 3) & ~3;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeName(value, fallback) {
  const normalized = String(value ?? fallback)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || fallback;
}

function mimeExtension(mimeType) {
  switch (mimeType) {
    case "image/jpeg": return ".jpg";
    case "image/png": return ".png";
    case "image/webp": return ".webp";
    case "image/ktx2": return ".ktx2";
    default: fail(`Unsupported embedded image MIME type: ${mimeType}`);
  }
}

function parseGlb(bytes) {
  if (bytes.length < 20) fail("GLB is too small");
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) fail("Input is not a GLB 2.0 file");
  if (bytes.readUInt32LE(4) !== 2) fail("Only GLB 2.0 is supported");
  if (bytes.readUInt32LE(8) !== bytes.length) fail("GLB declared length does not match file size");

  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) fail("GLB chunk exceeds file length");
    if (type === JSON_CHUNK) json = JSON.parse(bytes.subarray(start, end).toString("utf8").replace(/\u0000+$/g, "").trimEnd());
    if (type === BIN_CHUNK) binary = bytes.subarray(start, end);
    offset = end;
  }
  if (!json || !binary) fail("GLB must contain JSON and BIN chunks");
  if ((json.buffers?.length ?? 0) !== 1) fail("Expected exactly one embedded GLB buffer");
  return { json, binary };
}

async function main() {
  const [sourceArg, outputArg] = process.argv.slice(2);
  if (!sourceArg || !outputArg) {
    fail("Usage: node externalize_preview_gltf.mjs <source.glb> <output-directory>");
  }

  const source = resolve(sourceArg);
  const output = resolve(outputArg);
  const glbBytes = await readFile(source);
  const { json, binary } = parseGlb(glbBytes);
  const originalViews = json.bufferViews ?? [];
  const embeddedImageViews = new Set(
    (json.images ?? []).map((image) => image.bufferView).filter((value) => Number.isInteger(value)),
  );

  await rm(output, { recursive: true, force: true });
  await mkdir(join(output, "buffers"), { recursive: true });
  await mkdir(join(output, "textures"), { recursive: true });

  const files = [];
  const recordFile = async (absolutePath, bytes) => {
    await writeFile(absolutePath, bytes);
    files.push({
      file: relative(output, absolutePath).replaceAll("\\", "/"),
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  };

  for (const [index, image] of (json.images ?? []).entries()) {
    if (!Number.isInteger(image.bufferView)) continue;
    const view = originalViews[image.bufferView];
    if (!view || view.buffer !== 0) fail(`Image ${index} references an invalid bufferView`);
    const start = view.byteOffset ?? 0;
    const end = start + view.byteLength;
    if (end > binary.length) fail(`Image ${index} exceeds the GLB binary chunk`);
    const extension = mimeExtension(image.mimeType);
    const filename = `${String(index).padStart(2, "0")}-${safeName(image.name, `texture-${index}`)}${extension}`;
    const data = Buffer.from(binary.subarray(start, end));
    await recordFile(join(output, "textures", filename), data);
    image.uri = `textures/${filename}`;
    delete image.bufferView;
    delete image.mimeType;
  }

  const oldToNewView = new Map();
  const retainedViews = [];
  for (const [oldIndex, view] of originalViews.entries()) {
    if (embeddedImageViews.has(oldIndex)) continue;
    oldToNewView.set(oldIndex, retainedViews.length);
    retainedViews.push({ ...view });
  }

  const remapView = (oldIndex, context) => {
    if (!Number.isInteger(oldIndex)) return oldIndex;
    const next = oldToNewView.get(oldIndex);
    if (!Number.isInteger(next)) fail(`${context} points to an extracted image bufferView`);
    return next;
  };
  for (const [index, accessor] of (json.accessors ?? []).entries()) {
    if (Number.isInteger(accessor.bufferView)) accessor.bufferView = remapView(accessor.bufferView, `accessor ${index}`);
    if (accessor.sparse) {
      accessor.sparse.indices.bufferView = remapView(accessor.sparse.indices.bufferView, `accessor ${index} sparse indices`);
      accessor.sparse.values.bufferView = remapView(accessor.sparse.values.bufferView, `accessor ${index} sparse values`);
    }
  }

  const bufferParts = [];
  let current = { chunks: [], length: 0 };
  for (let newIndex = 0; newIndex < retainedViews.length; newIndex += 1) {
    const view = retainedViews[newIndex];
    if (view.buffer !== 0) fail(`bufferView ${newIndex} does not reference the embedded GLB buffer`);
    const oldIndex = [...oldToNewView.entries()].find(([, mapped]) => mapped === newIndex)?.[0];
    const sourceView = originalViews[oldIndex];
    const sourceStart = sourceView.byteOffset ?? 0;
    const sourceEnd = sourceStart + sourceView.byteLength;
    if (sourceEnd > binary.length) fail(`bufferView ${oldIndex} exceeds the GLB binary chunk`);
    const paddedStart = align4(current.length);
    if (current.chunks.length > 0 && paddedStart + sourceView.byteLength > MAX_BUFFER_BYTES) {
      bufferParts.push(current);
      current = { chunks: [], length: 0 };
    }
    const targetOffset = align4(current.length);
    current.chunks.push({ targetOffset, data: Buffer.from(binary.subarray(sourceStart, sourceEnd)) });
    current.length = targetOffset + sourceView.byteLength;
    view.buffer = bufferParts.length;
    view.byteOffset = targetOffset;
  }
  if (current.chunks.length > 0) bufferParts.push(current);

  json.bufferViews = retainedViews;
  json.buffers = [];
  for (const [index, part] of bufferParts.entries()) {
    const bytes = Buffer.alloc(align4(part.length));
    for (const chunk of part.chunks) chunk.data.copy(bytes, chunk.targetOffset);
    const filename = `world-${index}.bin`;
    await recordFile(join(output, "buffers", filename), bytes);
    json.buffers.push({ uri: `buffers/${filename}`, byteLength: bytes.length });
  }

  json.asset = {
    ...json.asset,
    extras: {
      ...(json.asset?.extras ?? {}),
      browserPackage: "markets-and-makers.highlands-rivers-world.browser.v1",
      sourceGlb: basename(source),
      sourceSha256: sha256(glbBytes),
    },
  };
  const gltfBytes = Buffer.from(`${JSON.stringify(json)}\n`, "utf8");
  await recordFile(join(output, "world.gltf"), gltfBytes);

  const packageManifest = {
    schema: "markets-and-makers.highlands-rivers-world.browser-package.v1",
    version: 1,
    source: { file: basename(source), bytes: glbBytes.length, sha256: sha256(glbBytes) },
    entrypoint: "world.gltf",
    limits: { maximum_buffer_bytes: MAX_BUFFER_BYTES },
    counts: {
      nodes: json.nodes?.length ?? 0,
      meshes: json.meshes?.length ?? 0,
      materials: json.materials?.length ?? 0,
      images: json.images?.length ?? 0,
      buffers: json.buffers.length,
      bufferViews: json.bufferViews.length,
    },
    files: [...files].sort((a, b) => a.file.localeCompare(b.file)),
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(packageManifest, null, 2)}\n`, "utf8");
  await recordFile(join(output, "browser-package.json"), manifestBytes);
  console.log(JSON.stringify({ output, ...packageManifest.counts, bytes: files.reduce((sum, file) => sum + file.bytes, 0) }, null, 2));
}

await main();
