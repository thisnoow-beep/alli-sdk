/* 확인 모달 — Flow 5 DELETE 등 파괴적 동작은 반드시 이 모달을 거친다. */
import { el, type Child } from '../lib/dom';
import { button } from './widgets';

export interface ConfirmOpts {
  title: string;
  body: Child;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function confirmModal(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (result: boolean) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };

    const confirmBtn = button(opts.confirmLabel ?? '확인', {
      variant: opts.danger ? 'warn' : 'primary',
      onClick: () => close(true),
    });

    const overlay = el(
      'div',
      {
        class: 'modal-overlay',
        onclick: (e: Event) => {
          if (e.target === overlay) close(false);
        },
      },
      el(
        'div',
        { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        el('div', { class: 't-display-sm' }, opts.title),
        el('div', { class: 't-body-md' }, opts.body),
        el(
          'div',
          { class: 'row', style: 'justify-content: flex-end;' },
          button(opts.cancelLabel ?? '취소', { variant: 'quiet', onClick: () => close(false) }),
          confirmBtn,
        ),
      ),
    );

    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    confirmBtn.focus();
  });
}
