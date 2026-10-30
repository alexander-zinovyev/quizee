import type { StatsQueryOptions } from "./queries";
import { StatsError } from "./error";

export type StatsPageSearch = Record<string, string | string[] | undefined>;
export function pageValue(params: StatsPageSearch, key: string): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) throw new StatsError("invalid-query", "Repeated statistics query parameters are unsupported.", 400);
  return value;
}
export function statsPageOptions(params: StatsPageSearch, prefix: string): StatsQueryOptions {
  return { sort: pageValue(params, `${prefix}Sort`), direction: pageValue(params, `${prefix}Direction`), cursor: pageValue(params, `${prefix}Cursor`) };
}
