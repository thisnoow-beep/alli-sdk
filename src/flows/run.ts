/* Flow 2 실행 — 앱 테스트 실행 (SSOT §4 Flow 2의 3·5·6·7단계, §5.4)
   선택한 앱(#/apps)을 입력 변수 key-value 폼(§9-1: 변수 스키마 API 부재 — 로컬 정의)으로 구성해
   sync/stream으로 실행하고, 같은 요청을 curl/JS/Python 코드로 가져간다.
   응답은 v2(result.responses[])·레거시(result.choices[]) 모두 추출(§9-3), conversation.id 표시. */
import { el, clear } from '../lib/dom';
import { specs } from '../core/endpoints';
import { buildUrl, type RequestSpec } from '../core/request-spec';
import type { AlliClient } from '../core/client';
import type { AppType, Citation, Clue, RunAppBody, RunResponse } from '../core/types';
import { deepFindConversationId, extractRunMessages } from '../core/extract';
import { session } from '../state/session';
import { getClient } from '../state/client';
import { selectedApp } from '../state/selection';
import { buildInputs, loadVarDefs, saveVarDefs } from '../state/app-vars';
import {
  badge,
  banner,
  button,
  checkbox,
  copyButton,
  field,
  page,
  segmented,
  spinner,
  textInput,
} from '../ui/widgets';
import { errorPanel } from '../ui/error-panel';
import { rawView, type RawRequestInfo } from '../ui/raw-view';
import { codePanel } from '../ui/code-panel';
import { kvForm } from '../ui/kv-form';
import { streamView } from '../ui/stream-view';
import { cluesPanel } from '../ui/clues-panel';
import { markdownView } from '../ui/markdown-view';

/* API 용어 → 화면 용어 (GLOSSARY §1 — UI에 skill/캠페인 노출 금지) */
const TYPE_LABELS: Record<string, string> = {
  single_action: '답변형 앱',
  skill: '대화형 앱',
  campaign: '대화형 앱',
  agent: '에이전트형 앱',
};

function typeLabel(t: AppType): string {
  return TYPE_LABELS[t] ?? String(t);
}

/** run 응답의 citations[](§5.4) → Clue(출처 패널 어휘) 매핑 — kbId는 knowledgeBaseId, 없으면 url */
function toClue(c: Citation): Clue {
  return {
    clueId: c.clueId,
    source: c.source,
    title: c.title,
    pageNo: c.pageNo,
    kbId: c.knowledgeBaseId ?? c.url,
    text: c.text,
  };
}

function collectClues(data: unknown): Clue[] {
  const responses = (data as RunResponse)?.result?.responses;
  if (!Array.isArray(responses)) return [];
  const clues: Clue[] = [];
  for (const item of responses) {
    for (const c of item?.citations ?? []) clues.push(toClue(c));
  }
  return clues;
}

type ExtraJsonResult = { obj: Record<string, unknown> } | { error: string } | null;

export function render(container: HTMLElement): void {
  const selected = selectedApp.get();

  // 앱 미선택 — empty-state + 이동 버튼만 (공통 동작 규칙)
  if (!selected) {
    container.appendChild(
      page(
        '앱 실행',
        '선택한 앱을 sync/stream으로 실행하고 그대로 ERP 코드로 가져갑니다.',
        el(
          'div',
          { class: 'empty-state' },
          el('p', {}, '선택된 앱이 없습니다 — 먼저 앱 화면에서 테스트할 앱을 선택하세요.'),
          el('div', { style: 'margin-top: 16px;' }, button('#/apps로 이동', { onClick: () => (location.hash = '#/apps') })),
        ),
      ),
    );
    return;
  }

  // 호이스팅되는 내부 함수(run 등)에서도 non-null로 쓰도록 별도 const에 고정
  const app = selected;
  const isConversational = app.type === 'skill' || app.type === 'campaign';

  // ---- 폼 상태 ----
  let mode: 'sync' | 'stream' = 'sync';
  let chatMessage = '';
  let llmModel = '';
  let temperatureStr = '';
  let conversationId = '';
  let isStateful = false;
  let extraJson = '';
  let running = false;

  // ---- 고급 옵션 → body 패치 (비어있지 않은 것만) ----
  const advancedPatch = (): Partial<RunAppBody> => {
    const patch: Partial<RunAppBody> = {};
    if (chatMessage.trim() !== '') patch.chat = { message: chatMessage };
    if (llmModel.trim() !== '') patch.llmModel = llmModel.trim();
    if (temperatureStr.trim() !== '') {
      const t = Number(temperatureStr);
      if (Number.isFinite(t)) patch.temperature = t;
    }
    if (conversationId.trim() !== '') patch.conversationId = conversationId.trim();
    if (isStateful) patch.isStateful = true;
    return patch;
  };

  // 추가 파라미터 raw JSON — §5.4의 나머지 키를 객체로 병합
  const parseExtraJson = (): ExtraJsonResult => {
    const raw = extraJson.trim();
    if (raw === '') return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { error: 'JSON 객체({ ... }) 형태여야 합니다 — 키들이 실행 body에 병합됩니다' };
      }
      return { obj: parsed as Record<string, unknown> };
    } catch {
      return { error: 'JSON 파싱 실패 — 예: {"llmPromptId":"...","requiredVariables":["변수명"]}' };
    }
  };

  /** 코드 생성용 body — 검증 에러는 무시하고 현재 폼 상태를 최대한 반영 */
  const composeBody = (): RunAppBody => {
    const { inputs } = buildInputs(kv.getDefs(), kv.getValues());
    const body: RunAppBody = { inputs, mode, ...advancedPatch() };
    const extra = parseExtraJson();
    if (extra !== null && 'obj' in extra) Object.assign(body, extra.obj);
    return body;
  };

  // ---- 코드 생성 패널 (현재 폼 상태 기준) ----
  const code = codePanel(
    () => ({ spec: specs.runApp(app.id, composeBody()), wrapper: { kind: 'none' } }),
    () => {
      const cfg = session.get();
      return {
        baseUrl: cfg.baseUrl,
        ownUserId: cfg.ownUserId || undefined,
        userEmail: cfg.userEmail || undefined,
      };
    },
  );
  const refreshCode = () => code.refresh();

  // ---- 입력 변수 폼 (§9-1 — 정의는 앱별 로컬 저장) ----
  const kv = kvForm(loadVarDefs(app.id), {
    onChange: () => {
      saveVarDefs(app.id, kv.getDefs());
      refreshCode();
    },
  });

  // ---- 고급 옵션 (기본 접힘) ----
  const tempErrorEl = el('span', { class: 'field-error', style: 'display: none;' });
  const extraErrorEl = el('span', { class: 'field-error', style: 'display: none;' });
  const setFieldError = (slot: HTMLElement, msg: string | null): void => {
    slot.textContent = msg ?? '';
    slot.style.display = msg ? '' : 'none';
  };

  const advancedBody = el(
    'div',
    { class: 'stack', style: 'display: none;' },
    field(
      'chat.message',
      textInput({
        area: true,
        rows: 3,
        placeholder: '사용자 메시지(질문)',
        value: chatMessage,
        onInput: (v) => {
          chatMessage = v;
          refreshCode();
        },
      }),
      { hint: '앱에 전달할 사용자 메시지 — 비우면 전송하지 않습니다' },
    ),
    field(
      'llmModel',
      textInput({
        mono: true,
        placeholder: 'gpt4_o',
        value: llmModel,
        onInput: (v) => {
          llmModel = v;
          refreshCode();
        },
      }),
      { hint: '프로젝트에 등록된 모델명 — 소문자로 입력 (예: gpt4_o, anthropic_claude_3_haiku)' },
    ),
    el(
      'div',
      { class: 'field' },
      el('span', { class: 'field-label' }, 'temperature (0~1)'),
      textInput({
        type: 'number',
        mono: true,
        placeholder: '0 (서버 기본값)',
        value: temperatureStr,
        onInput: (v) => {
          temperatureStr = v;
          refreshCode();
        },
      }),
      tempErrorEl,
      el('span', { class: 'field-hint' }, '생성 온도 — 비우면 서버 기본값(0)을 사용합니다'),
    ),
    field(
      'conversationId',
      textInput({
        mono: true,
        placeholder: '기존 대화 ID',
        value: conversationId,
        onInput: (v) => {
          conversationId = v;
          refreshCode();
        },
      }),
      { hint: '기존 대화를 이어서 실행할 때 지정합니다' },
    ),
    checkbox('isStateful — 대화 상태 유지', {
      checked: isStateful,
      onChange: (v) => {
        isStateful = v;
        refreshCode();
      },
    }),
    el(
      'div',
      { class: 'field' },
      el('span', { class: 'field-label' }, '추가 파라미터 (raw JSON)'),
      textInput({
        area: true,
        rows: 4,
        mono: true,
        placeholder: '{"llmPromptId":"...","gaPromptGroupId":"...","requiredVariables":["변수명"]}',
        value: extraJson,
        onInput: (v) => {
          extraJson = v;
          refreshCode();
        },
      }),
      extraErrorEl,
      el(
        'span',
        { class: 'field-hint' },
        '실행 body의 나머지 키(chat.source, llmPromptId, gaPromptGroupId, requiredVariables 등)를 JSON 객체로 입력하면 병합됩니다',
      ),
    ),
  );

  const advToggle = button('고급 옵션 ▸', {
    small: true,
    variant: 'quiet',
    onClick: () => {
      const hidden = advancedBody.style.display === 'none';
      advancedBody.style.display = hidden ? '' : 'none';
      advToggle.textContent = hidden ? '고급 옵션 ▾' : '고급 옵션 ▸';
    },
  });

  // ---- 결과 영역 ----
  const resultSlot = el('div', { class: 'stack' });
  const rawSlot = el('div', {});

  const appendConversationBadge = (convId: string | undefined): void => {
    if (!convId) return;
    // §4 Flow 2-6: 응답 내 conversation.id 표시 — 파일 첨부/대화 화면에서 이어가는 재료
    resultSlot.appendChild(
      el(
        'div',
        { class: 'row', style: 'gap: 8px;' },
        badge('conversation.id', 'on'),
        el('span', { class: 't-caption muted-soft' }, convId),
        copyButton(() => convId, 'ID 복사'),
      ),
    );
  };

  const renderSyncResult = (data: unknown): void => {
    const messages = extractRunMessages(data);
    if (messages.length === 0) {
      resultSlot.appendChild(el('div', { class: 'empty-state' }, '추출된 메시지가 없습니다 — Raw 응답을 확인하세요'));
    } else {
      for (const m of messages) resultSlot.appendChild(markdownView(m.text, { draftJsBadge: m.viaDraftJs }));
    }
    const clues = collectClues(data);
    if (clues.length > 0) resultSlot.appendChild(cluesPanel(clues));
    appendConversationBadge(deepFindConversationId(data));
  };

  async function runSync(client: AlliClient, spec: RequestSpec, requestInfo: RawRequestInfo): Promise<void> {
    resultSlot.append(
      spinner(),
      el('span', { class: 't-caption muted', style: 'margin-left: 8px;' }, `POST ${spec.path} 호출 중`),
    );
    try {
      const res = await client.execute<RunResponse>(spec);
      clear(resultSlot);
      renderSyncResult(res.data);
      rawSlot.appendChild(
        rawView({ request: requestInfo, status: res.status, elapsedMs: res.elapsedMs, responseText: res.rawBody }),
      );
    } catch (e) {
      clear(resultSlot);
      resultSlot.appendChild(errorPanel(e, 'run'));
    }
  }

  async function runStream(client: AlliClient, spec: RequestSpec, requestInfo: RawRequestInfo): Promise<void> {
    const sv = streamView();
    resultSlot.appendChild(sv.el);
    const ac = new AbortController();
    sv.start(() => ac.abort());
    const jsonValues: unknown[] = [];
    let elapsed: number | undefined;
    try {
      for await (const ev of client.executeStream(spec, ac.signal)) {
        if (ev.type === 'done') {
          elapsed = ev.elapsedMs;
        } else {
          sv.push(ev);
          if (ev.type === 'json') jsonValues.push(ev.value);
        }
      }
      sv.finish();
      // done까지 수집한 JSON 조각들에서 conversationId 탐색 (§9-2 — 위치 미확정이라 deep-scan)
      appendConversationBadge(deepFindConversationId(jsonValues));
      rawSlot.appendChild(rawView({ request: requestInfo, elapsedMs: elapsed, streamTranscript: sv.transcript() }));
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        sv.finish({ aborted: true });
        rawSlot.appendChild(rawView({ request: requestInfo, streamTranscript: sv.transcript() }));
      } else {
        sv.finish();
        resultSlot.appendChild(errorPanel(e, 'run'));
      }
    }
  }

  const runBtn = button('실행', { onClick: () => void run() });

  async function run(): Promise<void> {
    if (running) return;

    // 1. 입력 변수 검증 (정의 기준 — 필수/JSON 형식). 정의가 없으면 inputs:{}로 그대로 전송(§9-1 서버 에러 재현 경로)
    const { inputs, errors } = buildInputs(kv.getDefs(), kv.getValues());
    kv.setErrors(errors);

    // 2. 고급 옵션 검증
    let invalid = errors.length > 0;
    setFieldError(tempErrorEl, null);
    setFieldError(extraErrorEl, null);
    if (temperatureStr.trim() !== '') {
      const t = Number(temperatureStr);
      if (!Number.isFinite(t) || t < 0 || t > 1) {
        setFieldError(tempErrorEl, '0~1 사이 숫자를 입력하세요');
        invalid = true;
      }
    }
    const extra = parseExtraJson();
    if (extra !== null && 'error' in extra) {
      setFieldError(extraErrorEl, extra.error);
      invalid = true;
    }
    if (invalid) return;

    // 3. body 구성 — {inputs, mode} + 고급 옵션(비어있지 않은 것만) + raw JSON 병합
    const body: RunAppBody = { inputs, mode, ...advancedPatch() };
    if (extra !== null && 'obj' in extra) Object.assign(body, extra.obj);
    const spec = specs.runApp(app.id, body);
    const client = getClient();
    const requestInfo: RawRequestInfo = {
      method: spec.method,
      url: buildUrl(client.cfg.baseUrl, spec),
      headers: client.buildHeaders(spec),
      body: JSON.stringify(body, null, 2),
    };

    running = true;
    runBtn.disabled = true;
    clear(resultSlot);
    clear(rawSlot);
    try {
      if (mode === 'stream') await runStream(client, spec, requestInfo);
      else await runSync(client, spec, requestInfo);
    } finally {
      running = false;
      runBtn.disabled = false;
    }
  }

  // ---- 상단 앱 요약 ----
  const summary = el(
    'div',
    { class: 'stack', style: 'gap: 8px;' },
    el(
      'div',
      { class: 'row' },
      el('span', { class: 't-title-sm' }, app.name),
      badge(typeLabel(app.type), isConversational ? 'on' : 'default'),
      app.published === false ? badge('작성 중인 앱', 'warn') : null,
    ),
    el(
      'div',
      { class: 'row', style: 'gap: 4px;' },
      el('span', { class: 't-caption muted-soft' }, app.id),
      copyButton(() => app.id, 'ID 복사'),
      button('다른 앱 선택', { small: true, variant: 'quiet', onClick: () => (location.hash = '#/apps') }),
    ),
  );

  // ---- 레이아웃 ----
  container.appendChild(
    page(
      '앱 실행',
      '입력 변수를 구성해 POST /webapi/apps/{app_id}/run을 sync/stream으로 실행하고, 같은 요청을 ERP 코드로 가져갑니다.',
      el(
        'div',
        { class: 'grid-2col' },
        el(
          'div',
          { class: 'stack' },
          summary,
          isConversational
            ? banner(
                '대화형 앱 제약 — 실행 중간에 사용자 입력(선택/메시지)이 필요한 앱은 이 화면(run)으로 실행할 수 없습니다 (문서 업로드 후 LLM 노드 실행형은 예외). 파일 첨부 또는 대화 화면에서 run_conversation으로 테스트하세요.',
                'warn',
              )
            : null,
          el(
            'div',
            { class: 'field' },
            el('span', { class: 'field-label' }, '입력 변수 (inputs)'),
            el(
              'span',
              { class: 'field-hint' },
              '변수명은 Alli 빌더 화면에서 확인하세요. single_action: 앱에 정의된 변수 / 대화형(skill): user 변수만 사용 가능',
            ),
            kv.el,
          ),
          el('div', {}, advToggle),
          advancedBody,
          el(
            'div',
            { class: 'row' },
            segmented(
              [
                { value: 'sync', label: 'sync' },
                { value: 'stream', label: 'stream' },
              ],
              mode,
              (v) => {
                mode = v as 'sync' | 'stream';
                refreshCode();
              },
            ),
            runBtn,
          ),
          el(
            'span',
            { class: 'field-hint' },
            'stream은 sync와 동일 포맷의 JSON 조각을 스트리밍합니다 (SSE 아님)',
          ),
        ),
        el('div', { class: 'stack' }, resultSlot, rawSlot, code.el),
      ),
    ),
  );

  refreshCode();
}
