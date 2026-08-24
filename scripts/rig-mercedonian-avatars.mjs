import fs from "node:fs";
import path from "node:path";
import { MeshoptDecoder } from "../game/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js";

const sourceRoot = "/Users/michaelkennethbrillantes/Desktop/MM/avatar/avatar";
const outputRoot = path.resolve("game/public/assets/avatars/mercedonians");
const avatars = [
  ["av02_urban_gardener/New_Project_8242026.glb", "av02-urban-gardener.glb"],
  ["av03_solar_technician/New_Project_8242026 (1).glb", "av03-solar-technician.glb"],
  ["av04_market_grocer/New_Project_8242026.glb", "av04-market-grocer.glb"],
  ["av05_fabricator_engineer/New_Project_8242026 (1).glb", "av05-fabricator-engineer.glb"],
  ["av06_harbor_courier/New_Project_8242026.glb", "av06-harbor-courier.glb"],
  ["av07_community_chef/New_Project_8242026.glb", "av07-community-chef.glb"],
  ["av08_cooperative_shopkeeper/New_Project_8242026 (1).glb", "av08-cooperative-shopkeeper.glb"],
  ["av10_repair_mechanic/New_Project_8242026.glb", "av10-repair-mechanic.glb"],
  ["av12_water_systems_biologist/New_Project_8242026 (1).glb", "av12-water-systems-biologist.glb"],
];

const joints = [
  { name: "Hips", parent: -1, t: [0, -0.06, 0] },
  { name: "Spine", parent: 0, t: [0, 0.21, 0] },
  { name: "Chest", parent: 1, t: [0, 0.25, 0] },
  { name: "Neck", parent: 2, t: [0, 0.22, 0] },
  { name: "Head", parent: 3, t: [0, 0.18, 0] },
  { name: "LeftUpperArm", parent: 2, t: [0.14, 0.12, 0] },
  { name: "LeftLowerArm", parent: 5, t: [0.20, -0.12, 0] },
  { name: "RightUpperArm", parent: 2, t: [-0.14, 0.12, 0] },
  { name: "RightLowerArm", parent: 7, t: [-0.20, -0.12, 0] },
  { name: "LeftUpperLeg", parent: 0, t: [0.075, -0.02, 0] },
  { name: "LeftLowerLeg", parent: 9, t: [0, -0.40, 0] },
  { name: "LeftFoot", parent: 10, t: [0, -0.36, 0.06] },
  { name: "RightUpperLeg", parent: 0, t: [-0.075, -0.02, 0] },
  { name: "RightLowerLeg", parent: 12, t: [0, -0.40, 0] },
  { name: "RightFoot", parent: 13, t: [0, -0.36, 0.06] },
];

const align4 = (value) => (value + 3) & ~3;
const quatX = (angle) => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
const quatZ = (angle) => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];

function parseGlb(file) {
  const bytes = fs.readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString().replace(/\0+$/, ""));
  const binHeader = 20 + jsonLength;
  const binLength = bytes.readUInt32LE(binHeader);
  return { json, bin: Buffer.from(bytes.subarray(binHeader + 8, binHeader + 8 + binLength)) };
}

function writeGlb(file, json, bin) {
  json.buffers[0].byteLength = bin.length;
  const rawJson = Buffer.from(JSON.stringify(json));
  const jsonLength = align4(rawJson.length);
  const binLength = align4(bin.length);
  const output = Buffer.alloc(12 + 8 + jsonLength + 8 + binLength, 0x20);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonLength, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  rawJson.copy(output, 20);
  const binHeader = 20 + jsonLength;
  output.writeUInt32LE(binLength, binHeader);
  output.writeUInt32LE(0x004e4942, binHeader + 4);
  bin.copy(output, binHeader + 8);
  fs.writeFileSync(file, output);
}

function appendData(state, data, options) {
  const offset = align4(state.bin.length);
  state.bin = Buffer.concat([state.bin, Buffer.alloc(offset - state.bin.length), Buffer.from(data.buffer, data.byteOffset, data.byteLength)]);
  const view = state.json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.byteLength, ...(options.target ? { target: options.target } : {}) }) - 1;
  return state.json.accessors.push({ bufferView: view, byteOffset: 0, componentType: options.componentType, count: options.count, type: options.type, ...(options.normalized ? { normalized: true } : {}), ...(options.min ? { min: options.min } : {}), ...(options.max ? { max: options.max } : {}) }) - 1;
}

async function decodedPositions(json, bin, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const extension = view.extensions?.EXT_meshopt_compression;
  if (!extension) throw new Error("Expected meshopt-compressed avatar positions.");
  await MeshoptDecoder.ready;
  const decoded = new Uint8Array(extension.count * extension.byteStride);
  MeshoptDecoder.decodeGltfBuffer(decoded, extension.count, extension.byteStride, bin.subarray(extension.byteOffset, extension.byteOffset + extension.byteLength), extension.mode, extension.filter);
  return { values: new Int16Array(decoded.buffer), stride: extension.byteStride / 2, count: accessor.count };
}

function addInfluence(jointData, weightData, vertex, first, second = first, blend = 0) {
  const offset = vertex * 4;
  jointData[offset] = first;
  jointData[offset + 1] = second;
  weightData[offset] = Math.round((1 - blend) * 255);
  weightData[offset + 1] = Math.round(blend * 255);
}

function buildWeights(positionData) {
  const jointData = new Uint8Array(positionData.count * 4);
  const weightData = new Uint8Array(positionData.count * 4);
  for (let vertex = 0; vertex < positionData.count; vertex += 1) {
    const base = vertex * positionData.stride;
    const x = Math.max(-1, positionData.values[base] / 32767);
    const y = Math.max(-1, positionData.values[base + 1] / 32767);
    const side = x >= 0;
    if (y < -0.76) addInfluence(jointData, weightData, vertex, side ? 11 : 14);
    else if (y < -0.42) addInfluence(jointData, weightData, vertex, side ? 10 : 13, side ? 11 : 14, (y + 0.76) / 0.34);
    else if (y < -0.08) addInfluence(jointData, weightData, vertex, side ? 9 : 12, side ? 10 : 13, (y + 0.42) / 0.34);
    else if (y > 0.66) addInfluence(jointData, weightData, vertex, 4);
    else if (y > 0.54) addInfluence(jointData, weightData, vertex, 3, 4, (y - 0.54) / 0.12);
    else if (Math.abs(x) > 0.13 && y > 0.02) {
      const outer = Math.min(1, (Math.abs(x) - 0.13) / 0.12);
      addInfluence(jointData, weightData, vertex, side ? 5 : 7, side ? 6 : 8, outer);
    } else if (y > 0.30) addInfluence(jointData, weightData, vertex, 2, 3, (y - 0.30) / 0.24);
    else if (y > 0.08) addInfluence(jointData, weightData, vertex, 1, 2, (y - 0.08) / 0.22);
    else addInfluence(jointData, weightData, vertex, 0, 1, Math.max(0, (y + 0.08) / 0.16));
  }
  return { jointData, weightData };
}

function globalJointPositions() {
  return joints.map((joint, index) => {
    const result = [...joint.t];
    for (let parent = joint.parent; parent >= 0; parent = joints[parent].parent) {
      result[0] += joints[parent].t[0]; result[1] += joints[parent].t[1]; result[2] += joints[parent].t[2];
    }
    return result;
  });
}

function addAnimation(state, name, times, tracks) {
  const input = appendData(state, new Float32Array(times), { componentType: 5126, count: times.length, type: "SCALAR", min: [times[0]], max: [times.at(-1)] });
  const animation = { name, samplers: [], channels: [] };
  for (const track of tracks) {
    const flattened = new Float32Array(track.values.flat());
    const output = appendData(state, flattened, { componentType: 5126, count: times.length, type: track.path === "rotation" ? "VEC4" : "VEC3" });
    const sampler = animation.samplers.push({ input, output, interpolation: "LINEAR" }) - 1;
    animation.channels.push({ sampler, target: { node: track.node, path: track.path } });
  }
  state.json.animations.push(animation);
}

async function rig(source, output) {
  const state = parseGlb(source);
  state.json.bufferViews ??= [];
  state.json.accessors ??= [];
  state.json.animations = [];
  const primitive = state.json.meshes[0].primitives[0];
  const positions = await decodedPositions(state.json, state.bin, primitive.attributes.POSITION);
  const { jointData, weightData } = buildWeights(positions);
  primitive.attributes.JOINTS_0 = appendData(state, jointData, { componentType: 5121, count: positions.count, type: "VEC4", target: 34962 });
  primitive.attributes.WEIGHTS_0 = appendData(state, weightData, { componentType: 5121, count: positions.count, type: "VEC4", normalized: true, target: 34962 });

  const meshNode = state.json.nodes.findIndex((node) => node.mesh === 0);
  const nodeScale = state.json.nodes[meshNode].scale ?? [1, 1, 1];
  const rigRoot = state.json.nodes.push({ name: "MercedonianRig", scale: nodeScale, children: [] }) - 1;
  const jointNodes = joints.map((joint) => state.json.nodes.push({ name: joint.name, translation: joint.t, children: [] }) - 1);
  joints.forEach((joint, index) => {
    const node = jointNodes[index];
    if (joint.parent < 0) state.json.nodes[rigRoot].children.push(node);
    else state.json.nodes[jointNodes[joint.parent]].children.push(node);
  });
  state.json.scenes[state.json.scene ?? 0].nodes.push(rigRoot);

  const inverse = new Float32Array(joints.length * 16);
  globalJointPositions().forEach(([x, y, z], index) => {
    const offset = index * 16;
    inverse[offset] = 1; inverse[offset + 5] = 1; inverse[offset + 10] = 1; inverse[offset + 15] = 1;
    inverse[offset + 12] = -x; inverse[offset + 13] = -y; inverse[offset + 14] = -z;
  });
  const inverseAccessor = appendData(state, inverse, { componentType: 5126, count: joints.length, type: "MAT4" });
  state.json.skins = [{ name: "MercedonianHumanoid", inverseBindMatrices: inverseAccessor, skeleton: jointNodes[0], joints: jointNodes }];
  state.json.nodes[meshNode].skin = 0;

  const idleTimes = [0, 1, 2];
  addAnimation(state, "Idle", idleTimes, [
    { node: jointNodes[2], path: "rotation", values: [quatZ(-0.015), quatZ(0.015), quatZ(-0.015)] },
    { node: jointNodes[4], path: "rotation", values: [quatZ(0.025), quatZ(-0.025), quatZ(0.025)] },
    { node: jointNodes[0], path: "translation", values: [[0, -0.06, 0], [0, -0.052, 0], [0, -0.06, 0]] },
  ]);
  const walkTimes = [0, 0.25, 0.5, 0.75, 1];
  const cycle = (amplitude, offset = 0) => walkTimes.map((_, index) => quatX(Math.sin((index / 4) * Math.PI * 2 + offset) * amplitude));
  addAnimation(state, "Walk", walkTimes, [
    { node: jointNodes[0], path: "translation", values: walkTimes.map((_, index) => [0, -0.06 + (index % 2 ? 0.025 : 0), 0]) },
    { node: jointNodes[9], path: "rotation", values: cycle(0.48) },
    { node: jointNodes[12], path: "rotation", values: cycle(0.48, Math.PI) },
    { node: jointNodes[10], path: "rotation", values: cycle(0.32, Math.PI) },
    { node: jointNodes[13], path: "rotation", values: cycle(0.32) },
    { node: jointNodes[5], path: "rotation", values: cycle(0.34, Math.PI) },
    { node: jointNodes[7], path: "rotation", values: cycle(0.34) },
    { node: jointNodes[2], path: "rotation", values: walkTimes.map((_, index) => quatZ(Math.sin((index / 4) * Math.PI * 2) * 0.035)) },
  ]);
  state.json.asset.generator = `${state.json.asset.generator ?? "glTF"}; Markets & Makers humanoid rigger`;
  writeGlb(output, state.json, state.bin);
  console.log(`Rigged ${path.basename(output)}: ${positions.count.toLocaleString()} weighted vertices, ${joints.length} joints, Idle + Walk`);
}

fs.mkdirSync(outputRoot, { recursive: true });
for (const [source, output] of avatars) await rig(path.join(sourceRoot, source), path.join(outputRoot, output));
