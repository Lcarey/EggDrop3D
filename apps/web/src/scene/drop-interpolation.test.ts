import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import {
  calculateDropInterpolationAlpha,
  createDropRenderPose,
  interpolateDropRenderPose,
  type DropRenderPose,
} from "./dropInterpolation";

const pose = (
  position: readonly [number, number, number],
  rotation: readonly [number, number, number, number] = [0, 0, 0, 1],
) => createDropRenderPose(position, rotation);

const interpolate = (previous: DropRenderPose, current: DropRenderPose, alpha: number) =>
  interpolateDropRenderPose(pose([0, 0, 0]), previous, current, alpha);

const positionOf = (value: DropRenderPose) => value.position.toArray();

describe("drop render interpolation", () => {
  it("interpolates position between the two completed physics poses", () => {
    const previous = pose([1, 5, -3]);
    const current = pose([5, -1, 9]);

    expect(positionOf(interpolate(previous, current, 0))).toEqual([1, 5, -3]);
    expect(positionOf(interpolate(previous, current, .25))).toEqual([2, 3.5, 0]);
    expect(positionOf(interpolate(previous, current, .5))).toEqual([3, 2, 3]);
    expect(positionOf(interpolate(previous, current, 1))).toEqual([5, -1, 9]);
  });

  it("clamps render alpha so timing noise cannot overshoot a physics pose", () => {
    const previous = pose([0, 2, 0]);
    const current = pose([0, 1, 0]);

    expect(positionOf(interpolate(previous, current, -.001))).toEqual([0, 2, 0]);
    expect(positionOf(interpolate(previous, current, 1.001))).toEqual([0, 1, 0]);
    expect(calculateDropInterpolationAlpha(-.001, 1 / 60)).toBe(0);
    expect(calculateDropInterpolationAlpha(2 / 60, 1 / 60)).toBe(1);
  });

  it("slerps the shortest quaternion path and keeps the result normalized", () => {
    const previous = pose([0, 0, 0], [0, 0, 0, 1]);
    // The negated quaternion represents the same +90-degree Y rotation. A
    // component-wise interpolation would take the long way around instead.
    const halfAngle = Math.PI / 4;
    const current = pose([0, 0, 0], [0, -Math.sin(halfAngle), 0, -Math.cos(halfAngle)]);
    const halfway = interpolate(previous, current, .5).rotation;
    const expected = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4);

    expect(halfway.length()).toBeCloseTo(1, 12);
    expect(halfway.angleTo(expected)).toBeCloseTo(0, 10);
  });

  it("turns 12 Hz slow-motion physics samples into smooth 60 Hz render poses", () => {
    const fixedStepSeconds = 1 / 60;
    const renderStepSeconds = 1 / 60;
    const playbackRate = .2;
    let accumulator = 0;
    let physicsPositionY = 0;
    let previous = pose([0, physicsPositionY, 0]);
    let current = previous;
    const renderedY: number[] = [];

    for (let frame = 0; frame < 60; frame += 1) {
      accumulator += renderStepSeconds * playbackRate;
      while (accumulator + 1e-12 >= fixedStepSeconds) {
        previous = current;
        physicsPositionY -= 1;
        current = pose([0, physicsPositionY, 0]);
        accumulator = Math.max(0, accumulator - fixedStepSeconds);
      }
      const alpha = calculateDropInterpolationAlpha(accumulator, fixedStepSeconds);
      renderedY.push(interpolate(previous, current, alpha).position.y);
    }

    // The first completed fixed step arrives on frame five. From there, the
    // render pose advances one fifth of the distance every display frame; it
    // must not hold for four frames and jump on the fifth.
    const movingFrames = renderedY.slice(4);
    const perFrameMotion = movingFrames.slice(1).map((value, index) => value - movingFrames[index]!);
    expect(perFrameMotion).toHaveLength(55);
    for (const delta of perFrameMotion) expect(delta).toBeCloseTo(-.2, 10);
    expect(new Set(movingFrames.map((value) => value.toFixed(8))).size).toBe(movingFrames.length);
  });
});
