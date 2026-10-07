import { describe, expect, it } from "vitest";
import { canvasSize, finalLength, guideLines, authorSegments, guidesSvg, inheritedRect, jointsFor, outgoingRect, ownRect } from "@/lib/images/geometry";

describe("geometry", () => {
  it("dimensions selon le sens", () => {
    expect(canvasSize("down")).toEqual({ width: 1600, height: 1600 });
    expect(canvasSize("right")).toEqual({ width: 1600, height: 1600 });
  });
  it("bandes sens down", () => {
    expect(outgoingRect("down")).toEqual({ left: 0, top: 1440, width: 1600, height: 160 });
    expect(inheritedRect("down")).toEqual({ left: 0, top: 0, width: 1600, height: 160 });
    expect(ownRect("down")).toEqual({ left: 0, top: 160, width: 1600, height: 1440 });
  });
  it("bandes sens right", () => {
    expect(outgoingRect("right")).toEqual({ left: 1440, top: 0, width: 160, height: 1600 });
    expect(inheritedRect("right")).toEqual({ left: 0, top: 0, width: 160, height: 1600 });
    expect(ownRect("right")).toEqual({ left: 160, top: 0, width: 1440, height: 1600 });
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
  it("segments d'auteurs : zones dessinées entre les jointures", () => {
    expect(authorSegments(1)).toEqual([{ rank: 1, start: 0, end: 1600 }]);
    expect(authorSegments(2)).toEqual([{ rank: 1, start: 0, end: 1440 }, { rank: 2, start: 1600, end: 3040 }]);
    const s3 = authorSegments(3);
    expect(s3).toEqual([
      { rank: 1, start: 0, end: 1440 },
      { rank: 2, start: 1600, end: 2880 },
      { rank: 3, start: 3040, end: 4480 },
    ]);
    const joints = jointsFor(3);
    expect(s3[0].end).toBe(joints[0].start);
    expect(s3[1].start).toBe(joints[0].end);
    expect(s3[2].end).toBe(finalLength(3));
  });
  it("SVG de guides en pointillés", () => {
    const svg = guidesSvg("down", 1600, 1600, [160]);
    expect(svg).toContain("<svg");
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain('y1="160"');
  });
});
