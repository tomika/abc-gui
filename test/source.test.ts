import { describe, expect, it } from "vitest";
import { AbcDocument } from "../src/model/document.js";
import { parseSource } from "../src/parser/source.js";

const music = 'Q:1/4=120\nK:F\nM:4/4\n"F"z2AA BABd|"C"cGEc "Bb"BFDB|"F/A"AFCA "Gm"GABA|';

describe("abcjs options header", () => {
  it.each(["{g}A", "{^g}A", "{ g}A", "[CEG]", "[K:G]G"])("keeps ABC starting with %s before a separator, also after Reset/Apply", (fragment) => {
    const value = fragment + "\n---\nK:C\nCDEF|";
    const doc = new AbcDocument(value);
    expect(doc.source()).toEqual({ abc: value, options: {} });
    expect(doc.elementAtOffset(fragment.length - 1)).not.toBeNull();
    doc.setSourceOptions({});
    expect(doc.value).toBe(value);
    expect(doc.canUndo()).toBe(false);
  });

  it("preserves hand formatting when reordered nested options are unchanged", () => {
    const value = '{ "swing": 65, "format": {"titlefont": "Arial 18", "partsbox": true}, "pan": [-1, 1] }\n---\n' + music;
    const doc = new AbcDocument(value);
    doc.setSourceOptions({ pan: [-1, 1], format: { partsbox: true, titlefont: "Arial 18" }, swing: 65 });
    expect(doc.value).toBe(value);
    expect(doc.canUndo()).toBe(false);
  });

  it("does not allow parser-control JSON options to hide elements", () => {
    const value = '{"header_only":true,"stop_on_warning":true,"afterParsing":1}\n---\nK:C\nCDEF @ GABc|';
    const doc = new AbcDocument(value);
    expect(doc.elementAtOffset(value.indexOf("GABc"))).not.toBeNull();
    expect(doc.source().options.header_only).toBe(true);
  });

  it.each(["\n", "\r\n"])("creates, updates and removes a settings header with %j", (newline) => {
    const body = music.replace(/\n/g, newline);
    const doc = new AbcDocument(body);
    doc.setSourceOptions({ swing: 65, chordsOff: false, format: { titlefont: "Arial 18" } });
    expect(doc.source().options).toEqual({ swing: 65, chordsOff: false, format: { titlefont: "Arial 18" } });
    expect(doc.value.slice(doc.source().bodyStart)).toBe(body);
    expect(doc.value).toContain(newline + "---" + newline);
    doc.setSourceOptions({ ...doc.source().options, swing: 60 });
    expect(doc.value.match(/---/g)).toHaveLength(1);
    expect(doc.value.slice(doc.source().bodyStart)).toBe(body);
    doc.setSourceOptions({});
    expect(doc.value).toBe(body);
    doc.undo();
    expect(doc.source().options.swing).toBe(60);
  });

  it("keeps a Unicode BOM and repairs an invalid header without altering notes", () => {
    const body = "K:C\nCDEF|";
    const doc = new AbcDocument('\uFEFF{"swing":}\n---\n' + body);
    doc.setSourceOptions({ swing: 65 });
    expect(doc.value.startsWith("\uFEFF{")).toBe(true);
    expect(doc.value.slice(doc.source().bodyStart)).toBe(body);
    doc.setSourceOptions({});
    expect(doc.value).toBe("\uFEFF" + body);
  });

  it("makes a settings submission a separate undo step from rapid note edits", () => {
    const doc = new AbcDocument("K:C\nCDEF|");
    doc.replace(4, 5, "G");
    doc.setSourceOptions({ swing: 65 });
    doc.replace(doc.value.indexOf("GDEF"), doc.value.indexOf("GDEF") + 1, "A");
    doc.undo();
    expect(doc.source().options.swing).toBe(65);
    expect(doc.value.endsWith("GDEF|")).toBe(true);
    doc.undo();
    expect(doc.value).toBe("K:C\nGDEF|");
    doc.undo();
    expect(doc.value).toBe("K:C\nCDEF|");
  });

  it("does not rewrite the source when settings are unchanged", () => {
    const value = '{ "swing": 65 }\n---\n' + music;
    const doc = new AbcDocument(value);
    doc.setSourceOptions({ swing: 65 });
    expect(doc.value).toBe(value);
    expect(doc.canUndo()).toBe(false);
  });

  it("removes an existing empty header when resetting settings", () => {
    const doc = new AbcDocument("{}\n---\n" + music);
    doc.setSourceOptions({});
    expect(doc.value).toBe(music);
  });

  it("leaves ordinary ABC unchanged, including separators in the body", () => {
    for (const value of [music, "X:1\nK:C\nCDE|\n---\nFGA|"]) {
      expect(parseSource(value)).toEqual({ abc: value, options: {} });
    }
  });

  it.each(["\n", "\r\n"])("parses the reported fragment and preserves offsets with %j", (newline) => {
    const value = ('{ "swing": 65 }\n---\n' + music).replace(/\n/g, newline);
    const doc = new AbcDocument(value);
    const source = doc.source();
    expect(source.options).toEqual({ swing: 65 });
    expect(source.headerError).toBeUndefined();
    expect(source.abc).toHaveLength(value.length);
    expect(doc.value).toBe(value);

    const elements: Array<{ el_type: string; startChar: number; endChar: number }> = [];
    doc.forEachElement((element) => elements.push(element));
    const notes = elements.filter((element) => element.el_type === "note");
    expect(notes).toHaveLength(23);
    expect(doc.slice(notes[0].startChar, notes[0].endChar).trim()).toBe('"F"z2');
    const start = value.indexOf("AA");
    expect(doc.elementAtOffset(start)?.startChar).toBe(start);
    expect((doc.parsed()[0] as { warnings?: string[] }).warnings).toBeUndefined();
  });

  it("supports multiline JSON, nested options, blank lines, BOM and X: tunes", () => {
    const value = '\uFEFF\n{\n  "swing": 65,\n\n  "format": {"titlefont": "Arial 18"},\n  "jazzchords": true\n}\n  ---  \n\nX:1\nK:C\nCDEF|';
    const doc = new AbcDocument(value);
    expect(doc.source().options).toEqual({
      swing: 65, format: { titlefont: "Arial 18" }, jazzchords: true
    });
    const start = value.indexOf("CDEF");
    expect(doc.elementAtOffset(start)?.startChar).toBe(start);
  });

  it("keeps positions in multiple tunes", () => {
    const value = '{"swing":65}\n---\nX:1\nK:C\nCDEF|\n\nX:2\nK:G\nGABc|';
    const doc = new AbcDocument(value);
    expect(doc.parsed()).toHaveLength(2);
    const start = value.indexOf("GABc");
    expect(doc.elementAtOffset(start)?.startChar).toBe(start);
  });

  it.each(['{"swing":}', '{"swing":65,}'])("ignores invalid options without parsing them as music: %s", (header) => {
    const value = header + "\n---\nX:1\nK:C\nCDEF|";
    const doc = new AbcDocument(value);
    expect(doc.source().options).toEqual({});
    expect(doc.source().headerError).toBeTruthy();
    const start = value.indexOf("CDEF");
    expect(doc.elementAtOffset(start)?.startChar).toBe(start);
  });

  it("does not treat strings inside the JSON as ABC context fields", () => {
    const value = '{"description":"[K:D] [L:1/4] [M:3/4]"}\n---\nCDEF|';
    const doc = new AbcDocument(value);
    expect(doc.keyAt(value.length)).toEqual({ tonic: "C", accidental: "", mode: "maj" });
    expect(doc.unitLengthAt(value.length)).toEqual({ num: 1, den: 8 });
    expect(doc.inlineFieldAt(value.indexOf("K:D"))).toBeNull();
    expect(doc.findInfoLineByName("K")).toBeNull();
  });

  it("refreshes options on edits, undo, redo and silent replacement", () => {
    const value = '{"swing":65}\n---\n' + music;
    const doc = new AbcDocument(value);
    expect(doc.source()).toBe(doc.source());
    const start = value.indexOf("65");
    doc.replace(start, start + 2, "50");
    expect(doc.source().options.swing).toBe(50);
    doc.undo();
    expect(doc.source().options.swing).toBe(65);
    doc.redo();
    expect(doc.source().options.swing).toBe(50);
    doc.setValue(music, { silent: true });
    expect(doc.source().options).toEqual({});
  });

  it("preserves the header during a note edit", () => {
    const value = '{"swing":65}\n---\n' + music;
    const doc = new AbcDocument(value);
    const note = doc.elementAtOffset(value.indexOf("AA"))!;
    doc.replace(note.startChar, note.endChar, "G");
    expect(doc.value).toBe(value.replace("AA", "GA"));
    expect(doc.source().options.swing).toBe(65);
  });
});
