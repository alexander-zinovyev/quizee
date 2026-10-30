export type DeployedIndex = { name?: string | null; queryScope?: string | null; state?: string | null; fields?: Array<{ fieldPath?: string | null; order?: string | null; arrayConfig?: string | null }> | null };
export type DesiredIndex = { collectionGroup: string; queryScope: string; fields: Array<Record<string, string>> };

/** Firestore appends a document-name tie breaker when a manifest omits it. */
export function indexKey(index: Pick<DeployedIndex, "queryScope" | "fields">) {
  const fields = (index.fields ?? []).map((field) => ({ fieldPath: field.fieldPath, ...(field.order ? { order: field.order } : {}), ...(field.arrayConfig ? { arrayConfig: field.arrayConfig } : {}) }));
  if (!fields.some((field) => field.fieldPath === "__name__")) fields.push({ fieldPath: "__name__", order: [...fields].reverse().find((field) => field.order)?.order ?? "ASCENDING" });
  return JSON.stringify([index.queryScope, fields]);
}

export function missingStatisticsIndexes(desired: DesiredIndex[], deployed: DeployedIndex[]) {
  return desired.map((index) => {
    const match = deployed.find((candidate) => candidate.name?.split("/collectionGroups/")[1]?.split("/")[0] === index.collectionGroup && indexKey(candidate) === indexKey(index));
    return { index, status: !match ? "missing" as const : match.state === "READY" ? "ready" as const : "pending" as const, state: match?.state ?? null, name: match?.name ?? null };
  });
}

export function singleFieldKey(indexes: Array<{ queryScope?: string | null; order?: string | null; arrayConfig?: string | null }>) {
  return JSON.stringify(indexes.map((index) => [index.queryScope, index.order || index.arrayConfig]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
