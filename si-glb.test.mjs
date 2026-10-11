import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./tools/three-node-loader.mjs', import.meta.url);
const T = await import('./dist/vendor/three.module.js');
const { inspectGLB, createSiGLBAdapter, loadSiGLB } = await import('./dist/si-glb.js');

// Tiny synthetic fixtures test the adapter contract only; none is a displayed SI asset.
function fixture({ rig = false, clips = [] } = {}) {
  const scene = new T.Group(), geometry = new T.BoxGeometry(2, 6, 1);
  const material = new T.MeshStandardMaterial({ color: 0x24639a, roughness: .71, metalness: .11 });
  let mesh;
  if (rig) {
    const vertices = geometry.attributes.position.count;
    geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(new Uint16Array(vertices * 4), 4));
    const weights = new Float32Array(vertices * 4); for (let i = 0; i < vertices; i++) weights[i * 4] = 1;
    geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4));
    mesh = new T.SkinnedMesh(geometry, material); mesh.name = 'AuthoredSkin';
    const left = new T.Bone(), right = new T.Bone();
    left.name = 'mixamorig:LeftHand'; right.name = 'mixamorig:RightHand';
    left.position.set(-1, 2, 0); right.position.set(1, 2, 0);
    mesh.add(left, right); mesh.bind(new T.Skeleton([left, right]));
  } else mesh = new T.Mesh(geometry, material);
  mesh.position.set(8, 11, -4); scene.add(mesh);
  return { scene, animations: clips };
}
function heroFixture({ invalid = null, heldPose = null, userMetadata = true } = {}) {
  const gltf = fixture({ rig: true }), bone = gltf.scene.getObjectByName('mixamorig:LeftHand');
  const names = ['Idle', 'Walk', 'Takeoff', 'Flight', 'Hover', 'Landing', 'PalmBlast'];
  gltf.animations = names.map(name => {
    const values = name === heldPose ? [Math.sin(.1), 0, 0, Math.cos(.1), Math.sin(.1), 0, 0, Math.cos(.1)] : [0, 0, 0, 1, Math.sin(.1), 0, 0, Math.cos(.1)];
    const clip = new T.AnimationClip(name, .4, name === invalid ? [] : [new T.QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, [0, .4], values)]);
    if (userMetadata) clip.userData = { loop: !['Takeoff', 'Landing', 'PalmBlast'].includes(name) };
    return clip;
  });
  return gltf;
}
function binary(json, extra = 0) {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const count = Math.ceil(text.length / 4) * 4;
  const buffer = new ArrayBuffer(20 + count + extra), view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, count, true); view.setUint32(16, 0x4e4f534a, true);
  const body = new Uint8Array(buffer, 20, count); body.fill(32); body.set(text);
  return buffer;
}
const minimal = { asset: { version: '2.0' }, meshes: [{ primitives: [] }] };

function texturedContract({ shared = false, missingTexture = -1, missingSlot = null, undecodedTexture = -1 } = {}) {
  const indices = shared ? [0, 0, 0] : [0, 1, 2];
  const json = {
    ...minimal,
    // Multiple texture indices may share one image; unused images must not count.
    images: Array.from({ length: shared ? 3 : 1 }, () => ({ uri: 'data:image/png;base64,AA==' })),
    textures: Array.from({ length: shared ? 1 : 3 }, () => ({ source: 0 })),
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: indices[0] }, metallicRoughnessTexture: { index: indices[2] } }, normalTexture: { index: indices[1] } }],
  };
  const gltf = fixture(), material = gltf.scene.children[0].material;
  const textures = json.textures.map(() => new T.DataTexture(new Uint8Array([255, 128, 64, 255]), 1, 1));
  if (undecodedTexture >= 0) textures[undecodedTexture] = new T.Texture();
  material.map = textures[indices[0]]; material.normalMap = textures[indices[1]];
  material.metalnessMap = textures[indices[2]]; material.roughnessMap = textures[indices[2]];
  if (missingSlot) material[missingSlot] = null;
  const requests = [];
  gltf.parser = { async getDependency(type, index) {
    requests.push([type, index]);
    if (type === 'texture') return index === missingTexture ? null : textures[index];
    if (type === 'material') return index === 0 ? material : null;
    throw new Error('Unexpected dependency');
  } };
  return { json, gltf, material, textures, requests };
}
async function loadContract(contract) {
  const previous = globalThis.location;
  globalThis.location = { href: 'http://127.0.0.1:8051/' };
  try {
    return await loadSiGLB({
      url: './assets/test-character.glb',
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => binary(contract.json) }),
      loader: { parseAsync: async () => contract.gltf },
    });
  } finally {
    if (previous === undefined) delete globalThis.location;
    else globalThis.location = previous;
  }
}

test('grounds and centers an authored mesh at the configured height without changing material', () => {
  const gltf = fixture(), material = gltf.scene.children[0].material;
  const adapter = createSiGLBAdapter(gltf, { height: 3.9, orientationY: Math.PI / 2 });
  const bounds = adapter.bounds(), size = bounds.getSize(new T.Vector3()), center = bounds.getCenter(new T.Vector3());
  assert.ok(Math.abs(bounds.min.y) < 1e-7); assert.ok(Math.abs(size.y - 3.9) < 1e-7);
  assert.ok(Math.abs(center.x) < 1e-7 && Math.abs(center.z) < 1e-7);
  assert.equal(gltf.scene.children[0].material, material); assert.equal(material.roughness, .71);
  assert.equal(adapter.stats.meshes, 1); assert.equal(adapter.stats.triangles, 12);
  adapter.dispose();
});
test('rigid assets rotate continuously but never claim gait or invent palm positions', () => {
  const adapter = createSiGLBAdapter(fixture());
  assert.equal(adapter.capabilities.hasRig, false); assert.equal(adapter.capabilities.hasGait, false);
  assert.equal(adapter.capabilities.hasPalmBones, false); assert.equal(adapter.palmPosition(0), null);
  assert.equal(adapter.capabilities.hasHeroFlight, false); assert.equal(adapter.capabilities.hasPalmAnimation, false);
  assert.equal(adapter.supportsClip('Flight'), false);
  for (let i = 0; i < 200; i++) adapter.update({ spin: true, moving: true }, .05);
  assert.ok(adapter.facing.rotation.y > Math.PI * 2); assert.equal(adapter.currentClip, null);
  adapter.dispose();
});
test('movement rotates in the shortest direction and finite delta guard protects the model', () => {
  const adapter = createSiGLBAdapter(fixture());
  for (let i = 0; i < 30; i++) adapter.update({ heading: -Math.PI + .05 }, .05);
  assert.ok(Math.abs(adapter.facing.rotation.y - (-Math.PI + .05)) < .01);
  const before = adapter.facing.rotation.y;
  adapter.update({ spin: true }, Infinity); adapter.update({ heading: NaN }, NaN);
  assert.equal(adapter.facing.rotation.y, before); adapter.dispose();
});
test('verified real bones and embedded clips are exposed and played unchanged', () => {
  const gltf = fixture({ rig: true }), bone = gltf.scene.getObjectByName('mixamorig:LeftHand');
  const clip = new T.AnimationClip('Run', 1, [new T.QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, [0, 1], [0, 0, 0, 1, Math.sin(.1), 0, 0, Math.cos(.1)])]);
  gltf.animations.push(clip);
  const adapter = createSiGLBAdapter(gltf);
  assert.equal(adapter.capabilities.hasRig, true); assert.equal(adapter.capabilities.hasGait, true);
  assert.equal(adapter.capabilities.hasPalmBones, true);
  assert.deepEqual(adapter.capabilities.palmBoneNames, ['mixamorig:LeftHand', 'mixamorig:RightHand']);
  adapter.root.position.set(10, 2, 1); adapter.update({ moving: true }, .05);
  assert.equal(adapter.currentClip, 'Run'); assert.equal(adapter.stats.animations[0].duration, 1);
  assert.ok(adapter.palmPosition(0).isVector3); assert.ok(adapter.palmPosition(0).x > 8);
  assert.equal(adapter.playClip('not-present'), false); adapter.dispose();
});
test('a Run name cannot claim gait from empty, root-only, missing-bone or constant tracks', async t => {
  const cases = [
    ['empty clip', []],
    ['root-only motion', [new T.NumberKeyframeTrack('.rotation[x]', [0, 1], [0, .1])]],
    ['missing bone', [new T.NumberKeyframeTrack('NotAnAuthoredBone.rotation[x]', [0, 1], [0, .1])]],
    ['one static bone key', [new T.NumberKeyframeTrack('AuthoredSkin.bones[mixamorig:LeftHand].rotation[x]', [0], [.1])]],
    ['constant bone keys', [new T.NumberKeyframeTrack('AuthoredSkin.bones[mixamorig:LeftHand].rotation[x]', [0, 1], [.1, .1])]],
    ['no elapsed key time', [new T.NumberKeyframeTrack('AuthoredSkin.bones[mixamorig:LeftHand].rotation[x]', [0, 0], [0, .1])]],
  ];
  for (const [name, tracks] of cases) await t.test(name, () => {
    const adapter = createSiGLBAdapter(fixture({ rig: true, clips: [new T.AnimationClip('Run', 1, tracks)] }));
    assert.equal(adapter.capabilities.hasRig, true);
    assert.equal(adapter.capabilities.hasEmbeddedAnimation, true);
    assert.equal(adapter.capabilities.hasGait, false);
    adapter.update({ moving: true }, .05);
    assert.equal(adapter.currentClip, null);
    // Rejected gait inference does not delete or rewrite an authored clip.
    assert.deepEqual(adapter.capabilities.embeddedClipNames, ['Run']);
    if (name !== 'missing bone') assert.equal(adapter.playClip('Run'), true);
    adapter.dispose();
  });
});
test('loose scene bones do not establish skin gait', () => {
  const clip = new T.AnimationClip('Walk', 1, [new T.NumberKeyframeTrack('LooseBone.rotation[x]', [0, 1], [0, .1])]);
  const gltf = fixture({ rig: true, clips: [clip] }), loose = new T.Bone();
  loose.name = 'LooseBone'; gltf.scene.add(loose);
  const adapter = createSiGLBAdapter(gltf);
  assert.equal(adapter.capabilities.hasGait, false);
  adapter.update({ moving: true }, .05); assert.equal(adapter.currentClip, null);
  adapter.dispose();
});
test('bone bindings through a real mesh skeleton can establish embedded gait', () => {
  const clip = new T.AnimationClip('Walk', 1, [new T.NumberKeyframeTrack('AuthoredSkin.bones[mixamorig:LeftHand].rotation[x]', [0, 1], [0, .1])]);
  const gltf = fixture({ rig: true, clips: [clip] }); gltf.scene.children[0].name = 'AuthoredSkin';
  const adapter = createSiGLBAdapter(gltf);
  assert.equal(adapter.capabilities.hasGait, true);
  adapter.update({ moving: true }, .05); assert.equal(adapter.currentClip, 'Walk');
  adapter.dispose();
});
test('exact phase clips override ambiguous automatic flight matching without inventing a substitute', () => {
  const adapter = createSiGLBAdapter(heroFixture());
  assert.equal(adapter.capabilities.hasHeroFlight, true);
  assert.equal(adapter.capabilities.hasPalmAnimation, true);
  assert.equal(adapter.supportsClip('Flight', { requireBoneMotion: true }), true);
  adapter.update({ flight: true }, .05);
  assert.equal(adapter.currentClip, null); // Both authored Flight and Hover match the legacy pattern.
  assert.equal(adapter.update({ flight: true, clipName: 'Flight' }, .05), true);
  assert.equal(adapter.currentClip, 'Flight');
  adapter.update({ moving: true, clipName: 'Hover' }, .05);
  assert.equal(adapter.currentClip, 'Hover');
  assert.equal(adapter.update({ flight: true, clipName: 'MissingFlight' }, .05), false);
  assert.equal(adapter.currentClip, null);
  assert.equal(adapter.supportsClip('MissingFlight'), false);
  adapter.update({ clipName: 'Idle' }, .05);
  adapter.update({ clipName: null, moving: true }, .05);
  assert.equal(adapter.currentClip, null); adapter.dispose();
});
test('one-shot phase clips clamp once and repeated updates never restart the completed action', async t => {
  for (const name of ['Takeoff', 'Landing', 'PalmBlast']) await t.test(name, () => {
    const adapter = createSiGLBAdapter(heroFixture());
    for (let i = 0; i < 12; i++) adapter.update({ clipName: name }, .1);
    assert.equal(adapter.currentClip, name);
    assert.equal(adapter.currentClipFinished, true);
    assert.ok(Math.abs(adapter.currentClipTime - .4) < 1e-7);
    const before = adapter.currentClipTime;
    adapter.update({ clipName: name }, .1); assert.equal(adapter.currentClipTime, before);
    assert.equal(adapter.currentClipDuration, .4);
    assert.equal(adapter.stats.animations.find(clip => clip.name === name).loop, false);
    // Manual playback restarts a completed shot; explicit pulses can restart an active shot.
    assert.equal(adapter.playClip(name, 0), true); assert.equal(adapter.currentClipTime, 0);
    adapter.update({ clipName: name }, .1); assert.ok(adapter.currentClipTime > 0);
    adapter.playClip(name, 0, { restart: true }); assert.equal(adapter.currentClipTime, 0);
    adapter.update({ clipName: name, restartClip: true }, .05); assert.ok(Math.abs(adapter.currentClipTime - .05) < 1e-7);
    adapter.dispose();
  });
});
test('looping authored phases repeat rather than clamp at the clip end', async t => {
  for (const name of ['Idle', 'Walk', 'Flight', 'Hover']) await t.test(name, () => {
    const adapter = createSiGLBAdapter(heroFixture());
    for (let i = 0; i < 7; i++) adapter.update({ clipName: name }, .1);
    assert.equal(adapter.currentClip, name); assert.equal(adapter.currentClipFinished, false);
    assert.ok(adapter.currentClipTime < .4);
    assert.equal(adapter.stats.animations.find(clip => clip.name === name).loop, true);
    adapter.dispose();
  });
});
test('loop metadata is honored from clip userData, parser GLB extras and inspected source metadata', () => {
  const gltf = heroFixture({ userMetadata: false });
  gltf.animations.find(clip => clip.name === 'Flight').userData = { loop: false };
  gltf.parser = { json: { animations: gltf.animations.map(clip => ({ name: clip.name, extras: { loop: clip.name === 'Takeoff' } })) } };
  const adapter = createSiGLBAdapter(gltf);
  assert.equal(adapter.stats.animations.find(clip => clip.name === 'Flight').loop, false);
  assert.equal(adapter.stats.animations.find(clip => clip.name === 'Takeoff').loop, true);
  adapter.dispose();
  const source = { manifest: { animationMetadata: [{ name: 'Flight', loop: false }] } };
  const second = createSiGLBAdapter(fixture({ clips: [new T.AnimationClip('Flight', 1, [])] }), { source });
  assert.equal(second.stats.animations[0].loop, false); second.dispose();
  const manifest = inspectGLB(binary({ ...minimal, animations: [{ name: 'Takeoff', extras: { loop: false } }, { name: 'Flight', extras: { loop: true } }] }));
  assert.deepEqual(manifest.animationMetadata, [{ name: 'Takeoff', loop: false }, { name: 'Flight', loop: true }]);
});
test('hero capability requires actual bone tracks, and allows a held non-rest authored flight pose', () => {
  for (const name of ['Takeoff', 'Flight', 'Hover', 'Landing']) {
    const adapter = createSiGLBAdapter(heroFixture({ invalid: name }));
    assert.equal(adapter.capabilities.hasHeroFlight, false);
    assert.equal(adapter.supportsClip(name), true);
    assert.equal(adapter.supportsClip(name, { requireBoneMotion: true }), false);
    adapter.dispose();
  }
  const missingPalm = createSiGLBAdapter(heroFixture({ invalid: 'PalmBlast' }));
  assert.equal(missingPalm.capabilities.hasPalmAnimation, false); missingPalm.dispose();
  const held = createSiGLBAdapter(heroFixture({ heldPose: 'Flight' }));
  assert.equal(held.capabilities.hasHeroFlight, true);
  assert.equal(held.supportsClip('Flight', { requireBoneMotion: true }), true); held.dispose();
  const rest = heroFixture({ heldPose: 'Flight' });
  rest.animations.find(clip => clip.name === 'Flight').tracks[0].values.set([0, 0, 0, 1, 0, 0, 0, 1]);
  const restAdapter = createSiGLBAdapter(rest);
  assert.equal(restAdapter.capabilities.hasHeroFlight, false); restAdapter.dispose();
});
test('duplicate exact names are rejected rather than selecting the first authored clip', () => {
  const gltf = heroFixture(); gltf.animations.push(gltf.animations.find(clip => clip.name === 'Flight').clone());
  const adapter = createSiGLBAdapter(gltf);
  assert.equal(adapter.capabilities.hasHeroFlight, false);
  assert.equal(adapter.supportsClip('Flight'), false); assert.equal(adapter.playClip('Flight'), false);
  adapter.update({ clipName: 'Flight' }, .05); assert.equal(adapter.currentClip, null); adapter.dispose();
});
test('ambiguous hand bone names are not guessed', () => {
  const gltf = fixture({ rig: true }), duplicate = new T.Bone(); duplicate.name = 'LeftHand'; gltf.scene.add(duplicate);
  const adapter = createSiGLBAdapter(gltf);
  assert.equal(adapter.palmPosition(0), null); assert.equal(adapter.capabilities.hasPalmBones, false);
  adapter.dispose();
});
test('invalid or empty geometry is rejected, never replaced', () => {
  assert.throws(() => createSiGLBAdapter({ scene: new T.Group() }), /bounds/);
  assert.throws(() => createSiGLBAdapter(fixture(), { height: 0 }), /positive/);
  assert.throws(() => createSiGLBAdapter(null), /scene/);
});
test('binary GLB identity, chunk lengths and embedded-resource boundaries are checked', () => {
  assert.equal(inspectGLB(binary(minimal)).selfContained, true);
  assert.throws(() => inspectGLB(new ArrayBuffer(12)), /complete/);
  const wrong = binary(minimal); new DataView(wrong).setUint32(0, 0, true); assert.throws(() => inspectGLB(wrong), /genuine/);
  const truncated = binary(minimal); new DataView(truncated).setUint32(8, truncated.byteLength + 4, true); assert.throws(() => inspectGLB(truncated), /truncated/);
  assert.throws(() => inspectGLB(binary(minimal, 4)), /chunk header/);
  assert.throws(() => inspectGLB(binary({ ...minimal, images: [{ uri: 'https://untrusted.example/file.png' }] })), /self-contained/);
  assert.throws(() => inspectGLB(binary({ ...minimal, buffers: [{ uri: '../external.bin' }] })), /self-contained/);
});
test('material texture references count unique texture indices rather than images or slots', () => {
  const distinct = inspectGLB(binary(texturedContract().json));
  assert.equal(distinct.images, 1); assert.equal(distinct.referencedTextures, 3);
  assert.deepEqual(distinct.textureIndices, [0, 1, 2]);
  const shared = inspectGLB(binary(texturedContract({ shared: true }).json));
  assert.equal(shared.images, 3); assert.equal(shared.referencedTextures, 1);
  assert.deepEqual(shared.textureIndices, [0]);
  assert.throws(() => inspectGLB(binary({ ...minimal, materials: [{ normalTexture: { index: 9 } }] })), /Invalid authored material texture reference/);
});
test('textured loading fails closed when base-color, normal or metallic-roughness decoding fails', async t => {
  for (const [name, index] of [['base-color', 0], ['normal', 1], ['metallic-roughness', 2]]) await t.test(name, async () => {
    const contract = texturedContract({ missingTexture: index });
    await assert.rejects(loadContract(contract), new RegExp(`texture ${index} failed to load or decode`));
    assert.equal(contract.gltf.scene.parent, null);
  });
});
test('textured loading fails closed when a parsed material silently drops an authored map', async t => {
  for (const slot of ['map', 'normalMap', 'metalnessMap', 'roughnessMap']) await t.test(slot, async () => {
    const contract = texturedContract({ missingSlot: slot });
    await assert.rejects(loadContract(contract), /missing its decoded/);
    assert.equal(contract.gltf.scene.parent, null);
  });
});
test('a Texture instance without decoded pixels cannot make a textured character ready', async () => {
  await assert.rejects(loadContract(texturedContract({ undecodedTexture: 1 })), /texture 1 failed to load or decode/);
});
test('fully decoded authored PBR textures are preserved and verified per unique index', async () => {
  const contract = texturedContract(), adapter = await loadContract(contract);
  assert.equal(adapter.content.children[0].material, contract.material);
  assert.equal(contract.material.map, contract.textures[0]);
  assert.equal(contract.material.normalMap, contract.textures[1]);
  assert.equal(contract.material.metalnessMap, contract.textures[2]);
  assert.equal(contract.material.roughnessMap, contract.textures[2]);
  assert.deepEqual(adapter.source.manifest.textureValidation, { referencedTextures: 3, decodedTextures: 3 });
  assert.deepEqual(contract.requests.filter(([type]) => type === 'texture'), [['texture', 0], ['texture', 1], ['texture', 2]]);
  assert.equal(adapter.stats.textures, 3); adapter.dispose();
});
test('one decoded texture reused in several authored slots is checked once', async () => {
  const contract = texturedContract({ shared: true }), adapter = await loadContract(contract);
  assert.deepEqual(adapter.source.manifest.textureValidation, { referencedTextures: 1, decodedTextures: 1 });
  assert.deepEqual(contract.requests.filter(([type]) => type === 'texture'), [['texture', 0]]);
  assert.equal(adapter.stats.textures, 1); adapter.dispose();
});
test('genuinely untextured authored geometry remains valid without a texture parser', async () => {
  const adapter = await loadContract({ json: { ...minimal, images: [{ uri: 'data:image/png;base64,AA==' }] }, gltf: fixture() });
  assert.equal(adapter.stats.textures, 0);
  assert.deepEqual(adapter.source.manifest.textureValidation, { referencedTextures: 0, decodedTextures: 0 });
  assert.equal(adapter.capabilities.real3DMesh, true); adapter.dispose();
});
test('remote and non-GLB paths fail before any network request', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests++; throw new Error('must not fetch'); };
  await assert.rejects(loadSiGLB({ url: 'https://untrusted.example/model.glb', fetchImpl }), /same-origin/);
  await assert.rejects(loadSiGLB({ url: './sprite.png', fetchImpl }), /same-origin/);
  assert.equal(requests, 0);
});
