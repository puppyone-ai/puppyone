// Recovery never replaces an object. Inspect every target before the first write.
export async function recoverImmutableUploads({ bundles, store }) {
  const plans = [];
  for (const { prefix, files } of bundles) {
    const marker = `${prefix}/release.json`;
    const expected = new Map(files.map((file) => [`${prefix}/${file.name}`, file]));
    if (!expected.has(marker)) throw new Error(`Missing commit marker for ${prefix}`);
    const listed = await store.list(`${prefix}/`);
    const existing = new Set(listed);
    for (const key of existing) {
      const file = expected.get(key);
      if (!file) throw new Error(`Unexpected immutable object: ${key}`);
      const remote = await store.digest(key);
      if (remote.bytes !== file.bytes || remote.sha256 !== file.sha256) {
        throw new Error(`Immutable object differs from the original artifact: ${key}`);
      }
    }
    const missing = [...expected].filter(([key]) => !existing.has(key));
    if (existing.has(marker) && missing.length) {
      throw new Error(`Committed immutable bundle is incomplete: ${prefix}`);
    }
    plans.push(missing.sort(([left], [right]) => Number(left === marker) - Number(right === marker)));
  }
  for (const plan of plans) {
    for (const [key, file] of plan) {
      await store.putMissing(key, file.path);
      const remote = await store.digest(key);
      if (remote.bytes !== file.bytes || remote.sha256 !== file.sha256) {
        throw new Error(`Recovered object failed integrity verification: ${key}`);
      }
      console.log(`Verified recovered immutable object: ${key}`);
    }
  }
}
