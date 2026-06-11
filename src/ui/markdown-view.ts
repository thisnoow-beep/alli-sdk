/* 마크다운 렌더 — marked + DOMPurify.
   GA 답변 등 원격 콘텐츠가 들어오므로 새니타이즈는 비협상. 앱에서 innerHTML을 쓰는 유일한 경로. */
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { el } from '../lib/dom';
import { badge } from './widgets';

marked.use({ gfm: true, breaks: true });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function markdownView(md: string, opts: { draftJsBadge?: boolean } = {}): HTMLElement {
  const html = marked.parse(md, { async: false });
  const view = el('div', { class: 'md-view' });
  view.innerHTML = DOMPurify.sanitize(html);
  if (opts.draftJsBadge) {
    return el(
      'div',
      { class: 'stack' },
      el('div', {}, badge('DraftJS 원문 — Raw 뷰 참조', 'warn')),
      view,
    );
  }
  return view;
}
