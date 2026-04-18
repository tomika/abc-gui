/**
 * Toolbar with language-independent Unicode glyph buttons. Clicking a button
 * inserts a snippet after the current selection (or at end of document if
 * nothing is selected). Shift-click inserts BEFORE the selection instead.
 *
 * Info-field buttons (the "Header" group) always land on their own line:
 * the snippet is placed at the nearest line boundary so it never splits an
 * existing music / header line or ends up mid-line.
 */

import { AbcDocument } from "../model/document.js";
import { button, el } from "./dom.js";

export interface ToolbarDeps {
  doc: AbcDocument;
  getSelection: () => { startChar: number; endChar: number } | null;
  setSelection: (s: { startChar: number; endChar: number } | null) => void;
}

interface InsertSpec {
  /** visible glyph */
  glyph: string;
  /** accessible title / tooltip */
  title: string;
  /** raw snippet inserted around the selection */
  snippet: string;
  /** true → place snippet on its own line (info fields) */
  infoField?: boolean;
}

export class Toolbar {
  private host: HTMLElement;
  private deps: ToolbarDeps;
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;

  constructor(host: HTMLElement, deps: ToolbarDeps) {
    this.host = host;
    this.deps = deps;
    this.host.classList.add("abc-gui-toolbar");
    this.render();
    // Refresh undo/redo enabled state whenever the document changes.
    this.deps.doc.on(() => this.updateHistoryButtons());
    this.updateHistoryButtons();
  }

  private render(): void {
    const undoBtn = button("↶", "undo (Ctrl+Z)", () => this.deps.doc.undo());
    const redoBtn = button("↷", "redo (Ctrl+Shift+Z)", () => this.deps.doc.redo());
    this.undoBtn = undoBtn;
    this.redoBtn = redoBtn;
    const historyGroup = el("div", { class: "abc-gui-group", title: "History" });
    historyGroup.append(undoBtn, redoBtn);

    const shiftHint = " (hold Shift to insert before selection)";

    this.host.append(
      historyGroup,
      this.group("Insert", [
        { glyph: "♪", title: "insert note (C)" + shiftHint, snippet: "C" },
        { glyph: "𝄽", title: "insert rest" + shiftHint, snippet: "z" },
        { glyph: "[♪]", title: "insert chord" + shiftHint, snippet: "[CEG]" },
        { glyph: "∣", title: "insert bar line" + shiftHint, snippet: "|" },
        { glyph: "‖", title: "insert double bar" + shiftHint, snippet: "||" },
        { glyph: "|:", title: "insert start-repeat" + shiftHint, snippet: "|:" },
        { glyph: ":|", title: "insert end-repeat" + shiftHint, snippet: ":|" },
        { glyph: "(3", title: "insert triplet" + shiftHint, snippet: "(3" },
        { glyph: "⌒", title: "insert tie" + shiftHint, snippet: "-" },
        { glyph: "(…)", title: "insert slur" + shiftHint, snippet: "()" },
        { glyph: "{♪}", title: "insert grace-note group" + shiftHint, snippet: "{c}" }
      ]),
      this.group("Accidental", [
        { glyph: "♯", title: "sharp" + shiftHint, snippet: "^" },
        { glyph: "♭", title: "flat" + shiftHint, snippet: "_" },
        { glyph: "♮", title: "natural" + shiftHint, snippet: "=" }
      ]),
      this.group("Annotation", [
        { glyph: '"Am"', title: "insert chord symbol" + shiftHint, snippet: '"Am"' },
        { glyph: '"^…"', title: "insert above annotation" + shiftHint, snippet: '"^text"' },
        { glyph: '"_…"', title: "insert below annotation" + shiftHint, snippet: '"_text"' }
      ]),
      this.group("Decoration", [
        { glyph: "·", title: "staccato" + shiftHint, snippet: "!staccato!" },
        { glyph: "𝄐", title: "fermata" + shiftHint, snippet: "!fermata!" },
        { glyph: "𝆖", title: "trill" + shiftHint, snippet: "!trill!" },
        { glyph: ">", title: "accent" + shiftHint, snippet: "!>!" }
      ]),
      this.group("Header", [
        {
          glyph: "X:",
          title: "new tune header" + shiftHint,
          snippet: "X:1\nT:Untitled\nM:4/4\nL:1/8\nK:C",
          infoField: true
        },
        { glyph: "T:", title: "insert title field" + shiftHint, snippet: "T:Title", infoField: true },
        { glyph: "C:", title: "insert composer field" + shiftHint, snippet: "C:Composer", infoField: true },
        { glyph: "R:", title: "insert rhythm field" + shiftHint, snippet: "R:Rhythm", infoField: true },
        { glyph: "K:", title: "insert key field" + shiftHint, snippet: "K:C", infoField: true },
        { glyph: "M:", title: "insert meter field" + shiftHint, snippet: "M:4/4", infoField: true },
        { glyph: "L:", title: "insert unit length field" + shiftHint, snippet: "L:1/8", infoField: true },
        { glyph: "Q:", title: "insert tempo field" + shiftHint, snippet: "Q:1/4=120", infoField: true },
        { glyph: "V:", title: "insert voice field" + shiftHint, snippet: "V:1", infoField: true }
      ])
    );
  }

  private updateHistoryButtons(): void {
    if (this.undoBtn) this.undoBtn.disabled = !this.deps.doc.canUndo();
    if (this.redoBtn) this.redoBtn.disabled = !this.deps.doc.canRedo();
  }

  private group(name: string, specs: ReadonlyArray<InsertSpec>): HTMLElement {
    const g = el("div", { class: "abc-gui-group", title: name });
    for (const spec of specs) {
      g.append(
        button(spec.glyph, spec.title, (ev) => this.insert(spec, ev.shiftKey))
      );
    }
    return g;
  }

  private insert(spec: InsertSpec, before: boolean): void {
    const sel = this.deps.getSelection();
    const doc = this.deps.doc;
    const src = doc.value;

    if (spec.infoField) {
      // Info fields must live on their own line. Pin the insertion point to
      // a line boundary and wrap the snippet with the newlines needed to
      // keep surrounding content intact.
      const anchor = sel ? (before ? sel.startChar : sel.endChar) : src.length;
      const pos = before ? startOfLine(src, anchor) : endOfLine(src, anchor);
      const needLeadingNL =
        pos > 0 && src[pos - 1] !== "\n" ? "\n" : "";
      const needTrailingNL =
        pos < src.length && src[pos] !== "\n" ? "\n" : "";
      const text = needLeadingNL + spec.snippet + needTrailingNL;
      doc.replace(pos, pos, text);
      const selStart = pos + needLeadingNL.length;
      this.deps.setSelection({
        startChar: selStart,
        endChar: selStart + spec.snippet.length
      });
      return;
    }

    if (sel) {
      const pos = before ? sel.startChar : sel.endChar;
      doc.replace(pos, pos, spec.snippet);
      this.deps.setSelection({
        startChar: pos,
        endChar: pos + spec.snippet.length
      });
    } else {
      const end = src.length;
      doc.replace(end, end, spec.snippet);
      this.deps.setSelection({
        startChar: end,
        endChar: end + spec.snippet.length
      });
    }
  }
}

function startOfLine(src: string, offset: number): number {
  let s = Math.max(0, Math.min(offset, src.length));
  while (s > 0 && src[s - 1] !== "\n") s--;
  return s;
}

function endOfLine(src: string, offset: number): number {
  let e = Math.max(0, Math.min(offset, src.length));
  while (e < src.length && src[e] !== "\n") e++;
  return e;
}
