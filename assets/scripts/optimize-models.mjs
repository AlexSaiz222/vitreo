// Vitreo 3D pipeline, step 2 of 3 (docs/04, "Exportar y optimizar"):
//   assets/export/*.glb  →  apps/web/public/models/*.glb
//
//   1. Checks the naming contract with the code (docs/04, part 3): every
//      plant_<id> wherever it is, and for the whole diorama (vitreo.glb) its
//      structure, the roof vent, the camera empties and one plant per zone
//      of the app.
//   2. Optimises: dedup, prune, then meshopt (reorder + quantise + compress).
//      Morph targets (shape keys), COLOR_0 (leaf tone), _WIND and the empties
//      (cam_*, anchor_*) survive.
//   3. Reports size, triangles and draw calls against the budget, and warns
//      about things to fix in Blender (including leaf tones that drift from
//      the palette tokens).
//   4. Removes optimised models whose export no longer exists.
//   5. Lightmaps (assets/textures/lightmaps.json, from bake_lightmaps.py):
//      checks that every baked object is there with its lightmap UV
//      (TEXCOORD_0), converts the atlases to WebP and writes the json the app
//      reads. Model and textures share the size budget.
//   6. Light probes: for every part that is not baked, the baked light
//      around it as an ambient cube (six directions; day, night, lamp), so
//      the app can light it like its baked neighbours without dynamic
//      lights (D68).
//
// Run from the repository root: `pnpm models`. Exit code 1 if a model breaks
// the contract, so a bad export never reaches the app.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../..');
const INPUT = path.join(ROOT, 'assets/export');
const OUTPUT = path.join(ROOT, 'apps/web/public/models');
const TOKENS = path.join(ROOT, 'apps/web/src/styles/tokens.css');
const ZONES = path.join(ROOT, 'apps/web/src/scene/zones.ts');
const TEXTURES = path.join(ROOT, 'assets/textures');
const LIGHTMAPS = 'lightmaps.json';
/**
 * WebP quality of the lightmaps: they are soft gradients, and lower
 * qualities start to show bands (q90: ≈ 150–200 KB per 1024 px atlas).
 */
const LIGHTMAP_QUALITY = 90;
/** Bits for texture coordinates: 14 is ¼ texel on a 2048 px lightmap. */
const TEXCOORD_BITS = 14;
/** The whole diorama, exported from assets/blender/vitreo.blend. */
const DIORAMA = 'vitreo.glb';
/** Nodes the app looks up by name in the diorama (docs/04, part 3). */
const DIORAMA_NODES = [
  // structure
  'base',
  'gravel',
  'path',
  'steps',
  'floor_main',
  'frame_main',
  'frame_details',
  'gutter',
  'glass_main',
  'door',
  'door_leaf',
  'vent_window',
  // devices
  'tank',
  'tank_water',
  'tank_hose',
  'pump',
  'grow_light',
  'fan',
  'fan_blades',
  'sensor_box',
  'vent_servo',
  'cables',
  // decor
  'decor_ground',
  'decor_plants',
  // helpers
  'cam_home',
];
/**
 * Nodes the app scales or turns about their origin (the water level, the fan
 * blades). Quantisation moves a mesh node's origin to the middle of its mesh,
 * so these become an empty that keeps the origin, with the mesh as a child
 * `<name>_mesh` (as Blender already does for the door).
 */
const KEEP_ORIGIN = ['tank_water', 'fan_blades'];

/**
 * Material names the app knows (each gets its palette token). An unknown one
 * would be drawn with the wrong colour without anyone noticing.
 */
const MATERIALS = new Set([
  'plinth',
  'tray',
  'path',
  'floor',
  'frame',
  'glass',
  'terracotta',
  'leaf',
  'device',
  'device_dark',
  'fan_back',
  'fan_blade',
  'hardware',
  'gasket',
  'water',
  'led',
  'light_strip',
  'decor',
]);

/** CLAUDE.md / docs/04: the whole scene must stay under these. */
const SCENE_BUDGET = { kilobytes: 4096, triangles: 150_000, drawCalls: 100 };
/** A rough share per plant (pot + soil + foliage), with ~10 plants in the scene. */
const PLANT_BUDGET = { triangles: 3000, drawCalls: 3 };
/** How far (linear RGB) a leaf tone may drift from its palette token. */
const TONE_TOLERANCE = 0.02;

/** Colours a plant's COLOR_0 may use (apps/web/src/scene/models/leafTones.ts). */
const FOLIAGE_TOKENS = [
  '--scene-leaf-deep',
  '--scene-leaf-mid',
  '--scene-leaf-new',
  '--scene-leaf-light',
  '--scene-flower-white',
  '--scene-flower-heart',
  '--scene-fruit',
  '--scene-fruit-green',
  '--scene-flower-chives',
  '--scene-stake',
];

/** The foliage tokens from tokens.css, in linear RGB (what COLOR_0 stores). */
function leafTokens() {
  const css = readFileSync(TOKENS, 'utf8');
  const linear = (channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return FOLIAGE_TOKENS.map((name) => {
    const hex = new RegExp(String.raw`${name}:\s*#([0-9a-f]{6})`, 'i').exec(css)?.[1];
    if (!hex) throw new Error(`${name} not found in tokens.css`);
    const rgb = [0, 2, 4].map((i) => linear(Number.parseInt(hex.slice(i, i + 2), 16)));
    return { name, rgb };
  });
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

/** The plant ids of the app (apps/web/src/scene/zones.ts). */
function zoneIds() {
  return [...readFileSync(ZONES, 'utf8').matchAll(/\bid: '([a-z0-9_]+)'/g)].map((m) => m[1]);
}

/**
 * Triangles and draw calls as drawn: per node, so a mesh shared by several
 * nodes (the four pots) counts once per node.
 */
function stats(nodes) {
  let triangles = 0;
  let drawCalls = 0;
  for (const node of nodes) {
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      drawCalls++;
      const indices = primitive.getIndices();
      const count = indices ? indices.getCount() : primitive.getAttribute('POSITION').getCount();
      triangles += count / 3;
    }
  }
  return { triangles, drawCalls };
}

/** A node and all its descendants. */
function subtree(node) {
  return [node, ...node.listChildren().flatMap(subtree)];
}

/** docs/04, part 3: a plant_<id> with its pot, soil and foliage. */
function checkPlant(nodes, id) {
  const errors = [];
  for (const name of [`pot_${id}`, `soil_${id}`, `foliage_${id}`]) {
    if (!nodes.has(name)) errors.push(`missing node "${name}"`);
  }
  const foliage = nodes.get(`foliage_${id}`)?.getMesh();
  if (foliage) {
    const targets = foliage.getExtras().targetNames ?? [];
    if (!targets.includes('wilt')) errors.push(`foliage_${id} has no "wilt" shape key`);
    for (const primitive of foliage.listPrimitives()) {
      if (!primitive.getAttribute('_WIND')) {
        errors.push(`foliage_${id} has no "_WIND" attribute (how much each vertex sways)`);
      }
      if (!primitive.getAttribute('COLOR_0')) {
        errors.push(`foliage_${id} has no COLOR_0 (the tone of each leaf)`);
      }
    }
  }
  return errors;
}

/** docs/04, part 3. Returns a list of broken rules. */
function checkContract(document, file) {
  if (file.startsWith('pot_')) {
    return [`plant models are named after their root: rename to ${file.replace('pot_', 'plant_')}`];
  }
  const nodes = new Map(document.getRoot().listNodes().map((node) => [node.getName(), node]));
  const plants = [...nodes.keys()].flatMap((name) => /^plant_(.+)$/.exec(name)?.[1] ?? []);
  const errors = plants.flatMap((id) => checkPlant(nodes, id));

  const single = /^plant_(.+)\.glb$/.exec(file)?.[1];
  if (single && !plants.includes(single)) errors.push(`missing node "plant_${single}"`);

  if (file === DIORAMA) {
    for (const name of DIORAMA_NODES) {
      if (!nodes.has(name)) errors.push(`missing node "${name}"`);
    }
    const vent = nodes.get('vent_window')?.getMesh();
    if (vent && !(vent.getExtras().targetNames ?? []).includes('open')) {
      errors.push('vent_window has no "open" shape key');
    }
    // The door turns on its hinge: an empty there, with the leaf inside.
    const door = nodes.get('door');
    if (door && (door.getMesh() || !door.listChildren().some((c) => c.getName() === 'door_leaf'))) {
      errors.push('door must be an empty on the hinge with door_leaf as its child');
    }
    for (const primitive of nodes.get('decor_plants')?.getMesh()?.listPrimitives() ?? []) {
      if (!primitive.getAttribute('_WIND')) errors.push('decor_plants has no "_WIND" attribute');
      if (!primitive.getAttribute('COLOR_0')) errors.push('decor_plants has no COLOR_0 (its colour)');
    }
    const strip = nodes
      .get('grow_light')
      ?.getMesh()
      ?.listPrimitives()
      .some((primitive) => primitive.getMaterial()?.getName() === 'light_strip');
    if (nodes.has('grow_light') && !strip) errors.push('grow_light has no "light_strip" material');
    for (const material of document.getRoot().listMaterials()) {
      const name = material.getName();
      if (!MATERIALS.has(name) && !/^soil_/.test(name)) {
        errors.push(`unknown material "${name}" (the app picks colours by material name)`);
      }
    }
    for (const id of zoneIds()) {
      if (!plants.includes(id)) errors.push(`no plant_${id} for the app's zone "${id}"`);
    }
    for (const id of plants) {
      if (!nodes.has(`cam_focus_${id}`)) errors.push(`missing empty "cam_focus_${id}"`);
    }
  }
  return errors;
}

/** How many of the nearest baked vertices a light probe averages. */
const PROBE_SAMPLES = 400;
/** A sample counts for a cube direction when its face looks at least this much that way. */
const PROBE_FACING = 0.4;
/**
 * By day, the share of the brightest facing samples a probe keeps: the
 * surfaces around a part were baked in its own shadow (the tank darkens the
 * plinth next to it), which is not the sun that reaches the part.
 */
const PROBE_DAY_SHARE = 0.25;
/** Fewer facing samples than this: the direction takes the plain average. */
const PROBE_MIN_FACING = 6;
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Ambient cube directions: +x, -x, +y, -y, +z, -z. */
const CUBE_AXES = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** sRGB byte → linear, for decoding the atlases. */
const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** An atlas decoded to linear light (× its intensity), sampled at a UV. */
async function readAtlas(atlas) {
  const { data, info } = await sharp(path.join(TEXTURES, atlas.file))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const clamp = (value, max) => Math.min(max, Math.max(0, value));
  return (u, v) => {
    // glTF UVs start at the top left, like image rows.
    const x = clamp(Math.floor(u * info.width), info.width - 1);
    const y = clamp(Math.floor(v * info.height), info.height - 1);
    const i = (y * info.width + x) * info.channels;
    return [0, 1, 2].map((c) => SRGB_TO_LINEAR[data[i + c]] * atlas.intensity);
  };
}

/** A point times a glTF (column-major) matrix. */
function transformPoint([x, y, z], m) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/**
 * Light probes (D68): for every mesh that is not baked, the average baked
 * light of the nearest baked surfaces, per atlas (linear, intensity applied).
 * The app lights those parts with it instead of dynamic lights, so a door
 * or a vent reads like the baked frame next to it, by day and by night.
 */
async function computeProbes(document, lightmaps) {
  const modes = ['day', 'night', 'lamp'];
  const atlases = await Promise.all(modes.map((mode) => readAtlas(lightmaps.atlases[mode])));
  const samples = [];
  const position = [];
  const normal = [];
  const uv = [];
  for (const node of document.getRoot().listNodes()) {
    if (node.getExtras().lightmap !== true) continue;
    const matrix = node.getWorldMatrix();
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const positions = primitive.getAttribute('POSITION');
      const normals = primitive.getAttribute('NORMAL');
      const uvs = primitive.getAttribute('TEXCOORD_0');
      if (!positions || !normals || !uvs) continue;
      for (let i = 0; i < positions.getCount(); i++) {
        positions.getElement(i, position);
        normals.getElement(i, normal);
        // Faces looking down rest on the ground or face it: nearly black in
        // the bake, they are not the light around a part.
        const world = [0, 1, 2].map(
          (k) => matrix[k] * normal[0] + matrix[k + 4] * normal[1] + matrix[k + 8] * normal[2],
        );
        const length = Math.hypot(...world) || 1;
        const facing = world.map((v) => v / length);
        if (facing[1] < -0.5) continue;
        uvs.getElement(i, uv);
        samples.push({
          at: transformPoint(position, matrix),
          facing,
          light: atlases.map((sample) => sample(uv[0], uv[1])),
        });
      }
    }
  }
  const probes = {};
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || node.getExtras().lightmap === true) continue;
    const matrix = node.getWorldMatrix();
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION');
      for (let i = 0; i < positions.getCount(); i++) {
        positions.getElement(i, position);
        const at = transformPoint(position, matrix);
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], at[k]);
          max[k] = Math.max(max[k], at[k]);
        }
      }
    }
    const distance = ({ at }) =>
      Math.hypot(...at.map((v, k) => Math.max(0, min[k] - v, v - max[k])));
    const nearest = samples
      .map((sample) => ({ sample, d: distance(sample) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, PROBE_SAMPLES);
    // An ambient cube: the light arriving from each of six directions, from
    // the samples whose faces look that way (weighted by how much they do).
    // A direction no sample faces takes the plain average.
    const round = (v) => Math.round(v * 1e4) / 1e4;
    probes[node.getName()] = Object.fromEntries(
      modes.map((mode, m) => {
        const average = [0, 1, 2].map(
          (c) => nearest.reduce((sum, { sample }) => sum + sample.light[m][c], 0) / nearest.length,
        );
        const cube = CUBE_AXES.map((axis) => {
          // Samples facing this way. By day, the brightest ones: the surfaces
          // next to a part were baked in its own shadow, which is not the sun
          // that reaches it. At night and for the lamp, all of them: there the
          // brighter half would be what the light inside reaches (the pots by
          // the door), not the dark outside of the frame next to it.
          const facing = nearest
            .map(({ sample }) => ({
              light: sample.light[m],
              w: Math.max(0, sample.facing.reduce((d, v, k) => d + v * axis[k], 0)),
            }))
            .filter(({ w }) => w > PROBE_FACING)
            .sort((a, b) => luminance(b.light) - luminance(a.light));
          const bright =
            mode === 'day' ? facing.slice(0, Math.ceil(facing.length * PROBE_DAY_SHARE)) : facing;
          if (bright.length < PROBE_MIN_FACING) return average.map(round);
          const weight = bright.reduce((sum, { w }) => sum + w, 0);
          return [0, 1, 2].map((c) =>
            round(bright.reduce((sum, { light, w }) => sum + w * light[c], 0) / weight),
          );
        });
        return [mode, cube];
      }),
    );
  }
  return probes;
}

/** The bake of bake_lightmaps.py, if there is one. */
function readLightmaps() {
  const file = path.join(TEXTURES, LIGHTMAPS);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

/**
 * Baked objects (docs/04, part 5): each one listed in lightmaps.json must
 * exist, carry its lightmap UV as TEXCOORD_0 and say so in its extras; and
 * nothing may claim a lightmap the json does not list.
 */
function checkLightmaps(document, lightmaps) {
  const errors = [];
  const nodes = new Map(document.getRoot().listNodes().map((node) => [node.getName(), node]));
  const listed = new Set(lightmaps.objects);
  for (const name of listed) {
    const node = nodes.get(name);
    if (!node) {
      errors.push(`baked object "${name}" is not in the model`);
      continue;
    }
    if (node.getExtras().lightmap !== true) errors.push(`${name} has no "lightmap": true extra`);
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      if (!primitive.getAttribute('TEXCOORD_0')) {
        errors.push(`${name} has no lightmap UV (TEXCOORD_0)`);
        break;
      }
    }
  }
  for (const [name, node] of nodes) {
    if (node.getExtras().lightmap === true && !listed.has(name)) {
      errors.push(`${name} says it is baked but lightmaps.json does not list it`);
    }
  }
  for (const [mode, atlas] of Object.entries(lightmaps.atlases ?? {})) {
    if (!existsSync(path.join(TEXTURES, atlas.file))) errors.push(`lightmap ${mode}: ${atlas.file} is missing`);
    if (!(atlas.intensity > 0)) errors.push(`lightmap ${mode}: no intensity`);
  }
  for (const mode of ['day', 'night', 'lamp']) {
    if (!lightmaps.atlases?.[mode]) errors.push(`lightmaps.json has no "${mode}" atlas`);
  }
  return errors;
}

/**
 * The colour of the day's baked light (D134): the mean of its lit texels,
 * scaled to luminance 1. The sun is warm and its bounce off the sand warmer
 * still, so white parts came out peach; the app balances the light against
 * this, as a camera does, so the tokens show as they are.
 */
async function dayTint(atlas) {
  const { data, info } = await sharp(path.join(TEXTURES, atlas.file))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += info.channels) {
    const light = [0, 1, 2].map((c) => SRGB_TO_LINEAR[data[i + c]]);
    // Texels outside every island are black.
    if (luminance(light) < 0.01) continue;
    for (let c = 0; c < 3; c++) sum[c] += light[c];
  }
  const scale = luminance(sum) || 1;
  return sum.map((v) => Math.round((v / scale) * 1e4) / 1e4);
}

/** Converts the atlases to WebP next to the model and writes the app's json. Returns KB. */
async function publishLightmaps(lightmaps, probes) {
  let kilobytes = 0;
  const atlases = {};
  for (const [mode, atlas] of Object.entries(lightmaps.atlases)) {
    const file = atlas.file.replace(/\.png$/i, '.webp');
    const target = path.join(OUTPUT, file);
    await sharp(path.join(TEXTURES, atlas.file))
      .webp({ quality: LIGHTMAP_QUALITY, smartSubsample: true })
      .toFile(target);
    kilobytes += statSync(target).size / 1024;
    atlases[mode] = {
      file,
      intensity: atlas.intensity,
      ...(mode === 'day' && { tint: await dayTint(atlas) }),
    };
  }
  const meta = {
    uv: lightmaps.uv,
    colorSpace: lightmaps.colorSpace,
    objects: lightmaps.objects,
    atlases,
    probes,
  };
  writeFileSync(path.join(OUTPUT, LIGHTMAPS), `${JSON.stringify(meta, null, 2)}\n`);
  console.info(
    `✓ lightmaps: ${Object.keys(atlases).join(', ')} → WebP (${kilobytes.toFixed(0)} KB) · ` +
      `${lightmaps.objects.length} baked objects · ${Object.keys(probes).length} light probes`,
  );
  return kilobytes;
}

/** Linear RGB → sRGB hex, for messages people can read. */
function toHex(rgb) {
  const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  return `#${rgb
    .slice(0, 3)
    .map((c) => Math.round(Math.min(1, Math.max(0, srgb(c))) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Leaf tones (COLOR_0) that are not close to any leaf token. */
function toneDrift(document, tokens) {
  const notes = [];
  const seen = new Set();
  for (const mesh of document.getRoot().listMeshes()) {
    if (!mesh.getName().startsWith('foliage_')) continue;
    for (const primitive of mesh.listPrimitives()) {
      const color = primitive.getAttribute('COLOR_0');
      if (!color) continue;
      const element = [];
      for (let i = 0; i < color.getCount(); i++) {
        color.getElement(i, element);
        const key = element.slice(0, 3).map((v) => v.toFixed(3)).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const ranked = tokens
          .map((token) => ({
            ...token,
            distance: Math.hypot(...token.rgb.map((c, k) => c - (element[k] ?? 0))),
          }))
          .sort((a, b) => a.distance - b.distance);
        const closest = ranked[0];
        if (closest && closest.distance > TONE_TOLERANCE) {
          notes.push(
            `leaf tone ${toHex(element)} is not a palette token ` +
              `(closest: ${closest.name} ${toHex(closest.rgb)})`,
          );
        }
      }
    }
  }
  return notes;
}

function warnings(document) {
  const notes = [];
  for (const material of document.getRoot().listMaterials()) {
    // Glass is seen from both sides on purpose.
    if (material.getDoubleSided() && material.getName() !== 'glass') {
      notes.push(`material "${material.getName()}" is double-sided`);
    }
  }
  for (const plant of document.getRoot().listNodes()) {
    if (!plant.getName().startsWith('plant_')) continue;
    const { triangles, drawCalls } = stats(subtree(plant));
    if (triangles > PLANT_BUDGET.triangles) {
      notes.push(`${plant.getName()}: ${triangles} triangles (plant guide: ≤ ${PLANT_BUDGET.triangles})`);
    }
    if (drawCalls > PLANT_BUDGET.drawCalls) {
      notes.push(`${plant.getName()}: ${drawCalls} draw calls (plant guide: ≤ ${PLANT_BUDGET.drawCalls})`);
    }
  }
  return notes;
}

mkdirSync(OUTPUT, { recursive: true });
const files = readdirSync(INPUT).filter((file) => file.endsWith('.glb'));
const tokens = leafTokens();
const lightmaps = readLightmaps();

// Optimised models whose export is gone (e.g. renamed) must not linger.
const published = (f) =>
  f.endsWith('.glb') ? files.includes(f) : lightmaps !== null && /^(lightmap_.+\.webp|lightmaps\.json)$/.test(f);
for (const stale of readdirSync(OUTPUT).filter((f) => !published(f))) {
  rmSync(path.join(OUTPUT, stale));
  console.info(`− removed ${stale} (no longer in assets/export)`);
}
let failed = false;
const total = { kilobytes: 0, triangles: 0, drawCalls: 0 };

for (const file of files) {
  const source = path.join(INPUT, file);
  const target = path.join(OUTPUT, file);
  const document = await io.read(source);

  const errors = [
    ...checkContract(document, file),
    ...(file === DIORAMA && lightmaps ? checkLightmaps(document, lightmaps) : []),
  ];
  if (errors.length > 0) {
    failed = true;
    console.error(`✗ ${file}\n${errors.map((e) => `    ${e}`).join('\n')}`);
    continue;
  }

  // Probes need the model as exported (metres, before quantisation).
  const probes = file === DIORAMA && lightmaps ? await computeProbes(document, lightmaps) : null;
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!KEEP_ORIGIN.includes(node.getName()) || !mesh) continue;
    node.setMesh(null).addChild(document.createNode(`${node.getName()}_mesh`).setMesh(mesh));
  }
  await document.transform(
    // Not materials: their names are the contract with the app (each gets its
    // token), even when Blender gives two of them the same values.
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }),
    // keepLeaves: the empties (cam_home, cam_focus_*, anchor_*) are leaf nodes.
    prune({ keepAttributes: true, keepLeaves: true }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizeTexcoord: TEXCOORD_BITS }),
  );
  await io.write(target, document);

  const before = statSync(source).size / 1024;
  const after = statSync(target).size / 1024;
  const counts = stats(document.getRoot().listNodes());
  total.kilobytes += after;
  total.triangles += counts.triangles;
  total.drawCalls += counts.drawCalls;
  console.info(
    `✓ ${file}: ${before.toFixed(0)} KB → ${after.toFixed(0)} KB · ` +
      `${counts.triangles} triangles · ${counts.drawCalls} draw calls`,
  );
  for (const note of [...warnings(document), ...toneDrift(document, tokens)]) {
    console.warn(`    ⚠ ${note}`);
  }
  if (file === DIORAMA && lightmaps) total.kilobytes += await publishLightmaps(lightmaps, probes ?? {});
}

console.info(
  `\nModels and lightmaps: ${total.kilobytes.toFixed(0)} / ${SCENE_BUDGET.kilobytes} KB · ` +
    `${total.triangles} / ${SCENE_BUDGET.triangles} triangles · ` +
    `${total.drawCalls} / ${SCENE_BUDGET.drawCalls} draw calls (whole-scene budget)`,
);
process.exitCode = failed ? 1 : 0;
