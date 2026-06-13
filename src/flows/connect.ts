/* Flow 1 — API Key 검증 (SSOT §4 Flow 1)
   Base URL(US 리전 고정) + API 키 + (권장) OWN-USER-ID를 받아 GET /v2/projects로 검증하고
   성공 시 세션에 고정한다. 키는 sessionStorage(탭 한정)가 기본, 영구 저장은 경고 동반 옵트인. */
import { el, clear } from '../lib/dom';
import { specs } from '../core/endpoints';
import { buildUrl } from '../core/request-spec';
import { encodeOwnUserId, isAscii } from '../core/encoding';
import { REGION_BASE_URLS, session, isConnected } from '../state/session';
import { makeClient } from '../state/client';
import { badge, banner, button, checkbox, field, page, spinner, textInput } from '../ui/widgets';
import { errorPanel } from '../ui/error-panel';
import { rawView } from '../ui/raw-view';
import { codePanel } from '../ui/code-panel';

export function render(container: HTMLElement): void {
  const saved = session.get();

  // ---- 폼 상태 ---- (리전은 US 고정 — 수정 불가)
  const baseUrl = REGION_BASE_URLS.us;
  let apiKey = saved.apiKey;
  let ownUserId = saved.ownUserId;
  let userEmail = saved.userEmail;
  let persist = saved.persist;
  let checking = false;

  // ---- 코드 생성 패널 (현재 폼 상태 기준) ----
  const code = codePanel(
    () => ({ spec: specs.projects(), wrapper: { kind: 'none' } }),
    () => ({
      baseUrl,
      ownUserId: ownUserId.trim() || undefined,
      userEmail: userEmail.trim() || undefined,
    }),
  );
  const refreshCode = () => code.refresh();

  // ---- 컨트롤 ----
  const keyInput = textInput({
    type: 'password',
    mono: true,
    placeholder: 'REST API 키',
    value: apiKey,
    onInput: (v) => {
      apiKey = v;
    },
    onEnter: () => void check(),
  }) as HTMLInputElement;

  const revealBtn = button('표시', {
    small: true,
    variant: 'quiet',
    onClick: () => {
      const hidden = keyInput.type === 'password';
      keyInput.type = hidden ? 'text' : 'password';
      revealBtn.textContent = hidden ? '숨김' : '표시';
    },
  });

  const ownUserPreview = el('span', { class: 'field-hint' });
  const updateOwnUserPreview = (): void => {
    const v = ownUserId.trim();
    if (!v) ownUserPreview.textContent = '';
    else if (isAscii(v)) ownUserPreview.textContent = `전송 값: ${v} (그대로)`;
    else ownUserPreview.textContent = `전송 값: ${encodeOwnUserId(v)} (비ASCII → base64: 자동 변환)`;
  };
  updateOwnUserPreview();

  const persistWarn = banner(
    '경고 — 영구 저장을 켜면 API 키가 이 브라우저의 localStorage에 평문으로 남습니다. 공용 PC에서는 사용하지 마세요.',
    'warn',
  );
  persistWarn.style.display = persist ? '' : 'none';

  // ---- 결과 영역 ----
  const statusSlot = el('div', {});
  const rawSlot = el('div', {});

  const checkBtn = button('프로젝트 확인', { onClick: () => void check() });

  async function check(): Promise<void> {
    if (checking) return;
    const base = baseUrl;
    clear(statusSlot);
    clear(rawSlot);

    if (!apiKey.trim()) {
      statusSlot.appendChild(banner('API 키를 입력하세요 — 대시보드 Settings > General의 REST API 키 (JS 챗 위젯용 sdkKey 아님)', 'warn'));
      return;
    }

    checking = true;
    checkBtn.disabled = true;
    statusSlot.append(spinner(), el('span', { class: 't-caption muted', style: 'margin-left: 8px;' }, 'GET /webapi/v2/projects 호출 중'));

    const client = makeClient({
      baseUrl: base,
      apiKey: apiKey.trim(),
      ownUserId: ownUserId.trim() || undefined,
      userEmail: userEmail.trim() || undefined,
    });
    const spec = specs.projects();

    try {
      const res = await client.execute(spec);
      // 200 = 검증 성공 (§5.1 — 스키마 미상세라 상태 코드만 신뢰)
      session.set({
        region: 'us',
        baseUrl: base,
        apiKey: apiKey.trim(),
        ownUserId: ownUserId.trim(),
        userEmail: userEmail.trim(),
        persist,
        validated: true,
      });
      clear(statusSlot);
      statusSlot.append(
        banner('검증 성공 — 세션에 저장되었습니다. 앱 화면에서 테스트할 앱을 선택하세요.', 'success'),
        el('div', { style: 'margin-top: 16px;' }, button('앱 목록으로 이동', { onClick: () => (location.hash = '#/apps') })),
      );
      rawSlot.appendChild(
        rawView({
          request: { method: spec.method, url: buildUrl(base, spec), headers: client.buildHeaders(spec) },
          status: res.status,
          elapsedMs: res.elapsedMs,
          responseText: res.rawBody,
        }),
      );
    } catch (e) {
      clear(statusSlot);
      statusSlot.appendChild(errorPanel(e, 'connect', { rawOpen: true }));
    } finally {
      checking = false;
      checkBtn.disabled = false;
    }
  }

  // ---- 레이아웃 ----
  container.appendChild(
    page(
      '연결',
      'Base URL과 API 키를 검증하고 세션에 고정합니다. 키는 이 탭에만 보관됩니다(탭을 닫으면 소멸).',
      el(
        'div',
        { class: 'grid-2col' },
        el(
          'div',
          { class: 'stack' },
          isConnected() ? el('div', {}, badge('현재 연결됨 — 다시 검증하면 설정이 교체됩니다', 'on')) : null,
          field('리전', el('div', {}, badge('US — backend.alli.ai', 'on')), {
            hint: 'US 리전으로 고정되어 있습니다',
          }),
          field('API 키', el('div', { class: 'row' }, keyInput, revealBtn), {
            hint: '대시보드 Settings > General의 REST API 키 — JS 챗 위젯용 sdkKey와 다른 키입니다',
          }),
          el(
            'div',
            { class: 'field' },
            el('span', { class: 'field-label' }, 'OWN-USER-ID (옵션, 권장)'),
            textInput({
              mono: true,
              placeholder: 'ERP 사번 (예: EMP12345) / RPA는 시스템 계정 ID',
              value: ownUserId,
              onInput: (v) => {
                ownUserId = v;
                updateOwnUserPreview();
                refreshCode();
              },
            }),
            ownUserPreview,
            el(
              'span',
              { class: 'field-hint' },
              '호출의 최종 사용자를 기록하는 귀속 식별자 — 멀티턴(답변 생성·대화)의 전제조건입니다. 미지정 시 모든 호출이 "프로젝트 기본 사용자"로 합쳐지고 멀티턴이 비활성화됩니다. 처음 보는 ID는 Alli가 자동 생성하므로 사전 등록이 필요 없습니다.',
            ),
          ),
          field(
            'USER-EMAIL (옵션)',
            textInput({
              mono: true,
              placeholder: 'OWN-USER-ID 사용자의 이메일을 함께 갱신할 때',
              value: userEmail,
              onInput: (v) => {
                userEmail = v;
                refreshCode();
              },
            }),
          ),
          checkbox('이 브라우저에 영구 저장 (localStorage)', {
            checked: persist,
            onChange: (v) => {
              persist = v;
              persistWarn.style.display = v ? '' : 'none';
            },
          }),
          persistWarn,
          el('div', {}, checkBtn),
        ),
        el('div', { class: 'stack' }, statusSlot, rawSlot, code.el),
      ),
    ),
  );

  refreshCode();
}
