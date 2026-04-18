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
  private playBtn: HTMLButtonElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;
  private rawSelectBtn: HTMLButtonElement | null = null;

  constructor(host: HTMLElement, deps: ToolbarDeps) {
    this.host = host;
    this.deps = deps;
    this.host.classList.add("abc-gui-toolbar");
    this.render();
    // Refresh undo/redo enabled state whenever the document changes.
    this.deps.doc.on(() => this.updateHistoryButtons());
    this.deps.onPlaybackStateChange(() => this.updatePlaybackButtons());
    this.updateHistoryButtons();
    this.updatePlaybackButtons();
    this.updateRawSelectButton();
  }

  private render(): void {
    const undoBtn = button("↶", "undo (Ctrl+Z)", () => this.deps.doc.undo());
    const redoBtn = button("↷", "redo (Ctrl+Shift+Z)", () => this.deps.doc.redo());
    this.undoBtn = undoBtn;
    this.redoBtn = redoBtn;
    const historyGroup = el("div", { class: "abc-gui-group", title: "History" });
    historyGroup.append(undoBtn, redoBtn);

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

    const shiftHint = " (hold Shift to insert before selection)";

    this.host.append(
      historyGroup,
      playbackGroup,
      modeGroup,
      // Insert group: only standalone score elements live here. Note/rest
      // properties — accidentals, length, ties, triplets, slurs, grace
      // notes, chord symbols, annotations, and decorations — are edited
      // via the property panel of the selected note instead.
      this.group("Insert", [
        { glyph: "♪", title: "insert note (C)" + shiftHint, snippet: "C" },
        { glyph: "𝄽", title: "insert rest" + shiftHint, snippet: "z" },
        { glyph: "[♪]", title: "insert chord" + shiftHint, snippet: "[CEG]" },
        { glyph: "∣", title: "insert bar line" + shiftHint, snippet: "|" },
        { glyph: "‖", title: "insert double bar" + shiftHint, snippet: "||" },
        { glyph: "|:", title: "insert start-repeat" + shiftHint, snippet: "|:" },
        { glyph: ":|", title: "insert end-repeat" + shiftHint, snippet: ":|" }
      ]),
      this.group("Accidental", [
        { glyph: "♯", title: "sharp" + shiftHint, snippet: "^" },
        { glyph: "♭", title: "flat" + shiftHint, snippet: "_" },
        { glyph: "♮", title: "natural" + shiftHint, snippet: "=" }
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
