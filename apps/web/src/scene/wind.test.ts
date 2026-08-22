import { describe, expect, it } from "vitest";
import {
  createWindField,
  WIND_REFERENCE_HEIGHT_M,
  WIND_ROUGHNESS_LENGTH_M,
  WIND_SIGMA_MPS,
} from "./wind";

const STEP = 1 / 240;

describe("wind field", () => {
  it("is deterministic for a given seed and varies across seeds", () => {
    const a = createWindField(42);
    const b = createWindField(42);
    const c = createWindField(43);
    for (let index = 0; index < 500; index += 1) {
      a.step(STEP);
      b.step(STEP);
      c.step(STEP);
    }
    expect(a.velocityAt(3)).toEqual(b.velocityAt(3));
    expect(a.velocityAt(3)).not.toEqual(c.velocityAt(3));
  });

  it("is horizontal only and zero at the surface", () => {
    const wind = createWindField(7);
    for (let index = 0; index < 1000; index += 1) wind.step(STEP);
    expect(wind.velocityAt(0)).toEqual([0, 0, 0]);
    expect(wind.velocityAt(WIND_ROUGHNESS_LENGTH_M)).toEqual([0, 0, 0]);
    expect(wind.velocityAt(5)[1]).toBe(0);
  });

  it("follows the log-law profile: stronger higher up", () => {
    const wind = createWindField(7);
    for (let index = 0; index < 2000; index += 1) wind.step(STEP);
    const low = wind.velocityAt(0.5);
    const reference = wind.velocityAt(WIND_REFERENCE_HEIGHT_M);
    const high = wind.velocityAt(30);
    const magnitude = (v: readonly number[]) => Math.hypot(v[0]!, v[2]!);
    expect(magnitude(low)).toBeLessThan(magnitude(reference));
    expect(magnitude(reference)).toBeLessThan(magnitude(high));
  });

  it("stays a light breeze: bounded intensity with near-zero mean", () => {
    const wind = createWindField(1234);
    let sumX = 0;
    let sumSquaresX = 0;
    const samples = 60 * 240;
    for (let index = 0; index < samples; index += 1) {
      wind.step(STEP);
      const [x] = wind.velocityAt(WIND_REFERENCE_HEIGHT_M);
      sumX += x;
      sumSquaresX += x * x;
      expect(Math.abs(x)).toBeLessThan(WIND_SIGMA_MPS * 6);
    }
    const mean = sumX / samples;
    const std = Math.sqrt(sumSquaresX / samples - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.15);
    expect(std).toBeGreaterThan(WIND_SIGMA_MPS * 0.5);
    expect(std).toBeLessThan(WIND_SIGMA_MPS * 1.5);
  });
});
