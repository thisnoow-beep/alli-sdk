// @vitest-environment jsdom
/* error-panel 원문 표시 — JSON일 때만 하이라이트, HTML/평문은 그대로 (원문 보기 의미 보존) */
import { describe, expect, it } from 'vitest';
import { errorPanel } from './error-panel';
import { AlliApiError } from '../core/errors';

describe('errorPanel — rawBody 하이라이팅 분기', () => {
  it('유효 JSON rawBody는 json 하이라이트된다', () => {
    const e = new AlliApiError('HTTP 400', {
      httpStatus: 400,
      code: 7000,
      shape: 'standard',
      rawBody: '{"type":"APIError","code":7000,"message":"bad key"}',
    });
    const panel = errorPanel(e, undefined, { rawOpen: true });
    const pre = panel.querySelector('pre.code-block')!;
    expect(pre).not.toBeNull();
    expect(pre.querySelector('.hljs-attr')).not.toBeNull();
    expect((pre as HTMLElement).style.display).not.toBe('none');
  });

  it('비JSON rawBody(HTML 등)는 span 없는 평문 textNode 유지', () => {
    const rawBody = '<html><body>502 Bad Gateway</body></html>';
    const e = new AlliApiError('HTTP 502', { httpStatus: 502, shape: 'non-json', rawBody });
    const panel = errorPanel(e, undefined, { rawOpen: true });
    const pre = panel.querySelector('pre.code-block')!;
    expect(pre.querySelectorAll('span').length).toBe(0);
    expect(pre.textContent).toBe(rawBody);
    expect(panel.querySelector('pre.code-block body')).toBeNull();
  });

  it('rawOpen 미지정이면 원문은 접힌 상태로 시작한다', () => {
    const e = new AlliApiError('HTTP 400', { httpStatus: 400, shape: 'standard', rawBody: '{"code":7000}' });
    const panel = errorPanel(e);
    const pre = panel.querySelector('pre.code-block') as HTMLElement;
    expect(pre.style.display).toBe('none');
  });
});
