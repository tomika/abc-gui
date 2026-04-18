/**
 * AbcEditor — top-level controller that wires the sub-views together.
 */

import { AbcDocument } from "../model/document.js";
import { ScoreView, SelectionEvent } from "../render/score-view.js";
import { MidiPlayer } from "../render/midi-player.js";
import { PropertyPanel, Selection } from "./property-panel.js";
import { Toolbar } from "./toolbar.js";
import { RawView } from "./raw-view.js";
import { el } from "./dom.js";

export interface AbcEditorOptions {
  value?: string;
  onChange?: (abc: string) => void;
  /** hide the raw text pane (default: false) */
  hideRawView?: boolean;
}

export class AbcEditor {
  private container: HTMLElement;
  private doc: AbcDocument;
  private score: ScoreView;
  private panel: PropertyPanel;
  private raw: RawView | null = null;
  private currentSelection: Selection | null = null;
  private changeDebounce: ReturnType<typeof setTimeout> | null = null;
  private keydownHandler: ((ev: KeyboardEvent) => void) | null = null;
  private player: MidiPlayer;
  private playbackListeners: (() => void)[] = [];
  private rawSelectEnabled = true;

  constructor(container: HTMLElement, opts: AbcEditorOptions = {}) {
    this.container = container;
    this.container.classList.add("abc-gui-root");
    this.container.innerHTML = "";

    this.doc = new AbcDocument(opts.value ?? "");

    const toolbarHost = el("div", { class: "abc-gui-toolbar-host" });
    const body = el("div", { class: "abc-gui-body" });
    const scoreHost = el("div", { class: "abc-gui-score-host" });
    const sideHost = el("div", { class: "abc-gui-side-host" });
    const panelHost = el("div", { class: "abc-gui-panel-host" });
    const rawHost = el("div", { class: "abc-gui-raw-host" });

    sideHost.append(panelHost);
    if (!opts.hideRawView) sideHost.append(rawHost);
    body.append(scoreHost, sideHost);
    this.container.append(toolbarHost, body);

    this.score = new ScoreView(scoreHost, this.doc);
    this.panel = new PropertyPanel(panelHost, this.doc);
    this.player = new MidiPlayer();
    // Any re-render invalidates the primed synth buffer so playback always
    // reflects the latest ABC source.
    this.score.onRender(() => {
      this.player.invalidate();
      this.firePlaybackChange();
    });
    if (!opts.hideRawView) {
      this.raw = new RawView(rawHost, this.doc);
      // Clicking / moving caret in the raw textarea selects the enclosing
      // ABC element (music note/bar/rest) or the header line it sits on.
      this.raw.onCaret((start, end) => this.handleRawCaret(start, end));
    }
    new Toolbar(toolbarHost, {
      doc: this.doc,
      getSelection: () => this.currentSelection,
      setSelection: (s) => this.select(s),
      getRawSelectEnabled: () => this.rawSelectEnabled,
      setRawSelectEnabled: (v) => {
        this.rawSelectEnabled = v;
      },
      playSupported: MidiPlayer.isSupported(),
      isPlaying: () => this.player.isPlaying(),
      play: () => this.handlePlay(),
      stop: () => this.handleStop(),
      onPlaybackStateChange: (cb) => this.playbackListeners.push(cb)
    });

    this.score.onSelect((ev) => this.handleScoreClick(ev));

    // After any mutation, map our cached selection forward and refresh panel.
    this.doc.on((ev) => {
      if (this.currentSelection) {
        this.currentSelection = remapRange(this.currentSelection, ev);
        this.score.setSelected(this.currentSelection);
        this.panel.setSelection(this.currentSelection);
        if (this.currentSelection && this.raw) {
          this.raw.highlightRange(
            this.currentSelection.startChar,
            this.currentSelection.endChar
          );
        }
      }
      if (opts.onChange) {
        if (this.changeDebounce) clearTimeout(this.changeDebounce);
        this.changeDebounce = setTimeout(() => {
          opts.onChange!(this.doc.value);
        }, 50);
      }
    });

    // Keyboard shortcuts: undo / redo when focus is inside the editor.
    this.keydownHandler = (ev: KeyboardEvent) => {
      const mod = ev.ctrlKey || ev.metaKey;
      if (!mod) return;
      if (ev.key === "z" || ev.key === "Z") {
        ev.preventDefault();
        if (ev.shiftKey) this.doc.redo();
        else this.doc.undo();
      } else if (ev.key === "y" || ev.key === "Y") {
        ev.preventDefault();
        this.doc.redo();
      }
    };
    this.container.addEventListener("keydown", this.keydownHandler);
  }

  // Public API ---------------------------------------------------

  getValue(): string {
    return this.doc.value;
  }

  setValue(v: string, opts: { silent?: boolean } = {}): void {
    this.doc.setValue(v, opts);
    this.currentSelection = null;
    this.panel.setSelection(null);
    this.score.setSelected(null);
  }

  destroy(): void {
    if (this.changeDebounce) clearTimeout(this.changeDebounce);
    if (this.keydownHandler) {
      this.container.removeEventListener("keydown", this.keydownHandler);
    }
    this.player.invalidate();
    this.score.destroy();
    this.container.innerHTML = "";
    this.container.classList.remove("abc-gui-root");
  }

  // Internal -----------------------------------------------------

  private handleScoreClick(ev: SelectionEvent): void {
    this.select({ startChar: ev.startChar, endChar: ev.endChar }, ev.classes);
  }

  private handleRawCaret(start: number, end: number): void {
    if (!this.rawSelectEnabled) return;
    // If the user made an explicit selection in the textarea, respect it.
    if (end > start) {
      this.select({ startChar: start, endChar: end });
      return;
    }
    // Caret-only: find the enclosing music element first, else the info line
    // or inline field the caret sits on.
    const music = this.doc.elementAtOffset(start);
    if (music) {
      this.select({ startChar: music.startChar, endChar: music.endChar });
      return;
    }
    const inline = this.doc.inlineFieldAt(start);
    if (inline) {
      this.select(inline);
      return;
    }
    const info = this.doc.infoLineAt(start);
    if (info) {
      this.select(info);
      return;
    }
    this.select(null);
  }

  private select(sel: Selection | null, classes: string | null = null): void {
    this.currentSelection = sel;
    this.score.setSelected(sel, classes);
    this.panel.setSelection(sel);
    if (this.raw && sel) {
      this.raw.highlightRange(sel.startChar, sel.endChar);
    }
  }

  private handlePlay(): void {
    const tune = this.score.getTune();
    if (!tune) return;
    const startChar = this.currentSelection?.startChar;
    this.player
      .play(tune, { startChar })
      .then(() => this.firePlaybackChange())
      .catch((err) => {
        // Surface errors to the console but do not crash the editor — MIDI
        // is optional and can fail for environment reasons (no audio
        // context, soundfont CDN blocked, …).
        // eslint-disable-next-line no-console
        console.warn("[abc-gui] playback failed:", err);
        this.firePlaybackChange();
      });
    this.firePlaybackChange();
  }

  private handleStop(): void {
    this.player.stop();
    this.firePlaybackChange();
  }

  private firePlaybackChange(): void {
    for (const l of [...this.playbackListeners]) l();
  }
}

/**
 * Adjust a previously-saved character range to stay consistent after an
 * insert/delete. If the edit overlaps the range, re-anchor the range to
 * the inserted text (that is the element that was just edited).
 */
function remapRange(
  sel: Selection,
  ev: { replaced: { start: number; end: number }; inserted: string }
): Selection | null {
  const { start, end } = ev.replaced;
  const delta = ev.inserted.length - (end - start);

  // Edit entirely before the selection: shift.
  if (end <= sel.startChar) {
    return { startChar: sel.startChar + delta, endChar: sel.endChar + delta };
  }
  // Edit entirely after the selection: unchanged.
  if (start >= sel.endChar) return sel;

  // Whole-document / surrounding replacement (setValue, undo, redo) —
  // when the edit strictly covers the selection on at least one side AND
  // isn't an exact-match surgical edit, the original anchor is gone:
  // drop the selection.
  const exactMatch = start === sel.startChar && end === sel.endChar;
  if (!exactMatch && start <= sel.startChar && end >= sel.endChar) {
    return null;
  }

  // Partial overlap: anchor on the newly-inserted text (that is the element
  // that was just edited via the property panel).
  return { startChar: start, endChar: start + ev.inserted.length };
}
