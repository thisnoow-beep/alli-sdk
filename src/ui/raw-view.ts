/* Raw 요청/응답 뷰 — 전 화면 공통.
   API-KEY 값은 마스킹하고, 응답 원문 복사 버튼은 Gate G1(실 응답 캡처 → SSOT §9 갱신)의 핵심 도구다. */
import { el } from '../lib/dom';
import { copyButton, maskKey } from './widgets';

export interface RawRequestInfo {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** 표시용 본문 — JSON pretty 또는 multipart 파트 요약 */
  body?: string;
}

export interface RawData {
  request: RawRequestInfo;
  status?: number;
  elapsedMs?: number;
  /** sync 응답 원문 */
  responseText?: string;
  /** stream일 때 청크 구분자가 포함된 트랜스크립트 */
  streamTranscript?: string;
}

function headerLines(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${k.toUpperCase() === 'API-KEY' ? maskKey(v) : v}`)
    .join('\n');
}

export function rawView(data: RawData): HTMLElement {
  const reqText = [
    `${data.request.method} ${data.request.url}`,
    headerLines(data.request.headers),
    ...(data.request.body ? ['', data.request.body] : []),
  ].join('\n');

  const respText = data.streamTranscript ?? data.responseText ?? '';
  const meta = [
    data.status !== undefined ? `HTTP ${data.status}` : null,
    data.elapsedMs !== undefined ? `${Math.round(data.elapsedMs)}ms` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return el(
    'div',
    { class: 'stack', style: 'gap: 16px;' },
    el(
      'div',
      { class: 'spread' },
      el('span', { class: 't-caption muted' }, '요청'),
      copyButton(() => reqText),
    ),
    el('pre', { class: 'code-block code-block--wrap' }, reqText),
    el(
      'div',
      { class: 'spread' },
      el('span', { class: 't-caption muted' }, `응답${meta ? ` · ${meta}` : ''}`),
      copyButton(() => respText, '응답 복사'),
    ),
    el('pre', { class: 'code-block code-block--wrap' }, respText || '(빈 본문)'),
  );
}
