import { describe, it, expect } from "vitest";
import {
  readNote,
  writeNote,
  readRest,
  writeRest,
  readChord,
  writeChord,
  readLength,
  writeLength,
  readOctaveMarks,
  writePitch,
  readInfoLine,
  writeInfoLine,
  readInlineField,
  writeInlineField
} from "../src/parser/element.js";

describe("length", () => {
  it("reads plain numerator", () => {
    expect(readLength("A3", 1)).toEqual({ num: 3, den: 1, end: 2 });
  });
  it("reads /2 shorthand", () => {
    expect(readLength("A/", 1)).toEqual({ num: 1, den: 2, end: 2 });
  });
  it("reads // chain", () => {
    expect(readLength("A//", 1)).toEqual({ num: 1, den: 4, end: 3 });
  });
  it("reads 3/2", () => {
    expect(readLength("A3/2", 1)).toEqual({ num: 3, den: 2, end: 4 });
  });
  it("writes minimal forms", () => {
    expect(writeLength(1, 1)).toBe("");
    expect(writeLength(3, 1)).toBe("3");
    expect(writeLength(1, 2)).toBe("/2");
    expect(writeLength(1, 4)).toBe("/4");
    expect(writeLength(3, 2)).toBe("3/2");
  });
});

describe("pitch / octave", () => {
  it("lower-case = octave 1", () => {
    expect(readOctaveMarks("c", 1, true)).toEqual({ octave: 1, end: 1 });
  });
  it("apostrophe raises", () => {
    expect(readOctaveMarks("c''", 1, true)).toEqual({ octave: 3, end: 3 });
  });
  it("comma lowers uppercase", () => {
    expect(readOctaveMarks("C,,", 1, false)).toEqual({ octave: -2, end: 3 });
  });
  it("round-trips via writePitch", () => {
    expect(writePitch("C", 0)).toBe("C");
    expect(writePitch("C", 1)).toBe("c");
    expect(writePitch("C", 3)).toBe("c''");
    expect(writePitch("C", -2)).toBe("C,,");
  });
});

describe("note round-trip", () => {
  const samples = ["C", "c", "^F", "_B,", "=c'", "^^F,,", "G3/2", "_a/4"];
  for (const s of samples) {
    it(`round-trips ${s}`, () => {
      const parsed = readNote(s, 0)!;
      expect(parsed).toBeTruthy();
      expect(writeNote(parsed)).toBe(s);
    });
  }
});

describe("rest round-trip", () => {
  for (const s of ["z", "z2", "z/2", "z3/2", "x", "Z", "Z4"]) {
    it(`round-trips ${s}`, () => {
      const p = readRest(s, 0)!;
      expect(p).toBeTruthy();
      expect(writeRest(p)).toBe(s);
    });
  }
});

describe("chord round-trip", () => {
  for (const s of ["[CEG]", "[^FAc]", "[CEG]2", "[_B,dG]/2"]) {
    it(`round-trips ${s}`, () => {
      const p = readChord(s, 0)!;
      expect(p).toBeTruthy();
      expect(writeChord(p)).toBe(s);
    });
  }
});

describe("info fields", () => {
  it("reads and writes header line", () => {
    const f = readInfoLine("K: Gmaj")!;
    expect(f).toEqual({ name: "K", value: "Gmaj" });
    expect(writeInfoLine(f)).toBe("K:Gmaj");
  });
  it("reads and writes inline field", () => {
    const f = readInlineField("[M:6/8]")!;
    expect(f).toEqual({ name: "M", value: "6/8" });
    expect(writeInlineField(f)).toBe("[M:6/8]");
  });
});

import { readPrefix, writePrefix } from "../src/parser/element.js";

describe("prefix parsing", () => {
  it("returns empty prefix when none present", () => {
    const p = readPrefix("CDE", 0);
    expect(p.end).toBe(0);
    expect(p.annotations).toEqual([]);
    expect(p.decorations).toEqual([]);
    expect(p.grace).toBeNull();
  });
  it("reads a chord symbol", () => {
    const p = readPrefix('"G"C', 0);
    expect(p.end).toBe(3);
    expect(p.annotations).toHaveLength(1);
    expect(p.annotations[0]!.placement).toBe("");
    expect(p.annotations[0]!.text).toBe("G");
  });
  it("reads a placement-prefixed annotation", () => {
    const p = readPrefix('"^hey"C', 0);
    expect(p.annotations[0]!.placement).toBe("^");
    expect(p.annotations[0]!.text).toBe("hey");
  });
  it("reads a bang decoration", () => {
    const p = readPrefix("!trill!g2", 0);
    expect(p.decorations).toEqual(["trill"]);
    expect(p.end).toBe(7);
  });
  it("reads short-char decoration before a note", () => {
    const p = readPrefix(".C", 0);
    expect(p.decorations).toEqual(["staccato"]);
    expect(p.end).toBe(1);
  });
  it("reads grace notes", () => {
    const p = readPrefix("{cd}A", 0);
    expect(p.grace).toBe("cd");
    expect(p.end).toBe(4);
  });
  it("reads chord symbol + decoration + grace", () => {
    const p = readPrefix('"Gm"!trill!{cd}A', 0);
    expect(p.annotations[0]!.text).toBe("Gm");
    expect(p.decorations).toEqual(["trill"]);
    expect(p.grace).toBe("cd");
  });
  it("does not consume T: info-field prefix", () => {
    // "T" is a short-char decoration only when followed by a pitch — not
    // when it's the start of a header field like "T:Title".
    const p = readPrefix("T:Title", 0);
    expect(p.decorations).toEqual([]);
    expect(p.end).toBe(0);
  });
  it("writePrefix round-trips chord/deco/grace", () => {
    const p = readPrefix('"Gm"!trill!{cd}', 0);
    expect(writePrefix(p)).toBe('"Gm"!trill!{cd}');
  });
});
