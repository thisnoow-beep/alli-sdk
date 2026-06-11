/* 기본 위젯 — 모든 Flow가 공유. DESIGN.md 컴포넌트 규약(components.css)을 따른다. */
import { el, type Child } from '../lib/dom';

export interface ButtonOpts {
  onClick?: (e: MouseEvent) => void;
  variant?: 'primary' | 'quiet' | 'warn';
  small?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}

export function button(label: Child, opts: ButtonOpts = {}): HTMLButtonElement {
  const cls = [
    'btn',
    opts.small ? 'btn--sm' : '',
    opts.variant === 'quiet' ? 'btn--quiet' : '',
    opts.variant === 'warn' ? 'btn--warn' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return el(
    'button',
    {
      class: cls,
      type: opts.type ?? 'button',
      disabled: opts.disabled ?? false,
      title: opts.title,
      onclick: opts.onClick,
    },
    label,
  );
}

export interface TextInputOpts {
  value?: string;
  placeholder?: string;
  mono?: boolean;
  type?: 'text' | 'password' | 'number';
  area?: boolean;
  rows?: number;
  onInput?: (value: string) => void;
  onEnter?: () => void;
  disabled?: boolean;
}

export function textInput(opts: TextInputOpts = {}): HTMLInputElement | HTMLTextAreaElement {
  const cls = `input${opts.mono ? ' input--mono' : ''}`;
  const common = {
    class: cls,
    placeholder: opts.placeholder,
    value: opts.value ?? '',
    disabled: opts.disabled ?? false,
    oninput: opts.onInput
      ? (e: Event) => opts.onInput?.((e.target as HTMLInputElement | HTMLTextAreaElement).value)
      : undefined,
    onkeydown: opts.onEnter
      ? (e: Event) => {
          const ke = e as KeyboardEvent;
          if (ke.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
            ke.preventDefault();
            opts.onEnter?.();
          }
        }
      : undefined,
  };
  if (opts.area) return el('textarea', { ...common, rows: opts.rows ?? 4 });
  return el('input', { ...common, type: opts.type ?? 'text' });
}

export function selectInput(
  options: { value: string; label: string }[],
  opts: { value?: string; onChange?: (value: string) => void; disabled?: boolean } = {},
): HTMLSelectElement {
  const sel = el(
    'select',
    {
      class: 'input',
      disabled: opts.disabled ?? false,
      onchange: opts.onChange
        ? (e: Event) => opts.onChange?.((e.target as HTMLSelectElement).value)
        : undefined,
    },
    ...options.map((o) => el('option', { value: o.value }, o.label)),
  );
  if (opts.value !== undefined) sel.value = opts.value;
  return sel;
}

export function checkbox(
  label: Child,
  opts: { checked?: boolean; onChange?: (checked: boolean) => void; disabled?: boolean } = {},
): HTMLLabelElement {
  return el(
    'label',
    { class: 'check' },
    el('input', {
      type: 'checkbox',
      checked: opts.checked ?? false,
      disabled: opts.disabled ?? false,
      onchange: (e: Event) => opts.onChange?.((e.target as HTMLInputElement).checked),
    }),
    label,
  );
}

/** 라벨 + 컨트롤 + 힌트/에러 래퍼 */
export function field(
  label: string,
  control: Child,
  opts: { hint?: string; error?: string } = {},
): HTMLElement {
  return el(
    'div',
    { class: 'field' },
    el('span', { class: 'field-label' }, label),
    control,
    opts.hint ? el('span', { class: 'field-hint' }, opts.hint) : null,
    opts.error ? el('span', { class: 'field-error' }, opts.error) : null,
  );
}

/** 세그먼트 토글 (sync/stream 등) */
export function segmented(
  options: { value: string; label: string; disabled?: boolean }[],
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const wrap = el('div', { class: 'seg', role: 'radiogroup' });
  const buttons = options.map((o) =>
    el(
      'button',
      {
        type: 'button',
        class: o.value === value ? 'active' : '',
        disabled: o.disabled ?? false,
        onclick: () => {
          for (const b of buttons) b.classList.remove('active');
          const idx = options.findIndex((x) => x.value === o.value);
          buttons[idx]?.classList.add('active');
          onChange(o.value);
        },
      },
      o.label,
    ),
  );
  append(wrap, buttons);
  return wrap;
}

function append(parent: HTMLElement, children: HTMLElement[]): void {
  for (const c of children) parent.appendChild(c);
}

export type Tone = 'default' | 'warn' | 'success' | 'on';

export function badge(text: string, tone: Tone = 'default'): HTMLElement {
  const cls = `badge${tone !== 'default' ? ` badge--${tone}` : ''}`;
  return el('span', { class: cls }, text);
}

export function banner(content: Child, tone: Exclude<Tone, 'on'> = 'default'): HTMLElement {
  const cls = `banner${tone !== 'default' ? ` banner--${tone}` : ''}`;
  return el('div', { class: cls, role: tone === 'warn' ? 'alert' : undefined }, content);
}

export function spinner(): HTMLElement {
  return el('span', { class: 'spinner', 'aria-label': '진행 중' });
}

/** 클립보드 복사 버튼 — 복사 성공 시 1.5초간 라벨 변경 */
export function copyButton(getText: () => string, label = '복사'): HTMLButtonElement {
  const btn = button(label, {
    small: true,
    variant: 'quiet',
    onClick: () => {
      void navigator.clipboard.writeText(getText()).then(() => {
        btn.textContent = '복사됨';
        setTimeout(() => {
          btn.textContent = label;
        }, 1500);
      });
    },
  });
  return btn;
}

/** 탭 바 — onSelect에서 컨텐츠 전환은 호출측 책임 */
export function tabsBar(
  items: { id: string; label: string }[],
  active: string,
  onSelect: (id: string) => void,
): HTMLElement {
  const bar = el('div', { class: 'tabs', role: 'tablist' });
  const buttons = items.map((item) =>
    el(
      'button',
      {
        type: 'button',
        role: 'tab',
        class: item.id === active ? 'active' : '',
        onclick: () => {
          for (const b of buttons) b.classList.remove('active');
          buttons[items.findIndex((x) => x.id === item.id)]?.classList.add('active');
          onSelect(item.id);
        },
      },
      item.label,
    ),
  );
  append(bar, buttons);
  return bar;
}

/** 키 마스킹 표시용 (상태 표시줄 등) — 앞 2자 + ●●●● + 뒤 2자 */
export function maskKey(key: string): string {
  if (key.length <= 6) return '●'.repeat(key.length);
  return `${key.slice(0, 2)}●●●●${key.slice(-2)}`;
}

/** 페이지 골격 — 제목/설명 + 본문 */
export function page(title: string, desc: Child, ...body: Child[]): HTMLElement {
  return el(
    'div',
    { class: 'page' },
    el(
      'div',
      { class: 'page-head' },
      el('h1', { class: 't-display-md' }, title),
      desc ? el('p', { class: 'page-desc t-body-sm' }, desc) : null,
    ),
    ...body,
  );
}
