/* 해시태그 피커 — Flow 4. GET /webapi/hashtags 결과로 선택 UI 구성 (SSOT §5.6/§5.7).
   구조: (Q&A / 문서) × (포함 / 제외) 4개 리스트 + 각 리스트의 and/or 옵션.
   비어있지 않은 리스트만 페이로드에 들어가고, 전부 비면 getFilter()는 undefined. */
import { el } from '../lib/dom';
import type { HashtagOption, HashtagsFilter } from '../core/types';
import { banner, segmented } from './widgets';

export interface HashtagPickerHandle {
  el: HTMLElement;
  getFilter(): HashtagsFilter | undefined;
}

interface ListState {
  tags: string[];
  option: HashtagOption;
}

let datalistSeq = 0;

export function hashtagPicker(
  allTags: Record<string, number>,
  opts: { onChange?: () => void } = {},
): HashtagPickerHandle {
  const sorted = Object.entries(allTags).sort((a, b) => b[1] - a[1]);
  const notify = () => {
    renderWarning();
    opts.onChange?.();
  };

  const state: Record<'qnaInclude' | 'qnaExclude' | 'docsInclude' | 'docsExclude', ListState> = {
    qnaInclude: { tags: [], option: 'or' },
    qnaExclude: { tags: [], option: 'or' },
    docsInclude: { tags: [], option: 'or' },
    docsExclude: { tags: [], option: 'or' },
  };

  const warnSlot = el('div', {});

  function renderWarning(): void {
    warnSlot.replaceChildren();
    const overlaps: string[] = [];
    for (const section of ['qna', 'docs'] as const) {
      const inc = state[`${section}Include`].tags;
      const exc = state[`${section}Exclude`].tags;
      for (const t of inc) if (exc.includes(t)) overlaps.push(`${section === 'qna' ? 'Q&A' : '문서'}: ${t}`);
    }
    if (overlaps.length) {
      warnSlot.appendChild(
        banner(`같은 태그가 포함과 제외에 동시에 있습니다 — ${overlaps.join(', ')}`, 'warn'),
      );
    }
  }

  function tagList(key: keyof typeof state, label: string): HTMLElement {
    const listState = state[key];
    const chipsWrap = el('div', { class: 'row', style: 'gap: 8px; min-height: 28px;' });
    const datalistId = `hashtag-dl-${++datalistSeq}`;

    function renderChips(): void {
      chipsWrap.replaceChildren();
      for (const tag of listState.tags) {
        chipsWrap.appendChild(
          el(
            'span',
            { class: 'chip' },
            `#${tag}`,
            el('button', {
              type: 'button',
              title: '제거',
              onclick: () => {
                listState.tags = listState.tags.filter((t) => t !== tag);
                renderChips();
                notify();
              },
            }, '×'),
          ),
        );
      }
    }

    const input = el('input', {
      class: 'input input--mono',
      placeholder: '태그 검색·추가',
      list: datalistId,
      style: 'max-width: 240px; height: 36px; font-size: 12px;',
      onchange: (e: Event) => {
        const v = (e.target as HTMLInputElement).value.trim().replace(/^#/, '');
        if (v && !listState.tags.includes(v)) {
          listState.tags.push(v);
          renderChips();
          notify();
        }
        (e.target as HTMLInputElement).value = '';
      },
    });

    const datalist = el(
      'datalist',
      { id: datalistId },
      ...sorted.map(([name, count]) => el('option', { value: name }, `${name} (${count}회 사용)`)),
    );

    renderChips();

    return el(
      'div',
      { class: 'stack', style: 'gap: 8px;' },
      el(
        'div',
        { class: 'row' },
        el('span', { class: 't-caption muted' }, label),
        segmented(
          [
            { value: 'or', label: 'or' },
            { value: 'and', label: 'and' },
          ],
          listState.option,
          (v) => {
            listState.option = v as HashtagOption;
            notify();
          },
        ),
      ),
      el('div', { class: 'row' }, input, datalist),
      chipsWrap,
    );
  }

  const root = el(
    'div',
    { class: 'stack', style: 'gap: 24px;' },
    el(
      'div',
      { class: 'grid-2col' },
      el(
        'div',
        { class: 'panel panel--soft stack', style: 'gap: 16px;' },
        el('div', { class: 't-title-sm' }, 'Q&A 태그'),
        tagList('qnaInclude', '포함'),
        tagList('qnaExclude', '제외'),
      ),
      el(
        'div',
        { class: 'panel panel--soft stack', style: 'gap: 16px;' },
        el('div', { class: 't-title-sm' }, '문서 태그'),
        tagList('docsInclude', '포함'),
        tagList('docsExclude', '제외'),
      ),
    ),
    warnSlot,
  );

  return {
    el: root,
    getFilter() {
      const f: HashtagsFilter = {};
      if (state.qnaInclude.tags.length) {
        f.qnaInclude = [...state.qnaInclude.tags];
        f.qnaIncludeOption = state.qnaInclude.option;
      }
      if (state.qnaExclude.tags.length) {
        f.qnaExclude = [...state.qnaExclude.tags];
        f.qnaExcludeOption = state.qnaExclude.option;
      }
      if (state.docsInclude.tags.length) {
        f.docsInclude = [...state.docsInclude.tags];
        f.docsIncludeOption = state.docsInclude.option;
      }
      if (state.docsExclude.tags.length) {
        f.docsExclude = [...state.docsExclude.tags];
        f.docsExcludeOption = state.docsExclude.option;
      }
      return Object.keys(f).length ? f : undefined;
    },
  };
}
