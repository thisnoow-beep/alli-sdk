/* AlliClient — fetch 래퍼.
   - 헤더 자동 주입: API-KEY(필수), OWN-USER-ID(설정 시, 비ASCII는 base64: 변환), USER-EMAIL(설정 시)
   - Content-Type: JSON body에만 'application/json' 명시, multipart는 미지정(boundary 자동) — §7-3
   - 비 2xx → parseAlliError로 AlliApiError throw, fetch 실패 → networkError throw
   - executeStream: body.getReader() + TextDecoder(stream:true) + createJsonScanner (§3.5)
   - fetchImpl 주입 가능 (목 모드/테스트). 기본은 글로벌 fetch —
     'Illegal invocation' 방지를 위해 this 바인딩 없이 래핑해 보관할 것. */

import type { RequestSpec } from './request-spec';

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

export class AlliClient {
  readonly cfg: AlliConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: AlliConfig, fetchImpl?: typeof fetch) {
    this.cfg = cfg;
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** spec → 전송 헤더 (raw 뷰 표시·코드 생성 미리보기에도 사용) */
  buildHeaders(spec: RequestSpec): Record<string, string> {
    void spec;
    throw new Error('TODO(M2): buildHeaders 구현');
  }

  /** sync 실행. 2xx가 아니면 AlliApiError throw. */
  async execute<T = unknown>(spec: RequestSpec, signal?: AbortSignal): Promise<ExecuteResult<T>> {
    void spec;
    void signal;
    void this.fetchImpl;
    throw new Error('TODO(M2): execute 구현');
  }

  /** stream 실행. HTTP 에러는 첫 yield 전에 AlliApiError throw. 마지막에 {type:'done'} yield. */
  async *executeStream(spec: RequestSpec, signal?: AbortSignal): AsyncGenerator<StreamEvent, void, void> {
    void spec;
    void signal;
    throw new Error('TODO(M2): executeStream 구현');
  }
}
