import { afterEach, describe, expect, it, vi } from "vitest";
import abcjs from "abcjs";
import { AbcDocument } from "../src/model/document.js";
import { ScoreView } from "../src/render/score-view.js";

vi.mock("abcjs", async (importOriginal) => {
  const original = await importOriginal<typeof import("abcjs")>();
  return {
    default: {
      ...original.default,
      renderAbc: vi.fn((_host, abc, options) => original.default.parseOnly(abc, options))
    }
  };
});

function host(): HTMLElement {
  return {
    classList: { add: vi.fn() },
    style: {}, scrollTop: 0, scrollLeft: 0, scrollHeight: 100, scrollWidth: 100,
    querySelectorAll: () => []
  } as unknown as HTMLElement;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("score options header", () => {
  it("keeps selection and complete parsing mandatory even with hostile document and host options", () => {
    const doc = new AbcDocument('{"selectTypes":false,"add_classes":false,"header_only":true,"afterParsing":1}\n---\nK:C\nCDEF|');
    const score = new ScoreView(host(), doc, { selectTypes: false, add_classes: false, header_only: true });
    const params = vi.mocked(abcjs.renderAbc).mock.calls[0][2];
    expect(params).toMatchObject({ selectTypes: true, add_classes: true, header_only: false, stop_on_warning: false });
    expect(params!.afterParsing).toBeUndefined();
    expect(score.getSynthOptions()).toEqual({});
    expect((score.getTune() as { lines: unknown[] }).lines.length).toBeGreaterThan(0);
    score.destroy();
  });

  it("warns once per malformed-header episode rather than on each keystroke", () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new AbcDocument('{"swing":}\n---\nK:C\nCDEF|');
    const score = new ScoreView(host(), doc);
    doc.replace(doc.value.length, doc.value.length, " GABc|");
    vi.advanceTimersByTime(30);
    doc.setValue('{"swing":,}\n---\nK:C\nCDEF|');
    vi.advanceTimersByTime(30);
    expect(warn).toHaveBeenCalledOnce();
    doc.setValue('{"swing":65}\n---\nK:C\nCDEF|');
    vi.advanceTimersByTime(30);
    doc.setValue('{"swing":}\n---\nK:C\nCDEF|');
    vi.advanceTimersByTime(30);
    expect(warn).toHaveBeenCalledTimes(2);
    score.destroy();
  });

  it("forwards rendering options, keeps host overrides and maps clicks to the raw source", () => {
    const value = '{"swing":65,"jazzchords":true,"scale":0.8,"clickListener":null}\n---\nK:F\nCDEF|';
    const doc = new AbcDocument(value);
    const score = new ScoreView(host(), doc, { scale: 1.2 });
    const [, abc, params] = vi.mocked(abcjs.renderAbc).mock.calls[0];
    expect(abc).toBe(doc.source().abc);
    expect(params).toMatchObject({ jazzchords: true, scale: 1.2, clickListener: expect.any(Function) });
    expect(score.getSynthOptions()).toMatchObject({ swing: 65 });
    const selected = vi.fn();
    score.onSelect(selected);
    const note = doc.elementAtOffset(value.indexOf("CDEF"))!;
    params!.clickListener!(note, 0, "abcjs-note", {});
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({
      startChar: note.startChar, endChar: note.endChar
    }));
    score.destroy();
  });

  it("updates rendered options and clears audio options after removing the header", () => {
    vi.useFakeTimers();
    const doc = new AbcDocument('{"swing":65,"germanAlphabet":true}\n---\nK:C\nCDEF|');
    const score = new ScoreView(host(), doc);
    expect(score.getAbcjsOptions().germanAlphabet).toBe(true);
    doc.setValue('{"swing":60}\n---\nK:C\nCDEF|');
    vi.advanceTimersByTime(30);
    expect(score.getSynthOptions().swing).toBe(60);
    doc.setValue("K:C\nCDEF|");
    vi.advanceTimersByTime(30);
    expect(score.getSynthOptions()).toEqual({});
    score.destroy();
  });

  it("reports invalid JSON and still renders the ABC body", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new AbcDocument('{"swing":}\n---\nK:C\nCDEF|');
    const score = new ScoreView(host(), doc);
    expect(warn).toHaveBeenCalledWith("[abc-gui] Invalid abcjs options header:", expect.any(String));
    expect(score.getTune()).toBeTruthy();
    expect(score.getSynthOptions()).toEqual({});
    score.destroy();
  });
});

describe("host defaults for header options", () => {
  it("renders and plays with defaults the header does not set", () => {
    const doc = new AbcDocument("K:C\nCDEF|");
    const score = new ScoreView(host(), doc, {}, {
      swing: { value: 60 }, jazzchords: { value: true }, scale: { value: 1.4, editable: false }
    });
    expect(vi.mocked(abcjs.renderAbc).mock.calls[0][2]).toMatchObject({ jazzchords: true, scale: 1.4 });
    expect(score.getSynthOptions()).toEqual({ swing: 60 });
    expect(score.getAbcjsOptions()).toMatchObject({ jazzchords: true, scale: 1.4 });
    expect(doc.value).toBe("K:C\nCDEF|");
    score.destroy();
  });

  it("lets the header override editable defaults and ignores it for fixed ones", () => {
    const doc = new AbcDocument('{"swing":70,"qpm":200,"jazzchords":false}\n---\nK:C\nCDEF|');
    const score = new ScoreView(host(), doc, {}, {
      swing: { value: 60 }, qpm: { value: 90, editable: false }, jazzchords: { value: true, editable: false }
    });
    expect(score.getSynthOptions()).toEqual({ swing: 70, qpm: 90 });
    expect(vi.mocked(abcjs.renderAbc).mock.calls[0][2]).toMatchObject({ jazzchords: true });
    score.destroy();
  });

  it("re-renders with replaced defaults", () => {
    vi.useFakeTimers();
    const doc = new AbcDocument("K:C\nCDEF|");
    const score = new ScoreView(host(), doc, {}, { swing: { value: 60 } });
    const rendered = vi.fn();
    score.onRender(rendered);
    score.setHeaderOptionDefaults({ qpm: { value: 80 } });
    vi.advanceTimersByTime(30);
    expect(rendered).toHaveBeenCalledOnce();
    expect(score.getSynthOptions()).toEqual({ qpm: 80 });
    score.destroy();
  });

  it("tells the dialog which values are defaults and which ones the host fixes", () => {
    const doc = new AbcDocument("K:C\nCDEF|");
    const score = new ScoreView(host(), doc, { staffwidth: 600, responsive: "resize" }, {
      swing: { value: 60 }, qpm: { value: 90, editable: false }, staffwidth: { value: 400 }
    });
    expect(score.getHostHeaderOptions()).toEqual({
      defaults: { swing: 60, staffwidth: 400 },
      locked: { qpm: 90, staffwidth: 600 }
    });
    score.destroy();
  });
});
