/* DEV 전용 컴포넌트 갤러리 (#/dev) — 공용 컴포넌트 시각 점검용. 프로덕션 번들에서 제외(동적 import). */
import { el } from '../lib/dom';
import { AlliApiError } from '../core/errors';
import {
  badge,
  banner,
  button,
  checkbox,
  field,
  page,
  segmented,
  spinner,
  tabsBar,
  textInput,
} from './widgets';
import { errorPanel } from './error-panel';
import { rawView } from './raw-view';
import { cluesPanel } from './clues-panel';
import { markdownView } from './markdown-view';
import { stepper } from './stepper';
import { confirmModal } from './modal';
import { kvForm } from './kv-form';
import { fileDrop } from './file-drop';
import { hashtagPicker } from './hashtag-picker';
import { codePanel } from './code-panel';
import { specs } from '../core/endpoints';

function section(title: string, ...body: Parameters<typeof el>[2][]): HTMLElement {
  return el(
    'section',
    { class: 'stack hairline-top', style: 'padding-top: 24px; gap: 16px;' },
    el('h2', { class: 't-display-sm' }, title),
    ...body,
  );
}

export function render(container: HTMLElement): void {
  const steps = stepper([
    { id: 'search', title: '기존 문서 검색' },
    { id: 'upload', title: '새 파일 업로드' },
    { id: 'ingest', title: '인제스천 대기' },
    { id: 'delete', title: '구 문서 삭제' },
  ]);
  steps.setState('search', 'done');
  steps.setState('upload', 'done');
  steps.setState('ingest', 'active', 'parsing · 2회 시도 · 14초 경과');

  const sampleError = new AlliApiError('Invalid API Key', {
    httpStatus: 403,
    code: 7001,
    shape: 'standard',
    rawBody: '{"type":"APIError","code":7001,"message":"Invalid API Key"}',
  });

  const kv = kvForm([
    { name: 'input', type: 'string', required: true, defaultValue: '' },
    { name: 'kbIds', type: 'json', required: false, defaultValue: '["kb-001"]' },
  ]);

  const cp = codePanel(
    () => ({ spec: specs.projects(), wrapper: { kind: 'none' } }),
    () => ({ baseUrl: 'https://backend.alli.ai', ownUserId: '홍길동' }),
  );
  cp.refresh();

  container.appendChild(
    page(
      'DEV 갤러리',
      '공용 컴포넌트 미리보기 (개발 전용)',
      el(
        'div',
        { class: 'stack', style: 'gap: 40px;' },
        section(
          '기본 위젯',
          el('div', { class: 'row' }, button('기본 버튼'), button('작은 버튼', { small: true }), button('경고', { variant: 'warn' }), button('콰이엇', { variant: 'quiet' }), button('비활성', { disabled: true })),
          el('div', { class: 'row' }, badge('미연결'), badge('연결됨', 'on'), badge('경고', 'warn'), badge('성공', 'success'), spinner()),
          banner('일반 배너 — 안내 문구'),
          banner('경고 배너 — 주의가 필요한 상황', 'warn'),
          field('텍스트 입력', textInput({ placeholder: '플레이스홀더' }), { hint: '힌트 문구' }),
          el('div', { class: 'row' }, segmented([{ value: 'sync', label: 'sync' }, { value: 'stream', label: 'stream' }], 'sync', () => {}), checkbox('체크박스')),
          tabsBar([{ id: 'a', label: 'JavaScript' }, { id: 'b', label: 'Python' }, { id: 'c', label: 'curl' }], 'a', () => {}),
        ),
        section('에러 해설 패널', errorPanel(sampleError, 'connect')),
        section(
          'Raw 뷰',
          rawView({
            request: {
              method: 'POST',
              url: 'https://backend.alli.ai/webapi/generative_answer',
              headers: { 'API-KEY': 'sk-test-abcdef123456', 'Content-Type': 'application/json' },
              body: '{\n  "query": "연차 이월 규정 알려줘"\n}',
            },
            status: 200,
            elapsedMs: 412,
            responseText: '{"answer":"## 연차 이월\\n- 최대 10일","threadId":"th-1"}',
          }),
        ),
        section(
          '마크다운 뷰 (새니타이즈)',
          markdownView('## 제목\n\n- 항목 1\n- 항목 2\n\n`코드` 와 [링크](https://example.com)\n\n<script>alert(1)</script> ← script는 제거됨'),
        ),
        section(
          '출처 패널',
          cluesPanel([
            { source: 'DOCUMENT', title: '취업규칙_v3.pdf', page_no: 12, kb_id: 'kb-001', text: '연차휴가는 다음 해로 최대 10일까지 이월할 수 있다…' },
            { source: 'FAQ', title: '연차 이월 문의', faq_id: 'faq-77', text: '인사팀 답변: 이월 신청은 12월 말까지…' },
          ]),
        ),
        section('스테퍼', steps.el),
        section(
          '확인 모달',
          el('div', {}, button('삭제 확인 모달 열기', {
            variant: 'warn',
            onClick: () => {
              void confirmModal({
                title: '구 문서 삭제',
                body: '구 노드(kb-001)를 삭제합니다. 새 문서 인제스천이 완료된 상태에서만 진행하세요.',
                confirmLabel: '삭제',
                danger: true,
              });
            },
          })),
        ),
        section('변수 폼 (kv-form)', kv.el),
        section('파일 첨부', fileDrop().el),
        section('해시태그 피커', hashtagPicker({ 인사규정: 12, 회계: 9, IT자산: 7, 보안: 5, 복리후생: 3 }).el),
        section('코드 생성 패널', cp.el),
      ),
    ),
  );
}
