import { describe, it, expect, vi } from "vitest";

// The AbcDocument lazily requires abcjs. We stub it out so the model can be
// tested without a DOM.
vi.mock("abcjs", () => ({ default: { parseOnly: () => [] } }));

import { AbcDocument } from "../src/model/document.js";

describe("AbcDocument", () => {
  it("stores initial value", () => {
    const d = new AbcDocument("X:1\nK:C\n");
    expect(d.value).toBe("X:1\nK:C\n");
  });

  it("replace performs surgical splice and emits change", () => {
    const d = new AbcDocument("abcdef");
    const events: string[] = [];
    d.on((e) => events.push(e.value));
    d.replace(2, 4, "XY");
    expect(d.value).toBe("abXYef");
    expect(events).toEqual(["abXYef"]);
  });

  it("setValue replaces whole document", () => {
    const d = new AbcDocument("foo");
    d.setValue("bar");
    expect(d.value).toBe("bar");
  });

  it("setValue with silent does not emit", () => {
    const d = new AbcDocument("foo");
    let count = 0;
    d.on(() => count++);
    d.setValue("bar", { silent: true });
    expect(count).toBe(0);
  });

  it("slice returns range text", () => {
    const d = new AbcDocument("hello world");
    expect(d.slice(6, 11)).toBe("world");
  });

  it("undo reverts the last replace", () => {
    const d = new AbcDocument("abc");
    d.replace(1, 2, "X"); // "aXc"
    expect(d.value).toBe("aXc");
    expect(d.canUndo()).toBe(true);
    d.undo();
    expect(d.value).toBe("abc");
    expect(d.canRedo()).toBe(true);
    d.redo();
    expect(d.value).toBe("aXc");
  });

  it("no-op replace does not push history", () => {
    const d = new AbcDocument("abc");
    d.replace(1, 2, "b"); // identical
    expect(d.canUndo()).toBe(false);
  });

  it("undo on empty stack is a no-op", () => {
    const d = new AbcDocument("abc");
    expect(() => d.undo()).not.toThrow();
    expect(d.value).toBe("abc");
  });

  it("new mutation clears the redo stack", () => {
    const d = new AbcDocument("abc");
    d.replace(0, 1, "A");
    d.undo();
    expect(d.canRedo()).toBe(true);
    d.replace(0, 1, "Z");
    expect(d.canRedo()).toBe(false);
  });

  it("infoLineAt recognises header lines", () => {
    const d = new AbcDocument("X:1\nT:Title\nK:C\nCDE|\n");
    // caret inside "T:Title"
    const range = d.infoLineAt(6);
    expect(range).toEqual({ startChar: 4, endChar: 11 });
    // caret inside music line — not an info line
    expect(d.infoLineAt(17)).toBeNull();
  });

  it("inlineFieldAt recognises inline fields", () => {
    const d = new AbcDocument("CDE[M:6/8]FGA");
    const r = d.inlineFieldAt(5);
    expect(r).toEqual({ startChar: 3, endChar: 10 });
    expect(d.inlineFieldAt(1)).toBeNull();
  });

  it("unitLengthAt falls back to 1/8 when no L: is set", () => {
    const d = new AbcDocument("X:1\nK:C\nCDE|\n");
    expect(d.unitLengthAt(10)).toEqual({ num: 1, den: 8 });
  });

  it("unitLengthAt picks up a header L:", () => {
    const d = new AbcDocument("X:1\nL:1/4\nK:C\nCDE|\n");
    expect(d.unitLengthAt(d.value.indexOf("C"))).toEqual({ num: 1, den: 4 });
  });

  it("unitLengthAt uses the most recent L: before the offset", () => {
    const src = "X:1\nL:1/8\nK:C\nCDE|\nL:1/16\nEFG|\n";
    const d = new AbcDocument(src);
    expect(d.unitLengthAt(src.indexOf("CDE"))).toEqual({ num: 1, den: 8 });
    expect(d.unitLengthAt(src.indexOf("EFG"))).toEqual({ num: 1, den: 16 });
  });

  it("unitLengthAt recognises inline [L:...] fields", () => {
    const src = "X:1\nL:1/8\nK:C\nCDE[L:1/4]FGA|\n";
    const d = new AbcDocument(src);
    expect(d.unitLengthAt(src.indexOf("CDE"))).toEqual({ num: 1, den: 8 });
    expect(d.unitLengthAt(src.indexOf("FGA"))).toEqual({ num: 1, den: 4 });
  });
});
