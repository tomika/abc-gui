/**
 * Small DOM builder helpers. Keeps UI code terse without adding a framework.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Partial<HTMLElementTagNameMap[K]> & {
    class?: string;
    dataset?: Record<string, string>;
    title?: string;
  },
  children: Array<Node | string> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null) continue;
      if (k === "class") node.className = String(v);
      else if (k === "dataset") {
        for (const [dk, dv] of Object.entries(v as Record<string, string>)) {
          node.dataset[dk] = dv;
        }
      } else if (k === "style" && typeof v === "object") {
        Object.assign(node.style, v as object);
      } else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (node as any)[k] = v;
      }
    }
  }
  for (const c of children) {
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function button(
  glyph: string,
  title: string,
  onClick: (ev: MouseEvent) => void,
  opts: { active?: boolean; className?: string } = {}
): HTMLButtonElement {
  const b = el(
    "button",
    {
      type: "button",
      title,
      class: "abc-gui-btn" + (opts.className ? " " + opts.className : "") +
        (opts.active ? " active" : "")
    },
    [glyph]
  );
  b.addEventListener("click", (e) => {
    e.preventDefault();
    onClick(e);
  });
  return b;
}
