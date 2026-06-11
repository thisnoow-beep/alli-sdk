/* 에러 파서 + 한글 해설 테스트 — SSOT §3.3, §9-1, §9-4, §4 Flow 1 기준 */
import { describe, expect, it } from 'vitest';
import { AlliApiError, explainError, networkError, parseAlliError } from './errors';

describe('parseAlliError — 5가지 shape 파싱', () => {
  it("표준 형태(code 숫자) → shape 'standard'", () => {
    const raw = '{"type":"APIError","code":7001,"message":"Invalid API Key"}';
    const e = parseAlliError(403, raw);
    expect(e).toBeInstanceOf(AlliApiError);
    expect(e.shape).toBe('standard');
    expect(e.code).toBe(7001);
    expect(e.httpStatus).toBe(403);
    expect(e.message).toBe('Invalid API Key');
    expect(e.rawBody).toBe(raw);
  });

  it('표준 형태인데 message가 없으면 기본 문구 HTTP {status}', () => {
    const e = parseAlliError(500, '{"type":"APIError","code":7000}');
    expect(e.shape).toBe('standard');
    expect(e.code).toBe(7000);
    expect(e.message).toBe('HTTP 500');
  });

  it("비표준 error 키(문자열) → shape 'error-key'", () => {
    const raw = '{"error":"Method Not Allowed POST: /webapi/apps"}';
    const e = parseAlliError(405, raw);
    expect(e.shape).toBe('error-key');
    expect(e.code).toBeUndefined();
    expect(e.httpStatus).toBe(405);
    expect(e.message).toBe('Method Not Allowed POST: /webapi/apps');
    expect(e.rawBody).toBe(raw);
  });

  it("비표준 errors 키 → shape 'errors-key'", () => {
    const raw = '{"errors":"internal error. Expecting value: line 1 column 1 (char 0)"}';
    const e = parseAlliError(500, raw);
    expect(e.shape).toBe('errors-key');
    expect(e.code).toBeUndefined();
    expect(e.message).toBe('internal error. Expecting value: line 1 column 1 (char 0)');
    expect(e.rawBody).toBe(raw);
  });

  it("JSON 파싱 실패(HTML 등) → shape 'non-json' + rawBody 보존", () => {
    const raw = '<html><body>502 Bad Gateway</body></html>';
    const e = parseAlliError(502, raw);
    expect(e.shape).toBe('non-json');
    expect(e.code).toBeUndefined();
    expect(e.message).toBe('HTTP 502');
    expect(e.rawBody).toBe(raw);
  });

  it("JSON이지만 code/error/errors 키가 전혀 없음 → shape 'non-json'", () => {
    const raw = '{"detail":"Not Found"}';
    const e = parseAlliError(404, raw);
    expect(e.shape).toBe('non-json');
    expect(e.message).toBe('HTTP 404');
    expect(e.rawBody).toBe(raw);
  });

  it("networkError → httpStatus 0, shape 'network', cause 요약 포함", () => {
    const e = networkError(new TypeError('Failed to fetch'));
    expect(e).toBeInstanceOf(AlliApiError);
    expect(e.shape).toBe('network');
    expect(e.httpStatus).toBe(0);
    expect(e.message).toContain('Failed to fetch');
  });
});

describe('explainError — 한글 해설', () => {
  it("7001 → 제목 'API 키가 유효하지 않습니다' + 힌트에 'sdkKey' 포함", () => {
    const e = parseAlliError(403, '{"type":"APIError","code":7001,"message":"Invalid API Key"}');
    const ex = explainError(e, 'connect');
    expect(ex.titleKo).toBe('API 키가 유효하지 않습니다');
    expect(ex.hintsKo.join(' ')).toContain('sdkKey');
    expect(ex.hintsKo.join(' ')).toContain('Settings > General');
  });

  it("network shape → 제목에 'CORS' 포함 + 힌트 3개", () => {
    const ex = explainError(networkError(new TypeError('Failed to fetch')));
    expect(ex.titleKo).toContain('CORS');
    expect(ex.hintsKo).toHaveLength(3);
    expect(ex.hintsKo.join(' ')).toContain('Base URL');
  });

  it("errors-key + 'Expecting value' → 힌트에 '빌더' 포함 (§9-1)", () => {
    const e = parseAlliError(
      500,
      '{"errors":"internal error. Expecting value: line 1 column 1 (char 0)"}',
    );
    const ex = explainError(e, 'run');
    expect(ex.hintsKo.join(' ')).toContain('빌더');
    expect(ex.hintsKo.join(' ')).toContain('inputs');
  });

  it("ctx 'ga' + 4xx(7001 아님) → '계약 옵션' 힌트 포함 (§9-4)", () => {
    const e = parseAlliError(400, '{"type":"APIError","code":7003,"message":"Invalid Parameter"}');
    const ex = explainError(e, 'ga');
    expect(ex.titleKo).toBe('파라미터 누락/형식 오류');
    expect(ex.hintsKo.join(' ')).toContain('계약 옵션');
  });

  it("7001은 ctx 'ga'여도 계약 옵션 힌트 미포함", () => {
    const e = parseAlliError(403, '{"type":"APIError","code":7001,"message":"Invalid API Key"}');
    const ex = explainError(e, 'ga');
    expect(ex.hintsKo.join(' ')).not.toContain('계약 옵션');
  });

  it("ctx 'kb'는 4xx여도 계약 옵션 힌트 미포함", () => {
    const e = parseAlliError(400, '{"type":"APIError","code":7003,"message":"Invalid Parameter"}');
    const ex = explainError(e, 'kb');
    expect(ex.hintsKo.join(' ')).not.toContain('계약 옵션');
  });

  it('코드 매핑: 7000 / 7002 / 7004 / 405', () => {
    const t = (status: number, body: string): string =>
      explainError(parseAlliError(status, body)).titleKo;
    expect(t(500, '{"code":7000,"message":"Something went wrong."}')).toBe('서버 오류(미분류)');
    expect(t(403, '{"code":7002,"message":"Invalid JSON"}')).toBe('요청 본문 JSON 디코딩 실패');
    expect(t(403, '{"code":7004,"message":"Payment Error"}')).toBe('결제/과금 오류 (연체 등)');
    expect(t(405, '{"error":"Method Not Allowed POST: /webapi/apps"}')).toBe('잘못된 HTTP 메서드');
  });

  it('AlliApiError가 아닌 일반 오류 → 일반 해설', () => {
    const ex = explainError(new RangeError('boom'));
    expect(ex.titleKo).toBe('알 수 없는 오류');
    expect(ex.hintsKo.join(' ')).toContain('boom');
  });
});
