// Node-only import-map equivalent for audit/tests. Browser code uses index.html's import map.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: new URL('../dist/vendor/three.module.js', import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL('../dist/vendor/addons/' + specifier.slice('three/addons/'.length), import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
