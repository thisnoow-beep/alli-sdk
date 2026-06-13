// @vitest-environment jsdom
/* codeBlock/highlightToHtml — 이스케이프 안전성(innerHTML 경로의 핵심 단언) + 언어별 토큰 생성 */
import { describe, expect, it } from 'vitest';
import { codeBlock, highlightToHtml, isRegisteredLanguage } from './code-block';

describe('highlightToHtml', () => {
  it('미지정 언어는 이스케이프된 평문을 반환한다', () => {
    expect(highlightToHtml('<b>&"\'</b>')).toBe('&lt;b&gt;&amp;&quot;&#x27;&lt;/b&gt;');
  });

  it('미등록 언어도 이스케이프 폴백 — span 없음', () => {
    const html = highlightToHtml('puts :hello', 'ruby');
    expect(html).toBe('puts :hello');
    expect(html).not.toContain('<span');
  });

  it('등록 언어는 hljs 토큰 span을 생성한다', () => {
    expect(highlightToHtml('const x = 1;', 'javascript')).toContain('hljs-keyword');
  });
});

describe('codeBlock — 이스케이프 안전성', () => {
  it('<script> 포함 코드가 요소로 승격되지 않고 텍스트로 보존된다', () => {
    const src = '<script>alert(1)</script>';
    const pre = codeBlock(src, 'javascript');
    expect(pre.querySelector('script')).toBeNull();
    expect(pre.textContent).toBe(src);
  });

  it('이벤트 핸들러 속성 포함 마크업도 텍스트로 보존된다', () => {
    const src = '<img src=x onerror=alert(1)>';
    const pre = codeBlock(src, 'xml');
    expect(pre.querySelector('img')).toBeNull();
    expect(pre.textContent).toBe(src);
  });

  it('미등록 언어는 span 없는 평문 + 텍스트 보존', () => {
    const src = 'puts "<b>hi</b>"';
    const pre = codeBlock(src, 'ruby');
    expect(pre.querySelectorAll('span').length).toBe(0);
    expect(pre.textContent).toBe(src);
  });
});

describe('codeBlock — 구조와 옵션', () => {
  it('pre.code-block > code.hljs.language-{x} 구조를 만든다', () => {
    const pre = codeBlock('echo hi', 'bash');
    expect(pre.tagName).toBe('PRE');
    expect(pre.className).toBe('code-block');
    const code = pre.firstElementChild as HTMLElement;
    expect(code.tagName).toBe('CODE');
    expect(code.classList.contains('hljs')).toBe(true);
    expect(code.classList.contains('language-bash')).toBe(true);
  });

  it('{ wrap: true }면 code-block--wrap 클래스가 붙는다', () => {
    expect(codeBlock('x', 'json', { wrap: true }).className).toBe('code-block code-block--wrap');
  });
});

describe('codeBlock — 등록 언어 6종 토큰 생성', () => {
  const cases: Array<[string, string, string]> = [
    ['bash', '# 주석\necho "hi"', '.hljs-comment'],
    ['javascript', 'const x = 1;', '.hljs-keyword'],
    ['python', 'def f():\n    return 1', '.hljs-keyword'],
    ['json', '{"a": 1}', '.hljs-attr'],
    ['powershell', '$env:FOO = "bar"', '.hljs-string'],
    ['xml', '<div class="a"></div>', '.hljs-name'],
  ];
  it.each(cases)('%s — 토큰 클래스 생성 + 텍스트 보존', (lang, src, sel) => {
    const pre = codeBlock(src, lang);
    expect(pre.querySelector(sel)).not.toBeNull();
    expect(pre.textContent).toBe(src);
  });

  it('별칭(js/sh/html)도 등록 언어로 해석된다', () => {
    expect(isRegisteredLanguage('js')).toBe(true);
    expect(isRegisteredLanguage('sh')).toBe(true);
    expect(isRegisteredLanguage('html')).toBe(true);
    expect(isRegisteredLanguage('ruby')).toBe(false);
  });
});
