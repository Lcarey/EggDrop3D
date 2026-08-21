import type { ApiErrorBody, CreateDesignResponse, DesignV1, PublicDesign } from "@eggdrop/shared";

const TOKEN_KEY = "eggdrop3d:edit-tokens:v1";
const DESIGN_INDEX_KEY = "eggdrop3d:design-index:v1";

export class DesignApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = "request_failed",
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const hexDigest = async (body: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

async function request<T>(path: string, init: RequestInit = {}, body?: unknown): Promise<T> {
  const serialized = body === undefined ? "" : JSON.stringify(body);
  const headers = new Headers(init.headers);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (init.method && init.method !== "GET" && init.method !== "HEAD") {
    headers.set("x-amz-content-sha256", await hexDigest(serialized));
  }
  const response = await fetch(path, { ...init, headers, body: body === undefined ? undefined : serialized });
  if (!response.ok) {
    let payload: ApiErrorBody | undefined;
    try { payload = await response.json() as ApiErrorBody; } catch { /* non-JSON infrastructure error */ }
    // A 5xx with no structured body means the request never reached the API
    // (e.g. the dev proxy could not connect because `npm run dev:api` is not
    // running), so point at the server rather than the design.
    const fallback = response.status >= 500 && !payload
      ? "Could not reach the save server. Make sure the API is running (npm run dev starts both), then try again."
      : `Request failed with status ${response.status}`;
    throw new DesignApiError(
      payload?.error.message ?? fallback,
      response.status,
      payload?.error.code,
      payload?.error.details,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const getDesign = (id: string) => request<PublicDesign>(`/api/designs/${encodeURIComponent(id)}`);

export const createDesign = (design: DesignV1) =>
  request<CreateDesignResponse>("/api/designs", { method: "POST" }, design);

export const updateDesign = (id: string, design: DesignV1, editToken: string, version: number) =>
  request<PublicDesign>(`/api/designs/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "X-Edit-Token": editToken, "If-Match": `"${version}"` },
  }, design);

export const deleteDesign = (id: string, editToken: string, version: number) =>
  request<void>(`/api/designs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "X-Edit-Token": editToken, "If-Match": `"${version}"` },
  });

const readRecord = <T,>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
};

export const getEditToken = (id: string) => readRecord<Record<string, string>>(TOKEN_KEY, {})[id] ?? null;

export const rememberCloudDesign = (design: PublicDesign, editToken?: string) => {
  if (editToken) {
    const tokens = readRecord<Record<string, string>>(TOKEN_KEY, {});
    tokens[design.id] = editToken;
    localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  }
  const items = readRecord<Array<{ id: string; name: string; updatedAt: string }>>(DESIGN_INDEX_KEY, []);
  const next = [{ id: design.id, name: design.design.name, updatedAt: design.updatedAt }, ...items.filter((item) => item.id !== design.id)].slice(0, 20);
  localStorage.setItem(DESIGN_INDEX_KEY, JSON.stringify(next));
};

export const forgetCloudDesign = (id: string) => {
  const tokens = readRecord<Record<string, string>>(TOKEN_KEY, {});
  delete tokens[id];
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  const items = readRecord<Array<{ id: string; name: string; updatedAt: string }>>(DESIGN_INDEX_KEY, []);
  localStorage.setItem(DESIGN_INDEX_KEY, JSON.stringify(items.filter((item) => item.id !== id)));
};

export const listRememberedDesigns = () => readRecord<Array<{ id: string; name: string; updatedAt: string }>>(DESIGN_INDEX_KEY, []);

