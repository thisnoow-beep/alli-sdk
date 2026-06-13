/* 최소 DOM 헬퍼 — 문자열 자식은 항상 textNode로 추가 (XSS 방어 기본자세).
   innerHTML은 ui/markdown-view와 ui/code-block(둘 다 DOMPurify 새니타이즈 후)에서만 사용한다.
   새 innerHTML 경로를 추가하지 말 것 — 코드 하이라이팅은 codeBlock()을 경유한다. */

export type Child = Node | string | number | null | undefined | false | Child[];

export type Attrs = Record<string, unknown> & { class?: string };

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') {
        node.className = String(v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'value' && 'value' in node) {
        (node as unknown as { value: string }).value = String(v);
      } else if (k === 'checked' && node instanceof HTMLInputElement) {
        node.checked = Boolean(v);
      } else if (v === true) {
        node.setAttribute(k, '');
      } else {
        node.setAttribute(k, String(v));
      }
    }
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) {
      append(parent, c);
    } else if (typeof c === 'string' || typeof c === 'number') {
      parent.appendChild(document.createTextNode(String(c)));
    } else {
      parent.appendChild(c);
    }
  }
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function frag(...children: Child[]): DocumentFragment {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}
