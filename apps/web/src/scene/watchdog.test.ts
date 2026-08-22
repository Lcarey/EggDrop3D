import { describe, expect, it } from "vitest";
import { classifyBodyMotion, maxPlausibleSpeedMps, WATCHDOG_MAX_DISTANCE_M } from "./watchdog";

describe("watchdog speed bound", () => {
  it("keeps a generous floor for low drops and scales with height and gravity", () => {
    expect(maxPlausibleSpeedMps(5, 9.80665)).toBe(25);
    const earth100 = maxPlausibleSpeedMps(100, 9.80665);
    expect(earth100).toBeGreaterThan(30);
    expect(maxPlausibleSpeedMps(100, 24.79)).toBeGreaterThan(earth100);
  });
});

describe("body motion classification", () => {
  const bound = maxPlausibleSpeedMps(30, 9.80665);

  it("passes ordinary falling bodies", () => {
    expect(classifyBodyMotion([0, 5, 0], [0.3, -8, 0.1], bound)).toBe("ok");
  });

  it("flags solver-divergence speeds and far-flung bodies as runaway", () => {
    expect(classifyBodyMotion([0, 5, 0], [0, -5e12, 0], bound)).toBe("runaway");
    expect(classifyBodyMotion([WATCHDOG_MAX_DISTANCE_M * 2, 5, 0], [0, -1, 0], bound)).toBe("runaway");
  });

  it("flags NaN poses as invalid", () => {
    expect(classifyBodyMotion([0, Number.NaN, 0], [0, -1, 0], bound)).toBe("invalid");
    expect(classifyBodyMotion([0, 1, 0], [Number.NaN, 0, 0], bound)).toBe("invalid");
  });
});
