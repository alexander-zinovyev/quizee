import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { getServerAuth, getServerFirestore } from "@/server/database";
import { StatsError } from "./error";
import { ADMIN_SESSION_COOKIE, adminCookie, requireStatsSessionAdmin } from "./sessions";
import { statsId } from "./model";
import type { StatsQueryOptions } from "./queries";

export async function statsResponse(work: () => Promise<Response>): Promise<Response> {
  try {
    const response = await work();
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof StatsError) return Response.json({ code: error.code, message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }) }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    const correlationId = randomUUID();
    console.error("[stats] Request failed", { correlationId, errorType: error instanceof Error ? error.name : "unknown" });
    return Response.json({ code: "internal-error", message: "Unable to complete this request.", details: { correlationId } }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function statsJson(request: Request, allowed: string[]): Promise<Record<string, unknown>> {
  let data: unknown;
  try { data = await request.json(); }
  catch { throw new StatsError("malformed-input", "Expected a JSON object.", 400); }
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some((key) => !allowed.includes(key))) {
    throw new StatsError("malformed-input", "The request contains unsupported fields.", 400);
  }
  return data as Record<string, unknown>;
}

export function statsVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new StatsError("malformed-input", "A nonnegative expectedVersion is required.", 400);
  return value;
}

export function requestStatsAdmin(request: Request): Promise<string> {
  const cookie = adminCookie(request);
  if (!cookie) throw new StatsError("unauthenticated", "Sign in to continue.", 401);
  return requireStatsSessionAdmin(getServerAuth(), getServerFirestore(), cookie);
}

export async function pageStatsAdmin(): Promise<string> {
  const cookie = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value ?? null;
  if (!cookie) throw new StatsError("unauthenticated", "Sign in to continue.", 401);
  return requireStatsSessionAdmin(getServerAuth(), getServerFirestore(), cookie);
}

export function statsParam(value: string): string {
  try { return statsId(value); }
  catch { throw new StatsError("invalid-id", "Invalid statistics identifier.", 400); }
}

export function statsListOptions(request: Request): StatsQueryOptions {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !["sort", "direction", "limit", "cursor"].includes(key))) throw new StatsError("invalid-query", "Unsupported statistics query parameter.", 400);
  return { sort: params.get("sort") ?? undefined, direction: params.get("direction") ?? undefined,
    limit: params.has("limit") ? Number(params.get("limit")) : undefined, cursor: params.get("cursor") };
}
