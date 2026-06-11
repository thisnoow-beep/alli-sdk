/* 목 fetch 자기 테스트 — latencyMs:0으로 13개 라우트 + 실패 트리거 + 스트림 경계를 검증한다. */

import { beforeEach, describe, expect, it } from 'vitest';
import { createMockFetch, resetMockState } from './mock-fetch';
import { APP_FIXTURES, GA_ANSWER_MARKDOWN, RUN_INPUTS_ERROR_BODY } from './fixtures';

const BASE = 'https://backend.alli.ai';
const KEY = { 'API-KEY': 'mock-key' };
const JSON_HEADERS = { ...KEY, 'Content-Type': 'application/json' };

function mf(): typeof fetch {
  return createMockFetch({ latencyMs: 0 });
}

/** 스트림 본문을 청크 단위로 수집 — 청크 경계 검증과 누적 텍스트 검증에 함께 사용 */
async function readAllChunks(res: Response): Promise<{ chunks: Uint8Array[]; text: string }> {
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  return { chunks, text: new TextDecoder().decode(merged) };
}

beforeEach(() => {
  resetMockState();
});

describe('공통 인증', () => {
  it('API-KEY가 invalid-key면 403 + code 7001', async () => {
    const res = await mf()(`${BASE}/webapi/v2/projects`, { headers: { 'API-KEY': 'invalid-key' } });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { type: string; code: number };
    expect(body.code).toBe(7001);
    expect(body.type).toBe('APIError');
  });

  it('API-KEY 헤더 자체가 없어도 동일하게 403/7001', async () => {
    const res = await mf()(`${BASE}/webapi/hashtags`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: number }).code).toBe(7001);
  });

  it('매칭되지 않는 경로는 405 + error 키 (비표준 에러 형태)', async () => {
    const res = await mf()(`${BASE}/webapi/apps`, { method: 'POST', headers: KEY });
    expect(res.status).toBe(405);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Method Not Allowed');
    expect(body.error).toContain('/webapi/apps');
  });
});

describe('1. GET /webapi/v2/projects', () => {
  it('200 + 프로젝트 정보', async () => {
    const res = await mf()(`${BASE}/webapi/v2/projects`, { headers: KEY });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { name: string; id: string } };
    expect(body.result.name).toBe('Mock Project');
    expect(body.result.id).toBe('prj-mock-1');
  });

  it('상대 경로(input이 path 문자열)도 처리한다', async () => {
    const res = await mf()('/webapi/v2/projects', { headers: KEY });
    expect(res.status).toBe(200);
  });
});

describe('2. GET /webapi/v2/apps', () => {
  type AppsBody = { result: { apps: { id: string; cursor?: string }[] } };

  it('필터 없으면 픽스처 6개 전부', async () => {
    const res = await mf()(`${BASE}/webapi/v2/apps`, { headers: KEY });
    const body = (await res.json()) as AppsBody;
    expect(body.result.apps).toHaveLength(APP_FIXTURES.length);
  });

  it('searchTerm/type/published 필터가 동작한다', async () => {
    const mock = mf();
    const byTerm = (await (await mock(`${BASE}/webapi/v2/apps?searchTerm=${encodeURIComponent('요약')}`, { headers: KEY })).json()) as AppsBody;
    expect(byTerm.result.apps.map((a) => a.id).sort()).toEqual(['app-legacy-9', 'app-sum-001']);

    const byType = (await (await mock(`${BASE}/webapi/v2/apps?type=skill`, { headers: KEY })).json()) as AppsBody;
    expect(byType.result.apps.map((a) => a.id).sort()).toEqual(['app-doc-101', 'app-exp-102']);

    const byPub = (await (await mock(`${BASE}/webapi/v2/apps?published=false`, { headers: KEY })).json()) as AppsBody;
    expect(byPub.result.apps.map((a) => a.id)).toEqual(['app-exp-102']);
  });

  it('pageSize/cursor 페이징 — 2페이지로 전체 회수', async () => {
    const mock = mf();
    const p1 = (await (await mock(`${BASE}/webapi/v2/apps?pageSize=4`, { headers: KEY })).json()) as AppsBody;
    expect(p1.result.apps).toHaveLength(4);
    const cursor = p1.result.apps[3].cursor!;
    const p2 = (await (await mock(`${BASE}/webapi/v2/apps?pageSize=4&cursor=${cursor}`, { headers: KEY })).json()) as AppsBody;
    expect(p2.result.apps).toHaveLength(2);
    const all = [...p1.result.apps, ...p2.result.apps].map((a) => a.id);
    expect(new Set(all).size).toBe(6);
  });
});

describe('3. GET /webapi/v2/apps/{id}', () => {
  it('단건 조회', async () => {
    const res = await mf()(`${BASE}/webapi/v2/apps/app-doc-101`, { headers: KEY });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { id: string; type: string } };
    expect(body.result.id).toBe('app-doc-101');
    expect(body.result.type).toBe('skill');
  });

  it('없는 앱이면 400/7003', async () => {
    const res = await mf()(`${BASE}/webapi/v2/apps/no-such-app`, { headers: KEY });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: number }).code).toBe(7003);
  });
});

describe('4. POST /webapi/apps/{id}/run', () => {
  it('inputs 누락이면 500 + 비표준 에러 본문 원문 그대로 (§9-1)', async () => {
    const res = await mf()(`${BASE}/webapi/apps/app-sum-001/run`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ mode: 'sync' }),
    });
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(RUN_INPUTS_ERROR_BODY);
  });

  it('inputs가 빈 객체여도 동일하게 500', async () => {
    const res = await mf()(`${BASE}/webapi/apps/app-sum-001/run`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ inputs: {} }),
    });
    expect(res.status).toBe(500);
  });

  it('sync — v2 형태 result.responses[] + conversation', async () => {
    const res = await mf()(`${BASE}/webapi/apps/app-sum-001/run`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ inputs: { input: '6월 전표' } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: {
        type: string;
        responses: { message: string; completed: boolean; citations: unknown[] }[];
        conversation: { id: string; state: string };
      };
    };
    expect(body.result.type).toBe('single_action');
    expect(body.result.responses[0].completed).toBe(true);
    expect(body.result.responses[0].citations).toHaveLength(1);
    expect(body.result.responses[0].message).toContain('요약');
    expect(body.result.conversation.id).toBe('conv-run-1');
  });

  it('app-legacy-9 — 레거시 result.choices[] 형태 (§9-3)', async () => {
    const res = await mf()(`${BASE}/webapi/apps/app-legacy-9/run`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ inputs: { input: 'x' } }),
    });
    const body = (await res.json()) as { result: { choices: { message: string }[] } };
    expect(body.result.choices[0].message).toBe('레거시 형태 응답입니다');
  });

  it('stream — 3조각, 두 번째 조각이 한글 멀티바이트 중간에서 끝나고 누적하면 유효한 JSON', async () => {
    const res = await mf()(`${BASE}/webapi/apps/app-sum-001/run`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ inputs: { input: 'x' }, mode: 'stream' }),
    });
    const { chunks, text } = await readAllChunks(res);
    expect(chunks).toHaveLength(3);
    // 세 번째 조각의 첫 바이트가 UTF-8 연속 바이트(0b10xxxxxx) = 문자 중간에서 잘렸다는 증거
    expect(chunks[2][0] & 0xc0).toBe(0x80);
    // 두 번째 조각만 단독 디코딩하면 깨진다 (fatal 디코더가 throw)
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(chunks[1])).toThrow();
    // 전체 누적은 sync와 동일 포맷의 완전한 JSON
    const parsed = JSON.parse(text) as { result: { responses: { completed: boolean }[] } };
    expect(parsed.result.responses[0].completed).toBe(true);
  });
});

describe('5. POST /webapi/v2/apps/{id}/run_conversation (+ 12·13 대화 회수)', () => {
  function form(fields: Record<string, string>, file?: File): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (file) fd.append('files', file);
    return fd;
  }

  it('항상 스트리밍 — conversation.id → message 2개 → completed 순', async () => {
    const res = await mf()(`${BASE}/webapi/v2/apps/app-doc-101/run_conversation`, {
      method: 'POST',
      headers: KEY,
      body: form({ message: '경비 정산 방법 알려줘' }),
    });
    const { chunks } = await readAllChunks(res);
    const docs = chunks.map((c) => JSON.parse(new TextDecoder().decode(c)) as Record<string, unknown>);
    expect(docs).toHaveLength(4);
    expect((docs[0]['conversation'] as { id: string }).id).toBe('conv-mock-1');
    expect(docs[1]['sender']).toBe('agent');
    expect(String(docs[1]['message'])).toContain('경비 정산 방법 알려줘');
    expect(docs[3]['completed']).toBe(true);
  });

  it('conversationId를 주면 새 대화 대신 그 id 유지 + 이력 누적', async () => {
    const mock = mf();
    await readAllChunks(
      await mock(`${BASE}/webapi/v2/apps/app-doc-101/run_conversation`, {
        method: 'POST',
        headers: KEY,
        body: form({ message: '첫 질문' }),
      }),
    );
    const res2 = await mock(`${BASE}/webapi/v2/apps/app-doc-101/run_conversation`, {
      method: 'POST',
      headers: KEY,
      body: form({ message: '후속 질문', conversationId: 'conv-mock-1' }),
    });
    const { chunks } = await readAllChunks(res2);
    const first = JSON.parse(new TextDecoder().decode(chunks[0])) as { conversation: { id: string } };
    expect(first.conversation.id).toBe('conv-mock-1');

    // 12. 대화 단건 — 턴 2회 분량(유저 2 + 에이전트 4 = 6건) 누적 확인
    const conv = (await (await mock(`${BASE}/webapi/v2/conversations/conv-mock-1`, { headers: KEY })).json()) as {
      result: { id: string; chats: { sender: string; message: string }[] };
    };
    expect(conv.result.id).toBe('conv-mock-1');
    expect(conv.result.chats).toHaveLength(6);
    expect(conv.result.chats[0].message).toBe('첫 질문');

    // 13. chats — 페이지당 5건 페이징
    const p1 = (await (await mock(`${BASE}/webapi/v2/conversations/conv-mock-1/chats?pageNo=1`, { headers: KEY })).json()) as {
      result: { chats: unknown[] };
    };
    const p2 = (await (await mock(`${BASE}/webapi/v2/conversations/conv-mock-1/chats?pageNo=2`, { headers: KEY })).json()) as {
      result: { chats: unknown[] };
    };
    expect(p1.result.chats).toHaveLength(5);
    expect(p2.result.chats).toHaveLength(1);
  });

  it('파일 파트가 있으면 응답 메시지에 파일명 언급', async () => {
    const res = await mf()(`${BASE}/webapi/v2/apps/app-doc-101/run_conversation`, {
      method: 'POST',
      headers: KEY,
      body: form({ message: '이 문서를 요약해줘' }, new File(['pdf'], '계약서.pdf')),
    });
    const { chunks } = await readAllChunks(res);
    const second = JSON.parse(new TextDecoder().decode(chunks[1])) as { message: string };
    expect(second.message).toContain('계약서.pdf');
  });
});

describe('6. POST /webapi/generative_answer', () => {
  const body = (extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ query: '연차 이월 규정 알려줘', answerFormat: 'MARKDOWN', ...extra });

  it('sync — answer 마크다운(<script> 포함) + intent + clues 2건 + threadId', async () => {
    const res = await mf()(`${BASE}/webapi/generative_answer`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'OWN-USER-ID': 'EMP12345' },
      body: body(),
    });
    const ga = (await res.json()) as {
      answer: string;
      intent: string;
      clues: { source: string; kbId?: string; faqId?: string }[];
      threadId?: string;
    };
    expect(ga.answer).toContain('<script>alert(1)</script>');
    expect(ga.answer).toContain('| 구분 |'); // 표
    expect(ga.intent).toBe('SEARCH');
    expect(ga.clues).toHaveLength(2);
    expect(ga.clues[0].source).toBe('DOCUMENT');
    expect(ga.clues[1].faqId).toBe('faq-77');
    expect(ga.threadId).toBe('th-mock-1');
  });

  it('OWN-USER-ID 헤더가 없으면 threadId 생략 (멀티턴 비활성 재현)', async () => {
    const res = await mf()(`${BASE}/webapi/generative_answer`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: body(),
    });
    const ga = (await res.json()) as Record<string, unknown>;
    expect('threadId' in ga).toBe(false);
  });

  it('threadId를 전달하면 fuQuestion(재작성된 질문) 동봉', async () => {
    const res = await mf()(`${BASE}/webapi/generative_answer`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'OWN-USER-ID': 'EMP12345' },
      body: body({ threadId: 'th-mock-1' }),
    });
    const ga = (await res.json()) as { fuQuestion?: string };
    expect(ga.fuQuestion).toContain('재작성된 질문');
  });

  it('stream — 누적 answer가 길어지는 조각 3개 + clues/threadId 포함 완전체', async () => {
    const res = await mf()(`${BASE}/webapi/generative_answer`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'OWN-USER-ID': 'EMP12345' },
      body: body({ mode: 'stream' }),
    });
    const { chunks } = await readAllChunks(res);
    const docs = chunks.map(
      (c) => JSON.parse(new TextDecoder().decode(c)) as { answer: string; clues?: unknown[]; threadId?: string },
    );
    expect(docs).toHaveLength(4);
    expect(docs[0].answer.length).toBeLessThan(docs[1].answer.length);
    expect(docs[1].answer.length).toBeLessThan(docs[2].answer.length);
    expect(docs[2].answer).toBe(GA_ANSWER_MARKDOWN);
    expect(docs[1].answer.startsWith(docs[0].answer)).toBe(true); // 누적형
    expect(docs[3].clues).toHaveLength(2);
    expect(docs[3].threadId).toBe('th-mock-1');
  });
});

describe('7. GET /webapi/hashtags', () => {
  it('해시태그명→사용수 맵', async () => {
    const res = await mf()(`${BASE}/webapi/hashtags`, { headers: KEY });
    const body = (await res.json()) as { result: Record<string, number> };
    expect(body.result['인사규정']).toBe(12);
    expect(Object.keys(body.result)).toHaveLength(5);
  });
});

describe('8~11. KB 노드 검색/업로드/삭제/인제스천', () => {
  type NodesBody = { result: { nodes: { id: string; name?: string; processState?: string }[] } };

  async function search(mock: typeof fetch, filter: Record<string, unknown>): Promise<NodesBody> {
    const res = await mock(`${BASE}/webapi/v2/knowledge_base_nodes/search`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ filter_: filter, limit: 10 }),
    });
    return (await res.json()) as NodesBody;
  }

  async function upload(mock: typeof fetch, fileName: string): Promise<string> {
    const fd = new FormData();
    fd.append('fileName', fileName);
    fd.append('file', new File(['bytes'], fileName));
    fd.append('hashtags', '인사규정');
    const res = await mock(`${BASE}/webapi/v2/knowledge_base_nodes/upload`, {
      method: 'POST',
      headers: KEY,
      body: fd,
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as NodesBody).result.nodes[0].id;
  }

  async function pollStatus(mock: typeof fetch, kbId: string): Promise<string> {
    const res = await mock(`${BASE}/webapi/v2/ingestion_status/${kbId}`, { headers: KEY });
    const body = (await res.json()) as { status: string; steps: { name: string; status: string }[] };
    expect(Array.isArray(body.steps)).toBe(true);
    return body.status;
  }

  it('검색 — 필터 없음 4건, searchTerm/nodeType 필터 동작', async () => {
    const mock = mf();
    expect((await search(mock, {})).result.nodes).toHaveLength(4);
    const byTerm = await search(mock, { searchTerm: '취업' });
    expect(byTerm.result.nodes.map((n) => n.id)).toEqual(['kb-001']);
    const folders = await search(mock, { nodeType: ['folder'] });
    expect(folders.result.nodes.map((n) => n.id)).toEqual(['kb-f-01']);
  });

  it('업로드 → kb-new- id 발급, 검색에 노출, 인제스천 정상 시퀀스로 진행', async () => {
    const mock = mf();
    const id = await upload(mock, '취업규칙_v3.pdf');
    expect(id).toMatch(/^kb-new-\d+$/);

    const found = await search(mock, { searchTerm: '취업규칙_v3' });
    expect(found.result.nodes.map((n) => n.id)).toEqual([id]);

    // 호출마다 진행: initializing → parsing → completed, 이후 completed 유지
    expect(await pollStatus(mock, id)).toBe('initializing');
    expect(await pollStatus(mock, id)).toBe('parsing');
    expect(await pollStatus(mock, id)).toBe('completed');
    expect(await pollStatus(mock, id)).toBe('completed');
  });

  it("fileName에 'fail' 포함 → 인제스천이 parsing_fail 시퀀스를 탄다", async () => {
    const mock = mf();
    const id = await upload(mock, '결재규정_fail.pdf');
    expect(await pollStatus(mock, id)).toBe('initializing');
    expect(await pollStatus(mock, id)).toBe('parsing');
    expect(await pollStatus(mock, id)).toBe('parsing_fail');
    expect(await pollStatus(mock, id)).toBe('parsing_fail');
  });

  it('삭제 — 200 빈 본문, 이후 검색에서 제외 (Flow 5 replace 조합)', async () => {
    const mock = mf();
    const res = await mock(`${BASE}/webapi/v2/knowledge_base_nodes/kb-001`, {
      method: 'DELETE',
      headers: KEY,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    const after = await search(mock, {});
    expect(after.result.nodes.map((n) => n.id)).not.toContain('kb-001');
    expect(after.result.nodes).toHaveLength(3);
  });
});

describe('12~13. 대화 조회 — 이력 없는 id는 기본 픽스처', () => {
  it('단건: 기본 픽스처 12건 (최근 20개 한도 내)', async () => {
    const res = await mf()(`${BASE}/webapi/v2/conversations/conv-unknown`, { headers: KEY });
    const body = (await res.json()) as { result: { id: string; chats: unknown[] } };
    expect(body.result.id).toBe('conv-unknown');
    expect(body.result.chats).toHaveLength(12);
  });

  it('chats: pageNo 페이징 — 5/5/2', async () => {
    const mock = mf();
    const page = async (n: number): Promise<unknown[]> => {
      const res = await mock(`${BASE}/webapi/v2/conversations/conv-unknown/chats?pageNo=${n}`, {
        headers: KEY,
      });
      return ((await res.json()) as { result: { chats: unknown[] } }).result.chats;
    };
    expect(await page(1)).toHaveLength(5);
    expect(await page(2)).toHaveLength(5);
    expect(await page(3)).toHaveLength(2);
    expect(await page(4)).toHaveLength(0);
  });
});

describe('지연 시뮬레이션', () => {
  it('latencyMs만큼 응답이 지연된다', async () => {
    const mock = createMockFetch({ latencyMs: 50 });
    const t0 = Date.now();
    await mock(`${BASE}/webapi/v2/projects`, { headers: KEY });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45); // 타이머 오차 여유
  });
});
