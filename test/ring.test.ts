import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript shared with the browser pages
import { depth, digits, frontIndex, wheelPose } from "../web/ring.js";

describe("artwork ring", () => {
  it("shades cards by how far round the ring they are", () => {
    expect(depth(0)).toBe(0);
    expect(depth(180)).toBe(1);
    expect(depth(90)).toBeCloseTo(0.5);
    expect(depth(-90)).toBeCloseTo(0.5);
    expect(depth(720)).toBeCloseTo(0);
  });
  it("knows which card faces the viewer", () => {
    expect(frontIndex(0, 10)).toBe(0);
    expect(frontIndex(-36, 10)).toBe(1);
    expect(frontIndex(-350, 10)).toBe(0);
    expect(frontIndex(36, 10)).toBe(9);
    expect(frontIndex(-17, 10)).toBe(0);
    expect(frontIndex(-19, 10)).toBe(1);
  });
  it("rolls the counter one digit at a time", () => {
    expect(digits(1)).toEqual([0, 1]);
    expect(digits(10)).toEqual([1, 0]);
    expect(digits(7, 3)).toEqual([0, 0, 7]);
  });
});

describe("option wheel", () => {
  it("keeps the selected option upright, sharp and fully visible", () => {
    expect(wheelPose(0)).toEqual({ x: -0, y: 0, rot: 0, opacity: 1, blur: 0 });
  });
  it("lets the others fall away along an arc", () => {
    const one = wheelPose(1), two = wheelPose(2), back = wheelPose(-1);
    expect(one.y).toBeCloseTo(66.9, 0);
    expect(one.x).toBeCloseTo(-3.5, 0);
    expect(one.rot).toBe(6);
    expect(one.opacity).toBe(0.75);
    expect(one.blur).toBe(2);
    expect(two.y).toBeGreaterThan(one.y * 1.9);
    expect(back.y).toBeCloseTo(-one.y);
    expect(back.rot).toBe(-6);
    expect(wheelPose(5).opacity).toBe(0.05);
  });
});
