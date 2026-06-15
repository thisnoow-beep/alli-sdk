/* 코드 생성 스모크 테스트 — 순서/제목, 이스케이프 생존, Python 리터럴 변환, 키 취급.
   JavaScript는 Model A: browser=같은 출처 프록시(/api) 호출(키 없음),
   node=플로우 무관 리버스 프록시(키 주입). 정밀 규칙(패리티 등) 테스트는 rules.test.ts. */

import { describe, expect, it } from 'vitest';
import { generateArtifacts } from './index';
import { specs } from '../core/endpoints';
import type { CodegenContext, CodegenPlan } from './plan';

const ctx: CodegenContext = { baseUrl: 'https://backend.alli.ai', ownUserId: '홍길동' };

function plan(spec: CodegenPlan['spec'], wrapper: CodegenPlan['wrapper'] = { kind: 'none' }): CodegenPlan {
  return { spec, wrapper };
}

const gaPlan = () =>
  plan(specs.generativeAnswer({ query: "오늘 '연차' 규정 알려줘", isStateful: true, mode: 'sync' }));

describe('generateArtifacts — 순서/제목 계약', () => {
  it('정확히 4개를 [curl, browser, node, python] 순서로 반환한다', () => {
    const arts = generateArtifacts(gaPlan(), ctx);
    expect(arts).toHaveLength(4);
    expect(arts.map((a) => a.variant)).toEqual(['curl', 'browser', 'node', 'python']);
    expect(arts.map((a) => a.title)).toEqual([
      'curl',
      '브라우저 (프록시 호출)',
      'Node.js 프록시 (20+)',
      'Python (requests)',
    ]);
    expect(arts.map((a) => a.setLabel)).toEqual(['curl', 'JavaScript', 'JavaScript', 'Python']);
    expect(arts.map((a) => a.language)).toEqual(['bash', 'javascript', 'javascript', 'python']);
  });
});

describe('키 취급 (§7-1, Model A) — 실 키 미삽입, 브라우저엔 키 없음', () => {
  it('curl/node/python은 환경변수 전제, 브라우저는 키 없이 프록시(/api)를 호출한다', () => {
    const [curl, browser, node, python] = generateArtifacts(gaPlan(), ctx);
    expect(curl.code).toContain('"API-KEY: $ALLI_API_KEY"');
    expect(curl.code).toContain('# 전제: 환경변수 ALLI_API_KEY 설정 완료');
    // 브라우저 — 키 변수명조차 코드에 없고, 같은 출처 프록시(/api)를 호출
    expect(browser.code).not.toContain('YOUR_API_KEY');
    expect(browser.code).not.toContain('ALLI_API_KEY');
    expect(browser.code).not.toContain('globalThis');
    expect(browser.code).toContain('const BASE_URL = "/api"');
    expect(browser.code).toContain('프록시');
    // Node.js — 리버스 프록시가 키를 쥐고 주입
    expect(node.code).toContain('const API_KEY = process.env.ALLI_API_KEY;');
    expect(node.code).toContain('if (!API_KEY) throw');
    expect(node.code).toContain('createServer');
    expect(node.code).toContain('headers["API-KEY"] = API_KEY');
    expect(python.code).toContain('API_KEY = os.environ["ALLI_API_KEY"]');
  });
});

describe('이스케이프/리터럴 변환 (§7-6)', () => {
  it('한글·작은따옴표 쿼리가 curl 셸 single-quote 이스케이프에서 살아남는다', () => {
    const [curl] = generateArtifacts(gaPlan(), ctx);
    expect(curl.code).toContain("오늘 '\\''연차'\\'' 규정 알려줘");
    expect(curl.code).toContain('--data-raw');
  });

  it('python은 true/false/null을 True/False/None으로 변환하고 한글은 그대로 둔다', () => {
    const p = plan(
      specs.runApp('APP_1', { inputs: { flag: true, off: false, note: null, label: '요약' }, mode: 'sync' }),
    );
    const python = generateArtifacts(p, ctx)[3];
    expect(python.code).toContain('"flag": True');
    expect(python.code).toContain('"off": False');
    expect(python.code).toContain('"note": None');
    expect(python.code).toContain('"label": "요약"');
    expect(python.code).not.toContain(': true');
    expect(python.code).not.toContain(': false');
    expect(python.code).not.toContain(': null');
  });
});

describe('OWN-USER-ID 헤더 (§7-2)', () => {
  it('curl은 사전 인코딩 base64: 리터럴, browser/python은 헬퍼 — node 프록시는 헤더를 그대로 포워딩', () => {
    const [curl, browser, node, python] = generateArtifacts(gaPlan(), ctx);
    expect(curl.code).toContain('OWN-USER-ID: base64:7ZmN6ri464+Z'); // encodeOwnUserId('홍길동') 고정값
    expect(curl.code).toContain("base64: 인코딩 (echo -n '값' | base64)");
    expect(browser.code).toContain('encodeOwnUserId("홍길동")');
    expect(python.code).toContain('encode_own_user_id("홍길동")');
    expect(python.code).toContain('def encode_own_user_id(');
    // node 프록시는 OWN-USER-ID를 주입하지 않고 클라이언트가 보낸 헤더를 그대로 전달
    expect(node.code).not.toContain('홍길동');
  });

  it('ownUserId 미설정이면 OWN-USER-ID 헤더와 헬퍼가 생성되지 않는다', () => {
    const arts = generateArtifacts(gaPlan(), { baseUrl: 'https://backend.alli.ai' });
    for (const a of arts) {
      expect(a.code).not.toContain('OWN-USER-ID');
    }
  });
});

describe('stream 소비 코드 (§7-5)', () => {
  it('변형별 스트림 소비 + extract_json_values 헬퍼 (node 프록시는 스트림 pipe)', () => {
    const p = plan(specs.generativeAnswer({ query: '연차 규정', mode: 'stream' }));
    const [curl, browser, node, python] = generateArtifacts(p, ctx);
    expect(curl.code).toContain('--no-buffer');
    expect(curl.code).toContain('JSON 조각 스트림');
    expect(browser.code).toContain('res.body.getReader()');
    expect(browser.code).toContain('new TextDecoder("utf-8")');
    expect(browser.code).toContain('decoder.decode(value, { stream: true })');
    expect(browser.code).toContain('function extractJsonValues(');
    expect(node.code).toContain('.pipe(res)'); // 프록시는 응답 스트림을 그대로 흘려보냄
    expect(python.code).toContain('stream=True');
    expect(python.code).toContain('iter_content(chunk_size=None)');
    expect(python.code).toContain('codecs.getincrementaldecoder("utf-8")()');
    expect(python.code).toContain('def extract_json_values(');
  });
});

describe('multipart 렌더링 (§7-7)', () => {
  it('parts 순서 1:1 — 텍스트/파일 형태가 변형별 규약을 따른다 (node 프록시는 본문 포워딩)', () => {
    const file = new File(['dummy'], 'contract.pdf', { type: 'application/pdf' });
    const p = plan(
      specs.runConversation('APP_1', [
        { name: 'message', kind: 'text', value: '이 문서를 요약해줘' },
        { name: 'files', kind: 'file', file },
      ]),
    );
    const [curl, browser, node, python] = generateArtifacts(p, ctx);
    expect(curl.code).toContain("-F 'message=이 문서를 요약해줘'");
    expect(curl.code).toContain("-F 'files=@./contract.pdf'");
    // multipart는 Content-Type 헤더를 직접 지정하지 않는다 (§7-3) — 주석 언급은 허용, 헤더 설정만 금지
    expect(curl.code).not.toContain("-H 'Content-Type");
    expect(browser.code).toContain('fd.append("message", "이 문서를 요약해줘");');
    expect(browser.code).toContain('fileInput.files[0]');
    expect(browser.code).toContain('<input type=file>에서:');
    expect(browser.code).not.toContain('"Content-Type": "application/json"');
    // node 프록시는 멀티파트 본문을 스트림 그대로 전달 — Content-Type/boundary 원본 유지
    expect(node.code).not.toContain('application/json');
    expect(node.code).toContain('Readable.toWeb(req)');
    expect(python.code).toContain('("files", ("contract.pdf", open("./contract.pdf", "rb")))');
    expect(python.code).not.toContain('"Content-Type": "application/json"'); // §7-3
  });
});

describe('GET/DELETE — Base URL + 경로 결합 (§7-8)', () => {
  it('쿼리스트링이 코드에서 그대로 읽힌다', () => {
    const p = plan(specs.listApps({ published: true, pageSize: 50 }));
    const [curl, browser, , python] = generateArtifacts(p, ctx);
    // curl은 Base URL을 명령어에 인라인 (§7-1)
    expect(curl.code).toContain('"https://backend.alli.ai/webapi/v2/apps?published=true&pageSize=50"');
    // 브라우저는 같은 출처 프록시(/api) 기준으로 경로를 붙인다
    expect(browser.code).toContain('`${BASE_URL}/webapi/v2/apps?published=true&pageSize=50`');
    expect(python.code).toContain('f"{BASE_URL}/webapi/v2/apps?published=true&pageSize=50"');
  });

  it('DELETE — 메서드가 명시된다', () => {
    const p = plan(specs.kbDelete('NODE_1'));
    const [curl, browser, , python] = generateArtifacts(p, ctx);
    expect(curl.code).toContain('curl -X DELETE');
    expect(browser.code).toContain('method: "DELETE"');
    expect(python.code).toContain('requests.delete(');
  });
});

describe('wrapper 3종 스모크', () => {
  it('ga-thread-loop — ask(query, threadId) + 멀티턴 안내 + curl THREAD_ID 템플릿', () => {
    const p = plan(specs.generativeAnswer({ query: '연차 이월 규정 알려줘', isStateful: true, mode: 'sync' }), {
      kind: 'ga-thread-loop',
    });
    const [curl, browser, , python] = generateArtifacts(p, ctx);
    expect(curl.code).toContain("THREAD_ID='1차_응답의_threadId'");
    expect(curl.code).toContain('"$THREAD_ID"');
    // 멀티턴 오케스트레이션은 브라우저(클라이언트)에서 수행
    expect(browser.code).toContain('async function ask(query, threadId)');
    expect(browser.code).toContain('OWN-USER-ID 헤더 없으면 threadId');
    expect(python.code).toContain('def ask(query, thread_id=None):');
    expect(python.code).toContain('OWN-USER-ID 헤더 없으면 threadId');
  });

  it('conversation-loop — deep-scan 헬퍼 + 후속 루프 + curl CONV_ID 템플릿', () => {
    const p = plan(specs.runConversation('APP_1', [{ name: 'message', kind: 'text', value: '견적을 시작할게요' }]), {
      kind: 'conversation-loop',
    });
    const [curl, browser, , python] = generateArtifacts(p, ctx);
    expect(curl.code).toContain("CONV_ID='1차_스트림에서_확보한_conversationId'");
    expect(curl.code).toContain('-F "conversationId=$CONV_ID"');
    expect(browser.code).toContain('function findConversationId(');
    expect(browser.code).toContain('deep-scan');
    expect(browser.code).toContain('sendMessage(');
    expect(python.code).toContain('def find_conversation_id(');
    expect(python.code).toContain('def send_message(message, conversation_id=None):');
  });

  it('kb-replace — 업로드→폴링→삭제 루틴 + bash 스크립트(grep 추출)', () => {
    const file = new File(['x'], '취업규칙_v3.pdf');
    const p = plan(
      specs.kbUpload([
        { name: 'fileName', kind: 'text', value: '취업규칙_v3.pdf' },
        { name: 'file', kind: 'file', file },
      ]),
      { kind: 'kb-replace', oldNodeId: 'OLD_NODE_1', pollInitialMs: 1000, pollMaxMs: 8000, pollTimeoutMs: 600000 },
    );
    const [curl, browser, , python] = generateArtifacts(p, ctx);
    expect(curl.code).toContain('# bash / Git Bash / WSL용');
    expect(curl.code).toContain("grep -o '\"id\" *: *\"[^\"]*\"'");
    expect(curl.code).toContain('OLD_NODE_1');
    expect(curl.code).toContain('업로드 → 완료 확인 → 삭제');
    for (const a of [browser, python]) {
      expect(a.code).toContain('업로드 → 완료 확인 → 삭제');
      expect(a.code).toContain('OLD_NODE_1');
      expect(a.code).toContain('post_completed');
      expect(a.code).toContain('parsing_fail');
      expect(a.code).toContain('롤백');
    }
    expect(python.code).toContain('def replace_document():');
    expect(browser.code).toContain('async function replaceDocument()');
  });
});

describe('Node.js 리버스 프록시 (Model A) — 플로우 무관', () => {
  it('프록시 서버 골격 — /api 포워딩, 키 주입, 스트림 pipe', () => {
    const node = generateArtifacts(gaPlan(), ctx)[2];
    expect(node.code).toContain('createServer');
    expect(node.code).toContain('const PREFIX = "/api"');
    expect(node.code).toContain('const BASE_URL = "https://backend.alli.ai"');
    expect(node.code).toContain('fetch(BASE_URL + upstreamPath');
    expect(node.code).toContain('headers["API-KEY"] = API_KEY');
    expect(node.code).toContain('.pipe(res)');
  });

  it('프록시 코드는 플로우와 무관하게 동일하다', () => {
    const a = generateArtifacts(gaPlan(), ctx)[2];
    const b = generateArtifacts(
      plan(specs.runConversation('APP_1', [{ name: 'message', kind: 'text', value: '안녕' }]), {
        kind: 'conversation-loop',
      }),
      ctx,
    )[2];
    expect(b.code).toBe(a.code);
  });
});
