import type { ApiErrorBody, CreateDesignResponse, DesignV1, PublicDesign } from "@eggdrop/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { InMemoryRateLimiter } from "./rate-limit.js";
import { InMemoryDesignRepository } from "./repository.js";

const DESIGN_ID = "10000000-0000-4000-8000-000000000001";
const EDIT_TOKEN = "A".repeat(43);

function design(overrides: Partial<DesignV1> = {}): DesignV1 {
  return {
    schemaVersion: 1,
    physicsVersion: 1,
    name: "Strawberry Flyer",
    mode: "sandbox",
    missionId: null,
    heightFt: 20,
    eggTransform: {
      position: [0, 0.5, 0],
      rotation: [0, 0, 0, 1],
      dimensions: [0.043, 0.057, 0.043],
    },
    parts: [
      {
        id: "straw-1",
        materialId: "straw",
        transform: {
          position: [0, 0.5, 0],
          rotation: [0, 0, 0, 1],
          dimensions: [0.012, 0.3, 0.012],
        },
      },
    ],
    joints: [],
    ...overrides,
  };
}

function testApp(options: { now?: () => number } = {}) {
  const repository = new InMemoryDesignRepository();
  const app = createApp({
    repository,
    rateLimiter: new InMemoryRateLimiter(),
    now: options.now ?? (() => Date.parse("2026-08-21T12:00:00.000Z")),
    idFactory: () => DESIGN_ID,
    tokenFactory: () => EDIT_TOKEN,
    logger: { error: () => undefined },
  });
  return { app, repository };
}

async function createDesign(app: ReturnType<typeof createApp>, value = design()) {
  return app.request("/api/designs", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.1" },
    body: JSON.stringify(value),
  });
}

describe("design API", () => {
  it("creates a design and returns the raw edit token only once", async () => {
    const { app, repository } = testApp();
    const createdResponse = await createDesign(app);

    expect(createdResponse.status).toBe(201);
    expect(createdResponse.headers.get("etag")).toBe('"1"');
    expect(createdResponse.headers.get("location")).toBe(`/api/designs/${DESIGN_ID}`);
    expect(createdResponse.headers.get("cache-control")).toBe("no-store");

    const created = (await createdResponse.json()) as CreateDesignResponse;
    expect(created).toMatchObject({
      id: DESIGN_ID,
      editToken: EDIT_TOKEN,
      version: 1,
      design: { name: "Strawberry Flyer" },
    });

    const stored = await repository.get(DESIGN_ID);
    expect(stored?.editTokenHash).not.toBe(EDIT_TOKEN);
    expect(stored?.editTokenHash).toHaveLength(43);

    const fetchedResponse = await app.request(`/api/designs/${DESIGN_ID}`, {
      headers: { "x-forwarded-for": "192.0.2.1" },
    });
    expect(fetchedResponse.status).toBe(200);
    expect(fetchedResponse.headers.get("cache-control")).toBe("no-store");
    const fetched = (await fetchedResponse.json()) as PublicDesign;
    expect(fetched).toMatchObject({ id: DESIGN_ID, version: 1 });
    expect(fetched).not.toHaveProperty("editToken");
    expect(fetched).not.toHaveProperty("editTokenHash");
  });

  it("supports conditional GETs without exposing private fields", async () => {
    const { app } = testApp();
    await createDesign(app);

    const response = await app.request(`/api/designs/${DESIGN_ID}`, {
      headers: {
        "if-none-match": 'W/"1"',
        "x-forwarded-for": "192.0.2.2",
      },
    });

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"1"');
    expect(await response.text()).toBe("");
  });

  it("requires both the edit token and current If-Match version", async () => {
    let currentTime = Date.parse("2026-08-21T12:00:00.000Z");
    const { app } = testApp({ now: () => currentTime });
    await createDesign(app);

    const missingToken = await app.request(`/api/designs/${DESIGN_ID}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"1"' },
      body: JSON.stringify(design({ name: "Revision" })),
    });
    expect(missingToken.status).toBe(401);

    const missingVersion = await app.request(`/api/designs/${DESIGN_ID}`, {
      method: "PUT",
      headers: {
        // Lambda Function URL OAC supplies this origin Authorization value.
        authorization: "AWS4-HMAC-SHA256 Credential=cloudfront/example",
        "x-edit-token": EDIT_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify(design({ name: "Revision" })),
    });
    expect(missingVersion.status).toBe(428);

    currentTime += 1_000;
    const updatedResponse = await app.request(`/api/designs/${DESIGN_ID}`, {
      method: "PUT",
      headers: {
        "x-edit-token": EDIT_TOKEN,
        "content-type": "application/json",
        "if-match": '"1"',
      },
      body: JSON.stringify(design({ name: "Revision" })),
    });
    expect(updatedResponse.status).toBe(200);
    expect(updatedResponse.headers.get("etag")).toBe('"2"');
    const updated = (await updatedResponse.json()) as PublicDesign;
    expect(updated).toMatchObject({ version: 2, design: { name: "Revision" } });

    const staleUpdate = await app.request(`/api/designs/${DESIGN_ID}`, {
      method: "PUT",
      headers: {
        "x-edit-token": EDIT_TOKEN,
        "content-type": "application/json",
        "if-match": '"1"',
      },
      body: JSON.stringify(design({ name: "Stale revision" })),
    });
    expect(staleUpdate.status).toBe(409);
    const staleError = (await staleUpdate.json()) as ApiErrorBody;
    expect(staleError.error).toMatchObject({
      code: "VERSION_CONFLICT",
      details: { currentVersion: 2 },
    });
  });

  it("rejects an incorrect token and conditionally deletes a design", async () => {
    const { app } = testApp();
    await createDesign(app);

    const wrongToken = await app.request(`/api/designs/${DESIGN_ID}`, {
      method: "DELETE",
      headers: {
        "x-edit-token": "B".repeat(43),
        "if-match": '"1"',
      },
    });
    expect(wrongToken.status).toBe(403);

    const deleted = await app.request(`/api/designs/${DESIGN_ID}`, {
      method: "DELETE",
      headers: {
        "x-edit-token": EDIT_TOKEN,
        "if-match": '"1"',
      },
    });
    expect(deleted.status).toBe(204);

    const fetched = await app.request(`/api/designs/${DESIGN_ID}`);
    expect(fetched.status).toBe(404);
  });

  it("returns structured schema validation errors", async () => {
    const { app } = testApp();
    const response = await createDesign(app, design({ name: "", heightFt: 51 }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "name" }),
        expect.objectContaining({ path: "heightFt" }),
      ]),
    );
  });

  it("rejects design bodies larger than 250 KiB before parsing", async () => {
    const { app } = testApp();
    const response = await app.request("/api/designs", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.30" },
      body: "x".repeat(250 * 1024 + 1),
    });
    expect(response.status).toBe(413);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("enforces separate exact read and write limits per minute", async () => {
    const writeApp = testApp().app;
    for (let index = 0; index < 30; index += 1) {
      const response = await writeApp.request("/api/designs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.10" },
        body: "{}",
      });
      expect(response.status).toBe(400);
    }
    const writeLimited = await writeApp.request("/api/designs", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.10" },
      body: "{}",
    });
    expect(writeLimited.status).toBe(429);
    expect(writeLimited.headers.get("ratelimit-limit")).toBe("30");
    expect(writeLimited.headers.get("retry-after")).toBe("60");

    const readApp = testApp().app;
    const unknownId = "20000000-0000-4000-8000-000000000002";
    for (let index = 0; index < 120; index += 1) {
      const response = await readApp.request(`/api/designs/${unknownId}`, {
        headers: { "x-forwarded-for": "192.0.2.20" },
      });
      expect(response.status).toBe(404);
    }
    const readLimited = await readApp.request(`/api/designs/${unknownId}`, {
      headers: { "x-forwarded-for": "192.0.2.20" },
    });
    expect(readLimited.status).toBe(429);
    expect(readLimited.headers.get("ratelimit-limit")).toBe("120");
  });
});
