/* 수직 스테퍼 — Flow 5 (검색→업로드→인제스천 대기→삭제) 진행 표시. */
import { el, clear } from '../lib/dom';
import { spinner } from './widgets';

export type StepState = 'pending' | 'active' | 'done' | 'failed';

export interface StepDef {
  id: string;
  title: string;
}

export interface StepperHandle {
  el: HTMLElement;
  setState(id: string, state: StepState, detail?: string): void;
  reset(): void;
}

const STATE_LABEL: Record<StepState, string> = {
  pending: '대기',
  active: '진행 중',
  done: '완료',
  failed: '실패',
};

export function stepper(steps: StepDef[]): StepperHandle {
  const rows = new Map<string, { row: HTMLElement; status: HTMLElement; detail: HTMLElement }>();

  const root = el(
    'div',
    { class: 'stepper' },
    ...steps.map((s, i) => {
      const status = el('span', { class: 't-caption muted' }, STATE_LABEL.pending);
      const detail = el('div', { class: 't-body-sm muted', style: 'margin-top: 4px;' });
      const row = el(
        'div',
        { class: 'stepper-step' },
        el('span', { class: 'step-no' }, `${i + 1}`.padStart(2, '0')),
        el(
          'div',
          { style: 'flex: 1;' },
          el('div', { class: 'spread' }, el('span', { class: 'step-title t-title-sm' }, s.title), status),
          detail,
        ),
      );
      rows.set(s.id, { row, status, detail });
      return row;
    }),
  );

  function setState(id: string, state: StepState, detailText?: string): void {
    const entry = rows.get(id);
    if (!entry) return;
    entry.row.classList.remove('active', 'done', 'failed');
    if (state !== 'pending') entry.row.classList.add(state);
    clear(entry.status);
    if (state === 'active') entry.status.append(spinner(), ` ${STATE_LABEL.active}`);
    else entry.status.textContent = STATE_LABEL[state];
    entry.status.className = `t-caption ${state === 'failed' ? 'warn-text' : state === 'done' ? 'success-text' : 'muted'}`;
    entry.detail.textContent = detailText ?? '';
  }

  return {
    el: root,
    setState,
    reset() {
      for (const [id] of rows) setState(id, 'pending');
    },
  };
}
