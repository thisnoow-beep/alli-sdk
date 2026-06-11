/* AlliClient — fetch 래퍼.
   - 헤더 자동 주입: API-KEY(필수), OWN-USER-ID(설정 시, 비ASCII는 base64: 변환), USER-EMAIL(설정 시)
   - Content-Type: JSON body에만 'application/json' 명시, multipart는 미지정(boundary 자동) — §7-3
   - 비 2xx → parseAlliError로 AlliApiError throw, fetch 실패 → networkError throw
   - executeStream: body.getReader() + TextDecoder(stream:true) + createJsonScanner (§3.5)
   - fetchImpl 주입 가능 (목 모드/테스트). 기본은 글로벌 fetch —
     'Illegal invocation' 방지를 위해 this 바인딩 없이 래핑해 보관할 것. */

import type { RequestSpec } from './request-spec';
import { buildUrl, toFormData } from './request-spec';
import type { ScanResult } from './stream';
import { createJsonScanner } from './stream';
import { networkError, parseAlliError } from './errors';
import { encodeOwnUserId } from './encoding';

export interface AlliConfig {
  baseUrl: string;
  apiKey: string;
  ownUserId?: string;
  userEmail?: string;
}

export interface ExecuteResult<T> {
  data: T;
  rawBody: string;
  status: number;
  elapsedMs: number;
}

export type StreamEvent =
  | { type: 'json'; value: unknown; raw: string }
  | { type: 'garbage'; raw: string }
  | { type: 'done'; fullRaw: string; elapsedMs: number };

/* ScanResult(스캐너 어휘) → StreamEvent(클라이언트 어휘) 변환 — done은 별도 합성 */
function toStreamEvent(r: ScanResult): StreamEvent {
  return r.kind === 'value'
    ? { type: 'json', value: r.value, raw: r.raw }
    : { type: 'garbage', raw: r.raw };
}

export class AlliClient {
  readonly cfg: AlliConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: AlliConfig, fetchImpl?: typeof fetch) {
    this.cfg = cfg;
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** spec → 전송 헤더 (raw 뷰 표시·코드 생성 미리보기에도 사용) */
  buildHeaders(spec: RequestSpec): Record<string, string> {
    const headers: Record<string, string> = { 'API-KEY': this.cfg.apiKey };
    // 빈 문자열은 미설정으로 취급 — 의미 없는 식별자 헤더 전송 방지
    if (this.cfg.ownUserId) headers['OWN-USER-ID'] = encodeOwnUserId(this.cfg.ownUserId); // §3.2 비ASCII 변환
    if (this.cfg.userEmail) headers['USER-EMAIL'] = this.cfg.userEmail;
    // §7-3: JSON에만 명시. multipart는 지정 금지 — fetch가 boundary 포함 Content-Type을 자동 설정
    if (spec.body.kind === 'json') headers['Content-Type'] = 'application/json';
    return headers;
  }

  /* 공통 요청 전송 — fetch 실패는 networkError로 래핑하되,
     AbortError(호출자 취소)는 의도를 보존하기 위해 그대로 재던진다 */
  private async send(spec: RequestSpec, signal?: AbortSignal): Promise<Response> {
    const url = buildUrl(this.cfg.baseUrl, spec);
    const init: RequestInit = { method: spec.method, headers: this.buildHeaders(spec) };
    if (spec.body.kind === 'json') init.body = JSON.stringify(spec.body.value);
    else if (spec.body.kind === 'multipart') init.body = toFormData(spec.body.parts);
    if (signal) init.signal = signal;
    try {
      return await this.fetchImpl(url, init);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      throw networkError(e);
    }
  }

  /** sync 실행. 2xx가 아니면 AlliApiError throw. */
  async execute<T = unknown>(spec: RequestSpec, signal?: AbortSignal): Promise<ExecuteResult<T>> {
    const started = performance.now();
    const res = await this.send(spec, signal);
    const rawBody = await res.text();
    if (!res.ok) throw parseAlliError(res.status, rawBody);
    // 빈 본문(204류) 또는 비JSON 2xx는 data=null — 원문은 rawBody로 항상 확인 가능
    let data: unknown = null;
    if (rawBody !== '') {
      try {
        data = JSON.parse(rawBody);
      } catch {
        data = null;
      }
    }
    return { data: data as T, rawBody, status: res.status, elapsedMs: performance.now() - started };
  }

  /** stream 실행. HTTP 에러는 첫 yield 전에 AlliApiError throw. 마지막에 {type:'done'} yield. */
  async *executeStream(spec: RequestSpec, signal?: AbortSignal): AsyncGenerator<StreamEvent, void, void> {
    const started = performance.now();
    const res = await this.send(spec, signal);
    if (!res.ok) {
      // 아무것도 yield하기 전에 throw — 호출자는 try 한 번으로 sync와 동일하게 처리
      throw parseAlliError(res.status, await res.text());
    }

    const scanner = createJsonScanner();
    let fullRaw = '';

    if (!res.body) {
      // 스트림 미지원 환경(목 Response 등) 폴백 — 본문 전체를 1회 push로 처리
      fullRaw = await res.text();
      for (const r of scanner.push(fullRaw)) yield toStreamEvent(r);
    } else {
      const reader = res.body.getReader();
      // stream:true — 한글 멀티바이트가 청크 경계에서 쪼개져도 디코더가 보류 후 이어붙임 (§3.5)
      const decoder = new TextDecoder('utf-8');
      try {
        for (;;) {
          const { done, value } = await reader.read(); // abort 시 AbortError가 그대로 전파됨
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          if (text === '') continue;
          fullRaw += text;
          for (const r of scanner.push(text)) yield toStreamEvent(r);
        }
      } finally {
        reader.releaseLock();
      }
      // 디코더 flush — 마지막 청크가 멀티바이트 중간에서 끝난 경우의 잔여 바이트 처리
      const tail = decoder.decode();
      if (tail !== '') {
        fullRaw += tail;
        for (const r of scanner.push(tail)) yield toStreamEvent(r);
      }
    }

    // 스캐너 잔여 partial 플러시 ("불완전 종료" garbage 가시화) 후 종료 이벤트
    for (const r of scanner.end()) yield toStreamEvent(r);
    yield { type: 'done', fullRaw, elapsedMs: performance.now() - started };
  }
}
