import { describe, expect, it } from "vitest";
import { csvCell, toCsv, unguardCell } from "./csv";

describe("CSV", () => {
  it("quotes only what needs it", () => {
    expect(csvCell("Acadian")).toBe("Acadian");
    expect(csvCell('Fridge, "new"')).toBe('"Fridge, ""new"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(-3)).toBe("-3");
  });

  it("never lets a typed note run as a formula", () => {
    expect(csvCell('=HYPERLINK("http://evil.example","click")')).toBe(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    expect(csvCell("- waiting on the fridge")).toBe("'- waiting on the fridge");
    expect(unguardCell("'- waiting on the fridge")).toBe("- waiting on the fridge");
    expect(unguardCell("'quoted on purpose")).toBe("'quoted on purpose");
  });

  it("starts with the marker Excel needs, one row per line", () => {
    expect(toCsv([["Unit", "Days"], ["203", 12]])).toBe("﻿Unit,Days\r\n203,12\r\n");
  });
});
