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
import { LocaleId, Strings, resolveStrings } from "../i18n.js";
import { AbcVisualParams } from "abcjs";

export interface AbcEditorOptions {
  value?: string;
  onChange?: (abc: string) => void;
  /** hide the raw text pane (default: false) */
  hideRawView?: boolean;
  /** UI language. Either a built-in id ("en", "hu") or a full Strings object. */
  locale?: LocaleId | Strings;
  /** Visual theme for the editor; defaults to "light". */
  theme?: "light" | "dark";
  /** Chord editor callback */
  chordEditor?: (chord: string) => Promise<{ chordName: string; chordMidiValues: number[] }>;
  /** Optional stricter chord validation callback for chord-symbol annotations. */
  chordVerifier?: (chordName: string, germanAlphabet: boolean) => boolean;
  /**
   * Extra parameters forwarded verbatim to `abcjs.renderAbc`. Use this to
   * tweak engraving-level behavior that abcjs exposes but we don't wrap
   * with a first-class option. Common keys:
   *   - `germanAlphabet: boolean` — render note names in German notation.
   *   - `jazzchords: boolean` — draw chord symbols in jazz style.
   *   - `visualTranspose: number` — semitone shift for display only.
   *   - `scale: number` — uniform zoom factor.
   *   - `staffwidth: number` — target staff width in pixels.
   *   - `paddingtop` / `paddingbottom` / `paddingleft` / `paddingright`.
   *   - `format: Record<string, string|number>` — ABC %%format overrides.
   *   - `print: boolean`, `oneSvgPerLine: boolean`, `wrap: object`, …
   * See the abcjs docs for the full list. Values here override the
   * editor's built-in defaults except for selection/click handling.
   */
  abcjsOptions?: AbcVisualParams;
}

export class AbcEditor {
  private container: HTMLElement;
  private doc: AbcDocument;
  private score: ScoreView;
  private panel: PropertyPanel;
  private toolbar: Toolbar;
  private raw: RawView | null = null;
  private rawHost: HTMLElement | null = null;
  private rawVisible = false;
  private rawVisibilityListeners: (() => void)[] = [];
  private currentSelection: Selection | null = null;
  /** abcjs CSS classes for the currently selected SVG group (when known).
   *  Cached so we can re-highlight the same element after a re-render
   *  triggered by a property edit — without this, the score-view's
   *  positional fallback (`abcjs-n<startChar>`) does not match because
   *  abcjs assigns `abcjs-n<noteIndexInMeasure>`, not character offsets. */
  private currentClasses: string | null = null;
  private changeDebounce: ReturnType<typeof setTimeout> | null = null;
  private keydownHandler: ((ev: KeyboardEvent) => void) | null = null;
  private player: MidiPlayer;
  private playbackListeners: (() => void)[] = [];
  private selectionListeners: (() => void)[] = [];
  private rawSelectEnabled = true;
  private pendingFocusAfterRender = false;
  private strings: Strings;

  constructor(container: HTMLElement, opts: AbcEditorOptions = {}) {
    this.container = container;
    this.container.classList.add("abc-gui-root");
    if (this.container.tabIndex < 0) this.container.tabIndex = 0;
    this.container.innerHTML = "";

    this.strings = resolveStrings(opts.locale);
    this.applyTheme(opts.theme ?? "light");

    this.doc = new AbcDocument(opts.value ?? "");

    const toolbarHost = el("div", { class: "abc-gui-toolbar-host" });
    const body = el("div", { class: "abc-gui-body" });
    const scoreHost = el("div", { class: "abc-gui-score-host" });
    const panelHost = el("div", { class: "abc-gui-panel-host" });
    const rawHost = el("div", { class: "abc-gui-raw-host" });
    this.rawHost = rawHost;

    body.append(scoreHost, panelHost);
    // Raw pane sits below the body so it can span the full container width
    // instead of being squeezed into the side column. It is always inserted
    // in the DOM so the user can toggle it on/off via the toolbar, but
    // `hidden` removes it from layout completely when not visible.
    // contentHost fills the space below the toolbar and scrolls in narrow
    // mode so the toolbar is always visible.
    const contentHost = el("div", { class: "abc-gui-content-host" });
    contentHost.append(body, rawHost);
    this.container.append(toolbarHost, contentHost);
    this.rawVisible = !opts.hideRawView;
    rawHost.hidden = !this.rawVisible;
    this.updateRawLayoutState();

    this.score = new ScoreView(scoreHost, this.doc, opts.abcjsOptions ?? {});
    this.panel = new PropertyPanel(
      panelHost,
      this.doc,
      this.strings,
      opts.chordEditor ?? null,
      opts.chordVerifier ?? null
    );
    this.panel.setGermanAlphabet(!!opts.abcjsOptions?.germanAlphabet);
    this.player = new MidiPlayer();
    // Any re-render invalidates the primed synth buffer so playback always
    // reflects the latest ABC source.
    this.score.onRender(() => {
      this.player.invalidate();
      this.firePlaybackChange();
      if (this.pendingFocusAfterRender) {
        this.pendingFocusAfterRender = false;
        this.focusEditor(false);
      }
    });
    if (!opts.hideRawView) {
      this.raw = new RawView(rawHost, this.doc);
      // Clicking / moving caret in the raw textarea selects the enclosing
      // ABC element (music note/bar/rest) or the header line it sits on.
      this.raw.onCaret((start, end) => this.handleRawCaret(start, end));
    }
    this.toolbar = new Toolbar(toolbarHost, {
      doc: this.doc,
      getSelection: () => this.currentSelection,
      setSelection: (s) => this.select(s),
      getRawSelectEnabled: () => this.rawSelectEnabled,
      setRawSelectEnabled: (v) => {
        this.rawSelectEnabled = v;
      },
      isRawVisible: () => this.rawVisible,
      toggleRawVisible: () => this.toggleRawVisible(),
      onRawVisibilityChange: (cb) => this.rawVisibilityListeners.push(cb),
      playSupported: MidiPlayer.isSupported(),
      isPlaying: () => this.player.isPlaying(),
      play: () => this.handlePlay(),
      stop: () => this.handleStop(),
      onPlaybackStateChange: (cb) => this.playbackListeners.push(cb),
      onSelectionChange: (cb) => this.selectionListeners.push(cb),
      strings: this.strings
    });

    this.score.onSelect((ev) => this.handleScoreClick(ev));

    // After any mutation, map our cached selection forward and refresh panel.
    this.doc.on((ev) => {
      if (this.currentSelection) {
        this.currentSelection = remapRange(this.currentSelection, ev);
        if (this.currentSelection === null) {
          // Edit destroyed the original anchor (e.g. setValue / undo of a
          // surrounding replacement) — drop cached classes too.
          this.currentClasses = null;
        }
        // Re-apply the SVG selection using the cached classes so the
        // highlight stays visible after a property-panel-driven edit
        // re-renders the score.
        this.score.setSelected(this.currentSelection, this.currentClasses);
        this.panel.setSelection(this.currentSelection, {
          preserveChordTab: true
        });
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

    // Keyboard shortcuts: navigation + editing actions while focus is inside
    // the editor (except text inputs/selects/textarea where typing should win).
    this.keydownHandler = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        this.focusEditor();
        return;
      }

      if (this.isEditableTarget(ev.target)) return;

      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && (ev.key === "z" || ev.key === "Z")) {
        ev.preventDefault();
        this.focusEditor();
        if (ev.shiftKey) this.doc.redo();
        else this.doc.undo();
        return;
      }
      if (mod && (ev.key === "y" || ev.key === "Y")) {
        ev.preventDefault();
        this.focusEditor();
        this.doc.redo();
        return;
      }
      if (mod && ev.key === "Home") {
        ev.preventDefault();
        this.focusEditor();
        this.selectFirstElement();
        return;
      }
      if (mod && ev.key === "End") {
        ev.preventDefault();
        this.focusEditor();
        this.selectLastElement();
        return;
      }
      if (mod) return;

      if (ev.key === "Tab") {
        ev.preventDefault();
        this.focusEditor();
        this.moveSelectionBy(ev.shiftKey ? -1 : 1);
        return;
      }

      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        this.focusEditor();
        if (ev.shiftKey) this.panel.stepLength(1); // longer
        else this.moveSelectionBy(-1);
        return;
      }
      if (ev.key === "ArrowRight") {
        ev.preventDefault();
        this.focusEditor();
        if (ev.shiftKey) this.panel.stepLength(-1); // shorter
        else this.moveSelectionBy(1);
        return;
      }
      if (ev.key === "Home") {
        ev.preventDefault();
        this.focusEditor();
        this.selectLineBoundaryElement("first");
        return;
      }
      if (ev.key === "End") {
        ev.preventDefault();
        this.focusEditor();
        this.selectLineBoundaryElement("last");
        return;
      }
      if (ev.key === "Delete") {
        ev.preventDefault();
        this.focusEditor();
        this.deleteCurrentElement("next");
        return;
      }
      if (ev.key === "Backspace") {
        ev.preventDefault();
        this.focusEditor();
        this.deleteCurrentElement("prev");
        return;
      }

      if (
        ev.key === "ArrowUp" ||
        ev.key === "ArrowDown" ||
        ev.key === "PageUp" ||
        ev.key === "PageDown"
      ) {
        if (this.panel.handleShortcut(ev.key, { shiftKey: ev.shiftKey })) {
          ev.preventDefault();
          this.focusEditor();
        }
        return;
      }

      if (this.panel.handleShortcut(ev.key, { shiftKey: ev.shiftKey })) {
        ev.preventDefault();
        // '+' opens a new attached-text input; keep focus on that field.
        if (ev.key === "+" || ev.key === "Add") {
          this.pendingFocusAfterRender = false;
        } else {
          this.focusEditor();
        }
        return;
      }
      if (this.toolbar.handleShortcut(ev.key, ev.shiftKey)) {
        ev.preventDefault();
        this.focusEditor();
        return;
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
    this.currentClasses = null;
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
    this.container.classList.remove("abc-gui-dark");
    this.container.classList.remove("abc-gui-raw-hidden");
  }

  /** Switch UI language. Accepts a built-in locale id or full Strings. */
  setLocale(locale: LocaleId | Strings): void {
    this.strings = resolveStrings(locale);
    this.toolbar.setStrings(this.strings);
    this.panel.setStrings(this.strings);
  }

  /** Switch visual theme. */
  setTheme(theme: "light" | "dark"): void {
    this.applyTheme(theme);
  }

  /**
   * Replace the extra abcjs render parameters (e.g. `germanAlphabet`,
   * `jazzchords`, `visualTranspose`, `scale`, `staffwidth`, `format`, …).
   * Triggers a re-render.
   */
  setAbcjsOptions(params: AbcVisualParams): void {
    this.score.setAbcjsOptions(params);
    this.panel.setGermanAlphabet(!!params.germanAlphabet);
  }

  /**
   * Return a short HTML usage tutorial in the currently active locale.
   * The returned markup is self-contained and suitable for dropping into
   * a splash-screen or help dialog (no external styles required).
   */
  getTutorialHtml(): string {
    return this.strings.tutorial;
  }

  private applyTheme(theme: "light" | "dark"): void {
    this.container.classList.toggle("abc-gui-dark", theme === "dark");
  }

  /** Show/hide the raw-text pane. Constructs/destroys the RawView lazily. */
  private toggleRawVisible(): void {
    this.rawVisible = !this.rawVisible;
    if (this.rawHost) this.rawHost.hidden = !this.rawVisible;
    if (this.rawVisible && !this.raw && this.rawHost) {
      this.raw = new RawView(this.rawHost, this.doc);
      this.raw.onCaret((start, end) => this.handleRawCaret(start, end));
      if (this.currentSelection) {
        this.raw.highlightRange(
          this.currentSelection.startChar,
          this.currentSelection.endChar
        );
      }
    }
    this.updateRawLayoutState();
    for (const l of [...this.rawVisibilityListeners]) l();
  }

  /** Keep layout classes in sync with raw-pane visibility. */
  private updateRawLayoutState(): void {
    this.container.classList.toggle("abc-gui-raw-hidden", !this.rawVisible);
  }

  // Internal -----------------------------------------------------

  private handleScoreClick(ev: SelectionEvent): void {
    this.container.focus();
    // abcjs reports clef / key-signature / time-signature / tempo /
    // metadata clicks with a range that sits inside (or equals) the
    // underlying `K:` / `M:` / `Q:` / `[K:...]` source. The raw range by
    // itself doesn't match any editor in the property panel, so snap
    // selections that land inside a header line or inline field up to the
    // whole field. This keeps notes / bars / rests unchanged because they
    // live in music-body lines where `infoLineAt` returns null.
    let { startChar, endChar } = this.resolveClickRange(ev);
    const semanticName = [
      ev.analysis?.name,
      ev.analysis?.clickedName,
      ev.classes,
      this.asObj(ev.abcelem)?.el_type,
      this.asObj(ev.abcelem)?.type
    ]
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .join(" ")
      .toLowerCase();

    // Slur/tie curves (drawn arcs) are visual binding marks, not editable
    // standalone elements. Parenthesis/tie state is edited from the bound
    // note/chord/rest in the property panel, so arc-only clicks should not
    // change selection. abcjs still paints its own `_selected` marker on
    // the clicked arc element, so clear it explicitly — otherwise the arc
    // keeps a leftover red highlight next to our actually-selected note.
    if (this.isBindingArcClick(semanticName)) {
      this.score.clearNativeSelection();
      return;
    }

    // abcjs exposes staff-level symbols (clef, key signature, time
    // signature, tempo) via click-analysis names like `staff-extra clef`.
    // Those symbols are editable through their owning source field, so map
    // them back onto the nearest relevant info line before falling back to
    // the raw click range.
    const fallbackOffset = startChar >= 0 ? startChar : this.doc.value.length;
    if (
      semanticName.includes("clef") ||
      semanticName.includes("staff-extra clef") ||
      semanticName.includes("staff-extra key-signature") ||
      semanticName.includes("key-signature")
    ) {
      const keyInfo = this.doc.findInfoLineByName("K", fallbackOffset);
      if (keyInfo) {
        this.select(keyInfo, ev.classes);
        return;
      }
    }
    if (
      semanticName.includes("staff-extra time-signature") ||
      semanticName.includes("time-signature") ||
      semanticName.includes("meter")
    ) {
      const meterInfo = this.doc.findInfoLineByName("M", fallbackOffset);
      if (meterInfo) {
        this.select(meterInfo, ev.classes);
        return;
      }
    }
    if (semanticName.includes("tempo")) {
      const tempoInfo = this.doc.findInfoLineByName("Q", fallbackOffset);
      if (tempoInfo) {
        this.select(tempoInfo, ev.classes);
        return;
      }
    }

    // Guard: some abcelem types report no usable source range. After the
    // semantic fallbacks above, treat those clicks as unlocated.
    if (startChar < 0 || endChar < 0 || endChar < startChar) {
      this.select(null, ev.classes);
      return;
    }

    const inline = this.doc.inlineFieldAt(startChar);
    if (
      inline &&
      startChar >= inline.startChar &&
      endChar <= inline.endChar
    ) {
      startChar = inline.startChar;
      endChar = inline.endChar;
    } else {
      const info = this.doc.infoLineAt(startChar);
      if (info && startChar >= info.startChar && endChar <= info.endChar) {
        startChar = info.startChar;
        endChar = info.endChar;
      }
    }

    this.select({ startChar, endChar }, ev.classes);
  }

  private isBindingArcClick(semanticName: string): boolean {
    return /(\babcjs-(slur|tie)\b|\b(slur|tie|arc|phrase)\b)/.test(semanticName);
  }

  private resolveClickRange(ev: SelectionEvent): { startChar: number; endChar: number } {
    let startChar = ev.startChar;
    let endChar = ev.endChar;
    if (startChar >= 0 && endChar >= startChar) {
      return { startChar, endChar };
    }

    const raw = this.asObj(ev.abcelem);
    const s = this.firstFinite(raw?.startChar, raw?.startCharArray);
    const e = this.firstFinite(raw?.endChar, raw?.endCharArray);
    if (s !== null && e !== null && e >= s) {
      startChar = s;
      endChar = e;
    }
    return { startChar, endChar };
  }

  private asObj(v: unknown): Record<string, unknown> | null {
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  }

  private firstFinite(
    scalar: unknown,
    list: unknown
  ): number | null {
    if (typeof scalar === "number" && Number.isFinite(scalar)) return scalar;
    if (Array.isArray(list)) {
      for (const item of list) {
        if (typeof item === "number" && Number.isFinite(item)) return item;
      }
    }
    return null;
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
    this.currentClasses = sel ? classes : null;
    this.score.setSelected(sel, classes);
    this.panel.setSelection(sel);
    if (this.raw && sel) {
      this.raw.highlightRange(sel.startChar, sel.endChar);
    }
    for (const l of [...this.selectionListeners]) l();
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return !!target.closest("input, textarea, select, [contenteditable='true']");
  }

  private focusEditor(scheduleAfterRender = true): void {
    if (scheduleAfterRender) this.pendingFocusAfterRender = true;
    const svg = this.container.querySelector(".abc-gui-score svg") as SVGElement | null;
    if (svg) {
      if (!svg.hasAttribute("tabindex")) svg.setAttribute("tabindex", "-1");
      const focusFn = (svg as unknown as { focus?: (opts?: FocusOptions) => void }).focus;
      if (typeof focusFn === "function") {
        try {
          focusFn.call(svg, { preventScroll: true });
        } catch {
          focusFn.call(svg);
        }
        return;
      }
    }
    try {
      this.container.focus({ preventScroll: true });
    } catch {
      this.container.focus();
    }
  }

  private allElementRanges(): Selection[] {
    const out: Selection[] = [];
    const seen = new Set<string>();
    this.doc.forEachElement((el) => {
      const key = `${el.startChar}:${el.endChar}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ startChar: el.startChar, endChar: el.endChar });
    });
    out.sort((a, b) =>
      a.startChar === b.startChar
        ? a.endChar - b.endChar
        : a.startChar - b.startChar
    );
    return out;
  }

  private moveSelectionBy(step: -1 | 1): void {
    const ranges = this.allElementRanges();
    if (ranges.length === 0) return;

    if (!this.currentSelection) {
      this.select(step > 0 ? ranges[0]! : ranges[ranges.length - 1]!);
      return;
    }

    const curStart = this.currentSelection.startChar;
    const curEnd = this.currentSelection.endChar;
    const idx = ranges.findIndex(
      (r) => r.startChar === curStart && r.endChar === curEnd
    );
    if (idx >= 0) {
      const nextIdx = Math.max(0, Math.min(ranges.length - 1, idx + step));
      this.select(ranges[nextIdx]!);
      return;
    }

    if (step > 0) {
      const next = ranges.find((r) => r.startChar >= curEnd) ?? ranges[ranges.length - 1]!;
      this.select(next);
    } else {
      const prevCandidates = ranges.filter((r) => r.endChar <= curStart);
      this.select(prevCandidates[prevCandidates.length - 1] ?? ranges[0]!);
    }
  }

  private selectFirstElement(): void {
    const ranges = this.allElementRanges();
    if (ranges.length === 0) return;
    this.select(ranges[0]!);
  }

  private selectLastElement(): void {
    const ranges = this.allElementRanges();
    if (ranges.length === 0) return;
    this.select(ranges[ranges.length - 1]!);
  }

  private selectLineBoundaryElement(which: "first" | "last"): void {
    const ranges = this.allElementRanges();
    if (ranges.length === 0) return;

    const anchor = this.currentSelection?.startChar ?? 0;
    const src = this.doc.value;
    const lineStart = src.lastIndexOf("\n", Math.max(0, anchor - 1)) + 1;
    const nl = src.indexOf("\n", anchor);
    const lineEnd = nl >= 0 ? nl : src.length;

    const inLine = ranges.filter(
      (r) => r.startChar >= lineStart && r.startChar < lineEnd
    );
    if (inLine.length === 0) return;
    this.select(which === "first" ? inLine[0]! : inLine[inLine.length - 1]!);
  }

  private deleteCurrentElement(direction: "next" | "prev"): void {
    if (!this.currentSelection) return;

    const ranges = this.allElementRanges();
    if (ranges.length === 0) return;

    const selStart = Math.min(
      this.currentSelection.startChar,
      this.currentSelection.endChar
    );
    const selEnd = Math.max(
      this.currentSelection.startChar,
      this.currentSelection.endChar
    );

    let idx = ranges.findIndex(
      (r) => r.startChar === selStart && r.endChar === selEnd
    );
    if (idx < 0) {
      idx = ranges.findIndex((r) => r.startChar < selEnd && r.endChar > selStart);
    }
    if (idx < 0) return;

    const target = ranges[idx]!;
    const removedLen = target.endChar - target.startChar;
    let nextSel: Selection | null = null;

    if (direction === "next") {
      const rawNext = ranges[idx + 1] ?? null;
      if (rawNext) {
        nextSel = {
          startChar: rawNext.startChar - removedLen,
          endChar: rawNext.endChar - removedLen
        };
      }
    } else {
      const rawPrev = ranges[idx - 1] ?? null;
      if (rawPrev) {
        nextSel = { startChar: rawPrev.startChar, endChar: rawPrev.endChar };
      }
    }

    this.doc.replace(target.startChar, target.endChar, "");
    this.select(nextSel);
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

  // Edit fully contained inside the selection (e.g. adding a decoration
  // to a note's prefix while the whole note is selected): keep the
  // selection anchored and shift only its end by the size delta. This
  // keeps the score / raw / panel views in sync on the newly-modified
  // element instead of clipping the highlight to just the inserted text.
  const exactMatch = start === sel.startChar && end === sel.endChar;
  if (
    !exactMatch &&
    start >= sel.startChar &&
    end <= sel.endChar
  ) {
    return { startChar: sel.startChar, endChar: sel.endChar + delta };
  }

  // Whole-document / surrounding replacement (setValue, undo, redo) —
  // when the edit strictly covers the selection on at least one side AND
  // isn't an exact-match surgical edit, the original anchor is gone:
  // drop the selection.
  if (!exactMatch && start <= sel.startChar && end >= sel.endChar) {
    return null;
  }

  // Partial overlap: anchor on the newly-inserted text (that is the element
  // that was just edited via the property panel).
  return { startChar: start, endChar: start + ev.inserted.length };
}
