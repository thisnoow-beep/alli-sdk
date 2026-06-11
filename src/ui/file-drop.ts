/* 파일 첨부 — Flow 3/6. run_conversation의 3가지 파일 필드(files/media_files/form_files) 구분 지정. */
import { el, clear } from '../lib/dom';
import { button, selectInput } from './widgets';

export type FileFieldName = 'files' | 'media_files' | 'form_files';

export interface PickedFile {
  file: File;
  fieldName: FileFieldName;
}

export interface FileDropHandle {
  el: HTMLElement;
  getFiles(): PickedFile[];
  clear(): void;
}

const FIELD_OPTIONS: { value: FileFieldName; label: string }[] = [
  { value: 'files', label: 'files (일반)' },
  { value: 'media_files', label: 'media_files (미디어)' },
  { value: 'form_files', label: 'form_files (폼)' },
];

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function fileDrop(opts: { onChange?: () => void } = {}): FileDropHandle {
  const picked: { file: File; select: HTMLSelectElement; row: HTMLElement }[] = [];
  const notify = () => opts.onChange?.();

  const input = el('input', { type: 'file', multiple: true, style: 'display:none;' }) as HTMLInputElement;
  const list = el('div', { class: 'stack', style: 'gap: 8px;' });

  function addFiles(files: FileList | File[]): void {
    for (const file of Array.from(files)) {
      const select = selectInput(FIELD_OPTIONS, { value: 'files', onChange: notify });
      select.style.maxWidth = '220px';
      const row = el(
        'div',
        { class: 'row', style: 'border-bottom: 1px solid var(--color-hairline); padding-bottom: 8px;' },
        el('span', { class: 't-body-sm', style: 'flex:1; word-break: break-all;' }, file.name),
        el('span', { class: 't-caption muted' }, fmtSize(file.size)),
        select,
        button('×', {
          small: true,
          variant: 'quiet',
          title: '제거',
          onClick: () => {
            const idx = picked.findIndex((p) => p.row === row);
            if (idx >= 0) picked.splice(idx, 1);
            row.remove();
            notify();
          },
        }),
      );
      picked.push({ file, select, row });
      list.appendChild(row);
    }
    notify();
  }

  input.addEventListener('change', () => {
    if (input.files) addFiles(input.files);
    input.value = '';
  });

  const zone = el(
    'div',
    {
      class: 'empty-state',
      style: 'cursor: pointer; border-style: dashed;',
      onclick: () => input.click(),
      ondragover: (e: Event) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-on-dark)';
      },
      ondragleave: (e: Event) => {
        (e.currentTarget as HTMLElement).style.borderColor = '';
      },
      ondrop: (e: Event) => {
        e.preventDefault();
        const de = e as DragEvent;
        (e.currentTarget as HTMLElement).style.borderColor = '';
        if (de.dataTransfer?.files) addFiles(de.dataTransfer.files);
      },
    },
    '파일을 끌어다 놓거나 클릭해서 선택 (PDF/Word/PPT/Excel/HTML/TXT 등)',
  );

  const root = el('div', { class: 'stack', style: 'gap: 12px;' }, zone, input, list);

  return {
    el: root,
    getFiles: () =>
      picked.map((p) => ({ file: p.file, fieldName: p.select.value as FileFieldName })),
    clear() {
      picked.length = 0;
      clear(list);
      notify();
    },
  };
}
