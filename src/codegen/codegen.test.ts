/* 코드 생성 스모크 테스트 — 순서/제목, 이스케이프 생존, Python 리터럴 변환, 키 미삽입.
   정밀 규칙(패리티 등) 테스트는 별도 에이전트 담당 — 여기서는 굵직한 계약만 확인한다. */

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
    expect(arts.map((a) => a.title)).toEqual(['curl', '브라우저 fetch', 'Node.js (20+)', 'Python (requests)']);
    expect(arts.map((a) => a.setLabel)).toEqual(['curl', 'JavaScript', 'JavaScript', 'Python']);
    expect(arts.map((a) => a.language)).toEqual(['bash', 'javascript', 'javascript', 'python']);
  });
});

describe('API 키 미삽입 (§7-1) — 전 변형 환경변수 ALLI_API_KEY 전제 (초기 설정에서 사전 안내)', () => {
  it('모든 변형이 환경변수 전제로 동작하고 키 리터럴/placeholder를 쓰지 않는다', () => {
    const [curl, browser, node, python] = generateArtifacts(gaPlan(), ctx);
    expect(curl.code).toContain('"API-KEY: $ALLI_API_KEY"');
    expect(curl.code).toContain('# 전제: 환경변수 ALLI_API_KEY 설정 완료');
    expect(browser.code).not.toContain('YOUR_API_KEY');
    expect(browser.code).toContain('const API_KEY = globalThis.ALLI_API_KEY;');
    expect(browser.code).toContain('키 리터럴을 넣지 마세요');
    expect(browser.code).toContain('if (!API_KEY) throw');
    expect(node.code).toContain('const API_KEY = process.env.ALLI_API_KEY;');
    expect(node.code).toContain('if (!API_KEY) throw');
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
  it('curl은 사전 인코딩된 base64: 리터럴 + 안내 주석, JS/Python은 헬퍼 호출', () => {
    const [curl, browser, node, python] = generateArtifacts(gaPlan(), ctx);
    expect(curl.code).toContain('OWN-USER-ID: base64:7ZmN6ri464+Z'); // encodeOwnUserId('홍길동') 고정값
    expect(curl.code).toContain("base64: 인코딩 (echo -n '값' | base64)");
    expect(browser.code).toContain('encodeOwnUserId("홍길동")');
    expect(node.code).toContain('function encodeOwnUserId(');
    expect(python.code).toContain('encode_own_user_id("홍길동")');
    expect(python.code).toContain('def encode_own_user_id(');
  });

  it('ownUserId 미설정이면 OWN-USER-ID 헤더와 헬퍼가 생성되지 않는다', () => {
    const arts = generateArtifacts(gaPlan(), { baseUrl: 'https://backend.alli.ai' });
    for (const a of arts) {
      expect(a.code).not.toContain('OWN-USER-ID');
    }
  });
});

describe('stream 소비 코드 (§7-5)', () => {
  it('변형별 스트림 소비 + extract_json_values 헬퍼가 동봉된다', () => {
    const p = plan(specs.generativeAnswer({ query: '연차 규정', mode: 'stream' }));
    const [curl, browser, node, python] = generateArtifacts(p, ctx);
    expect(curl.code).toContain('--no-buffer');
    expect(curl.code).toContain('JSON 조각 스트림');
    expect(browser.code).toContain('res.body.getReader()');
    expect(browser.code).toContain('new TextDecoder("utf-8")');
    expect(browser.code).toContain('decoder.decode(value, { stream: true })');
    expect(browser.code).toContain('function extractJsonValues(');
    expect(node.code).toContain('for await (const chunk of res.body)');
    expect(node.code).toContain('function extractJsonValues(');
    expect(python.code).toContain('stream=True');
    expect(python.code).toContain('iter_content(chunk_size=None)');
    expect(python.code).toContain('codecs.getincrementaldecoder("utf-8")()');
    expect(python.code).toContain('def extract_json_values(');
  });
});

describe('multipart 렌더링 (§7-7)', () => {
  it('parts 순서 1:1 — 텍스트/파일 형태가 변형별 규약을 따른다', () => {
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
    expect(node.code).toContain('import { readFile } from "node:fs/promises"');
    expect(node.code).toContain('new Blob([await readFile("./contract.pdf")])');
    expect(python.code).toContain('("files", ("contract.pdf", open("./contract.pdf", "rb")))');
    expect(python.code).not.toContain('"Content-Type": "application/json"'); // §7-3
  });
});

describe('GET/DELETE — Base URL + 경로 결합 (§7-8)', () => {
  it('쿼리스트링이 코드에서 그대로 읽힌다', () => {
    const p = plan(specs.listApps({ published: true, pageSize: 50 }));
    const [curl, , node, python] = generateArtifacts(p, ctx);
    // curl은 Base URL을 명령어에 인라인 (§7-1)
    expect(curl.code).toContain('"https://backend.alli.ai/webapi/v2/apps?published=true&pageSize=50"');
    expect(node.code).toContain('`${BASE_URL}/webapi/v2/apps?published=true&pageSize=50`');
    expect(python.code).toContain('f"{BASE_URL}/webapi/v2/apps?published=true&pageSize=50"');
  });

  it('DELETE — 메서드가 명시된다', () => {
    const p = plan(specs.kbDelete('NODE_1'));
    const [curl, , node, python] = generateArtifacts(p, ctx);
    expect(curl.code).toContain('curl -X DELETE');
    expect(node.code).toContain('method: "DELETE"');
    expect(python.code).toContain('requests.delete(');
  });
});

describe('wrapper 3종 스모크', () => {
  it('ga-thread-loop — ask(query, threadId) + 멀티턴 안내 + curl THREAD_ID 템플릿', () => {
    const p = plan(specs.generativeAnswer({ query: '연차 이월 규정 알려줘', isStateful: true, mode: 'sync' }), {
      kind: 'ga-thread-loop',
    });
    const [curl, browser, node, python] = generateArtifacts(p, ctx);
    expect(curl.code).toContain("THREAD_ID='1차_응답의_threadId'");
    expect(curl.code).toContain('"$THREAD_ID"');
    for (const a of [browser, node]) {
      expect(a.code).toContain('async function ask(query, threadId)');
      expect(a.code).toContain('OWN-USER-ID 헤더 없으면 threadId');
    }
    expect(python.code).toContain('def ask(query, thread_id=None):');
    expect(python.code).toContain('OWN-USER-ID 헤더 없으면 threadId');
  });

  it('conversation-loop — deep-scan 헬퍼 + 후속 루프 + curl CONV_ID 템플릿', () => {
    const p = plan(specs.runConversation('APP_1', [{ name: 'message', kind: 'text', value: '견적을 시작할게요' }]), {
      kind: 'conversation-loop',
    });
    const [curl, browser, node, python] = generateArtifacts(p, ctx);
    expect(curl.code).toContain("CONV_ID='1차_스트림에서_확보한_conversationId'");
    expect(curl.code).toContain('-F "conversationId=$CONV_ID"');
    for (const a of [browser, node]) {
      expect(a.code).toContain('function findConversationId(');
      expect(a.code).toContain('deep-scan');
      expect(a.code).toContain('sendMessage(');
    }
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
    const [curl, browser, node, python] = generateArtifacts(p, ctx);
    expect(curl.code).toContain('# bash / Git Bash / WSL용');
    expect(curl.code).toContain("grep -o '\"id\" *: *\"[^\"]*\"'");
    expect(curl.code).toContain('OLD_NODE_1');
    expect(curl.code).toContain('업로드 → 완료 확인 → 삭제');
    for (const a of [browser, node, python]) {
      expect(a.code).toContain('업로드 → 완료 확인 → 삭제');
      expect(a.code).toContain('OLD_NODE_1');
      expect(a.code).toContain('post_completed');
      expect(a.code).toContain('parsing_fail');
      expect(a.code).toContain('롤백');
    }
    expect(python.code).toContain('def replace_document():');
    expect(node.code).toContain('async function replaceDocument()');
  });
});
