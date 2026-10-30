import { createStatsReadCache } from "./read-cache";

/** Shared storage simulates independent web workers using the same external cache. */
export function statsCacheFixture() {
  const values = new Map<string, { payload: string | null }>();
  return { values, adapter: createStatsReadCache(async (key, load) => {
    const id = JSON.stringify(key);
    if (!values.has(id)) values.set(id, await load());
    return values.get(id)!;
  }) };
}
