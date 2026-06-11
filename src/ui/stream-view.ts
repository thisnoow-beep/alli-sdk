/* 스트림 뷰 — 실시간 청크 피드 + 추출 텍스트 + 중지(AbortController).
   텍스트 패널은 "누적형 스트림"(이전 텍스트를 포함해 점점 길어지는 GA 패턴)을 감지하면
   마지막 항목을 교체하고, 아니면 새 항목으로 추가한다 (§9-2 — 실제 프레이밍 미확정 대응). */
import { el, clear } from '../lib/dom';
import type { StreamEvent } from '../core/client';
import { extractStreamText } from '../core/extract';
import { banner, button, spinner } from './widgets';

export interface StreamViewHandle {
  el: HTMLElement;
  /** 스트리밍 시작 — 중지 버튼이 onAbort를 호출 */
  start(onAbort: () => void): void;
  push(ev: StreamEvent): void;
  finish(opts?: { aborted?: boolean; incomplete?: boolean }): void;
  reset(): void;
  /** raw 뷰용 트랜스크립트 (청크 구분자 포함) */
  transcript(): string;
}

export function streamView(): StreamViewHandle {
  let chunkNo = 0;
  let raw = '';
  let texts: string[] = [];
  let aborter: (() => void) | null = null;

  const textPane = el('div', { class: 'md-view', style: 'white-space: pre-wrap; word-break: break-word;' });
  const feed = el('pre', { class: 'code-block code-block--wrap', style: 'max-height: 240px;' });
  const statusRow = el('div', { class: 'row' });
  const noteSlot = el('div', {});

  const stopBtn = button('중지', {
    small: true,
    variant: 'warn',
    onClick: () => aborter?.(),
  });

  const root = el(
    'div',
    { class: 'stack', style: 'gap: 16px;' },
    statusRow,
    textPane,
    el('div', { class: 't-caption muted' }, '청크 피드'),
    feed,
    noteSlot,
  );

  function renderTexts(): void {
    textPane.textContent = texts.join('\n\n');
  }

  return {
    el: root,

    start(onAbort) {
      this.reset();
      aborter = onAbort;
      statusRow.append(spinner(), el('span', { class: 't-caption muted' }, '스트리밍 수신 중'), stopBtn);
    },

    push(ev) {
      if (ev.type === 'done') return;
      chunkNo += 1;
      const label = ev.type === 'garbage' ? 'garbage' : 'json';
      raw += `── #${chunkNo} (${label}) ──\n${ev.raw}\n`;
      feed.textContent = raw;
      feed.scrollTop = feed.scrollHeight;

      if (ev.type === 'json') {
        const text = extractStreamText(ev.value);
        if (text !== null && text !== '') {
          const last = texts[texts.length - 1];
          if (last !== undefined && text.startsWith(last)) texts[texts.length - 1] = text;
          else texts.push(text);
          renderTexts();
        }
      }
    },

    finish(opts = {}) {
      aborter = null;
      clear(statusRow);
      if (opts.aborted) statusRow.appendChild(el('span', { class: 't-caption warn-text' }, '중지됨'));
      else statusRow.appendChild(el('span', { class: 't-caption success-text' }, '수신 완료'));
      if (opts.incomplete) {
        noteSlot.appendChild(banner('스트림이 불완전하게 종료됨 — 마지막 조각이 잘렸을 수 있습니다 (청크 피드 확인)', 'warn'));
      }
    },

    reset() {
      chunkNo = 0;
      raw = '';
      texts = [];
      aborter = null;
      clear(statusRow);
      clear(noteSlot);
      textPane.textContent = '';
      feed.textContent = '';
    },

    transcript: () => raw,
  };
}
