/* 마크다운 렌더 — marked + DOMPurify.
   GA 답변 등 원격 콘텐츠가 들어오므로 새니타이즈는 비협상. 앱에서 innerHTML을 쓰는 유일한 경로. */
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { el } from '../lib/dom';
import { highlightToHtml, isRegisteredLanguage } from './code-block';
import { badge } from './widgets';

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    // marked v13+ 토큰 객체 시그니처 — 구식 (code, infostring, escaped) 3-인자 아님.
    // 등록 언어만 하이라이트, 미등록·미지정은 이스케이프 평문 (highlightToHtml 폴백).
    // lang은 원격 콘텐츠라 등록 확인된 것만 class에 넣는다 — 출력 전체는 아래 sanitize 통과.
    code(token) {
      const lang = token.lang?.split(/\s+/)[0];
      const known = lang !== undefined && lang !== '' && isRegisteredLanguage(lang);
      const cls = known ? ` language-${lang}` : '';
      return `<pre><code class="hljs${cls}">${highlightToHtml(token.text, known ? lang : undefined)}</code></pre>\n`;
    },
  },
});

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
