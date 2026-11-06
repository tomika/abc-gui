import { describe, expect, it } from "vitest";
import { en, hu } from "../src/i18n.js";
import { dialogStrings } from "../src/ui/header-options.js";

describe("header settings texts", () => {
  it("falls back to English for keys missing from older custom translations", () => {
    const older = { ...hu.headerOptions! };
    delete older.lockedValue;
    const strings = dialogStrings({ ...hu, headerOptions: older });
    expect(strings.title).toBe(hu.headerOptions!.title);
    expect(strings.lockedValue("Swing (%)")).toBe(en.headerOptions!.lockedValue!("Swing (%)"));
  });

  it("uses English when a translation has no header texts at all", () => {
    const strings = dialogStrings({ ...hu, headerOptions: undefined });
    expect(strings.apply).toBe(en.headerOptions!.apply);
    expect(strings.lockedValue("Swing (%)")).toContain("Swing (%)");
  });

  it("keeps a translation's own message for fixed values", () => {
    expect(dialogStrings(hu).lockedValue("Swing (%)")).toBe(hu.headerOptions!.lockedValue!("Swing (%)"));
  });
});
