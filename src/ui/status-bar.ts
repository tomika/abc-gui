/**
 * Bottom status bar showing the current musical context.
 *
 * It tracks:
 * - current bar number
 * - current note number
 * - effective K/M/L/Q/V values at the current selection
 *
 * Status items are clickable to jump to the related source element.
 */

import { AbcDocument, AbcElement } from "../model/document.js";
import { el } from "./dom.js";

type FieldName = "K" | "M" | "L" | "Q" | "V";

interface Range {
  startChar: number;
  endChar: number;
}

interface FieldHit extends Range {
  name: FieldName;
  value: string;
  kind: "line" | "inline";
}

interface FieldState {
  value: string;
  range: Range | null;
  fromDefault: boolean;
}

interface FieldGroup {
  start: number;
  end: number;
}

interface SourceLine extends Range {
  text: string;
}

interface StatusSnapshot {
  barNumber: number;
  barRange: Range | null;
  noteNumber: number;
  noteRange: Range | null;
  fields: Record<FieldName, FieldState>;
}

interface StatusElement extends Range {
  type: string;
}

export interface StatusBarDeps {
  doc: AbcDocument;
  getSelection: () => Range | null;
  setSelection: (s: Range | null) => void;
}

const FIELD_NAMES: ReadonlyArray<FieldName> = ["K", "M", "L", "Q", "V"];

const FIELD_DEFAULTS: Record<FieldName, string> = {
  K: "C",
  M: "4/4",
  L: "1/8",
  Q: "1/4=120",
  V: "1"
};

export class StatusBar {
  private host: HTMLElement;
  private deps: StatusBarDeps;

  constructor(host: HTMLElement, deps: StatusBarDeps) {
    this.host = host;
    this.deps = deps;
    this.host.classList.add("abc-gui-statusbar");
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    this.host.innerHTML = "";
    const snap = this.buildSnapshot();
    const row = el("div", { class: "abc-gui-status-row" });

    const navGroup = el("div", { class: "abc-gui-status-group" });
    navGroup.append(
      this.statusButton(
        "Bar",
        String(snap.barNumber),
        () => {
          if (snap.barRange) this.deps.setSelection(snap.barRange);
        },
        !!snap.barRange,
        snap.barRange
          ? "Show current bar line in property panel"
          : "No bar line available"
      ),
      this.statusButton(
        "Note",
        String(snap.noteNumber),
        () => {
          if (snap.noteRange) this.deps.setSelection(snap.noteRange);
        },
        !!snap.noteRange,
        snap.noteRange
          ? "Show current note in property panel"
          : "No note available"
      )
    );

    const fieldGroup = el("div", { class: "abc-gui-status-group" });
    for (const name of FIELD_NAMES) {
      const state = snap.fields[name];
      fieldGroup.append(
        this.statusButton(
          name,
          state.value,
          () => this.openField(name, state),
          true,
          state.fromDefault
            ? `Insert ${name}: at start and open it in the property panel`
            : `Show ${name}: field in property panel`
        )
      );
    }

    row.append(navGroup, fieldGroup);
    this.host.append(row);
  }

  private statusButton(
    label: string,
    value: string,
    onClick: () => void,
    enabled: boolean,
    title: string
  ): HTMLButtonElement {
    const btn = el(
      "button",
      {
        type: "button",
        class: "abc-gui-status-item",
        title,
        disabled: !enabled
      },
      [`${label}: ${value}`]
    ) as HTMLButtonElement;
    if (enabled) {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        onClick();
      });
    }
    return btn;
  }

  private openField(name: FieldName, state: FieldState): void {
    if (state.range) {
      this.deps.setSelection(state.range);
      return;
    }
    // If no applicable field exists and the status therefore shows a
    // default value, create a top-level field so the user can edit it.
    const inserted = this.insertMissingField(name, FIELD_DEFAULTS[name]);
    this.deps.setSelection(inserted);
  }

  private insertMissingField(name: FieldName, value: string): Range {
    const line = `${name}:${value}`;
    const src = this.deps.doc.value;
    const at = this.resolveInsertOffset(src);
    const needsPrefix = at > 0 && src[at - 1] !== "\n";
    const needsSuffix = at < src.length && src[at] !== "\n";
    const inserted = `${needsPrefix ? "\n" : ""}${line}${needsSuffix ? "\n" : ""}`;
    this.deps.doc.replace(at, at, inserted);
    const start = at + (needsPrefix ? 1 : 0);
    return { startChar: start, endChar: start + line.length };
  }

  private resolveInsertOffset(src: string): number {
    const sel = this.deps.getSelection();
    const anchor = sel ? Math.min(sel.startChar, sel.endChar) : 0;
    const lines = scanLines(src);
    const elements = this.collectElements();
    const firstMusicStart = this.firstMusicStart(elements);
    const group = this.resolveSelectedMetaGroup(anchor, lines, elements, firstMusicStart);

    // Prefer inserting into the currently selected metadata group.
    if (group) {
      const groupLines = lines.filter(
        (l) =>
          l.startChar >= group.start &&
          l.startChar < group.end &&
          isTopLevelInfoLine(l.text)
      );
      if (groupLines.length > 0) {
        return afterLine(groupLines[groupLines.length - 1]!, src.length, src);
      }
      return group.start;
    }

    // Otherwise, keep X: as the first logical header line.
    const xLine = lines.find((l) => /^\s*X:/.test(l.text));
    if (xLine) {
      const xAfter = afterLine(xLine, src.length, src);
      const headerLines = lines.filter(
        (l) =>
          l.startChar >= xAfter &&
          l.startChar < firstMusicStart &&
          isTopLevelInfoLine(l.text)
      );
      if (headerLines.length > 0) {
        return afterLine(headerLines[headerLines.length - 1]!, src.length, src);
      }
      return xAfter;
    }

    return 0;
  }

  private buildSnapshot(): StatusSnapshot {
    const elements = this.collectElements();
    const bars = elements.filter((e) => e.type === "bar");
    const notes = elements.filter((e) => e.type === "note");

    const sel = this.deps.getSelection();
    const anchor = sel ? Math.min(sel.startChar, sel.endChar) : 0;
    const selStart = sel ? Math.min(sel.startChar, sel.endChar) : -1;
    const selEnd = sel ? Math.max(sel.startChar, sel.endChar) : -1;

    const selectedBarIdx = sel
      ? bars.findIndex((b) => rangesOverlap(selStart, selEnd, b.startChar, b.endChar))
      : -1;
    const selectedNoteIdx = sel
      ? notes.findIndex((n) => rangesOverlap(selStart, selEnd, n.startChar, n.endChar))
      : -1;

    let barNumber = 1;
    let barRange: Range | null = null;
    if (bars.length > 0) {
      if (!sel) {
        barRange = toRange(bars[0]!);
      } else if (selectedBarIdx >= 0) {
        barNumber = selectedBarIdx + 1;
        barRange = toRange(bars[selectedBarIdx]!);
      } else {
        const barsBefore = bars.filter((b) => b.startChar < anchor).length;
        barNumber = barsBefore + 1;
        const nextBar = bars.find((b) => b.startChar >= anchor);
        barRange = nextBar
          ? toRange(nextBar)
          : toRange(bars[bars.length - 1]!);
      }
    }

    let noteNumber = 0;
    let noteRange: Range | null = null;
    if (notes.length > 0) {
      if (!sel) {
        noteNumber = 1;
        noteRange = toRange(notes[0]!);
      } else if (selectedNoteIdx >= 0) {
        noteNumber = selectedNoteIdx + 1;
        noteRange = toRange(notes[selectedNoteIdx]!);
      } else {
        const nextNoteIdx = notes.findIndex((n) => n.startChar >= anchor);
        const idx = nextNoteIdx >= 0 ? nextNoteIdx : notes.length - 1;
        noteNumber = idx + 1;
        noteRange = toRange(notes[idx]!);
      }
    }

    const src = this.deps.doc.value;
    const fieldHits = scanFieldHits(src);
    const lines = scanLines(src);
    const firstMusicStart = this.firstMusicStart(elements);
    const selectedMetaGroup = this.resolveSelectedMetaGroup(
      anchor,
      lines,
      elements,
      firstMusicStart
    );
    const fields = {} as Record<FieldName, FieldState>;
    for (const name of FIELD_NAMES) {
      const own = fieldHits.filter((f) => f.name === name);
      let chosen: FieldHit | null = null;
      if (sel && selectedMetaGroup) {
        // Within a contiguous metadata block (no music between lines), treat
        // K/M/L/Q/V as a logical set independent of line order.
        const inGroup = own.filter(
          (f) =>
            f.kind === "line" &&
            f.startChar >= selectedMetaGroup.start &&
            f.startChar < selectedMetaGroup.end
        );
        if (inGroup.length > 0) {
          chosen = inGroup[inGroup.length - 1]!;
        } else {
          for (const f of own) {
            if (f.startChar < selectedMetaGroup.start) chosen = f;
            else break;
          }
        }
      } else if (sel) {
        for (const f of own) {
          if (f.startChar <= anchor) chosen = f;
          else break;
        }
      } else {
        chosen = own[0] ?? null;
      }

      if (chosen) {
        fields[name] = {
          value: chosen.value,
          range: { startChar: chosen.startChar, endChar: chosen.endChar },
          fromDefault: false
        };
      } else {
        fields[name] = {
          value: FIELD_DEFAULTS[name],
          range: null,
          fromDefault: true
        };
      }
    }

    return { barNumber, barRange, noteNumber, noteRange, fields };
  }

  private collectElements(): StatusElement[] {
    const out: StatusElement[] = [];
    const seen = new Set<string>();
    this.deps.doc.forEachElement((el: AbcElement) => {
      if (typeof el.startChar !== "number" || typeof el.endChar !== "number") return;
      if (typeof el.el_type !== "string") return;
      const key = `${el.el_type}:${el.startChar}:${el.endChar}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        type: el.el_type,
        startChar: el.startChar,
        endChar: el.endChar
      });
    });
    out.sort((a, b) =>
      a.startChar === b.startChar
        ? a.endChar - b.endChar
        : a.startChar - b.startChar
    );
    return out;
  }

  private firstMusicStart(elements: StatusElement[]): number {
    if (elements.length === 0) return this.deps.doc.value.length;
    let min = Number.POSITIVE_INFINITY;
    for (const e of elements) {
      if (e.startChar < min) min = e.startChar;
    }
    return Number.isFinite(min) ? min : this.deps.doc.value.length;
  }

  private resolveSelectedMetaGroup(
    anchor: number,
    lines: SourceLine[],
    elements: StatusElement[],
    _firstMusicStart: number
  ): FieldGroup | null {
    const line = findLineAt(lines, anchor);
    if (!line) return null;
    if (!isTopLevelInfoLine(line.text)) return null;

    const prevMusicEnd = this.prevMusicEnd(elements, line.startChar);
    const nextMusicStart = this.nextMusicStart(
      elements,
      line.endChar,
      this.deps.doc.value.length
    );
    return { start: prevMusicEnd, end: nextMusicStart };
  }

  private prevMusicEnd(elements: StatusElement[], offset: number): number {
    let maxEnd = 0;
    for (const e of elements) {
      if (e.endChar <= offset && e.endChar > maxEnd) maxEnd = e.endChar;
    }
    return maxEnd;
  }

  private nextMusicStart(
    elements: StatusElement[],
    offset: number,
    fallback: number
  ): number {
    let minStart = Number.POSITIVE_INFINITY;
    for (const e of elements) {
      if (e.startChar >= offset && e.startChar < minStart) minStart = e.startChar;
    }
    if (Number.isFinite(minStart)) return minStart;
    return fallback;
  }
}

function toRange(v: Range): Range {
  return { startChar: v.startChar, endChar: v.endChar };
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  if (aStart === aEnd) {
    return aStart >= bStart && aStart < bEnd;
  }
  return aStart < bEnd && aEnd > bStart;
}

function scanFieldHits(src: string): FieldHit[] {
  const out: FieldHit[] = [];
  for (const ln of scanLines(src)) {
    const line = ln.text;

    const info = /^\s*([KMLQV]):(.*)$/.exec(line);
    if (info) {
      out.push({
        name: info[1] as FieldName,
        value: (info[2] ?? "").trim(),
        startChar: ln.startChar,
        endChar: ln.endChar,
        kind: "line"
      });
    }

    const inlineRe = /\[\s*([KMLQV]):([^\]\n\r]*)\]/g;
    let m: RegExpExecArray | null;
    while ((m = inlineRe.exec(line)) !== null) {
      const raw = m[0] ?? "";
      const s = ln.startChar + m.index;
      out.push({
        name: m[1] as FieldName,
        value: (m[2] ?? "").trim(),
        startChar: s,
        endChar: s + raw.length,
        kind: "inline"
      });
    }
  }

  out.sort((a, b) =>
    a.startChar === b.startChar
      ? a.endChar - b.endChar
      : a.startChar - b.startChar
  );
  return out;
}

function scanLines(src: string): SourceLine[] {
  const out: SourceLine[] = [];
  let start = 0;
  while (start <= src.length) {
    let end = src.indexOf("\n", start);
    if (end < 0) end = src.length;
    out.push({
      startChar: start,
      endChar: end,
      text: src.slice(start, end)
    });
    if (end === src.length) break;
    start = end + 1;
  }
  return out;
}

function isTopLevelInfoLine(line: string): boolean {
  return /^\s*[A-Za-z]:/.test(line);
}

function findLineAt(lines: SourceLine[], offset: number): SourceLine | null {
  for (const line of lines) {
    if (offset >= line.startChar && offset <= line.endChar) return line;
  }
  return null;
}

function afterLine(line: SourceLine, sourceLen: number, src: string): number {
  if (line.endChar < sourceLen && src[line.endChar] === "\n") {
    return line.endChar + 1;
  }
  return line.endChar;
}
