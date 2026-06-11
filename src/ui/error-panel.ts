/* 에러 해설 패널 — 전 화면 공통 (SSOT §3.3 + §9 힌트). */
import { el } from '../lib/dom';
import { AlliApiError, explainError, type ErrorContext } from '../core/errors';
import { badge, button } from './widgets';

export function errorPanel(e: unknown, ctx?: ErrorContext): HTMLElement {
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
    const raw = el('pre', { class: 'code-block code-block--wrap', style: 'display:none;' }, api.rawBody);
    const toggle = button('원문 보기', {
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
