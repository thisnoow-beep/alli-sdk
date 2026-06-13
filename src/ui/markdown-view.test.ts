// @vitest-environment jsdom
/* markdown-view 코드 펜스 하이라이팅 — 원격 콘텐츠(GA 답변) 경로라 이스케이프 단언이 핵심 */
import { describe, expect, it } from 'vitest';
import { markdownView } from './markdown-view';

describe('markdownView — 코드 펜스', () => {
  it('등록 언어 펜스(js)는 code.hljs + 토큰 span으로 렌더된다', () => {
    const view = markdownView('```js\nconst x = 1;\n```');
    const code = view.querySelector('pre code.hljs');
    expect(code).not.toBeNull();
    expect(code!.classList.contains('language-js')).toBe(true);
    expect(code!.querySelector('.hljs-keyword')).not.toBeNull();
  });

  it('미등록 언어 펜스(ruby)는 span 없는 이스케이프 평문', () => {
    const view = markdownView('```ruby\nputs :hello\n```');
    const code = view.querySelector('pre code.hljs');
    expect(code).not.toBeNull();
    expect(code!.querySelectorAll('span').length).toBe(0);
    expect(code!.textContent).toContain('puts :hello');
  });

  it('언어 미지정 펜스도 평문으로 안전 렌더', () => {
    const view = markdownView('```\nplain text\n```');
    const code = view.querySelector('pre code.hljs');
    expect(code).not.toBeNull();
    expect(code!.textContent).toContain('plain text');
  });

  it('펜스 내부 <script>는 요소로 승격되지 않고 텍스트 보존', () => {
    const view = markdownView('```js\n<script>alert(1)</script>\n```');
    expect(view.querySelector('script')).toBeNull();
    expect(view.textContent).toContain('<script>alert(1)</script>');
  });

  it('펜스 밖 마크다운(링크 훅 포함)은 기존대로 동작한다', () => {
    const view = markdownView('[a](https://example.com)');
    const a = view.querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
