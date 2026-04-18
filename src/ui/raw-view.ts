/**
 * Raw ABC text view — read/write textarea bound to the document. Typing
 * here updates the model (which re-renders the score). Structured edits
 * made elsewhere update the textarea in place.
 *
 * Also acts as a secondary selection surface: moving the caret or
 * selecting a range inside the textarea notifies the editor so the
 * corresponding element can be highlighted in the score / property panel.
 */

import { AbcDocument } from "../model/document.js";
import { el } from "./dom.js";

export type RawCaretListener = (offset: number, selectionEnd: number) => void;

export class RawView {
  private host: HTMLElement;
  private doc: AbcDocument;
  private textarea: HTMLTextAreaElement;
  private suppress = false;
  private caretListeners: RawCaretListener[] = [];

  constructor(host: HTMLElement, doc: AbcDocument) {
    this.host = host;
    this.doc = doc;
    this.host.classList.add("abc-gui-raw-view");
    this.textarea = el("textarea", {
      class: "abc-gui-raw-view-textarea",
      spellcheck: false
    }) as HTMLTextAreaElement;
    this.textarea.value = doc.value;
    this.textarea.addEventListener("input", () => {
      if (this.suppress) return;
      this.suppress = true;
      this.doc.setValue(this.textarea.value);
      this.suppress = false;
    });
    this.doc.on(() => {
      if (this.suppress) return;
      if (this.textarea.value !== this.doc.value) {
        // Preserve caret as best we can across external edits.
        const savedStart = this.textarea.selectionStart;
        const savedEnd = this.textarea.selectionEnd;
        this.textarea.value = this.doc.value;
        const clamp = (n: number) => Math.min(n, this.textarea.value.length);
        try {
          this.textarea.setSelectionRange(clamp(savedStart), clamp(savedEnd));
        } catch {
          /* ignore */
        }
      }
    });
    const emitCaret = () => {
      const s = this.textarea.selectionStart;
      const e = this.textarea.selectionEnd;
      for (const l of [...this.caretListeners]) l(s, e);
    };
    this.textarea.addEventListener("click", emitCaret);
    this.textarea.addEventListener("keyup", (ev) => {
      // Only forward caret-moving keys to avoid selection churn while typing.
      if (
        ev.key === "ArrowLeft" ||
        ev.key === "ArrowRight" ||
        ev.key === "ArrowUp" ||
        ev.key === "ArrowDown" ||
        ev.key === "Home" ||
        ev.key === "End" ||
        ev.key === "PageUp" ||
        ev.key === "PageDown"
      ) {
        emitCaret();
      }
    });
    this.host.append(this.textarea);
  }

  /** Notified when the user moves the caret or makes a selection in the raw
   *  textarea. */
  onCaret(cb: RawCaretListener): void {
    this.caretListeners.push(cb);
  }

  /** Programmatically highlight a character range in the textarea. Does not
   *  steal focus. */
  highlightRange(start: number, end: number): void {
    if (
      this.textarea.selectionStart === start &&
      this.textarea.selectionEnd === end
    ) {
      return;
    }
    try {
      this.textarea.setSelectionRange(start, end);
    } catch {
      /* ignore */
    }
  }
}
