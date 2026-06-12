/* Flow 3 — 파일 첨부 앱 테스트 (SSOT §4 Flow 3, §5.5, §9-2)
   message/conversationId/choices/sendFormInput + 파일(files/media_files/form_files)로 multipart parts를 구성하고
   ① 미리보기(파트 테이블 + 예시 와이어 포맷) ② 실행(run_conversation, 항상 스트리밍) ③ 코드 생성이
   같은 parts 배열을 공유한다 — 패리티의 핵심. 발견한 conversationId는 sessionStorage로 대화 화면과 공유. */
import { el, clear } from '../lib/dom';
import { specs } from '../core/endpoints';
import { buildUrl, textPart, filePart, type MultipartPart } from '../core/request-spec';
import { deepFindConversationId } from '../core/extract';
import { session } from '../state/session';
import { getClient } from '../state/client';
import { selectedApp } from '../state/selection';
import { badge, banner, button, copyButton, field, page, textInput } from '../ui/widgets';
import { errorPanel } from '../ui/error-panel';
import { rawView } from '../ui/raw-view';
import { codePanel } from '../ui/code-panel';
import { fileDrop } from '../ui/file-drop';
import { streamView } from '../ui/stream-view';

/** 대화 ID 공유 규약 — 파일 첨부 화면이 저장하고 대화 화면(#/conversation)이 초기값으로 읽는다 */
const LAST_CONV_KEY = 'alli-sdk:last-conversation-id:v1';

/** 예시 와이어 포맷용 고정 boundary — 실제 boundary는 fetch FormData가 전송 시 자동 생성 */
const EXAMPLE_BOUNDARY = '------AlliSDKBoundaryEXAMPLE';

function appTypeLabel(type: string): string {
  if (type === 'single_action') return '답변형 앱';
  if (type === 'skill' || type === 'campaign') return '대화형 앱';
  if (type === 'agent') return '에이전트형 앱';
  return type;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** ① 미리보기 테이블 — 필드명 / 종류(text·file) / 값 또는 파일명+크기 */
function partsTable(parts: MultipartPart[]): HTMLElement {
  return el(
    'table',
    { class: 'table' },
    el('thead', {}, el('tr', {}, el('th', {}, '필드명'), el('th', {}, '종류'), el('th', {}, '값'))),
    el(
      'tbody',
      {},
      ...parts.map((p) =>
        el(
          'tr',
          {},
          el('td', { style: 'font-family: var(--font-mono);' }, p.name),
          el('td', {}, p.kind),
          el(
            'td',
            { style: 'word-break: break-all;' },
            p.kind === 'text' ? (p.value ?? '') : `${p.file?.name ?? ''} (${fmtSize(p.file?.size ?? 0)})`,
          ),
        ),
      ),
    ),
  );
}

/** ② 예시 와이어 포맷 — 파일 본문은 '[바이너리 N bytes]'로 대체 */
function wireExample(parts: MultipartPart[]): string {
  const lines: string[] = [];
  for (const p of parts) {
    lines.push(EXAMPLE_BOUNDARY);
    if (p.kind === 'text') {
      lines.push(`Content-Disposition: form-data; name="${p.name}"`, '', p.value ?? '');
    } else {
      lines.push(
        `Content-Disposition: form-data; name="${p.name}"; filename="${p.file?.name ?? ''}"`,
        '',
        `[바이너리 ${p.file?.size ?? 0} bytes]`,
      );
    }
  }
  lines.push(`${EXAMPLE_BOUNDARY}--`);
  return lines.join('\n');
}

/** raw 뷰 요청 본문 표시용 — multipart 파트 요약 */
function partsSummary(parts: MultipartPart[]): string {
  return [
    'multipart/form-data — boundary는 전송 시 자동 생성 (§7-3)',
    ...parts.map((p) =>
      p.kind === 'text'
        ? `${p.name} (text): ${p.value ?? ''}`
        : `${p.name} (file): ${p.file?.name ?? ''} · ${p.file?.size ?? 0} bytes`,
    ),
  ].join('\n');
}

export function render(container: HTMLElement): void | (() => void) {
  const selected = selectedApp.get();

  // 앱 선택이 필요한 화면 — 미선택 시 empty-state만 표시 (공통 규칙)
  if (!selected) {
    container.appendChild(
      page(
        '파일 첨부',
        'multipart 구성을 미리보고 대화형 앱을 실행합니다.',
        el(
          'div',
          { class: 'empty-state' },
          el(
            'div',
            { class: 'stack', style: 'gap: 16px; align-items: center;' },
            '선택된 앱이 없습니다 — 앱 화면에서 테스트할 앱을 먼저 선택하세요.',
            el('div', {}, button('#/apps로 이동', { onClick: () => (location.hash = '#/apps') })),
          ),
        ),
      ),
    );
    return;
  }

  // 가드 통과 후 비-null 타입으로 고정 — 호이스팅된 run()의 클로저에서도 안전
  const app = selected;

  // ---- 폼 상태 ----
  let message = '';
  let conversationId = '';
  let choices = '';
  let sendFormInput = '';
  let running = false;
  let activeAbort: AbortController | null = null;

  const files = fileDrop({ onChange: () => refreshAll() });

  /** parts 빌드 — 미리보기·실행·코드 생성이 이 한 함수의 결과를 공유한다 (패리티의 핵심) */
  const buildParts = (): MultipartPart[] => [
    ...textPart('message', message.trim()),
    ...textPart('conversationId', conversationId.trim()),
    ...textPart('choices', choices.trim()),
    ...textPart('sendFormInput', sendFormInput.trim()),
    ...files.getFiles().map((p) => filePart(p.fieldName, p.file)),
  ];

  // ---- 코드 생성 패널 (현재 입력값 기준, 같은 parts) ----
  const code = codePanel(
    () => ({ spec: specs.runConversation(app.id, buildParts()), wrapper: { kind: 'none' } }),
    () => {
      const cfg = session.get();
      return {
        baseUrl: cfg.baseUrl,
        ownUserId: cfg.ownUserId.trim() || undefined,
        userEmail: cfg.userEmail.trim() || undefined,
      };
    },
  );

  // ---- multipart 미리보기 패널 ----
  const previewBody = el('div', { class: 'stack', style: 'gap: 12px;' });
  const previewPanel = el(
    'div',
    { class: 'stack', style: 'gap: 12px;' },
    el('div', { class: 't-caption muted' }, 'multipart 미리보기 — 현재 입력값 기준'),
    previewBody,
  );

  function refreshPreview(): void {
    clear(previewBody);
    const parts = buildParts();
    if (!parts.length) {
      previewBody.appendChild(el('div', { class: 'empty-state' }, '입력하거나 파일을 첨부하면 form-data 구성이 표시됩니다'));
      return;
    }
    previewBody.append(
      partsTable(parts),
      el('pre', { class: 'code-block code-block--wrap' }, wireExample(parts)),
      el('span', { class: 't-caption muted' }, '예시 — 실제 boundary는 전송 시 자동 생성됩니다'),
    );
  }

  /** 입력 변경마다 미리보기·코드 생성 동시 갱신 */
  function refreshAll(): void {
    refreshPreview();
    code.refresh();
  }

  // ---- 결과 영역 ----
  const sv = streamView();
  const statusSlot = el('div', {});
  const convSlot = el('div', {});
  const rawSlot = el('div', {});

  const runBtn = button('실행 (run_conversation)', { onClick: () => void run() });

  function showConversationId(id: string): void {
    try {
      sessionStorage.setItem(LAST_CONV_KEY, id); // 대화 화면(#/conversation)이 초기값으로 읽는다
    } catch {
      /* sessionStorage 불가 환경 — 표시만 유지 */
    }
    clear(convSlot);
    convSlot.appendChild(
      el(
        'div',
        { class: 'row', style: 'flex-wrap: wrap;' },
        badge('conversationId', 'on'),
        el('span', { class: 't-body-sm', style: 'font-family: var(--font-mono); word-break: break-all;' }, id),
        copyButton(() => id),
        button('대화 화면에서 이어가기', { small: true, onClick: () => (location.hash = '#/conversation') }),
      ),
    );
  }

  async function run(): Promise<void> {
    if (running) return;
    clear(statusSlot);
    clear(convSlot);
    clear(rawSlot);

    const parts = buildParts();
    const hasPayload = parts.some((p) => p.kind === 'file' || p.name !== 'conversationId');
    if (!hasPayload) {
      statusSlot.appendChild(
        banner('전송할 입력이 없습니다 — message·choices·sendFormInput 중 하나를 입력하거나 파일을 첨부하세요', 'warn'),
      );
      return;
    }
    if (choices.trim()) {
      try {
        if (!Array.isArray(JSON.parse(choices.trim()))) throw new Error('not array');
      } catch {
        statusSlot.appendChild(banner('choices는 JSON 배열 문자열이어야 합니다 — 예: [0, 1]', 'warn'));
        return;
      }
    }
    if (sendFormInput.trim()) {
      try {
        JSON.parse(sendFormInput.trim());
      } catch {
        statusSlot.appendChild(banner('sendFormInput은 JSON 문자열이어야 합니다 — 예: {"name": "홍길동"}', 'warn'));
        return;
      }
    }

    running = true;
    runBtn.disabled = true;

    const spec = specs.runConversation(app.id, parts);
    const ac = new AbortController();
    activeAbort = ac;
    sv.start(() => ac.abort());

    let foundConvId: string | undefined;
    let elapsedMs: number | undefined;

    try {
      const client = getClient();
      for await (const ev of client.executeStream(spec, ac.signal)) {
        if (ev.type === 'done') {
          elapsedMs = ev.elapsedMs;
        } else {
          sv.push(ev);
          // §9-2: 스키마 미문서화 — 수신 json 값마다 deep-scan으로 conversationId 탐색
          if (ev.type === 'json' && foundConvId === undefined) {
            const id = deepFindConversationId(ev.value);
            if (id !== undefined) {
              foundConvId = id;
              showConversationId(id);
            }
          }
        }
      }
      sv.finish();
      rawSlot.appendChild(
        rawView({
          request: {
            method: spec.method,
            url: buildUrl(client.cfg.baseUrl, spec),
            headers: client.buildHeaders(spec),
            body: partsSummary(parts),
          },
          elapsedMs,
          streamTranscript: sv.transcript(),
        }),
      );
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        sv.finish({ aborted: true });
      } else {
        sv.finish();
        statusSlot.appendChild(errorPanel(e, 'run'));
      }
    } finally {
      running = false;
      runBtn.disabled = false;
      activeAbort = null;
    }
  }

  // ---- 레이아웃 ----
  container.appendChild(
    page(
      '파일 첨부',
      'multipart/form-data 구성을 미리보고 대화형 앱을 실행합니다 (POST /webapi/v2/apps/{app_id}/run_conversation — 응답은 항상 스트리밍).',
      el(
        'div',
        { class: 'grid-2col' },
        el(
          'div',
          { class: 'stack' },
          el(
            'div',
            { class: 'row', style: 'flex-wrap: wrap;' },
            badge(`선택 앱: ${app.name}`, 'on'),
            badge(appTypeLabel(String(app.type))),
            button('다른 앱 선택', { small: true, variant: 'quiet', onClick: () => (location.hash = '#/apps') }),
          ),
          app.type === 'single_action'
            ? banner('파일 첨부 실행(run_conversation)은 대화형 앱 전용입니다 — 결과가 다를 수 있습니다', 'warn')
            : null,
          field(
            'message',
            textInput({
              area: true,
              rows: 3,
              placeholder: '사용자 메시지 — 예: 이 문서를 요약해줘',
              value: message,
              onInput: (v) => {
                message = v;
                refreshAll();
              },
            }),
            { hint: '대화의 사용자 발화로 전송됩니다' },
          ),
          field(
            'conversationId (옵션)',
            textInput({
              mono: true,
              placeholder: '비우면 새 대화 시작',
              value: conversationId,
              onInput: (v) => {
                conversationId = v;
                refreshAll();
              },
            }),
            { hint: '기존 대화를 이어가려면 이전 응답에서 받은 ID를 입력하세요' },
          ),
          field(
            'choices (옵션)',
            textInput({
              mono: true,
              placeholder: '[0, 1]',
              value: choices,
              onInput: (v) => {
                choices = v;
                refreshAll();
              },
            }),
            { hint: 'JSON 배열 문자열 — 예: [0, 1]' },
          ),
          field(
            'sendFormInput (옵션)',
            textInput({
              area: true,
              rows: 3,
              mono: true,
              placeholder: '{"name": "홍길동"}',
              value: sendFormInput,
              onInput: (v) => {
                sendFormInput = v;
                refreshAll();
              },
            }),
            { hint: '폼 제출 데이터 — JSON 문자열' },
          ),
          field('파일 첨부', files.el, {
            hint: '파일별로 form 필드(files 일반 / media_files 미디어 / form_files 폼)를 지정합니다',
          }),
          el('div', {}, runBtn),
          statusSlot,
        ),
        el('div', { class: 'stack' }, previewPanel, sv.el, convSlot, rawSlot, code.el),
      ),
    ),
  );

  refreshAll();

  // 라우트 이탈 시 진행 중 스트림 중단
  return () => {
    activeAbort?.abort();
    activeAbort = null;
  };
}
