/* AlliClient 테스트 — 가짜 fetchImpl 주입, 실 네트워크 호출 없음.
   헤더 규약(§3.2/§7-3), 에러 형태(§3.3), 스트리밍 소비(§3.5)를 검증한다. */

import { describe, expect, it } from 'vitest';
import { AlliClient } from './client';
import type { AlliConfig, StreamEvent } from './client';
import type { RequestSpec } from './request-spec';
import { AlliApiError } from './errors';

const CFG: AlliConfig = {
  baseUrl: 'https://backend.alli.ai',
  apiKey: 'TEST_KEY',
};

function jsonSpec(value: unknown = { q: '안녕' }): RequestSpec {
  return {
    id: 'generative_answer',
    method: 'POST',
    path: '/webapi/generative_answer',
    body: { kind: 'json', value },
    stream: false,
  };
}

function getSpec(): RequestSpec {
  return {
    id: 'projects',
    method: 'GET',
    path: '/webapi/v2/projects',
    body: { kind: 'none' },
    stream: false,
  };
}

interface Captured {
  url: string;
  init: RequestInit | undefined;
}

/* 응답을 만들어주는 핸들러로 fetchImpl을 구성하고, 마지막 호출 인자를 캡처 */
function makeFetch(handler: () => Response | Promise<Response>): {
  impl: typeof fetch;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const impl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return handler();
  };
  return { impl, calls };
}

/* Uint8Array 청크들을 순서대로 내보내는 ReadableStream (스트리밍 응답 목) */
function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

async function collect(gen: AsyncGenerator<StreamEvent, void, void>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe('AlliClient.buildHeaders / execute 헤더', () => {
  it('① API-KEY 포함 + 비ASCII OWN-USER-ID는 base64: 변환 + Content-Type은 json body에만', async () => {
    const client0 = new AlliClient(
      { ...CFG, ownUserId: '홍길동', userEmail: 'hong@example.com' },
      makeFetch(() => new Response('{}', { status: 200 })).impl,
    );

    const jsonHeaders = client0.buildHeaders(jsonSpec());
    expect(jsonHeaders['API-KEY']).toBe('TEST_KEY');
    expect(jsonHeaders['OWN-USER-ID']).toBe('base64:7ZmN6ri464+Z'); // §3.2 비ASCII → base64:
    expect(jsonHeaders['USER-EMAIL']).toBe('hong@example.com');
    expect(jsonHeaders['Content-Type']).toBe('application/json');

    // body 없는 GET — Content-Type 미지정
    const getHeaders = client0.buildHeaders(getSpec());
    expect(getHeaders['Content-Type']).toBeUndefined();

    // ownUserId/userEmail 미설정이면 식별자 헤더 자체가 없어야 한다
    const bare = new AlliClient(CFG).buildHeaders(getSpec());
    expect(bare['OWN-USER-ID']).toBeUndefined();
    expect(bare['USER-EMAIL']).toBeUndefined();

    // 실제 전송 검증: GET에는 body가 없어야 한다
    const { impl, calls } = makeFetch(() => new Response('{}', { status: 200 }));
    const client = new AlliClient(CFG, impl);
    await client.execute(getSpec());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.method).toBe('GET');
    expect(calls[0]!.init?.body).toBeUndefined();
  });

  it('② multipart spec은 FormData body로 전송하고 Content-Type을 지정하지 않는다', async () => {
    const { impl, calls } = makeFetch(() => new Response('{}', { status: 200 }));
    const client = new AlliClient(CFG, impl);
    const spec: RequestSpec = {
      id: 'run_conversation',
      method: 'POST',
      path: '/webapi/v2/apps/APP1/run_conversation',
      body: { kind: 'multipart', parts: [{ name: 'message', kind: 'text', value: '안녕' }] },
      stream: false,
    };
    await client.execute(spec);
    const init = calls[0]!.init;
    expect(init?.body).toBeInstanceOf(FormData);
    // §7-3: boundary 자동 설정을 위해 Content-Type 명시 금지
    expect((init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });
});

describe('AlliClient.execute 에러/응답 처리', () => {
  it('③ 403 표준 본문 → AlliApiError(code 7001, shape standard)', async () => {
    const body = '{"type":"APIError","code":7001,"message":"Invalid API Key"}';
    const { impl } = makeFetch(() => new Response(body, { status: 403 }));
    const client = new AlliClient(CFG, impl);
    const err = await client.execute(getSpec()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AlliApiError);
    const apiErr = err as AlliApiError;
    expect(apiErr.code).toBe(7001);
    expect(apiErr.shape).toBe('standard');
    expect(apiErr.httpStatus).toBe(403);
    expect(apiErr.rawBody).toBe(body);
  });

  it('④ {"errors":"..."} 본문 → shape errors-key', async () => {
    const body = '{"errors":"internal error. Expecting value: line 1 column 1 (char 0)"}';
    const { impl } = makeFetch(() => new Response(body, { status: 500 }));
    const client = new AlliClient(CFG, impl);
    const err = await client.execute(jsonSpec()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AlliApiError);
    expect((err as AlliApiError).shape).toBe('errors-key');
    expect((err as AlliApiError).message).toContain('Expecting value');
  });

  it('⑤ fetchImpl이 TypeError throw → shape network, httpStatus 0', async () => {
    const impl: typeof fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    const client = new AlliClient(CFG, impl);
    const err = await client.execute(getSpec()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AlliApiError);
    expect((err as AlliApiError).shape).toBe('network');
    expect((err as AlliApiError).httpStatus).toBe(0);
  });

  it('⑤-보강 AbortError는 networkError로 감싸지 않고 그대로 전파한다', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    const impl: typeof fetch = async () => {
      throw abort;
    };
    const client = new AlliClient(CFG, impl);
    await expect(client.execute(getSpec())).rejects.toBe(abort);
  });

  it('⑧ 빈 본문 200 → data null, rawBody 빈 문자열', async () => {
    const { impl } = makeFetch(() => new Response('', { status: 200 }));
    const client = new AlliClient(CFG, impl);
    const result = await client.execute(getSpec());
    expect(result.data).toBeNull();
    expect(result.rawBody).toBe('');
    expect(result.status).toBe(200);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe('AlliClient.executeStream', () => {
  it('⑥ JSON 2개를 3청크(한글 멀티바이트 중간 분할 포함)로 받아 json 2개 + done', async () => {
    const full = '{"a":1}{"b":"안녕"}';
    const bytes = new TextEncoder().encode(full);
    // '안'(3바이트)의 중간 + 첫 객체 중간에서 절단 — 디코더/스캐너 경계 처리 동시 검증
    const cut1 = 4; // '{"a"' 까지
    const cut2 = bytes.length - 5; // '안' 멀티바이트 한가운데
    const chunks = [bytes.slice(0, cut1), bytes.slice(cut1, cut2), bytes.slice(cut2)];

    const { impl } = makeFetch(() => new Response(streamOf(chunks), { status: 200 }));
    const client = new AlliClient(CFG, impl);
    const spec = { ...jsonSpec(), stream: true };
    const events = await collect(client.executeStream(spec));

    const jsonEvents = events.filter((e) => e.type === 'json');
    expect(jsonEvents.map((e) => e.value)).toEqual([{ a: 1 }, { b: '안녕' }]);
    expect(events.filter((e) => e.type === 'garbage')).toEqual([]);

    const last = events[events.length - 1]!;
    expect(last.type).toBe('done');
    if (last.type === 'done') {
      expect(last.fullRaw).toBe(full);
      expect(last.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('⑦ HTTP 403이면 아무 것도 yield하기 전에 AlliApiError throw', async () => {
    const body = '{"type":"APIError","code":7001,"message":"Invalid API Key"}';
    const { impl } = makeFetch(() => new Response(body, { status: 403 }));
    const client = new AlliClient(CFG, impl);
    const gen = client.executeStream({ ...jsonSpec(), stream: true });
    // 첫 next()에서 곧바로 reject — yield된 이벤트가 하나도 없어야 한다
    const err = await gen.next().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AlliApiError);
    expect((err as AlliApiError).code).toBe(7001);
    expect((err as AlliApiError).httpStatus).toBe(403);
  });

  it('⑥-보강 res.body가 없으면 본문 전체를 1회 push하는 폴백으로 처리한다', async () => {
    // Response 목: text()만 제공하고 body는 null — 비스트림 환경 시뮬레이션
    const fake = {
      ok: true,
      status: 200,
      body: null,
      text: async () => '{"a":1} {"b":2}',
    } as unknown as Response;
    const { impl } = makeFetch(() => fake);
    const client = new AlliClient(CFG, impl);
    const events = await collect(client.executeStream({ ...jsonSpec(), stream: true }));
    expect(events.filter((e) => e.type === 'json').map((e) => e.value)).toEqual([
      { a: 1 },
      { b: 2 },
    ]);
    const last = events[events.length - 1]!;
    expect(last.type).toBe('done');
    if (last.type === 'done') expect(last.fullRaw).toBe('{"a":1} {"b":2}');
  });
});
