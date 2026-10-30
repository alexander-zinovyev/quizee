export function stableJson(value: unknown): string {
  const stable = (input: unknown): unknown => Array.isArray(input) ? input.map(stable) : input && typeof input === "object"
    ? Object.fromEntries(Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, stable(entry)])) : input;
  const result = JSON.stringify(stable(value));
  if (result === undefined) throw new Error("Value cannot be serialized.");
  return result;
}

export function statsNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "Unavailable" : new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 }).format(value);
}

export function statsPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "Unavailable" : `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value * 100)}%`;
}

export function statsDate(value: string | null): string {
  return value === null ? "Date unavailable" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}
