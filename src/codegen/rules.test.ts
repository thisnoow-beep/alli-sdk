/* §7 코드 생성 규약 적대적 테스트 — 스펙(SSOT §7·§3.2~3.5·§5)에서 도출한 체크리스트 기반.
   체크리스트 (구현 확인 전에 작성):
     1. 산출물 정확히 4개 [curl, browser, node, python] + setLabel/title 계약 (plan.ts, §7 서두)
     2. 키 보안 — 실 키 미삽입, 전 변형 환경변수 ALLI_API_KEY 전제(브라우저는 백엔드 주입 값 참조) (§7-1)
     3. OWN-USER-ID 주입 + 비ASCII base64: 변환 (§7-2, §3.2)
     4. Content-Type — JSON만 application/json, multipart는 미지정(-F/FormData/files=) (§7-3)
     5. multipart 패리티 — parts와 생성 코드 구조 일치 (§7 서두, request-spec 패리티 원칙)
     6. stream 소비 + JSON 조각 누적 파싱 헬퍼 (§7-5, §3.5 — SSE 아님)
     7. 에러 스켈레톤 — 코드표(7001~7004) 해석 (§7-4, §3.3)
     8. kb-replace 폴링 루프 — 간격/타임아웃/실패 분기/롤백 DELETE (§7-6, Flow 5, §5.11)
     9. 멀티턴 — threadId/conversationId 보관·재전송 (§7-7, Flow 4/6)
    10. 생성 코드는 "현재 입력값 그대로 동작" — 구문 유효성 (§7 서두)
   주의: 수치/단위 등 스펙이 표현을 고정하지 않은 항목은 의미 등가(예: ms↔s 환산)를 허용한다. */

import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateArtifacts } from './index';
import { specs } from '../core/endpoints';
import type { CodegenContext, CodegenPlan, GeneratedArtifact } from './plan';
import type { MultipartPart } from '../core/request-spec';

/* ---------- 테스트 plan A~G ---------- */

type PlanKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

const CTX: CodegenContext = { baseUrl: 'https://backend.alli.ai', ownUserId: '홍길동' };
const CTX_ASCII: CodegenContext = { baseUrl: 'https://backend.alli.ai', ownUserId: 'EMP12345' };

function gaSpec() {
  return specs.generativeAnswer({
    query: "연차 이월 규정 'A동' 알려줘",
    isStateful: true,
    clues: true,
    hashtags: { docsInclude: ['인사규정'], docsIncludeOption: 'or' },
    search_from: ['document', 'qna'],
    mode: 'sync',
  });
}

/** D: 텍스트 2개(message, conversationId) + 파일 2개(files/media_files) */
function dParts(): MultipartPart[] {
  return [
    { name: 'message', kind: 'text', value: '이 계약서를 검토해줘' },
    { name: 'conversationId', kind: 'text', value: 'conv-prev-001' },
    { name: 'files', kind: 'file', file: new File(['%PDF-1.4'], '계약서.pdf', { type: 'application/pdf' }) },
    { name: 'media_files', kind: 'file', file: new File(['PNG'], '스캔.png', { type: 'image/png' }) },
  ];
}

const PLANS: Record<PlanKey, { plan: CodegenPlan; ctx: CodegenContext }> = {
  A: { plan: { spec: gaSpec(), wrapper: { kind: 'none' } }, ctx: CTX },
  B: {
    plan: { spec: specs.listApps({ searchTerm: '요약', published: true, pageSize: 50 }), wrapper: { kind: 'none' } },
    ctx: CTX_ASCII,
  },
  C: {
    plan: { spec: specs.runApp('app-sum-001', { inputs: { input: '텍스트' }, mode: 'stream' }), wrapper: { kind: 'none' } },
    ctx: CTX,
  },
  D: { plan: { spec: specs.runConversation('app-doc-101', dParts()), wrapper: { kind: 'none' } }, ctx: CTX },
  E: {
    plan: {
      spec: specs.kbUpload([
        { name: 'fileName', kind: 'text', value: '취업규칙_v3.pdf' },
        { name: 'file', kind: 'file', file: new File(['%PDF-1.4'], '취업규칙_v3.pdf', { type: 'application/pdf' }) },
      ]),
      wrapper: { kind: 'kb-replace', oldNodeId: 'kb-001', pollInitialMs: 2000, pollMaxMs: 5000, pollTimeoutMs: 600000 },
    },
    ctx: CTX,
  },
  F: { plan: { spec: gaSpec(), wrapper: { kind: 'ga-thread-loop' } }, ctx: CTX },
  G: { plan: { spec: specs.runConversation('app-doc-101', dParts()), wrapper: { kind: 'conversation-loop' } }, ctx: CTX },
};

const KEYS = Object.keys(PLANS) as PlanKey[];
const ARTS = Object.fromEntries(
  KEYS.map((k) => [k, generateArtifacts(PLANS[k].plan, PLANS[k].ctx)]),
) as Record<PlanKey, GeneratedArtifact[]>;

/** JSON 본문 plan (§7-3 application/json 대상) — B는 GET(본문 없음)이라 제외 */
const JSON_KEYS: PlanKey[] = ['A', 'C', 'F'];
const MULTIPART_KEYS: PlanKey[] = ['D', 'E'];
/** ctx.ownUserId='홍길동'(비ASCII)인 plan들 */
const HANGUL_CTX_KEYS: PlanKey[] = ['A', 'C', 'D', 'E', 'F', 'G'];

/* ---------- 헬퍼 ---------- */

function pick(key: PlanKey) {
  const [curl, browser, node, python] = ARTS[key];
  return { curl, browser, node, python };
}

/** 플로우 로직을 담는 변형(node 프록시 제외) — node는 플로우 무관 리버스 프록시라 플로우 내용을 담지 않는다 */
function flowArts(key: PlanKey): GeneratedArtifact[] {
  return ARTS[key].filter((a) => a.variant !== 'node');
}

function count(code: string, re: RegExp): number {
  return (code.match(re) ?? []).length;
}

/** multipart 필드명이 "필드로서" 등장하는지 — 따옴표로 감싸이거나 `name=` 형태 (media_files의 부분문자열 files 오탐 방지) */
function fieldRe(name: string): RegExp {
  return new RegExp(`["']${name}["']|[^A-Za-z0-9_]${name}=`);
}

/** 주석/문서화 줄 제거 — 호출 횟수 셀 때 주석 속 예시가 끼지 않도록 */
function stripCommentLines(code: string): string {
  return code
    .split('\n')
    .filter((l) => !/^\s*(\/\/|#|\*|\/\*|"""|''')/.test(l))
    .join('\n');
}

/** 멀티턴 함수(query를 첫 인자로 받는 함수)의 "호출" 횟수 — 정의 줄은 lookbehind로 제외 */
function multiturnCallCount(code: string): number {
  const src = stripCommentLines(code);
  const def = src.match(/(?:function|def)\s+([A-Za-z_]\w*)\s*\(\s*query/);
  if (!def) return 0;
  return count(src, new RegExp(`(?<!function )(?<!def )\\b${def[1]}\\s*\\(`, 'g'));
}

/** 폴링 설정값 검증 — 스펙(§7-6)은 간격·타임아웃 포함만 요구하고 단위를 고정하지 않으므로
    ms 원값 또는 정확한 초 환산값이 폴링 관련 줄에 할당돼 있으면 통과 */
function expectPollConfig(code: string, variant: string, ms: number): void {
  const sec = ms / 1000;
  const pollLines = code
    .split('\n')
    .filter((l) => /poll|interval|timeout|sleep|간격|타임아웃/i.test(l))
    .join('\n');
  const re = new RegExp(`[=:]\\s*${ms}\\b|[=:]\\s*${sec}(?:\\.0)?\\b`);
  expect(pollLines, `${variant}: 폴링 설정 ${ms}ms(또는 ${sec}s)가 폴링 코드에 없음`).toMatch(re);
}

/* ---------- 1. 산출물 형태 계약 (plan.ts / §7 서두) ---------- */

describe('산출물 계약 — 정확히 4개, 순서/라벨/타이틀', () => {
  it.each(KEYS)('plan %s — [curl,browser,node,python] + setLabel/언어 매핑 + Node 20 타이틀', (key) => {
    const arts = ARTS[key];
    expect(arts).toHaveLength(4);
    expect(arts.map((a) => a.variant)).toEqual(['curl', 'browser', 'node', 'python']);
    expect(arts.map((a) => a.setLabel)).toEqual(['curl', 'JavaScript', 'JavaScript', 'Python']);
    expect(arts.map((a) => a.language)).toEqual(['bash', 'javascript', 'javascript', 'python']);
    expect(arts[2].title).toContain('Node.js');
    expect(arts[2].title).toContain('20');
    for (const a of arts) {
      // curl은 단독 실행을 위해 Base URL을 명령어에 인라인, 나머지는 BASE_URL 상수
      if (a.variant !== 'curl') {
        expect(a.code, `${a.variant}: BASE_URL 상수`).toContain('BASE_URL');
      }
      // 브라우저는 같은 출처 프록시(/api)만 알고 Alli 주소는 모른다 (Model A) — 나머지는 Alli 주소 주입
      if (a.variant === 'browser') {
        expect(a.code, 'browser: /api 프록시 경로').toContain('"/api"');
        expect(a.code, 'browser: Alli 주소 비노출').not.toContain('https://backend.alli.ai');
      } else {
        expect(a.code, `${a.variant}: baseUrl 값 주입`).toContain('https://backend.alli.ai');
      }
    }
  });
});

describe('생성 코드에 내부 문서 참조 금지', () => {
  it.each(KEYS)('plan %s — SSOT/절 번호(§)가 생성 코드에 노출되지 않는다', (key) => {
    for (const a of ARTS[key]) {
      expect(a.code, `${a.variant}: 생성 코드는 SSOT 없이 그 자체로 읽혀야 한다`).not.toMatch(/SSOT|§/);
    }
  });
});

/* ---------- 2. 키 보안 (§7-1) ---------- */

describe('키 보안 (§7-1) — 실 키 미삽입, 전 변형 환경변수 ALLI_API_KEY 전제', () => {
  it.each(KEYS)('plan %s — env var 전제, 브라우저는 키 없이 프록시(/api) 호출 (Model A)', (key) => {
    const { curl, browser, node, python } = pick(key);
    for (const a of ARTS[key]) {
      // 실 키처럼 보이는 긴 영숫자 토큰이 따옴표로 박혀 있으면 안 된다
      expect(a.code, `${a.variant}: 실 키 형태 토큰 발견`).not.toMatch(/['"][A-Za-z0-9_-]{30,}['"]/);
      // 키를 코드에 직접 적게 하는 placeholder 금지 — 환경변수 설정은 초기 설정 화면에서 사전 안내
      expect(a.code, `${a.variant}: 키 placeholder 발견`).not.toContain('YOUR_API_KEY');
    }
    expect(curl.code).toContain('$ALLI_API_KEY');
    expect(node.code).toContain('process.env.ALLI_API_KEY');
    expect(python.code).toContain('os.environ["ALLI_API_KEY"]');
    // 브라우저 변형 — 키 변수명조차 없고 같은 출처 프록시(/api)를 호출 (키는 프록시 서버에만 존재)
    expect(browser.code, 'browser: 키 미포함').not.toContain('ALLI_API_KEY');
    expect(browser.code, 'browser: /api 프록시 호출').toContain('"/api"');
    expect(browser.code, 'browser: 프록시 안내 주석').toContain('프록시');
  });
});

/* ---------- 3. OWN-USER-ID (§7-2, §3.2) ---------- */

describe('OWN-USER-ID (§7-2) — 비ASCII는 base64: 변환, ASCII는 그대로', () => {
  it.each(HANGUL_CTX_KEYS)('plan %s — curl 사전 인코딩 리터럴 + browser/python 헬퍼·원본', (key) => {
    const { curl, browser, python } = pick(key);
    // base64('홍길동') === '7ZmN6ri464+Z' — encoding.ts 문서화 고정값
    expect(curl.code, 'curl: 미리 인코딩된 base64: 리터럴').toContain('base64:7ZmN6ri464+Z');
    // node 프록시는 OWN-USER-ID를 주입하지 않고 클라이언트 헤더를 그대로 포워딩 — browser/python만 헬퍼 주입
    for (const a of [browser, python]) {
      expect(a.code, `${a.variant}: base64: 변환 헬퍼 동봉`).toContain('base64:');
      expect(a.code, `${a.variant}: 원본 식별자 보존`).toContain('홍길동');
    }
  });

  it('plan B — ASCII(EMP12345)는 curl에 변환 없이 그대로', () => {
    const { curl, browser, python } = pick('B');
    expect(curl.code).toMatch(/OWN-USER-ID:\s*EMP12345/);
    expect(curl.code).not.toContain('base64:EMP12345');
    for (const a of [browser, python]) expect(a.code, a.variant).toContain('EMP12345');
  });
});

/* ---------- 4. Content-Type (§7-3) ---------- */

describe('Content-Type (§7-3) — JSON만 명시, multipart는 boundary 자동', () => {
  it.each(JSON_KEYS)('plan %s(JSON) — curl/browser/python에 application/json (node 프록시는 본문 포워딩)', (key) => {
    for (const a of flowArts(key)) expect(a.code, a.variant).toContain('application/json');
  });

  it.each(MULTIPART_KEYS)('plan %s(multipart) — application/json 부재 + Content-Type 직접 지정 금지', (key) => {
    const { curl, browser, node, python } = pick(key);
    for (const a of ARTS[key]) {
      expect(a.code, `${a.variant}: multipart에 application/json 금지`).not.toContain('application/json');
      expect(a.code, `${a.variant}: multipart/form-data 직접 지정 금지`).not.toMatch(
        /Content-Type['"]?\s*[:=]\s*['"]?multipart\/form-data/i,
      );
    }
    expect(curl.code, 'curl: -H Content-Type 헤더 자체가 없어야 함').not.toMatch(/-H\s+['"]?Content-Type/i);
    expect(curl.code, 'curl: -F 사용').toMatch(/-F\s/);
    expect(browser.code, 'browser: FormData 사용').toContain('FormData');
    expect(node.code, 'node: 프록시는 본문 스트림을 그대로 포워딩').toContain('Readable.toWeb(req)');
    expect(python.code, 'python: files= 사용').toMatch(/files\s*=/);
    for (const a of [browser, node, python]) {
      expect(a.code, `${a.variant}: Content-Type 헤더 키 설정 금지`).not.toMatch(/["']Content-Type["']\s*:/);
    }
  });
});

/* ---------- 5. multipart 패리티 (D) ---------- */

describe('multipart 패리티 (D) — parts 배열과 생성 코드 1:1', () => {
  it('모든 파트명이 필드로서, 모든 파일명이 4개 변형 전부에 등장', () => {
    const names = ['message', 'conversationId', 'files', 'media_files'];
    // node 프록시는 플로우 무관이라 파트명/파일명을 담지 않는다 — curl/browser/python만 검사
    for (const a of flowArts('D')) {
      for (const n of names) expect(a.code, `${a.variant}: 파트 ${n} 누락`).toMatch(fieldRe(n));
      expect(a.code, `${a.variant}: 파일명 계약서.pdf 누락`).toContain('계약서.pdf');
      expect(a.code, `${a.variant}: 파일명 스캔.png 누락`).toContain('스캔.png');
    }
  });

  it('curl -F 개수 == parts 수(4)', () => {
    const { curl } = pick('D');
    expect(count(curl.code, /-F\s/g)).toBe(4);
  });

  it('python files 튜플에 media_files 포함', () => {
    const { python } = pick('D');
    expect(python.code).toMatch(/\(\s*["']media_files["']\s*,/);
  });
});

/* ---------- 6. stream 소비 (C, §7-5/§3.5) ---------- */

describe('stream 소비 (C) — SSE 아님, JSON 조각 누적 파싱', () => {
  it('변형별 스트림 소비 구문 + JSON 추출 헬퍼 동봉', () => {
    const { curl, browser, node, python } = pick('C');
    expect(curl.code).toContain('--no-buffer');
    expect(browser.code).toContain('getReader');
    expect(node.code).toContain('Readable.fromWeb'); // 프록시는 응답 스트림을 그대로 pipe
    expect(python.code).toContain('iter_content');
    // 청크 누적 → JSON 단위 파싱 헬퍼는 소비 측(browser/python)에만 — node 프록시는 파싱하지 않고 pipe
    for (const a of [browser, python]) {
      expect(a.code, `${a.variant}: JSON 추출 헬퍼 부재`).toMatch(/(?:function|def)\s+\w*json\w*\s*\(/i);
    }
  });
});

/* ---------- 7. 에러 스켈레톤 (§7-4, §3.3) ---------- */

describe('에러 스켈레톤 (§7-4) — 코드표 해석 주석', () => {
  it.each(KEYS)('plan %s — curl/browser/python에 7001 코드표 (node 프록시는 에러를 그대로 전달)', (key) => {
    for (const a of flowArts(key)) expect(a.code, a.variant).toContain('7001');
  });
});

/* ---------- 8. kb-replace (E, §7-6 / Flow 5 / §5.11) ---------- */

describe('kb-replace (E) — 업로드 → 폴링 → 삭제/롤백', () => {
  it('curl/browser/python 모두 폴링 경로·종료 상태·구 노드/롤백 삭제·폴링 설정값 포함 (node 프록시 제외)', () => {
    for (const a of flowArts('E')) {
      expect(a.code, `${a.variant}: ingestion_status 경로`).toContain('ingestion_status');
      expect(a.code, `${a.variant}: 성공 상태 post_completed`).toContain('post_completed');
      expect(a.code, `${a.variant}: 실패 상태 parsing_fail`).toContain('parsing_fail');
      expect(a.code, `${a.variant}: 구 노드 kb-001`).toContain('kb-001');
      expect(a.code, `${a.variant}: 실패 시 롤백 분기`).toContain('롤백');
      // DELETE 호출 2가지 — 성공 시 구 노드 삭제 + 실패 시 신규 노드 롤백 삭제
      expect(
        count(a.code, /-X DELETE|["']DELETE["']|\bdelete\w*\s*\(/gi),
        `${a.variant}: DELETE 호출 지점이 2개 미만`,
      ).toBeGreaterThanOrEqual(2);
      expectPollConfig(a.code, a.variant, 2000);
      expectPollConfig(a.code, a.variant, 5000);
      expectPollConfig(a.code, a.variant, 600000);
    }
  });

  it('curl 변형은 bash 스크립트 — jq 미사용(grep 추출), bash 언급 주석', () => {
    const { curl } = pick('E');
    expect(curl.code).toMatch(/bash/);
    expect(curl.code).toContain('grep');
    // jq "사용"(파이프/호출) 금지 — "jq 없이" 같은 안내 주석은 의존이 아니므로 허용
    expect(curl.code).not.toMatch(/\|\s*jq\b|\bjq\s+(-|\.)/);
  });
});

/* ---------- 9. 멀티턴 wrapper (F/G, §7-7 / Flow 4·6) ---------- */

describe('멀티턴 (§7-7)', () => {
  it('F(ga-thread-loop) — threadId 보관·재전송 2회 호출 + OWN-USER-ID 전제 주석', () => {
    const { curl, browser, python } = pick('F');
    // 멀티턴 오케스트레이션은 curl/browser/python에 담긴다 — node 프록시는 플로우 무관
    for (const a of flowArts('F')) {
      expect(a.code, `${a.variant}: threadId 부재`).toContain('threadId');
      // 전제 주석 — OWN-USER-ID 없으면 threadId(멀티턴) 비활성 (§3.2)
      expect(a.code, `${a.variant}: OWN-USER-ID 전제 주석 부재`).toMatch(
        /OWN-USER-ID[^\n]*threadId|threadId[^\n]*OWN-USER-ID/,
      );
    }
    expect(count(curl.code, /(?:^|\n)\s*curl\b/g), 'curl: 1차/2차 호출 2회').toBeGreaterThanOrEqual(2);
    expect(curl.code, 'curl: 1차 응답 threadId 재사용 변수').toContain('$THREAD_ID');
    for (const a of [browser, python]) {
      expect(multiturnCallCount(a.code), `${a.variant}: 멀티턴 함수가 2회 이상 호출되지 않음`).toBeGreaterThanOrEqual(2);
    }
  });

  it('G(conversation-loop) — conversationId 보관 + deep-scan 헬퍼 흔적', () => {
    const { browser, python } = pick('G');
    for (const a of flowArts('G')) expect(a.code, `${a.variant}: conversationId 부재`).toContain('conversationId');
    for (const a of [browser, python]) {
      // 스트리밍 응답 스키마 미문서화(§9-2) → conversationId deep-scan 헬퍼 (node 프록시는 파싱하지 않음)
      expect(a.code, `${a.variant}: deep-scan 헬퍼 부재`).toMatch(/find[_]?conversation[_]?id/i);
    }
  });
});

/* ---------- 입력값 패리티 보강 (§7 서두 — "현재 입력값 그대로 동작") ---------- */

describe('입력값 패리티 — 이스케이프 생존·옵션 보존', () => {
  it("A — 따옴표 포함 질문/해시태그/search_from/MARKDOWN이 4개 변형 전부에", () => {
    for (const a of flowArts('A')) {
      expect(a.code, `${a.variant}: 질문 텍스트(A동) 소실`).toContain('A동');
      expect(a.code, `${a.variant}: hashtags(인사규정) 소실`).toContain('인사규정');
      expect(a.code, `${a.variant}: search_from 소실`).toContain('search_from');
      expect(a.code, `${a.variant}: answerFormat MARKDOWN 강제(§3.4) 소실`).toContain('MARKDOWN');
      expect(a.code, `${a.variant}: isStateful 소실`).toContain('isStateful');
    }
  });

  it('B — GET 쿼리스트링이 4개 변형 전부에 동일하게', () => {
    for (const a of flowArts('B')) {
      expect(a.code, a.variant).toContain('searchTerm=');
      expect(a.code, a.variant).toContain('published=true');
      expect(a.code, a.variant).toContain('pageSize=50');
    }
  });
});

/* ---------- 10. 구문 검증 (가드된 통합 테스트) ---------- */

function detectPython(): string | null {
  for (const exe of ['python', 'python3', 'py']) {
    try {
      const r = spawnSync(exe, ['--version'], { encoding: 'utf8' });
      if (r.status === 0 && /Python 3/.test(`${r.stdout}${r.stderr}`)) return exe;
    } catch {
      // 실행 파일 없음 — 다음 후보 시도
    }
  }
  return null;
}

describe('구문 검증 — 생성 코드는 그대로 실행 가능해야 한다 (§7 서두)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'alli-codegen-rules-'));
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it.each(KEYS)('plan %s — browser/node 아티팩트가 node --check 통과', (key) => {
    const { browser, node } = pick(key);
    for (const a of [browser, node]) {
      const file = join(tmp, `${key}-${a.variant}.mjs`);
      writeFileSync(file, a.code, 'utf8');
      const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      expect(r.status, `${a.variant} 구문 오류:\n${r.stderr}`).toBe(0);
    }
  });

  const PY = detectPython();
  const pyIt = PY ? it : it.skip; // python 미설치 환경에서는 skip
  pyIt.each(KEYS)('plan %s — python 아티팩트가 py_compile 통과', (key) => {
    const { python } = pick(key);
    const file = join(tmp, `${key}-python.py`);
    writeFileSync(file, python.code, 'utf8');
    const r = spawnSync(PY as string, ['-m', 'py_compile', file], { encoding: 'utf8' });
    expect(r.status, `python 구문 오류:\n${r.stderr}`).toBe(0);
  });
});

/* ---------- Node.js 리버스 프록시 계약 (Model A) ---------- */

describe('Node.js 프록시 (Model A) — 플로우 무관 리버스 프록시', () => {
  it.each(KEYS)('plan %s — node 변형은 /api 포워딩·키 주입·스트림 pipe 골격', (key) => {
    const { node } = pick(key);
    expect(node.code, 'createServer 서버').toContain('createServer');
    expect(node.code, '/api 접두사').toContain('"/api"');
    expect(node.code, 'Alli 주소 보유').toContain('https://backend.alli.ai');
    expect(node.code, 'API-KEY 주입(키는 이 서버에만)').toContain('headers["API-KEY"] = API_KEY');
    expect(node.code, '요청 본문 스트림 포워딩').toContain('Readable.toWeb(req)');
    expect(node.code, '응답 스트림 pipe').toContain('.pipe(res)');
    // 프록시는 플로우 오케스트레이션을 담지 않는다 (폴링/멀티턴은 클라이언트 몫)
    expect(node.code, '폴링 로직 비포함').not.toContain('ingestion_status');
    expect(node.code, '멀티턴 로직 비포함').not.toContain('threadId');
  });

  it('프록시 코드는 같은 ctx면 플로우와 무관하게 동일하다 (A == E == G)', () => {
    expect(ARTS.E[2].code).toBe(ARTS.A[2].code);
    expect(ARTS.G[2].code).toBe(ARTS.A[2].code);
  });
});
