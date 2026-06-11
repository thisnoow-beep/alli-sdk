/* 입력 변수 key-value 폼 — SSOT §9-1: API가 변수 스키마를 제공하지 않으므로
   행 추가식 자유 폼으로 정의(이름/타입/필수/기본값)하고 값을 입력받는다.
   정의는 flow가 state/app-vars로 영속화하고, 검증(buildInputs)도 flow가 수행한다. */
import { el, clear } from '../lib/dom';
import type { VarDef } from '../state/app-vars';
import { button, checkbox, selectInput, textInput } from './widgets';

export interface KvFormHandle {
  el: HTMLElement;
  getDefs(): VarDef[];
  getValues(): Record<string, string>;
  setErrors(errors: { name: string; message: string }[]): void;
  addRow(def?: Partial<VarDef>): void;
}

interface Row {
  wrap: HTMLElement;
  nameInput: HTMLInputElement;
  valueInput: HTMLInputElement;
  typeSelect: HTMLSelectElement;
  requiredBox: HTMLInputElement;
  defaultInput: HTMLInputElement;
  errorSlot: HTMLElement;
}

const GRID = 'display:grid; grid-template-columns: 1.1fr 1.5fr 110px 70px 1fr 40px; gap: 12px; align-items: center;';

export function kvForm(initialDefs: VarDef[], opts: { onChange?: () => void } = {}): KvFormHandle {
  const rows: Row[] = [];
  const notify = () => opts.onChange?.();

  const header = el(
    'div',
    { style: GRID },
    ...['변수명', '값', '타입', '필수', '기본값', ''].map((h) => el('span', { class: 't-caption muted' }, h)),
  );
  const rowsWrap = el('div', { class: 'stack', style: 'gap: 8px;' });

  function addRow(def: Partial<VarDef> = {}): void {
    const nameInput = textInput({ mono: true, placeholder: 'input', value: def.name ?? '', onInput: notify }) as HTMLInputElement;
    const valueInput = textInput({ placeholder: '값', onInput: notify }) as HTMLInputElement;
    const typeSelect = selectInput(
      [
        { value: 'string', label: '문자열' },
        { value: 'json', label: 'JSON' },
      ],
      { value: def.type ?? 'string', onChange: notify },
    );
    const requiredLabel = checkbox('', { checked: def.required ?? false, onChange: notify });
    const requiredBox = requiredLabel.querySelector('input') as HTMLInputElement;
    const defaultInput = textInput({ placeholder: '(없음)', value: def.defaultValue ?? '', onInput: notify }) as HTMLInputElement;
    const errorSlot = el('div', { class: 'field-error', style: 'grid-column: 1 / -1; display: none;' });

    const wrap = el('div', {});
    const grid = el(
      'div',
      { style: GRID },
      nameInput,
      valueInput,
      typeSelect,
      requiredLabel,
      defaultInput,
      button('×', {
        small: true,
        variant: 'quiet',
        title: '행 삭제',
        onClick: () => {
          const idx = rows.findIndex((r) => r.wrap === wrap);
          if (idx >= 0) rows.splice(idx, 1);
          wrap.remove();
          notify();
        },
      }),
    );
    wrap.append(grid, errorSlot);
    rows.push({ wrap, nameInput, valueInput, typeSelect, requiredBox, defaultInput, errorSlot });
    rowsWrap.appendChild(wrap);
  }

  for (const def of initialDefs) addRow(def);
  if (initialDefs.length === 0) addRow();

  const root = el(
    'div',
    { class: 'stack', style: 'gap: 12px;' },
    header,
    rowsWrap,
    el('div', {}, button('행 추가', {
      small: true,
      onClick: () => {
        addRow();
        notify();
      },
    })),
  );

  return {
    el: root,
    addRow,

    getDefs() {
      return rows
        .filter((r) => r.nameInput.value.trim() !== '')
        .map((r) => ({
          name: r.nameInput.value.trim(),
          type: (r.typeSelect.value as VarDef['type']) ?? 'string',
          required: r.requiredBox.checked,
          defaultValue: r.defaultInput.value,
        }));
    },

    getValues() {
      const values: Record<string, string> = {};
      for (const r of rows) {
        const name = r.nameInput.value.trim();
        if (name) values[name] = r.valueInput.value;
      }
      return values;
    },

    setErrors(errors) {
      for (const r of rows) {
        clear(r.errorSlot);
        r.errorSlot.style.display = 'none';
        r.valueInput.removeAttribute('aria-invalid');
      }
      for (const err of errors) {
        const row = rows.find((r) => r.nameInput.value.trim() === err.name);
        if (!row) continue;
        row.errorSlot.textContent = `${err.name}: ${err.message}`;
        row.errorSlot.style.display = 'block';
        row.valueInput.setAttribute('aria-invalid', 'true');
      }
    },
  };
}
