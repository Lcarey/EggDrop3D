import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshDesign } from "../editor/store";
import {
  createDesign,
  deleteDesign,
  forgetCloudDesign,
  getEditToken,
  listRememberedDesigns,
  rememberCloudDesign,
  updateDesign,
} from "./designs";

const hash = async (body: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const publicDesign = () => ({
  id: "share_123",
  design: freshDesign(),
  version: 1,
  createdAt: "2026-08-21T12:00:00.000Z",
  updatedAt: "2026-08-21T12:00:00.000Z",
});

describe("design API client", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("hashes the exact POST payload required by CloudFront Lambda OAC", async () => {
    const design = freshDesign();
    const response = { ...publicDesign(), editToken: "secret-once" };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(response), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(createDesign(design)).resolves.toEqual(response);
    const [path, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.stringify(design);
    const headers = new Headers(init?.headers);
    expect(path).toBe("/api/designs");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(body);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-amz-content-sha256")).toBe(await hash(body));
  });

  it("sends edit-token and optimistic-version headers for updates", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...publicDesign(), version: 2 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await updateDesign("share_123", freshDesign(), "edit-secret", 1);
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe("PUT");
    expect(headers.get("x-edit-token")).toBe("edit-secret");
    expect(headers.get("if-match")).toBe('"1"');
    expect(headers.get("x-amz-content-sha256")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashes an empty DELETE request and returns on 204", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    await expect(deleteDesign("share_123", "edit-secret", 4)).resolves.toBeUndefined();
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe("DELETE");
    expect(headers.get("x-amz-content-sha256")).toBe(await hash(""));
    expect(headers.get("if-match")).toBe('"4"');
  });

  it("keeps edit tokens separate from the local design index", () => {
    const design = publicDesign();
    rememberCloudDesign(design, "never-in-a-share-url");

    expect(getEditToken(design.id)).toBe("never-in-a-share-url");
    expect(listRememberedDesigns()).toEqual([{ id: design.id, name: design.design.name, updatedAt: design.updatedAt }]);
    expect(JSON.stringify(listRememberedDesigns())).not.toContain("never-in-a-share-url");

    forgetCloudDesign(design.id);
    expect(getEditToken(design.id)).toBeNull();
    expect(listRememberedDesigns()).toEqual([]);
  });
});
