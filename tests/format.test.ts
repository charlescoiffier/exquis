import { describe, expect, it } from "vitest";
import { formatDuration } from "@/lib/format";

describe("formatDuration", () => {
  it.each([[30, "30 s"], [90, "1 min 30 s"], [3600, "1 h"], [5400, "1 h 30 min"], [86400, "1 j"], [604800, "7 j"]])("%i s -> %s", (s, out) => {
    expect(formatDuration(s)).toBe(out);
  });
});
