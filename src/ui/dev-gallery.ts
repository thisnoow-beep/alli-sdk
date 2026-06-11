/* DEV 전용 컴포넌트 갤러리 (#/dev) — M3에서 공용 컴포넌트 추가 시 확장 */
import { el } from '../lib/dom';
import { badge, banner, button, checkbox, field, page, segmented, spinner, tabsBar, textInput } from './widgets';

export function render(container: HTMLElement): void {
  container.appendChild(
    page(
      'DEV 갤러리',
      '공용 컴포넌트 미리보기 (개발 전용)',
      el(
        'div',
        { class: 'stack' },
        el('div', { class: 'row' }, button('기본 버튼'), button('작은 버튼', { small: true }), button('경고', { variant: 'warn' }), button('콰이엇', { variant: 'quiet' }), button('비활성', { disabled: true })),
        el('div', { class: 'row' }, badge('미연결'), badge('연결됨', 'on'), badge('경고', 'warn'), badge('성공', 'success'), spinner()),
        banner('일반 배너 — 안내 문구'),
        banner('경고 배너 — 주의가 필요한 상황', 'warn'),
        field('텍스트 입력', textInput({ placeholder: '플레이스홀더' }), { hint: '힌트 문구' }),
        field('모노 입력', textInput({ mono: true, placeholder: 'app-id-...' }), { error: '에러 문구 예시' }),
        el('div', { class: 'row' }, segmented([{ value: 'sync', label: 'sync' }, { value: 'stream', label: 'stream' }], 'sync', () => {}), checkbox('체크박스')),
        tabsBar([{ id: 'a', label: 'curl' }, { id: 'b', label: 'JavaScript' }, { id: 'c', label: 'Python' }], 'a', () => {}),
        el('pre', { class: 'code-block' }, 'curl -H "API-KEY: $ALLI_API_KEY" https://backend.alli.ai/webapi/v2/projects'),
      ),
    ),
  );
}
