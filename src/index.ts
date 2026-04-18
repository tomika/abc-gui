/**
 * Public entry point for the `abc-gui` package.
 */

export { AbcEditor } from "./ui/editor.js";
export type { AbcEditorOptions } from "./ui/editor.js";
export { AbcDocument } from "./model/document.js";
export { en, hu, LOCALES, resolveStrings } from "./i18n.js";
export type { LocaleId, Strings } from "./i18n.js";

import { AbcEditor, AbcEditorOptions } from "./ui/editor.js";

/**
 * Mount the editor into a DOM element. Returns the editor instance, which
 * exposes `getValue`, `setValue`, and `destroy`.
 */
export function mount(
  container: HTMLElement,
  options: AbcEditorOptions = {}
): AbcEditor {
  return new AbcEditor(container, options);
}
