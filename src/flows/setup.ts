/* 초기 설정 — 생성 코드의 전제(백엔드 환경변수 ALLI_API_KEY) 사전 가이드.
   API 호출이 없는 정적 안내 화면. 모든 화면의 코드 생성은 "키가 백엔드 환경변수로
   주입돼 있다"는 전제로 작성되며(SSOT §7-1), 그 전제를 이 화면이 한 번에 안내한다.
   플레이그라운드 자체 세션의 키 입력·검증은 연결 화면(Flow 1) — 이 가이드와 별개. */
import { el } from '../lib/dom';
import { codeBlock, type CodeLanguage } from '../ui/code-block';
import { banner, button, copyButton, page } from '../ui/widgets';

const ENV_BASH = `export ALLI_API_KEY=발급받은키                          # 현재 셸에만 적용
echo 'export ALLI_API_KEY=발급받은키' >> ~/.zshrc      # 영구 적용 (새 터미널부터, bash는 ~/.bashrc)`;

const ENV_POWERSHELL = `$env:ALLI_API_KEY = "발급받은키"      # 현재 세션에만 적용
setx ALLI_API_KEY "발급받은키"        # 영구 적용 (새 터미널부터)`;

const ENV_DOTENV = `# .env (dotenv 등으로 로드하는 경우)
ALLI_API_KEY=발급받은키`;

const BROWSER_INJECT = `<!-- 페이지를 서빙하는 백엔드 템플릿에서 — 환경변수 ALLI_API_KEY를 읽어 주입 (테스트 환경 한정) -->
<script>globalThis.ALLI_API_KEY = "{{ env.ALLI_API_KEY }}";</script>`;

const VERIFY = `echo $ALLI_API_KEY                  # macOS/Linux — 값이 출력되면 설정 완료
$env:ALLI_API_KEY                   # Windows PowerShell
curl -H "API-KEY: $ALLI_API_KEY" https://backend.alli.ai/webapi/v2/projects   # 200이면 키도 유효`;

function codeExample(title: string, code: string, language?: CodeLanguage): HTMLElement {
  return el(
    'div',
    { class: 'stack', style: 'gap: 8px;' },
    el('div', { class: 'spread' }, el('span', { class: 't-caption muted' }, title), copyButton(() => code)),
    codeBlock(code, language, { wrap: true }),
  );
}

function section(title: string, ...body: (HTMLElement | string | null)[]): HTMLElement {
  return el('section', { class: 'stack', style: 'gap: 12px;' }, el('h2', { class: 't-display-sm' }, title), ...body);
}

function para(text: string): HTMLElement {
  return el('p', { class: 't-body-sm' }, text);
}

export function render(container: HTMLElement): void {
  container.appendChild(
    page(
      '초기 설정',
      '생성 코드의 전제 조건을 한 번만 준비합니다 — API 키는 코드가 아니라 백엔드 환경변수에 둡니다.',
      el(
        'div',
        { class: 'stack', style: 'gap: 32px; max-width: 720px;' },
        banner(
          '이 화면은 API를 호출하지 않는 가이드입니다. 아래 설정을 마치면, 모든 화면의 생성 코드(curl / 브라우저 JS / Node.js / Python)는 이 설정이 완료됐다는 전제로 동작합니다 — 생성 코드에 키를 직접 적을 일은 없습니다.',
        ),

        section(
          '1. REST API 키 발급',
          para(
            'Alli 대시보드 Settings > General의 REST API 키를 사용합니다. ⚠️ JS 챗 위젯용 sdkKey와 다른 키입니다 — 혼동하면 7001(잘못된 API 키) 에러가 납니다.',
          ),
        ),

        section(
          '2. 백엔드 환경변수 ALLI_API_KEY 설정',
          para('생성 코드는 모두 키가 코드를 실행하는 백엔드 환경에 환경변수로 주입돼 있다고 가정합니다.'),
          codeExample('macOS / Linux (bash·zsh)', ENV_BASH, 'bash'),
          codeExample('Windows (PowerShell)', ENV_POWERSHELL, 'powershell'),
          codeExample('.env 파일', ENV_DOTENV, 'bash'),
          banner(
            '.env 파일은 반드시 .gitignore에 추가하세요 — 저장소에 키를 커밋하면 안 됩니다. 컨테이너/CI 환경은 시크릿 매니저(예: GitHub Actions Secrets, Vault)로 주입하세요.',
            'warn',
          ),
        ),

        section(
          '3. 브라우저에서 쓸 때',
          para(
            '브라우저 소스/번들에는 키를 절대 넣지 않습니다. 브라우저용 생성 코드는 페이지를 서빙하는 백엔드가 환경변수 값을 읽어 주입(globalThis.ALLI_API_KEY)한다는 전제로 작성됩니다.',
          ),
          codeExample('백엔드 템플릿 주입 예시', BROWSER_INJECT, 'xml'),
          banner(
            '운영에서는 주입 대신 백엔드 프록시 경유를 권장합니다 — 브라우저는 자체 백엔드만 호출하고, API-KEY 헤더는 프록시가 환경변수에서 붙입니다. 키가 브라우저로 전혀 내려가지 않습니다.',
            'warn',
          ),
        ),

        section(
          '4. 설정 확인',
          codeExample('환경변수·키 유효성 확인', VERIFY, 'bash'),
        ),

        section(
          '다음 단계',
          para(
            '연결 화면에서 키를 검증하고 세션에 고정하세요. 연결 화면의 키 입력은 이 플레이그라운드의 브라우저 세션 전용이며, 생성 코드에는 절대 삽입되지 않습니다.',
          ),
          el('div', {}, button('연결 화면으로 이동', { onClick: () => (location.hash = '#/connect') })),
        ),
      ),
    ),
  );
}
