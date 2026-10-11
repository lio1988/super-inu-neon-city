import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const materialTextureSlots = {
  baseColorTexture: ['map'], metallicRoughnessTexture: ['metalnessMap', 'roughnessMap'],
  normalTexture: ['normalMap'], occlusionTexture: ['aoMap'], emissiveTexture: ['emissiveMap'],
  clearcoatTexture: ['clearcoatMap'], clearcoatRoughnessTexture: ['clearcoatRoughnessMap'], clearcoatNormalTexture: ['clearcoatNormalMap'],
  sheenColorTexture: ['sheenColorMap'], sheenRoughnessTexture: ['sheenRoughnessMap'], transmissionTexture: ['transmissionMap'],
  thicknessTexture: ['thicknessMap'], specularTexture: ['specularIntensityMap'], specularColorTexture: ['specularColorMap'],
  iridescenceTexture: ['iridescenceMap'], iridescenceThicknessTexture: ['iridescenceThicknessMap'], anisotropyTexture: ['anisotropyMap'],
};

function authoredTextureBindings(json) {
  const bindings = [];
  (json.materials || []).forEach((material, materialIndex) => {
    const unlit = Boolean(material.extensions?.KHR_materials_unlit);
    function visit(object, path = []) {
      for (const [key, value] of Object.entries(object || {})) {
        if (key === 'extras') continue;
        const nextPath = [...path, key];
        if (key.endsWith('Texture')) {
          if (!Number.isInteger(value?.index) || value.index < 0 || !json.textures?.[value.index]) {
            throw new Error(`Invalid authored material texture reference: material ${materialIndex}, ${nextPath.join('.')}.`);
          }
          bindings.push({ materialIndex, textureIndex: value.index, path: nextPath.join('.'), slots: unlit && key !== 'baseColorTexture' ? [] : (materialTextureSlots[key] || []) });
        } else if (value && typeof value === 'object' && !Array.isArray(value)) visit(value, nextPath);
      }
    }
    visit(material);
  });
  return bindings;
}

/** Validate the supplied file, not a substitute model. External asset URIs are rejected. */
export function inspectGLB(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20) {
    throw new Error('A complete binary .glb file is required.');
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error('The character must be a genuine glTF 2.0 binary .glb asset.');
  }
  if (view.getUint32(8, true) !== buffer.byteLength) {
    throw new Error('The GLB file is truncated or has an invalid declared length.');
  }
  const chunks = [];
  for (let offset = 12; offset < buffer.byteLength;) {
    if (offset + 8 > buffer.byteLength) throw new Error('Invalid GLB chunk header.');
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    if (length % 4 || offset + 8 + length > buffer.byteLength) throw new Error('Invalid GLB chunk length.');
    chunks.push({ type, offset: offset + 8, length });
    offset += 8 + length;
  }
  if (chunks[0]?.type !== 0x4e4f534a) throw new Error('The GLB JSON chunk is missing.');
  const jsonChunk = chunks[0];
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, jsonChunk.offset, jsonChunk.length)).trim());
  if (json.asset?.version !== '2.0' || !json.meshes?.length) {
    throw new Error('The GLB contains no glTF 2.0 character meshes.');
  }
  for (const resource of [...(json.buffers || []), ...(json.images || [])]) {
    if (resource.uri && !resource.uri.startsWith('data:')) {
      throw new Error('Only a self-contained GLB with embedded geometry and textures is allowed.');
    }
  }
  const materialTextureBindings = authoredTextureBindings(json);
  const textureIndices = [...new Set(materialTextureBindings.map(binding => binding.textureIndex))].sort((a, b) => a - b);
  return {
    bytes: buffer.byteLength,
    meshes: json.meshes.length,
    skins: json.skins?.length || 0,
    animations: (json.animations || []).map((a, i) => a.name || `animation-${i}`),
    animationMetadata: (json.animations || []).map(a => ({ name: a.name || '', loop: typeof a.extras?.loop === 'boolean' ? a.extras.loop : null })),
    images: json.images?.length || 0,
    referencedTextures: textureIndices.length,
    textureIndices,
    materialTextureBindings,
    extensionsRequired: [...(json.extensionsRequired || [])],
    selfContained: true,
  };
}

function isDecodedTexture(texture) {
  if (!texture?.isTexture) return false;
  const image = texture.source?.data;
  if (!image || image.complete === false) return false;
  const width = image.naturalWidth ?? image.width, height = image.naturalHeight ?? image.height;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return false;
  if (texture.isCompressedTexture) return Boolean(texture.mipmaps?.length && texture.mipmaps.every(mip => mip.data?.byteLength > 0));
  if ('data' in image) return Boolean(image.data?.byteLength > 0);
  return true;
}

async function validateAuthoredTextures(gltf, manifest) {
  if (!manifest.referencedTextures) return { referencedTextures: 0, decodedTextures: 0 };
  const parser = gltf.parser;
  if (typeof parser?.getDependency !== 'function') throw new Error('Cannot verify decoded authored GLB textures: GLTFLoader parser is unavailable.');
  const decoded = new Map();
  for (const index of manifest.textureIndices) {
    let texture;
    try { texture = await parser.getDependency('texture', index); }
    catch (cause) { throw new Error(`Authored GLB texture ${index} failed to load or decode.`, { cause }); }
    if (!isDecodedTexture(texture)) throw new Error(`Authored GLB texture ${index} failed to load or decode; an untextured substitute will not be shown.`);
    decoded.set(index, texture);
  }
  const materials = new Map();
  for (const binding of manifest.materialTextureBindings) {
    if (!binding.slots.length) continue;
    if (!materials.has(binding.materialIndex)) materials.set(binding.materialIndex, await parser.getDependency('material', binding.materialIndex));
    const material = materials.get(binding.materialIndex), texture = decoded.get(binding.textureIndex);
    for (const slot of binding.slots) {
      const map = material?.[slot];
      if (!isDecodedTexture(map) || map.source !== texture.source) {
        throw new Error(`Authored GLB material ${binding.materialIndex} is missing its decoded ${binding.path} (${slot}); an untextured substitute will not be shown.`);
      }
    }
  }
  return { referencedTextures: manifest.referencedTextures, decodedTextures: decoded.size };
}

const normalizeBoneName = name => String(name).toLowerCase().replace(/mixamorig/g, '').replace(/[^a-z]/g, '');
const handNames = {
  left: new Set(['lefthand', 'leftpalm', 'handleft', 'palmleft', 'handl', 'palml', 'lhand', 'lpalm']),
  right: new Set(['righthand', 'rightpalm', 'handright', 'palmright', 'handr', 'palmr', 'rhand', 'rpalm']),
};
const clipPatterns = {
  idle: /(?:^|[\s_.-])(idle|breath|breathing)(?:$|[\s_.-])/i,
  walk: /(?:^|[\s_.-])(walk|walking)(?:$|[\s_.-])/i,
  run: /(?:^|[\s_.-])(run|running|sprint)(?:$|[\s_.-])/i,
  flight: /(?:^|[\s_.-])(fly|flying|flight|hover)(?:$|[\s_.-])/i,
  shooting: /(?:^|[\s_.-])(shoot|shooting|fire|attack)(?:$|[\s_.-])/i,
};
const plainBounds = box => ({ min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new T.Vector3()).toArray() });
const shortestAngle = (target, current) => Math.atan2(Math.sin(target - current), Math.cos(target - current));
const oneShotNames = new Set(['Takeoff', 'Landing', 'PalmBlast']);
const heroFlightNames = ['Takeoff', 'Flight', 'Hover', 'Landing'];
const differentQuaternion = (a, offset, b, otherOffset = 0) => {
  let dot = 0, lengthA = 0, lengthB = 0;
  for (let i = 0; i < 4; i++) { const x = a[offset + i], y = b[otherOffset + i]; dot += x * y; lengthA += x * x; lengthB += y * y; }
  return lengthA > 1e-12 && lengthB > 1e-12 && 1 - Math.min(1, Math.abs(dot) / Math.sqrt(lengthA * lengthB)) > 1e-6;
};

// A clip name alone is not evidence of limb animation. Resolve the same authored
// binding used by Three.js, and require changing transform keys on a real skin bone.
function hasMeaningfulBoneTrack(clip, scene, skinnedBones, { allowAuthoredPose = false } = {}) {
  if (!Number.isFinite(clip?.duration) || clip.duration <= 0) return false;
  return (clip.tracks || []).some(track => {
    const times = track.times, values = track.values, valueSize = track.getValueSize?.();
    if (!times || times.length < 2 || !values || !Number.isInteger(valueSize) || valueSize <= 0 || values.length !== times.length * valueSize) return false;
    for (let i = 0; i < times.length; i++) {
      if (!Number.isFinite(times[i]) || (i && times[i] < times[i - 1])) return false;
    }
    if (times[times.length - 1] <= times[0]) return false;
    let changes = false;
    for (let i = 0; i < values.length; i++) {
      if (!Number.isFinite(values[i])) return false;
      if (i >= valueSize && Math.abs(values[i] - values[i % valueSize]) > 1e-6) changes = true;
    }
    let path;
    try { path = T.PropertyBinding.parseTrackName(track.name); } catch { return false; }
    if (!['position', 'quaternion', 'rotation'].includes(path.propertyName)) return false;
    let target = T.PropertyBinding.findNode(scene, path.nodeName);
    if (path.objectName === 'bones') {
      const candidates = target?.skeleton?.bones || [];
      target = candidates.find(bone => bone.name === path.objectIndex) || candidates[path.objectIndex];
    } else if (path.objectName) return false;
    if (!target?.isBone || !skinnedBones.has(target)) return false;
    if (path.propertyName === 'quaternion' && path.propertyIndex === undefined && valueSize === 4) {
      changes = false;
      for (let i = 4; i < values.length; i += 4) if (differentQuaternion(values, i, values)) changes = true;
    }
    if (changes) return true;
    if (!allowAuthoredPose) return false;
    // A genuine, constant non-rest bone pose is valid for e.g. a held flight pose,
    // but it does not establish gait. Identity/rest keys remain insufficient.
    const property = target[path.propertyName];
    const rest = path.propertyIndex !== undefined ? [property?.[path.propertyIndex]] : property?.toArray?.().slice(0, valueSize);
    if (!rest || rest.length !== valueSize || !rest.every(Number.isFinite)) return false;
    if (path.propertyName === 'quaternion' && valueSize === 4) return differentQuaternion(values, 0, rest);
    return rest.some((value, i) => Math.abs(values[i] - value) > 1e-6);
  });
}

/**
 * Wrap a successfully parsed GLB. Every rendered character mesh and animation originates
 * in that file. No primitive anatomy, billboard, fabricated bone, or synthetic gait exists.
 * `orientationY` rotates the asset's authored forward direction onto +Z.
 */
export function createSiGLBAdapter(gltf, {
  height = 3.9,
  orientationY = 0,
  clipNames = {},
  palmBoneNames = {},
  spinRate = .65,
  turnRate = 9,
  source = null,
} = {}) {
  if (!gltf?.scene?.isObject3D) throw new Error('GLTFLoader did not return a character scene.');
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(orientationY)) {
    throw new Error('A positive target height and finite model orientation are required.');
  }
  if (![spinRate, turnRate].every(Number.isFinite) || turnRate <= 0) {
    throw new Error('Turntable rates must be finite, with a positive turn rate.');
  }
  const root = new T.Group(), facing = new T.Group(), fitted = new T.Group(), oriented = new T.Group();
  root.name = 'SuperInuGLBRoot';
  facing.name = 'SuperInuYaw';
  fitted.name = 'SuperInuGroundFit';
  oriented.name = 'SuperInuAuthoredOrientation';
  oriented.rotation.y = orientationY;
  root.add(facing); facing.add(fitted); fitted.add(oriented); oriented.add(gltf.scene);
  root.updateMatrixWorld(true);
  const authoredBounds = new T.Box3().setFromObject(oriented, true);
  const size = authoredBounds.getSize(new T.Vector3()), center = authoredBounds.getCenter(new T.Vector3());
  if (![...size.toArray(), ...center.toArray(), ...authoredBounds.min.toArray(), ...authoredBounds.max.toArray()].every(Number.isFinite) || size.y <= 1e-6 || authoredBounds.isEmpty()) {
    throw new Error('The GLB character has no finite, non-empty geometry bounds.');
  }
  const scale = height / size.y;
  fitted.scale.setScalar(scale);
  fitted.position.set(-center.x * scale, -authoredBounds.min.y * scale, -center.z * scale);
  root.updateMatrixWorld(true);

  const bones = new Set(), skinnedBones = new Set(), materials = new Set(), textures = new Set();
  let meshes = 0, skinnedMeshes = 0, triangles = 0, vertices = 0;
  gltf.scene.traverse(object => {
    if (object.isBone) bones.add(object);
    if (!object.isMesh) return;
    meshes++;
    object.castShadow = true;
    object.receiveShadow = true;
    if (object.isSkinnedMesh) {
      skinnedMeshes++;
      for (const bone of object.skeleton.bones) { bones.add(bone); skinnedBones.add(bone); }
    }
    const geometry = object.geometry;
    vertices += geometry?.attributes?.position?.count || 0;
    const indices = geometry?.index?.count || geometry?.attributes?.position?.count || 0;
    const range = geometry?.drawRange;
    const drawCount = range && Number.isFinite(range.count) ? Math.min(range.count, Math.max(0, indices - range.start)) : indices;
    triangles += Math.floor(drawCount / 3);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      // Preserve authored PBR values, alpha modes, sidedness and texture color spaces.
    }
  });
  if (!meshes || !vertices) throw new Error('The GLB scene contains no renderable character mesh.');

  const palms = ['left', 'right'].map(side => {
    const explicit = palmBoneNames[side];
    const matches = [...bones].filter(bone => explicit ? bone.name === explicit : handNames[side].has(normalizeBoneName(bone.name)));
    // Ambiguous names are not guessed. Supply a verified exact bone name to resolve one.
    return matches.length === 1 ? matches[0] : null;
  });
  const clips = [...(gltf.animations || [])];
  const exactClips = new Map();
  for (const clip of clips) if (clips.filter(other => other.name === clip.name).length === 1) exactClips.set(clip.name, clip);
  const boneMotionClipNames = [...exactClips].filter(([, clip]) => hasMeaningfulBoneTrack(clip, gltf.scene, skinnedBones, { allowAuthoredPose: true })).map(([name]) => name);
  const boneMotionNames = new Set(boneMotionClipNames);
  function authoredLoop(clip, index) {
    if (typeof clip.userData?.loop === 'boolean') return clip.userData.loop;
    const definition = gltf.parser?.json?.animations?.[index];
    if (definition?.name === clip.name && typeof definition.extras?.loop === 'boolean') return definition.extras.loop;
    const metadata = source?.manifest?.animationMetadata?.[index];
    if (metadata?.name === clip.name && typeof metadata.loop === 'boolean') return metadata.loop;
    return !oneShotNames.has(clip.name);
  }
  const loopSettings = new Map(clips.map((clip, index) => [clip, authoredLoop(clip, index)]));
  const mapping = {};
  for (const [kind, pattern] of Object.entries(clipPatterns)) {
    const name = clipNames[kind];
    const matches = clips.filter(clip => name ? clip.name === name : pattern.test(clip.name));
    mapping[kind] = matches.length === 1 ? matches[0] : null;
    if ((kind === 'walk' || kind === 'run') && !hasMeaningfulBoneTrack(mapping[kind], gltf.scene, skinnedBones)) mapping[kind] = null;
  }
  const mixer = clips.length ? new T.AnimationMixer(gltf.scene) : null;
  const actions = new Map();
  for (const [name, clip] of exactClips) {
    const action = mixer.clipAction(clip), loop = loopSettings.get(clip);
    action.setLoop(loop ? T.LoopRepeat : T.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    actions.set(name, action);
  }
  let currentAction = null, currentClip = null, yaw = 0, disposed = false;
  function supportsClip(name, { requireBoneMotion = false } = {}) {
    return !disposed && exactClips.has(name) && (!requireBoneMotion || boneMotionNames.has(name));
  }
  function playClip(name, fadeSeconds = .18, { restart } = {}) {
    if (disposed) throw new Error('The GLB adapter has been disposed.');
    const action = actions.get(name);
    if (!action) return false;
    const shouldRestart = restart ?? Boolean(currentAction === action && action.loop === T.LoopOnce && action.paused && action.time >= action.getClip().duration);
    if (currentAction === action && !shouldRestart) return true;
    action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    const duration = Number.isFinite(fadeSeconds) ? Math.max(0, fadeSeconds) : .18;
    if (currentAction && currentAction !== action) currentAction.crossFadeTo(action, duration, false);
    else if (duration) action.fadeIn(duration);
    currentAction = action;
    currentClip = name;
    return true;
  }
  function stopClips() {
    mixer?.stopAllAction();
    currentAction = null;
    currentClip = null;
  }
  if (mapping.idle) playClip(mapping.idle.name, 0);
  const hasGait = Boolean(skinnedMeshes && (mapping.walk || mapping.run));
  const hasHeroFlight = Boolean(skinnedMeshes && heroFlightNames.every(name => boneMotionNames.has(name)));
  const hasPalmAnimation = Boolean(skinnedMeshes && palms.every(Boolean) && boneMotionNames.has('PalmBlast'));
  const warnings = [];
  if (!skinnedMeshes) warnings.push('This is a rigid 3D mesh, not a skeletal character. Limb walking/running is unavailable.');
  else if (!hasGait) warnings.push('The GLB contains no identified embedded walk/run clip with changing tracks on real skin bones. Limb gait is unavailable until a real authored clip is supplied.');
  if (!palms.every(Boolean)) warnings.push('Both verified hand/palm bones are not present. Anatomically anchored palm lasers are unavailable.');
  const capabilities = Object.freeze({
    real3DMesh: true,
    rotation360: true,
    hasRig: skinnedMeshes > 0,
    hasGait,
    hasHeroFlight,
    hasPalmAnimation,
    hasEmbeddedAnimation: clips.length > 0,
    hasPalmBones: palms.every(Boolean),
    embeddedClipNames: clips.map(clip => clip.name),
    supportedClipNames: [...exactClips.keys()],
    boneMotionClipNames,
    palmBoneNames: palms.map(bone => bone?.name || null),
    warnings,
  });
  const stats = {
    meshes, skinnedMeshes, triangles, vertices,
    bones: bones.size, materials: materials.size, textures: textures.size,
    authoredBounds: plainBounds(authoredBounds),
    fittedBounds: plainBounds(new T.Box3().setFromObject(root, true)),
    scale, height, orientationY,
    animations: clips.map(clip => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.length, loop: loopSettings.get(clip), hasBoneMotion: exactClips.get(clip.name) === clip && boneMotionNames.has(clip.name) })),
  };
  root.userData.characterSource = 'actual-glb';
  root.userData.capabilities = capabilities;
  root.userData.source = source;

  return {
    root, content: gltf.scene, facing, mixer, stats, capabilities, source,
    get currentClip() { return currentClip; },
    get currentClipTime() { return currentAction?.time || 0; },
    get currentClipDuration() { return currentAction?.getClip().duration || 0; },
    get currentClipFinished() { return Boolean(currentAction && currentAction.loop === T.LoopOnce && currentAction.paused && currentAction.time >= currentAction.getClip().duration); },
    supportsClip, playClip, stopClips,
    update(state = {}, deltaSeconds = 0) {
      if (disposed) return;
      const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, .1)) : 0;
      if (state.spin) yaw += spinRate * dt;
      else if (Number.isFinite(state.heading)) yaw += shortestAngle(state.heading, yaw) * (1 - Math.exp(-turnRate * dt));
      facing.rotation.y = yaw;
      let clipAccepted = false;
      if (Object.prototype.hasOwnProperty.call(state, 'clipName')) {
        // Explicit phase-driven selection must not fall through to a guessed clip.
        clipAccepted = typeof state.clipName === 'string' && playClip(state.clipName, .18, { restart: state.restartClip === true });
        if (!clipAccepted && currentAction) stopClips();
      } else {
        const selected = state.shooting ? mapping.shooting : state.flight ? mapping.flight : state.moving ? (mapping.run || mapping.walk) : mapping.idle;
        // Unsupported states never fabricate a pose, gait or flight gesture.
        if (selected) clipAccepted = playClip(selected.name, .18, { restart: false });
        else if (currentAction) stopClips();
      }
      if (!state.reduced && dt) mixer?.update(dt);
      root.updateMatrixWorld(true);
      return clipAccepted;
    },
    /** Returns null if that side has no verified real hand/palm bone. */
    palmPosition(index, target = new T.Vector3()) {
      const bone = palms[index];
      if (!bone || disposed) return null;
      root.updateMatrixWorld(true);
      return bone.getWorldPosition(target);
    },
    bounds(target = new T.Box3()) {
      root.updateMatrixWorld(true);
      return target.setFromObject(root, true);
    },
    dispose() {
      if (disposed) return;
      stopClips();
      mixer?.uncacheRoot(gltf.scene);
      const geometries = new Set();
      gltf.scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) {
        texture.dispose();
        texture.source?.data?.close?.();
      }
      root.removeFromParent();
      disposed = true;
    },
  };
}

/** Load only a local/self-origin, fully embedded binary character asset. */
export async function loadSiGLB({ url, loader = new GLTFLoader(), fetchImpl = globalThis.fetch, ...options } = {}) {
  const base = globalThis.location?.href || import.meta.url;
  const resolved = new URL(url || '', base);
  const origin = new URL(base).origin;
  if (!url || !/\.glb$/i.test(resolved.pathname) || !/^https?:$/.test(resolved.protocol) || resolved.origin !== origin) {
    throw new Error('Provide a same-origin local .glb URL. Remote assets and substitute models are not accepted.');
  }
  if (typeof fetchImpl !== 'function' || typeof loader.parseAsync !== 'function') {
    throw new Error('A fetch implementation and genuine GLTFLoader are required.');
  }
  const response = await fetchImpl(resolved.href, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`The character GLB could not be loaded (HTTP ${response.status}).`);
  const buffer = await response.arrayBuffer();
  const manifest = inspectGLB(buffer);
  const gltf = await loader.parseAsync(buffer, '');
  // GLTFLoader can resolve geometry while returning null for failed texture loads.
  // Do not expose a ready avatar until every authored material texture is decoded.
  manifest.textureValidation = await validateAuthoredTextures(gltf, manifest);
  return createSiGLBAdapter(gltf, { ...options, source: { url: resolved.pathname, manifest } });
}
