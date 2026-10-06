import { describe, expect, it } from "vitest";
import { canvasSize, finalLength, guideLines, guidesSvg, inheritedRect, jointsFor, outgoingRect, ownRect } from "@/lib/images/geometry";

describe("geometry", () => {
  it("dimensions selon le sens", () => {
    expect(canvasSize("down")).toEqual({ width: 1200, height: 1600 });
    expect(canvasSize("right")).toEqual({ width: 1600, height: 1200 });
  });
  it("bandes sens down", () => {
    expect(outgoingRect("down")).toEqual({ left: 0, top: 1440, width: 1200, height: 160 });
    expect(inheritedRect("down")).toEqual({ left: 0, top: 0, width: 1200, height: 160 });
    expect(ownRect("down")).toEqual({ left: 0, top: 160, width: 1200, height: 1440 });
  });
  it("bandes sens right", () => {
    expect(outgoingRect("right")).toEqual({ left: 1440, top: 0, width: 160, height: 1200 });
    expect(inheritedRect("right")).toEqual({ left: 0, top: 0, width: 160, height: 1200 });
    expect(ownRect("right")).toEqual({ left: 160, top: 0, width: 1440, height: 1200 });
  });
  it("lignes de guide selon le rang", () => {
    expect(guideLines("down", 1, 3)).toEqual([1440]);
    expect(guideLines("down", 2, 3)).toEqual([160, 1440]);
    expect(guideLines("down", 3, 3)).toEqual([160]);
  });
  it("longueur finale et jointures", () => {
    expect(finalLength(2)).toBe(3040);
    expect(jointsFor(3)).toEqual([{ start: 1440, end: 1600 }, { start: 2880, end: 3040 }]);
  });
  it("SVG de guides en pointillés", () => {
    const svg = guidesSvg("down", 1200, 1600, [160]);
    expect(svg).toContain("<svg");
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain('y1="160"');
  });
});
