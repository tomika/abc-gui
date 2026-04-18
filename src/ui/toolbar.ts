/**
 * Toolbar with language-independent Unicode glyph buttons. Clicking a button
 * inserts a snippet after the current selection (or at end of document if
 * nothing is selected). Shift-click inserts BEFORE the selection instead.
 *
 * Info-field buttons (the "Header" group) and the line-break button always
 * land on their own line: the snippet is inserted at the current selection
 * position and the surrounding text is split with newlines as needed, so
 * the positional meaning of fields like K:, M:, L:, V:, … is preserved.
 */

import { AbcDocument } from "../model/document.js";
import { button, el } from "./dom.js";

export interface ToolbarDeps {
  doc: AbcDocument;
  getSelection: () => { startChar: number; endChar: number } | null;
  setSelection: (s: { startChar: number; endChar: number } | null) => void;
  /** raw-textarea-to-selection binding: when false, clicking / moving the
   *  caret in the raw view no longer drives the element selection, so the
   *  user can edit the text freely without the panel jumping around. */
  getRawSelectEnabled: () => boolean;
  setRawSelectEnabled: (enabled: boolean) => void;
  /** MIDI playback. When `playSupported` is false the buttons are disabled. */
  playSupported: boolean;
  isPlaying: () => boolean;
  play: () => void;
  stop: () => void;
  /** Subscribe to playback-state changes so the toolbar can toggle icons. */
  onPlaybackStateChange: (cb: () => void) => void;
  /** Subscribe to selection changes so the toolbar can toggle the delete button. */
  onSelectionChange: (cb: () => void) => void;
}

interface InsertSpec {
  /** visible glyph */
  glyph: string;
  /** accessible title / tooltip */
  title: string;
  /** raw snippet inserted around the selection */
  snippet: string;
  /** true → place snippet on its own line (info fields). The snippet is
   *  inserted at the current selection position, and the surrounding text
   *  is split with newlines as needed so the snippet ends up on a line of
   *  its own. The selection's character offsets retain their meaning, so
   *  positional info fields like K:, M:, L:, [V:n] etc. land where the
   *  user expects. */
  infoField?: boolean;
  /** true → snippet is a bare newline whose only job is to split the line
   *  at the current selection position. */
  lineBreak?: boolean;
  /** true → insert before the selection by default; Shift inserts after
   *  (reverses the normal Shift-to-insert-before convention). */
  defaultBefore?: boolean;
  /** keyboard keys that trigger this insertion. */
  hotkeys?: string[];
}

export class Toolbar {
  private host: HTMLElement;
  private deps: ToolbarDeps;
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;
  private deleteBtn: HTMLButtonElement | null = null;
  private playBtn: HTMLButtonElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;
  private rawSelectBtn: HTMLButtonElement | null = null;
  private insertSpecs: ReadonlyArray<InsertSpec> = [];
  private headerSpecs: ReadonlyArray<InsertSpec> = [];

  constructor(host: HTMLElement, deps: ToolbarDeps) {
    this.host = host;
    this.deps = deps;
    this.host.classList.add("abc-gui-toolbar");
    this.render();
    // Refresh undo/redo enabled state whenever the document changes.
    this.deps.doc.on(() => this.updateHistoryButtons());
    this.deps.onPlaybackStateChange(() => this.updatePlaybackButtons());
    this.deps.onSelectionChange(() => this.updateHistoryButtons());
    this.updateHistoryButtons();
    this.updatePlaybackButtons();
    this.updateRawSelectButton();
  }

  private render(): void {
    const undoBtn = button("↶", "undo (Ctrl+Z)", () => this.deps.doc.undo());
    const redoBtn = button("↷", "redo (Ctrl+Shift+Z)", () => this.deps.doc.redo());
    this.undoBtn = undoBtn;
    this.redoBtn = redoBtn;
    const deleteBtn = button(
      "✖",
      "delete selected element (Delete: select next, Backspace: select previous)",
      () => this.deleteSelection()
    );
    this.deleteBtn = deleteBtn;
    const historyGroup = el("div", { class: "abc-gui-group", title: "History" });
    historyGroup.append(undoBtn, redoBtn, deleteBtn);

    const playBtn = button("▶", "play (from selected note, or from start)", () =>
      this.deps.play()
    );
    const stopBtn = button("■", "stop playback", () => this.deps.stop());
    playBtn.disabled = !this.deps.playSupported;
    stopBtn.disabled = !this.deps.playSupported;
    this.playBtn = playBtn;
    this.stopBtn = stopBtn;
    const playbackGroup = el("div", { class: "abc-gui-group", title: "Playback" });
    playbackGroup.append(playBtn, stopBtn);

    const rawSelectBtn = button(
      "⇌",
      "toggle raw-text → element selection (when off, you can edit the raw ABC freely without the panel jumping around)",
      () => {
        this.deps.setRawSelectEnabled(!this.deps.getRawSelectEnabled());
        this.updateRawSelectButton();
      }
    );
    this.rawSelectBtn = rawSelectBtn;
    const modeGroup = el("div", { class: "abc-gui-group", title: "Modes" });
    modeGroup.append(rawSelectBtn);

    const shiftHint = " (Shift: insert before selection)";

    this.insertSpecs = [
      {
        glyph: "♪",
        title: "insert note (N; inserts C)" + shiftHint,
        snippet: "C",
        hotkeys: ["N"]
      },
      {
        glyph: "𝄽",
        title: "insert rest (Z)" + shiftHint,
        snippet: "z",
        hotkeys: ["Z"]
      },
      {
        glyph: "[♪]",
        title: "insert chord (H)" + shiftHint,
        snippet: "[CEG]",
        hotkeys: ["H"]
      },
      {
        glyph: "∣",
        title: "insert bar line (I)" + shiftHint,
        snippet: "|",
        hotkeys: ["I"]
      },
      { glyph: "‖", title: "insert double bar" + shiftHint, snippet: "||" },
      {
        glyph: "|:",
        title: "insert start-repeat ([); default is before, Shift inserts after",
        snippet: "|:",
        defaultBefore: true,
        hotkeys: ["[", "{"]
      },
      {
        glyph: ":|",
        title: "insert end-repeat (])" + shiftHint,
        snippet: ":|",
        hotkeys: ["]", "}"]
      },
      {
        glyph: "↵",
        title: "insert line break (Enter; split current line at selection); Shift+Enter removes nearest line break",
        snippet: "\n",
        lineBreak: true,
        hotkeys: ["Enter"]
      }
    ];

    this.headerSpecs = [
      {
        glyph: "X:",
        title: "new tune header (X)" + shiftHint,
        snippet: "X:1\nT:Untitled\nM:4/4\nL:1/8\nK:C",
        infoField: true,
        hotkeys: ["X"]
      },
      {
        glyph: "T:",
        title: "insert title field (T)" + shiftHint,
        snippet: "T:Title",
        infoField: true,
        hotkeys: ["T"]
      },
      {
        glyph: "C:",
        title: "insert composer field (C)" + shiftHint,
        snippet: "C:Composer",
        infoField: true,
        hotkeys: ["C"]
      },
      {
        glyph: "R:",
        title: "insert rhythm field (R)" + shiftHint,
        snippet: "R:Rhythm",
        infoField: true,
        hotkeys: ["R"]
      },
      {
        glyph: "K:",
        title: "insert key field (K)" + shiftHint,
        snippet: "K:C",
        infoField: true,
        hotkeys: ["K"]
      },
      {
        glyph: "M:",
        title: "insert meter field (M)" + shiftHint,
        snippet: "M:4/4",
        infoField: true,
        hotkeys: ["M"]
      },
      {
        glyph: "L:",
        title: "insert unit length field (L)" + shiftHint,
        snippet: "L:1/8",
        infoField: true,
        hotkeys: ["L"]
      },
      {
        glyph: "Q:",
        title: "insert tempo field (Q)" + shiftHint,
        snippet: "Q:1/4=120",
        infoField: true,
        hotkeys: ["Q"]
      },
      {
        glyph: "V:",
        title: "insert voice field (V)" + shiftHint,
        snippet: "V:1",
        infoField: true,
        hotkeys: ["V"]
      }
    ];

    this.host.append(
      historyGroup,
      playbackGroup,
      modeGroup,
      // Insert group: only standalone score elements live here. Note/rest
      // properties — accidentals, length, ties, slurs, triplets, grace
      // notes, chord symbols, annotations, and decorations — are edited
      // via the property panel of the selected note instead.
      this.group("Insert", this.insertSpecs),
      this.group("Header", this.headerSpecs)
    );
  }

  /** Trigger one of the insert/header actions via keyboard hotkey. */
  handleShortcut(key: string, shiftKey: boolean): boolean {
    const norm = key.length === 1 ? key.toUpperCase() : key;
    const allSpecs = [...this.insertSpecs, ...this.headerSpecs];
    const spec = allSpecs.find((s) => s.hotkeys?.includes(norm));
    if (!spec) return false;
    this.insert(spec, spec.defaultBefore ? !shiftKey : shiftKey);
    return true;
  }

  private updateHistoryButtons(): void {
    if (this.undoBtn) this.undoBtn.disabled = !this.deps.doc.canUndo();
    if (this.redoBtn) this.redoBtn.disabled = !this.deps.doc.canRedo();
    if (this.deleteBtn) {
      const sel = this.deps.getSelection();
      this.deleteBtn.disabled = !sel || sel.startChar === sel.endChar;
    }
  }

  private deleteSelection(): void {
    const sel = this.deps.getSelection();
    if (!sel) return;
    const start = Math.min(sel.startChar, sel.endChar);
    const end = Math.max(sel.startChar, sel.endChar);
    if (start === end) return;
    this.deps.doc.replace(start, end, "");
    this.deps.setSelection({ startChar: start, endChar: start });
  }

  private updatePlaybackButtons(): void {
    if (!this.playBtn || !this.stopBtn) return;
    const supported = this.deps.playSupported;
    const playing = supported && this.deps.isPlaying();
    this.playBtn.classList.toggle("active", playing);
    this.playBtn.disabled = !supported;
    this.stopBtn.disabled = !supported;
  }

  private updateRawSelectButton(): void {
    if (!this.rawSelectBtn) return;
    const on = this.deps.getRawSelectEnabled();
    this.rawSelectBtn.classList.toggle("active", on);
    this.rawSelectBtn.title = on
      ? "raw-text → element selection: ON (click to disable for free-form raw editing)"
      : "raw-text → element selection: OFF (click to re-enable caret-based selection)";
  }

  private group(name: string, specs: ReadonlyArray<InsertSpec>): HTMLElement {
    const g = el("div", { class: "abc-gui-group", title: name });
    for (const spec of specs) {
      g.append(
        button(spec.glyph, spec.title, (ev) => this.insert(spec, spec.defaultBefore ? !ev.shiftKey : ev.shiftKey))
      );
    }
    return g;
  }

  private insert(spec: InsertSpec, before: boolean): void {
    const sel = this.deps.getSelection();
    const doc = this.deps.doc;
    const src = doc.value;

    if (spec.lineBreak) {
      const anchor = sel ? (before ? sel.startChar : sel.endChar) : src.length;
      if (!this.isMusicLineAnchor(src, anchor)) {
        return;
      }
      if (before) {
        // Shift: remove the newline closest to the current selection range.
        const rangeStart = sel ? Math.min(sel.startChar, sel.endChar) : src.length;
        const rangeEnd = sel ? Math.max(sel.startChar, sel.endChar) : src.length;

        // If a newline is inside the selected range, remove that one first.
        let nlPos = src.indexOf("\n", rangeStart);
        if (nlPos < 0 || nlPos > rangeEnd) {
          const prev = src.lastIndexOf("\n", Math.max(0, rangeStart - 1));
          const next = src.indexOf("\n", rangeEnd);
          const prevDist = prev >= 0 ? rangeStart - prev : Number.POSITIVE_INFINITY;
          const nextDist = next >= 0 ? next - rangeEnd : Number.POSITIVE_INFINITY;
          nlPos = prevDist <= nextDist ? prev : next;
        }
        if (nlPos < 0) return;
        doc.replace(nlPos, nlPos + 1, "");
        this.deps.setSelection({ startChar: nlPos, endChar: nlPos });
        return;
      }
      // A bare line break: just insert the snippet at the current position.
      // No wrapping — the snippet IS the newline.
      if (this.wouldCreateEmptyLine(src, anchor)) {
        return;
      }
      doc.replace(anchor, anchor, spec.snippet);
      const afterBreak = anchor + spec.snippet.length;
      const next = this.findNextElementAfter(afterBreak);
      if (next) {
        this.deps.setSelection(next);
      } else {
        // Fallback: place a caret after the inserted newline.
        this.deps.setSelection({ startChar: afterBreak, endChar: afterBreak });
      }
      return;
    }

    if (spec.infoField) {
      // Info fields must live on their own line. Pin the insertion point to
      // the current selection position (preserving the positional meaning of
      // K:/M:/L:/V: etc.) and surround the snippet with the newlines needed
      // to keep it on a line of its own — splitting the surrounding line if
      // the anchor is mid-line.
      const anchor = sel ? (before ? sel.startChar : sel.endChar) : src.length;
      const needLeadingNL = anchor > 0 && src[anchor - 1] !== "\n" ? "\n" : "";
      const needTrailingNL =
        anchor < src.length && src[anchor] !== "\n" ? "\n" : "";
      const text = needLeadingNL + spec.snippet + needTrailingNL;
      doc.replace(anchor, anchor, text);
      const selStart = anchor + needLeadingNL.length;
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

  /** Find the next parsed music element whose start is at/after `offset`. */
  private findNextElementAfter(
    offset: number
  ): { startChar: number; endChar: number } | null {
    let best: { startChar: number; endChar: number } | null = null;
    this.deps.doc.forEachElement((el) => {
      if (el.startChar < offset) return;
      if (!best || el.startChar < best.startChar) {
        best = { startChar: el.startChar, endChar: el.endChar };
      }
    });
    return best;
  }

  /** True when `anchor` sits on a line that contains parsed music elements. */
  private isMusicLineAnchor(src: string, anchor: number): boolean {
    const clamped = Math.max(0, Math.min(anchor, src.length));
    const probe = clamped === src.length && clamped > 0 ? clamped - 1 : clamped;

    let lineStart = probe;
    while (lineStart > 0 && src[lineStart - 1] !== "\n") lineStart--;
    let lineEnd = probe;
    while (lineEnd < src.length && src[lineEnd] !== "\n") lineEnd++;

    let hasMusic = false;
    this.deps.doc.forEachElement((el) => {
      if (hasMusic) return;
      if (el.startChar >= lineStart && el.startChar < lineEnd) hasMusic = true;
    });
    return hasMusic;
  }

  /** Splitting at start/end of a line would create an empty line. */
  private wouldCreateEmptyLine(src: string, anchor: number): boolean {
    if (anchor < 0 || anchor > src.length) return true;
    const leftIsBreak = anchor > 0 && src[anchor - 1] === "\n";
    const rightIsBreak = anchor < src.length && src[anchor] === "\n";
    return leftIsBreak || rightIsBreak;
  }
}
