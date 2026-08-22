import { describe, expect, it } from "vitest";
import { calculatePneumaticContactForceN, pneumaticShellForceN } from "./balloonContact";

const RADIUS = 0.15;
const SHELL = RADIUS * 0.4;
const DT = 1 / 240;

describe("pneumatic shell force", () => {
  it("is zero without penetration and grows monotonically with it", () => {
    expect(pneumaticShellForceN(0, SHELL, RADIUS)).toBe(0);
    expect(pneumaticShellForceN(-0.01, SHELL, RADIUS)).toBe(0);
    let previous = 0;
    for (const depth of [0.005, 0.015, 0.03, 0.05]) {
      const force = pneumaticShellForceN(depth, SHELL, RADIUS);
      expect(force).toBeGreaterThan(previous);
      previous = force;
    }
  });

  it("supports a realistic payload within the shell stroke", () => {
    // A 1.6 kg cardboard panel (15.7 N) should find equilibrium before the
    // rigid core (full shell depth) takes over.
    const atFullStroke = pneumaticShellForceN(SHELL, SHELL, RADIUS);
    expect(atFullStroke).toBeGreaterThan(1.6 * 9.81);
  });
});

describe("implicit pneumatic contact step", () => {
  it("only pushes, never pulls", () => {
    const force = calculatePneumaticContactForceN({
      penetrationM: 0.02,
      shellDepthM: SHELL,
      balloonRadiusM: RADIUS,
      approachSpeedMps: -6,
      reducedMassKg: 0.1,
      dtSeconds: DT,
    });
    expect(force).toBeGreaterThanOrEqual(0);
  });

  it("cushions an impact without trampolining: rebound never exceeds impact speed", () => {
    // Drop a 0.5 kg body at 4 m/s onto the shell and integrate the 1-D
    // contact explicitly using the implicit force law each step.
    const mass = 0.5;
    let penetration = 0;
    let velocity = 4;
    let maxRebound = 0;
    for (let step = 0; step < 2000; step += 1) {
      const force = calculatePneumaticContactForceN({
        penetrationM: penetration,
        shellDepthM: SHELL,
        balloonRadiusM: RADIUS,
        approachSpeedMps: velocity,
        reducedMassKg: mass,
        dtSeconds: DT,
      });
      velocity -= (force / mass) * DT;
      penetration = Math.max(0, penetration + velocity * DT);
      expect(Number.isFinite(velocity)).toBe(true);
      if (velocity < 0) maxRebound = Math.max(maxRebound, -velocity);
      if (penetration === 0 && velocity <= 0) break;
    }
    expect(maxRebound).toBeLessThanOrEqual(4);
    expect(maxRebound).toBeGreaterThan(0);
  });

  it("stays finite and non-oscillating even for extreme stiffness inputs", () => {
    // Tiny reduced mass + deep penetration is the classic explicit-spring
    // explosion; the implicit solve must stay bounded.
    const force = calculatePneumaticContactForceN({
      penetrationM: SHELL,
      shellDepthM: SHELL,
      balloonRadiusM: RADIUS,
      approachSpeedMps: 10,
      reducedMassKg: 0.001,
      dtSeconds: DT,
    });
    expect(Number.isFinite(force)).toBe(true);
    // The impulse delivered in one step cannot reverse the approach into a
    // faster escape than the approach itself.
    const deltaV = (force / 0.001) * DT;
    expect(deltaV).toBeLessThanOrEqual(10 * 2);
  });
});
