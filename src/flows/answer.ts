/* Flow 4 — Generative Answer(답변 생성) 테스트 (SSOT §4 Flow 4, §5.6/§5.7)
   사내 문서/Q&A 기반 생성형 답변의 옵션 조합(model/promptGroupId/hashtags/search_from/clues)을
   실험하고 같은 요청을 ERP 코드로 가져간다. answerFormat은 빌더가 항상 MARKDOWN 강제(§3.4).
   멀티턴: OWN-USER-ID 설정 시 isStateful + 응답 threadId 보관·자동 첨부 (§9-6). */
import { el, clear } from '../lib/dom';
import { specs } from '../core/endpoints';
import { buildUrl, type RequestSpec } from '../core/request-spec';
import type { AlliClient } from '../core/client';
import { GA_MODEL_SUGGESTIONS } from '../core/types';
import type { Clue, GaResponse, GenerativeAnswerBody, HashtagsResponse, SearchFrom } from '../core/types';
import { tryExtractDraftJs } from '../core/draftjs';
import { session } from '../state/session';
import { getClient } from '../state/client';
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
import { hashtagPicker, type HashtagPickerHandle } from '../ui/hashtag-picker';
import { streamView } from '../ui/stream-view';
import { cluesPanel } from '../ui/clues-panel';
import { markdownView } from '../ui/markdown-view';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 턴 누적 단위 — raw는 sync 원문 또는 stream 트랜스크립트 (최신 건은 rawSlot에도 표시) */
interface Turn {
  query: string;
  answer: unknown;
  fuQuestion?: string;
  clues: Clue[];
  raw: string;
}

let datalistSeq = 0;

export function render(container: HTMLElement): void {
  const hasOwnUserId = session.get().ownUserId.trim() !== '';

  // ---- 폼 상태 ----
  let query = '';
  let mode: 'sync' | 'stream' = 'sync';
  let model = '';
  let promptGroupId = '';
  const searchFromState: Record<SearchFrom, boolean> = { document: false, qna: false, web: false };
  let cluesOn = false;
  let clueTextOn = false;
  let isStateful = false;
  let threadId = ''; // 멀티턴 — 응답의 threadId를 보관해 후속 질문 body에 자동 첨부
  let running = false;

  // 해시태그 피커 — 렌더 시 GET /webapi/hashtags로 비동기 구성 (§5.7)
  let picker: HashtagPickerHandle | null = null;

  const searchFromList = (): SearchFrom[] =>
    (['document', 'qna', 'web'] as const).filter((s) => searchFromState[s]);

  /** 현재 폼 상태 → GA body — 비어있지 않은 옵션만 포함. answerFormat은 빌더가 MARKDOWN 강제 */
  const composeBody = (): GenerativeAnswerBody => {
    const body: GenerativeAnswerBody = { query: query.trim(), mode };
    if (model.trim() !== '') body.model = model.trim();
    if (promptGroupId.trim() !== '') body.promptGroupId = promptGroupId.trim();
    if (cluesOn) {
      body.clues = true;
      if (clueTextOn) body.clueText = true; // clues=true일 때만 동작 (§5.6)
    }
    const hashtags = picker?.getFilter();
    if (hashtags) body.hashtags = hashtags;
    const sf = searchFromList();
    if (sf.length > 0) body.search_from = sf;
    if (isStateful) {
      body.isStateful = true;
      if (threadId !== '') body.threadId = threadId; // 첫 호출엔 비우고 응답 값을 재전송
    }
    return body;
  };

  // ---- 코드 생성 패널 (현재 폼 상태 기준) — 멀티턴이면 threadId 보관·재전송 루프 형태 (§7) ----
  const code = codePanel(
    () => ({
      spec: specs.generativeAnswer(composeBody()),
      wrapper: isStateful ? { kind: 'ga-thread-loop' } : { kind: 'none' },
    }),
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

  // ---- 질문 입력 ----
  const queryInput = textInput({
    area: true,
    rows: 3,
    placeholder: '예: 연차 이월 규정 알려줘',
    value: query,
    onInput: (v) => {
      query = v;
      refreshCode();
    },
  });

  // ---- model: 자유 입력 + datalist 제안 (프로젝트 등록 모델만 유효 — §5.6) ----
  const modelDlId = `ga-model-dl-${++datalistSeq}`;
  const modelInput = textInput({
    mono: true,
    placeholder: 'gpt4_o (서버 기본값)',
    value: model,
    onInput: (v) => {
      model = v;
      refreshCode();
    },
  });
  modelInput.setAttribute('list', modelDlId);
  const modelDatalist = el(
    'datalist',
    { id: modelDlId },
    ...GA_MODEL_SUGGESTIONS.map((m) => el('option', { value: m })),
  );

  // ---- 해시태그 필터 — 렌더 시 로드, 실패하면 경고 후 생략 ----
  const hashtagSlot = el('div', {});
  hashtagSlot.append(
    spinner(),
    el('span', { class: 't-caption muted', style: 'margin-left: 8px;' }, 'GET /webapi/hashtags 호출 중'),
  );

  async function loadHashtags(): Promise<void> {
    try {
      const res = await getClient().execute<HashtagsResponse>(specs.hashtags());
      const tags = res.data?.result ?? {};
      picker = hashtagPicker(tags, { onChange: refreshCode });
      clear(hashtagSlot);
      hashtagSlot.appendChild(picker.el);
    } catch (e) {
      clear(hashtagSlot);
      hashtagSlot.appendChild(
        banner(
          `해시태그 목록을 불러오지 못했습니다 — 필터 없이 진행합니다 (${e instanceof Error ? e.message : String(e)})`,
          'warn',
        ),
      );
    }
  }
  void loadHashtags();

  // ---- clues / clueText — clueText는 clues가 켜졌을 때만 활성 ----
  const clueTextCheck = checkbox('근거 본문 포함 (clueText)', {
    checked: clueTextOn,
    disabled: !cluesOn,
    onChange: (v) => {
      clueTextOn = v;
      refreshCode();
    },
  });
  const clueTextInput = clueTextCheck.querySelector('input') as HTMLInputElement;
  const cluesCheck = checkbox('근거 포함 (clues)', {
    checked: cluesOn,
    onChange: (v) => {
      cluesOn = v;
      clueTextInput.disabled = !v;
      refreshCode();
    },
  });

  // ---- 멀티턴 (isStateful) — OWN-USER-ID 없으면 비활성 + 사유 배너 (§9-6) ----
  const statefulCheck = checkbox('멀티턴 (isStateful) — 응답 threadId를 보관해 후속 질문에 자동 첨부', {
    checked: isStateful,
    disabled: !hasOwnUserId,
    onChange: (v) => {
      isStateful = v;
      refreshCode();
    },
  });

  // ---- threadId 칩 (멀티턴 진행 중 표시) ----
  const threadSlot = el('div', {});
  const renderThreadChip = (): void => {
    clear(threadSlot);
    if (threadId === '') return;
    threadSlot.appendChild(
      el(
        'div',
        { class: 'row', style: 'gap: 8px;' },
        badge('threadId', 'on'),
        el('span', { class: 't-caption muted-soft' }, threadId),
        copyButton(() => threadId, 'ID 복사'),
        button('새 스레드', {
          small: true,
          variant: 'quiet',
          onClick: () => {
            threadId = '';
            renderThreadChip();
            refreshCode();
          },
        }),
        el('span', { class: 't-caption muted' }, '후속 질문 body에 자동 첨부됩니다'),
      ),
    );
  };

  // ---- 턴 누적 UI ----
  const turns: Turn[] = [];
  const turnsSlot = el('div', { class: 'stack', style: 'gap: 0;' });

  /** answer 표시 — string이면 마크다운(방어적 DraftJS 추출 폴백), 아니면 JSON + 경고 (§3.4) */
  function answerView(answer: unknown): HTMLElement {
    if (typeof answer === 'string') {
      if (answer === '') return el('div', { class: 'empty-state' }, '빈 답변 — Raw 응답을 확인하세요');
      const draft = tryExtractDraftJs(answer);
      if (draft !== null) return markdownView(draft, { draftJsBadge: true });
      return markdownView(answer);
    }
    if (answer === null || answer === undefined) {
      return el('div', { class: 'empty-state' }, '답변 필드가 없습니다 — Raw 응답을 확인하세요');
    }
    // 문자열이 아닌 answer — MARKDOWN 강제에도 DraftJS 객체로 온 경우 (§3.4 함정)
    const fromObj = tryExtractDraftJs(JSON.stringify(answer));
    if (fromObj !== null) return markdownView(fromObj, { draftJsBadge: true });
    return el(
      'div',
      { class: 'stack', style: 'gap: 8px;' },
      el('div', {}, badge('answer가 문자열이 아님 — DraftJS 객체 가능성 (§3.4)', 'warn')),
      el('pre', { class: 'code-block code-block--wrap' }, JSON.stringify(answer, null, 2)),
    );
  }

  function turnEl(t: Turn, no: number): HTMLElement {
    return el(
      'div',
      { class: 'stack', style: 'gap: 8px;' },
      el(
        'div',
        { class: 'chat-row from-user' },
        el('div', { class: 'chat-who' }, `질문 #${no}`),
        el('div', { class: 'chat-body' }, t.query),
      ),
      t.fuQuestion ? el('div', { class: 't-caption muted' }, `재작성된 질문: ${t.fuQuestion}`) : null,
      answerView(t.answer),
      cluesPanel(t.clues),
    );
  }

  /** 응답(sync data 또는 stream 마지막 완전체)에서 answer/clues/threadId/fuQuestion 추출 — 타입 가드 느슨하게 */
  function handleResult(q: string, data: unknown, raw: string): void {
    const ga: GaResponse = isRecord(data) ? (data as GaResponse) : {};
    const clueArr: Clue[] = Array.isArray(ga.clues) ? ga.clues.filter((c) => isRecord(c)) : [];
    const turn: Turn = { query: q, answer: ga.answer, clues: clueArr, raw };
    if (typeof ga.fuQuestion === 'string' && ga.fuQuestion !== '') turn.fuQuestion = ga.fuQuestion;
    turns.push(turn);
    turnsSlot.appendChild(turnEl(turn, turns.length));

    if (isStateful && typeof ga.threadId === 'string' && ga.threadId !== '') {
      threadId = ga.threadId; // §4 Flow 4-6: 응답 threadId 자동 보관 → 후속 질문에 첨부
      renderThreadChip();
      refreshCode();
    }
  }

  // ---- 결과 영역 ----
  const statusSlot = el('div', { class: 'stack' });
  const rawSlot = el('div', {});

  async function runSync(client: AlliClient, spec: RequestSpec, requestInfo: RawRequestInfo, q: string): Promise<void> {
    statusSlot.append(
      spinner(),
      el('span', { class: 't-caption muted', style: 'margin-left: 8px;' }, 'POST /webapi/generative_answer 호출 중'),
    );
    try {
      const res = await client.execute<GaResponse>(spec);
      clear(statusSlot);
      handleResult(q, res.data, res.rawBody);
      rawSlot.appendChild(
        rawView({ request: requestInfo, status: res.status, elapsedMs: res.elapsedMs, responseText: res.rawBody }),
      );
    } catch (e) {
      clear(statusSlot);
      statusSlot.appendChild(errorPanel(e, 'ga')); // 4xx → §9-4 계약 옵션 힌트
    }
  }

  async function runStream(client: AlliClient, spec: RequestSpec, requestInfo: RawRequestInfo, q: string): Promise<void> {
    const sv = streamView();
    statusSlot.appendChild(sv.el);
    const ac = new AbortController();
    sv.start(() => ac.abort());
    // GA 스트림은 sync와 동일 포맷 JSON 조각을 누적 전송(§3.5) — 마지막 완전체에서 추출
    let lastJson: unknown;
    let lastWithAnswer: unknown;
    let elapsed: number | undefined;
    try {
      for await (const ev of client.executeStream(spec, ac.signal)) {
        if (ev.type === 'done') {
          elapsed = ev.elapsedMs;
        } else {
          sv.push(ev);
          if (ev.type === 'json') {
            lastJson = ev.value;
            if (isRecord(ev.value) && 'answer' in ev.value) lastWithAnswer = ev.value;
          }
        }
      }
      sv.finish();
      const finalValue = lastWithAnswer ?? lastJson;
      clear(statusSlot); // 답변은 턴 목록으로, 청크 피드는 Raw 트랜스크립트로 이관
      if (finalValue !== undefined) {
        handleResult(q, finalValue, sv.transcript());
      } else {
        statusSlot.appendChild(banner('스트림에서 JSON 조각을 받지 못했습니다 — Raw 응답을 확인하세요', 'warn'));
      }
      rawSlot.appendChild(rawView({ request: requestInfo, elapsedMs: elapsed, streamTranscript: sv.transcript() }));
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        sv.finish({ aborted: true });
        rawSlot.appendChild(rawView({ request: requestInfo, streamTranscript: sv.transcript() }));
      } else {
        sv.finish();
        statusSlot.appendChild(errorPanel(e, 'ga'));
      }
    }
  }

  const runBtn = button('실행', { onClick: () => void run() });

  async function run(): Promise<void> {
    if (running) return;
    clear(statusSlot);
    clear(rawSlot);

    const q = query.trim();
    if (q === '') {
      statusSlot.appendChild(banner('질문(query)을 입력하세요', 'warn'));
      return;
    }

    const spec = specs.generativeAnswer(composeBody());
    const client = getClient();
    const requestInfo: RawRequestInfo = {
      method: spec.method,
      url: buildUrl(client.cfg.baseUrl, spec),
      headers: client.buildHeaders(spec),
      // 실제 전송 값(answerFormat: MARKDOWN 강제 포함)을 그대로 표시
      body: spec.body.kind === 'json' ? JSON.stringify(spec.body.value, null, 2) : '',
    };

    running = true;
    runBtn.disabled = true;
    try {
      if (mode === 'stream') await runStream(client, spec, requestInfo, q);
      else await runSync(client, spec, requestInfo, q);
    } finally {
      running = false;
      runBtn.disabled = false;
    }
  }

  // ---- 레이아웃 ----
  container.appendChild(
    page(
      '답변 생성',
      '사내 문서/Q&A 기반 생성형 답변(POST /webapi/generative_answer)의 옵션 조합을 실험하고, 같은 요청을 ERP 코드로 가져갑니다.',
      el(
        'div',
        { class: 'grid-2col' },
        el(
          'div',
          { class: 'stack' },
          field('질문 (query)', queryInput, { hint: '검색·답변 생성의 입력 질문입니다' }),
          field('model', el('div', {}, modelInput, modelDatalist), {
            hint: '프로젝트에 등록된 모델만 유효 (소문자)',
          }),
          field(
            'promptGroupId',
            textInput({
              mono: true,
              placeholder: '그룹 프롬프트 ID',
              value: promptGroupId,
              onInput: (v) => {
                promptGroupId = v;
                refreshCode();
              },
            }),
            {
              hint: 'Settings > Prompt Management의 답변 생성 그룹 프롬프트 URL 마지막 세그먼트 (Q&A 자동생성 그룹과 혼용 금지)',
            },
          ),
          el(
            'div',
            { class: 'field' },
            el('span', { class: 'field-label' }, '해시태그 필터 (hashtags)'),
            el('span', { class: 'field-hint' }, 'Q&A/문서 각각 포함·제외 태그와 and/or 옵션 — 비우면 전체 대상'),
            hashtagSlot,
          ),
          el(
            'div',
            { class: 'field' },
            el('span', { class: 'field-label' }, '검색 소스 (search_from)'),
            el(
              'div',
              { class: 'row', style: 'gap: 16px;' },
              checkbox('문서 (document)', {
                checked: searchFromState.document,
                onChange: (v) => {
                  searchFromState.document = v;
                  refreshCode();
                },
              }),
              checkbox('Q&A (qna)', {
                checked: searchFromState.qna,
                onChange: (v) => {
                  searchFromState.qna = v;
                  refreshCode();
                },
              }),
              checkbox('웹 (web)', {
                checked: searchFromState.web,
                onChange: (v) => {
                  searchFromState.web = v;
                  refreshCode();
                },
              }),
            ),
            el('span', { class: 'field-hint' }, '체크한 소스만 배열로 전송 — 모두 비우면 서버 기본값을 사용합니다'),
          ),
          el(
            'div',
            { class: 'field' },
            el('span', { class: 'field-label' }, '근거 (clues)'),
            cluesCheck,
            clueTextCheck,
            el('span', { class: 'field-hint' }, 'clueText는 clues가 켜졌을 때만 동작합니다 — 출처 패널에 본문이 함께 표시됩니다'),
          ),
          el(
            'div',
            { class: 'field' },
            el('span', { class: 'field-label' }, '멀티턴'),
            statefulCheck,
            hasOwnUserId
              ? null
              : banner(
                  'OWN-USER-ID 미설정 — 멀티턴(threadId)이 비활성화됩니다. 연결 화면에서 호출자 식별자를 설정하세요',
                  'warn',
                ),
          ),
          field('answerFormat', el('div', {}, badge('MARKDOWN (고정)', 'on')), {
            hint: 'DraftJS 기본값 함정 회피 (§3.4) — SDK가 항상 MARKDOWN을 지정합니다',
          }),
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
          el('span', { class: 'field-hint' }, 'stream은 sync와 동일 포맷의 JSON 조각을 스트리밍합니다 (SSE 아님)'),
        ),
        el('div', { class: 'stack' }, threadSlot, turnsSlot, statusSlot, rawSlot, code.el),
      ),
    ),
  );

  refreshCode();
}
