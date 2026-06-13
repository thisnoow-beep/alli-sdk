/* 코드 하이라이팅 — highlight.js core + 필요 언어 6종만 등록.
   루트 임포트(highlight.js 전체)는 전 언어 번들(~1MB)이라 금지, highlightAuto도 금지.
   innerHTML 경로지만 hljs 자체 이스케이프 + DOMPurify strict 프로파일 이중 방어 (lib/dom.ts 정책). */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import powershell from 'highlight.js/lib/languages/powershell';
import xml from 'highlight.js/lib/languages/xml';
import DOMPurify from 'dompurify';
import { el } from '../lib/dom';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('xml', xml);

export type CodeLanguage = 'bash' | 'javascript' | 'python' | 'json' | 'powershell' | 'xml';

/** 등록된 언어(별칭 포함 — js/sh/html 등)인지. 마크다운 펜스의 임의 언어명 판별용. */
export function isRegisteredLanguage(language: string): boolean {
  return Boolean(hljs.getLanguage(language));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** 코드 → 하이라이트된 HTML 문자열 (DOM 불요 — markdown-view renderer에서도 재사용).
    미등록/미지정 언어는 이스케이프된 평문 폴백 — 출력은 항상 HTML 문자열로 균일하다. */
export function highlightToHtml(code: string, language?: string): string {
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language }).value;
  }
  return escapeHtml(code);
}

/** pre.code-block > code.hljs 하이라이트 블록 — 기존 평문 pre.code-block의 대체재.
    strict 프로파일(span+class만)은 "hljs 출력은 span뿐"이라는 계약의 코드화.
    markdown-view가 등록한 전역 A 태그 훅이 이 sanitize에도 실행되지만 hljs 출력엔 <a>가 없어 무해. */
export function codeBlock(code: string, language?: string, opts?: { wrap?: boolean }): HTMLElement {
  const codeEl = el('code', { class: `hljs${language ? ` language-${language}` : ''}` });
  codeEl.innerHTML = DOMPurify.sanitize(highlightToHtml(code, language), {
    ALLOWED_TAGS: ['span'],
    ALLOWED_ATTR: ['class'],
  });
  return el('pre', { class: `code-block${opts?.wrap ? ' code-block--wrap' : ''}` }, codeEl);
}
