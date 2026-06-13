/* 에러 해설 패널 — 전 화면 공통 (SSOT §3.3 + §9 힌트). */
import { el } from '../lib/dom';
import { AlliApiError, explainError, type ErrorContext } from '../core/errors';
import { codeBlock } from './code-block';
import { badge, button } from './widgets';

export interface ErrorPanelOptions {
  /** true면 응답 원문을 접지 않고 처음부터 펼쳐서 보여준다 */
  rawOpen?: boolean;
}

export function errorPanel(e: unknown, ctx?: ErrorContext, opts?: ErrorPanelOptions): HTMLElement {
  const exp = explainError(e, ctx);
  const api = e instanceof AlliApiError ? e : null;

  const badges = el('div', { class: 'row' });
  if (api) {
    if (api.httpStatus > 0) badges.appendChild(badge(`HTTP ${api.httpStatus}`, 'warn'));
    if (api.code !== undefined) badges.appendChild(badge(`code ${api.code}`, 'warn'));
    badges.appendChild(badge(api.shape, 'default'));
  }

  const hints = el(
    'ul',
    { class: 't-body-sm', style: 'padding-left: 20px; display: grid; gap: 6px;' },
    ...exp.hintsKo.map((h) => el('li', {}, h)),
  );

  const panel = el(
    'div',
    { class: 'banner banner--warn', role: 'alert' },
    el(
      'div',
      { class: 'stack', style: 'gap: 12px;' },
      el('div', { class: 't-title-sm warn-text' }, exp.titleKo),
      badges,
      exp.hintsKo.length ? hints : null,
    ),
  );

  if (api?.rawBody) {
    const open = opts?.rawOpen === true;
    // 원문이 유효 JSON일 때만 하이라이트 — HTML/평문(프록시 502 등)은 기존 textNode 유지
    let raw: HTMLElement;
    try {
      JSON.parse(api.rawBody);
      raw = codeBlock(api.rawBody, 'json', { wrap: true });
    } catch {
      raw = el('pre', { class: 'code-block code-block--wrap' }, api.rawBody);
    }
    if (!open) raw.style.display = 'none';
    const toggle = button(open ? '원문 닫기' : '원문 보기', {
      small: true,
      variant: 'quiet',
      onClick: () => {
        const hidden = raw.style.display === 'none';
        raw.style.display = hidden ? 'block' : 'none';
        toggle.textContent = hidden ? '원문 닫기' : '원문 보기';
      },
    });
    panel.appendChild(el('div', {}, toggle));
    panel.appendChild(raw);
  }

  return panel;
}
