import { randomUUID } from "node:crypto";
import {
  DesignV1Schema,
  MAX_DESIGN_PAYLOAD_BYTES,
  type ApiErrorBody,
  type CreateDesignResponse,
  type DesignV1,
  type PublicDesign,
} from "@eggdrop/shared";
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { DesignRecord, DesignRepository } from "./repository.js";
import type { RateLimiter, RateLimitResult } from "./rate-limit.js";
import {
  editTokenMatches,
  generateEditToken,
  hashEditToken,
  isPlausibleEditToken,
} from "./security.js";

const API_ROOT = "/api/designs";
const RATE_LIMIT_WINDOW_MS = 60_000;
const READS_PER_WINDOW = 120;
const WRITES_PER_WINDOW = 30;
const MAX_BODY_BYTES = MAX_DESIGN_PAYLOAD_BYTES;
const DESIGN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AppEnv = {
  Variables: {
    requestId: string;
  };
};

type ErrorStatus = Extract<
  ContentfulStatusCode,
  400 | 401 | 403 | 404 | 409 | 413 | 415 | 428 | 429 | 500 | 503
>;

export interface AppDependencies {
  repository: DesignRepository;
  rateLimiter: RateLimiter;
  now?: () => number;
  idFactory?: () => string;
  tokenFactory?: () => string;
  logger?: Pick<Console, "error">;
}

interface ParsedBody {
  ok: true;
  design: DesignV1;
}

interface InvalidBody {
  ok: false;
  status: 400 | 413 | 415;
  code: string;
  message: string;
  details?: unknown;
}

function apiError(
  c: Context<AppEnv>,
  status: ErrorStatus,
  code: string,
  message: string,
  details?: unknown,
) {
  c.header("Cache-Control", "no-store");
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
  return c.json(body, status);
}

function toPublicDesign(record: DesignRecord): PublicDesign {
  // Build the public shape explicitly so editTokenHash can never leak if the
  // persistence record gains fields later.
  return {
    id: record.id,
    design: record.design,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function setEntityHeaders(c: Context<AppEnv>, record: Pick<DesignRecord, "id" | "version">) {
  c.header("ETag", `"${record.version}"`);
  c.header("Content-Location", `${API_ROOT}/${record.id}`);
}

function getClientIdentity(c: Context<AppEnv>): string {
  // CloudFront appends the actual viewer address to X-Forwarded-For. Reading
  // the final entry prevents a caller-supplied first entry from evading limits.
  const forwarded = c.req.header("x-forwarded-for");
  const forwardedParts = forwarded
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return (
    forwardedParts?.at(-1) ??
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
}

function setRateLimitHeaders(
  c: Context<AppEnv>,
  result: RateLimitResult,
  nowMs: number,
): void {
  c.header("RateLimit-Limit", String(result.limit));
  c.header("RateLimit-Remaining", String(result.remaining));
  c.header("RateLimit-Reset", String(Math.max(1, Math.ceil((result.resetAt - nowMs) / 1_000))));
  c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1_000)));
}

function extractEditToken(c: Context<AppEnv>): string | null {
  // CloudFront's Lambda Function URL OAC replaces the viewer Authorization
  // header with its SigV4 credentials, so this is the production contract.
  const editTokenHeader = c.req.header("x-edit-token")?.trim();
  if (editTokenHeader) return editTokenHeader;

  // Bearer is retained for direct/local API clients only.
  const authorization = c.req.header("authorization");
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

type IfMatchResult =
  | { kind: "ok"; version: number }
  | { kind: "missing" }
  | { kind: "invalid" };

function parseIfMatch(value: string | undefined): IfMatchResult {
  if (value === undefined) return { kind: "missing" };
  const normalized = value.trim();
  const match = /^(?:"([1-9]\d*)"|([1-9]\d*))$/.exec(normalized);
  const rawVersion = match?.[1] ?? match?.[2];
  if (!rawVersion) return { kind: "invalid" };

  const version = Number(rawVersion);
  return Number.isSafeInteger(version)
    ? { kind: "ok", version }
    : { kind: "invalid" };
}

function ifNoneMatchIncludes(value: string | undefined, version: number): boolean {
  if (!value) return false;
  return value
    .split(",")
    .map((part) => part.trim())
    .some((part) => part === `"${version}"` || part === `W/"${version}"` || part === "*");
}

async function parseDesignBody(request: Request): Promise<ParsedBody | InvalidBody> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return {
      ok: false,
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Use Content-Type: application/json.",
    };
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "The design payload is too large.",
    };
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return {
      ok: false,
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "The design payload is too large.",
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(rawBody) as unknown;
  } catch {
    return {
      ok: false,
      status: 400,
      code: "INVALID_JSON",
      message: "The request body is not valid JSON.",
    };
  }

  const parsed = DesignV1Schema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      message: "The design payload does not match schema version 1.",
      details: parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  return { ok: true, design: parsed.data };
}

function validateDesignId(c: Context<AppEnv>): string | null {
  const id = c.req.param("id");
  return typeof id === "string" && DESIGN_ID_PATTERN.test(id) ? id : null;
}

export function createApp(dependencies: AppDependencies): Hono<AppEnv> {
  const now = dependencies.now ?? Date.now;
  const idFactory = dependencies.idFactory ?? randomUUID;
  const tokenFactory = dependencies.tokenFactory ?? generateEditToken;
  const logger = dependencies.logger ?? console;
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id")?.slice(0, 128) || randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    c.header("X-Content-Type-Options", "nosniff");
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) {
      c.header("Cache-Control", "no-store");
    }
    await next();
  });

  app.use("*", async (c, next) => {
    if (!(c.req.path === API_ROOT || c.req.path.startsWith(`${API_ROOT}/`))) {
      return next();
    }

    const isRead = c.req.method === "GET" || c.req.method === "HEAD";
    const bucket = isRead ? "design-read" : "design-write";
    const limit = isRead ? READS_PER_WINDOW : WRITES_PER_WINDOW;
    const requestTime = now();
    let result: RateLimitResult;
    try {
      result = await dependencies.rateLimiter.consume(
        bucket,
        getClientIdentity(c),
        limit,
        RATE_LIMIT_WINDOW_MS,
        requestTime,
      );
    } catch (error) {
      logger.error(
        JSON.stringify({
          level: "error",
          event: "rate_limiter_failed",
          requestId: c.get("requestId"),
          errorName: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      return apiError(
        c,
        503,
        "SERVICE_UNAVAILABLE",
        "Request limiting is temporarily unavailable. Please try again.",
      );
    }

    setRateLimitHeaders(c, result, requestTime);
    if (!result.allowed) {
      c.header(
        "Retry-After",
        String(Math.max(1, Math.ceil((result.resetAt - requestTime) / 1_000))),
      );
      return apiError(c, 429, "RATE_LIMITED", "Too many requests. Please try again shortly.");
    }
    return next();
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.post(API_ROOT, async (c) => {
    const parsedBody = await parseDesignBody(c.req.raw);
    if (!parsedBody.ok) {
      return apiError(
        c,
        parsedBody.status,
        parsedBody.code,
        parsedBody.message,
        parsedBody.details,
      );
    }

    const editToken = tokenFactory();
    if (!isPlausibleEditToken(editToken)) {
      throw new Error("The edit token generator did not return a 256-bit base64url token.");
    }

    const timestamp = new Date(now()).toISOString();
    let record: DesignRecord | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate: DesignRecord = {
        id: idFactory(),
        design: parsedBody.design,
        editTokenHash: hashEditToken(editToken),
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      if (await dependencies.repository.create(candidate)) {
        record = candidate;
        break;
      }
    }
    if (!record) throw new Error("Unable to allocate a unique design id.");

    const response: CreateDesignResponse = {
      ...toPublicDesign(record),
      editToken,
    };
    setEntityHeaders(c, record);
    c.header("Location", `${API_ROOT}/${record.id}`);
    c.header("Cache-Control", "no-store");
    return c.json(response, 201);
  });

  app.get(`${API_ROOT}/:id`, async (c) => {
    const id = validateDesignId(c);
    if (!id) return apiError(c, 400, "INVALID_DESIGN_ID", "The design id is invalid.");

    const record = await dependencies.repository.get(id);
    if (!record) return apiError(c, 404, "DESIGN_NOT_FOUND", "The design was not found.");

    setEntityHeaders(c, record);
    if (ifNoneMatchIncludes(c.req.header("if-none-match"), record.version)) {
      return c.body(null, 304);
    }
    return c.json(toPublicDesign(record));
  });

  app.put(`${API_ROOT}/:id`, async (c) => {
    const id = validateDesignId(c);
    if (!id) return apiError(c, 400, "INVALID_DESIGN_ID", "The design id is invalid.");

    const editToken = extractEditToken(c);
    if (!editToken || !isPlausibleEditToken(editToken)) {
      return apiError(
        c,
        401,
        "EDIT_TOKEN_REQUIRED",
        "A valid X-Edit-Token header is required.",
      );
    }

    const ifMatch = parseIfMatch(c.req.header("if-match"));
    if (ifMatch.kind === "missing") {
      return apiError(c, 428, "IF_MATCH_REQUIRED", "Send the current design ETag in If-Match.");
    }
    if (ifMatch.kind === "invalid") {
      return apiError(c, 400, "INVALID_IF_MATCH", "If-Match must contain one numeric ETag.");
    }

    const current = await dependencies.repository.get(id);
    if (!current) return apiError(c, 404, "DESIGN_NOT_FOUND", "The design was not found.");
    if (!editTokenMatches(editToken, current.editTokenHash)) {
      return apiError(c, 403, "EDIT_TOKEN_INVALID", "The edit token is not valid for this design.");
    }
    if (ifMatch.version !== current.version) {
      return apiError(c, 409, "VERSION_CONFLICT", "The design has changed since it was loaded.", {
        currentVersion: current.version,
      });
    }

    const parsedBody = await parseDesignBody(c.req.raw);
    if (!parsedBody.ok) {
      return apiError(
        c,
        parsedBody.status,
        parsedBody.code,
        parsedBody.message,
        parsedBody.details,
      );
    }

    const updated = await dependencies.repository.replace({
      id,
      design: parsedBody.design,
      editTokenHash: hashEditToken(editToken),
      expectedVersion: ifMatch.version,
      updatedAt: new Date(now()).toISOString(),
    });
    if (!updated) {
      return apiError(c, 409, "VERSION_CONFLICT", "The design changed during this update.");
    }

    setEntityHeaders(c, updated);
    c.header("Cache-Control", "no-store");
    return c.json(toPublicDesign(updated));
  });

  app.delete(`${API_ROOT}/:id`, async (c) => {
    const id = validateDesignId(c);
    if (!id) return apiError(c, 400, "INVALID_DESIGN_ID", "The design id is invalid.");

    const editToken = extractEditToken(c);
    if (!editToken || !isPlausibleEditToken(editToken)) {
      return apiError(
        c,
        401,
        "EDIT_TOKEN_REQUIRED",
        "A valid X-Edit-Token header is required.",
      );
    }

    const ifMatch = parseIfMatch(c.req.header("if-match"));
    if (ifMatch.kind === "missing") {
      return apiError(c, 428, "IF_MATCH_REQUIRED", "Send the current design ETag in If-Match.");
    }
    if (ifMatch.kind === "invalid") {
      return apiError(c, 400, "INVALID_IF_MATCH", "If-Match must contain one numeric ETag.");
    }

    const current = await dependencies.repository.get(id);
    if (!current) return apiError(c, 404, "DESIGN_NOT_FOUND", "The design was not found.");
    if (!editTokenMatches(editToken, current.editTokenHash)) {
      return apiError(c, 403, "EDIT_TOKEN_INVALID", "The edit token is not valid for this design.");
    }
    if (ifMatch.version !== current.version) {
      return apiError(c, 409, "VERSION_CONFLICT", "The design has changed since it was loaded.", {
        currentVersion: current.version,
      });
    }

    const deleted = await dependencies.repository.delete({
      id,
      editTokenHash: hashEditToken(editToken),
      expectedVersion: ifMatch.version,
    });
    if (!deleted) {
      return apiError(c, 409, "VERSION_CONFLICT", "The design changed during this deletion.");
    }
    c.header("Cache-Control", "no-store");
    return c.body(null, 204);
  });

  app.notFound((c) => apiError(c, 404, "NOT_FOUND", "The requested route was not found."));

  app.onError((error, c) => {
    logger.error(
      JSON.stringify({
        level: "error",
        event: "request_failed",
        requestId: c.get("requestId"),
        method: c.req.method,
        path: c.req.path,
        errorName: error.name,
      }),
    );
    return apiError(c, 500, "INTERNAL_ERROR", "An unexpected error occurred.");
  });

  return app;
}
