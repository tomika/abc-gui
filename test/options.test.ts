import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyDefaults, isHeaderOptionKey, resolveDefaults, synthOptions, visualOptions,
  type HeaderOptionDefaults
} from "../src/parser/options.js";
import { parseOptionsJson, sameOptions } from "../src/parser/source.js";

describe("document option boundaries", () => {
  it("allows supported audio data and excludes callbacks, URLs and parser controls", () => {
    expect(synthOptions({
      swing: 65, qpm: 60, program: 0, chordsOff: false, bassvol: 0, voicesOff: [0, 2], pan: [-1, 1],
      soundFontUrl: "https://example.invalid/samples/", sequenceCallback: 1, onEnded: true,
      callbackContext: {}, header_only: true, selectTypes: false, scale: 1.2,
      afterParsing: () => { throw new Error("must not run"); }
    })).toEqual({ swing: 65, qpm: 60, program: 0, chordsOff: false, bassvol: 0, voicesOff: [0, 2], pan: [-1, 1] });
  });

  it("rejects invalid audio types and ranges", () => {
    expect(synthOptions({
      qpm: 0, defaultQpm: -20, swing: {}, program: 128, chordsOff: 1, drum: [],
      voicesOff: ["0"], pan: [2], bassvol: -1, midiTranspose: 1.5, fadeLength: NaN,
      soundFontVolumeMultiplier: Infinity
    })).toEqual({});
  });

  it("limits engraving data without passing parser switches or executable options", () => {
    expect(visualOptions({
      scale: 1.2, germanAlphabet: true, jazzchords: true, visualTranspose: 2,
      format: { titlefont: "Arial 18", partsbox: true, header_only: true, unknown: {} },
      wrap: { preferredMeasuresPerLine: 4, minSpacing: 1.8, onEnded: true },
      header_only: true, stop_on_warning: true, selectTypes: false, add_classes: false,
      clickListener: 1, afterParsing: 1, soundFontUrl: "https://example.invalid"
    })).toEqual({
      scale: 1.2, germanAlphabet: true, jazzchords: true, visualTranspose: 2,
      format: { titlefont: "Arial 18", partsbox: true },
      wrap: { preferredMeasuresPerLine: 4, minSpacing: 1.8 }
    });
  });

  it.each(["[]", "null", "65", "true", '"text"'])("rejects non-object JSON in the shared parser: %s", (value) => {
    expect(() => parseOptionsJson(value)).toThrow("Expected a JSON object.");
  });

  it("compares nested objects independently of key order and preserves array order", () => {
    expect(sameOptions({ a: 1, b: { x: 2, y: [3, 4] } }, { b: { y: [3, 4], x: 2 }, a: 1 })).toBe(true);
    expect(sameOptions({ a: [3, 4] }, { a: [4, 3] })).toBe(false);
    expect(sameOptions({ a: false }, { a: 0 })).toBe(false);
  });
});

describe("host defaults for header options", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("checks defaults like header values and records which ones are fixed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolved = resolveDefaults({
      swing: { value: 60 },
      qpm: { value: 90, editable: false },
      jazzchords: { value: true, editable: true },
      format: { value: { titlefont: "Arial 18", unknown: 1 } as Record<string, unknown> },
      program: { value: 200 },
      soundFontUrl: { value: "https://example.invalid/" }
    } as HeaderOptionDefaults);
    expect(resolved.values).toEqual({ swing: 60, qpm: 90, jazzchords: true, format: { titlefont: "Arial 18" } });
    expect([...resolved.locked]).toEqual(["qpm"]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map(([message]) => message).join(" ")).toMatch(/"program".*"soundFontUrl"/);
  });

  it("lets the document override editable defaults but never fixed ones", () => {
    const defaults = resolveDefaults({
      swing: { value: 60 }, qpm: { value: 90, editable: false }, scale: { value: 1.5 }
    });
    expect(applyDefaults({ swing: 70, qpm: 200, staffwidth: 500 }, defaults))
      .toEqual({ swing: 70, qpm: 90, scale: 1.5, staffwidth: 500 });
    expect(applyDefaults({}, defaults)).toEqual({ swing: 60, qpm: 90, scale: 1.5 });
  });

  it("keeps the default when the document value is invalid or unsupported", () => {
    const defaults = resolveDefaults({ swing: { value: 60 }, program: { value: 24 } });
    expect(applyDefaults({ swing: "fast", program: 300, onEnded: true }, defaults))
      .toEqual({ swing: 60, program: 24 });
  });

  it("recognises only keys the options header supports", () => {
    expect(isHeaderOptionKey("swing")).toBe(true);
    expect(isHeaderOptionKey("format")).toBe(true);
    expect(isHeaderOptionKey("responsive")).toBe(false);
    expect(isHeaderOptionKey("clickListener")).toBe(false);
  });
});
