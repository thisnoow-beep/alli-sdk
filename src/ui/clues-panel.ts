/* 출처(clues) 패널 — Flow 4. API 용어 clue = 화면 용어 "출처" (GLOSSARY §6). */
import { el } from '../lib/dom';
import type { Clue } from '../core/types';
import { badge, copyButton } from './widgets';

/* API 용어 → 화면 용어 (GLOSSARY — API의 FAQ는 화면의 "Q&A") */
const SOURCE_LABELS: Record<string, string> = { DOCUMENT: '문서', FAQ: 'Q&A', WEB: '웹' };

export function cluesPanel(clues: Clue[]): HTMLElement {
  if (!clues.length) {
    return el('div', { class: 'empty-state' }, '출처 없음 — clues 옵션을 켜면 근거 문서가 표시됩니다');
  }
  return el(
    'div',
    { class: 'stack', style: 'gap: 0;' },
    el('div', { class: 't-caption muted', style: 'padding-bottom: 8px;' }, `출처 ${clues.length}건`),
    ...clues.map((c) => {
      const id = c.kbId ?? c.faqId ?? '';
      return el(
        'div',
        { class: 'chat-row' },
        el(
          'div',
          { class: 'row', style: 'gap: 8px;' },
          badge(SOURCE_LABELS[c.source ?? 'DOCUMENT'] ?? String(c.source), c.source === 'FAQ' ? 'on' : 'default'),
          el('span', { class: 't-title-sm' }, c.title ?? '(제목 없음)'),
          c.pageNo !== undefined ? el('span', { class: 't-caption muted' }, `p.${c.pageNo}`) : null,
          id
            ? el(
                'span',
                { class: 'row', style: 'gap: 4px;' },
                el('span', { class: 't-caption muted-soft' }, id),
                copyButton(() => id, 'ID 복사'),
              )
            : null,
        ),
        c.text ? el('p', { class: 't-body-sm muted', style: 'margin-top: 8px;' }, c.text) : null,
      );
    }),
  );
}
