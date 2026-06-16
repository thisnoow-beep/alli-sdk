/* 에러 파서 + 한글 해설 — SSOT §3.3 (Gate G1 실 API 검증 반영, 2026-06-16).
   실측 형태:
   - 인증/권한: { "error": { "value": 1013, "name": "INVALID_TOKEN" }, "message": "INVALID_TOKEN" }  (HTTP 401)
   - 요청 본문 오류: { "result": [], "errors": "content must be JSON deserializable!" }  (HTTP 400)
   - 메서드 오류: "Method not allowed"  (HTTP 405, text/html — 비JSON)
   - inputs 형식 오류(일부 앱): { "errors": "internal error. Expecting value: ..." }
   back-compat: { "type":"APIError", "code":700x, "message" } / { "error":"<문자열>" } 도 계속 처리. */

export type ErrorShape =
  | 'standard'
  | 'error-object'
  | 'error-key'
  | 'errors-key'
  | 'non-json'
  | 'network';

export interface AlliApiErrorOptions {
  httpStatus: number;
  code?: number;
  /** error-object 형태의 error.name (예: 'INVALID_TOKEN') */
  errorName?: string;
  shape: ErrorShape;
  rawBody: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class AlliApiError extends Error {
  readonly httpStatus: number;
  /** 숫자 코드 — error-object의 error.value(실측 1013 등) 또는 레거시 standard의 code */
  readonly code?: number;
  /** error-object의 error.name (예: 'INVALID_TOKEN') */
  readonly errorName?: string;
  readonly shape: ErrorShape;
  readonly rawBody: string;

  constructor(message: string, opts: AlliApiErrorOptions) {
    super(message);
    this.name = 'AlliApiError';
    this.httpStatus = opts.httpStatus;
    if (opts.code !== undefined) this.code = opts.code;
    if (opts.errorName !== undefined) this.errorName = opts.errorName;
    this.shape = opts.shape;
    this.rawBody = opts.rawBody;
  }
}

/** 비 2xx 응답 본문 → AlliApiError (code | error | errors | 비JSON 모두 대응) */
export function parseAlliError(httpStatus: number, bodyText: string): AlliApiError {
  const fallbackMessage = `HTTP ${httpStatus}`;

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    // HTML 에러 페이지, 빈 본문 등 — 원문은 rawBody에 보존
    return new AlliApiError(fallbackMessage, { httpStatus, shape: 'non-json', rawBody: bodyText });
  }

  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const body = parsed as Record<string, unknown>;

    // 실측 인증/권한 형태: { error: { value: 1013, name: 'INVALID_TOKEN' }, message } (§3.3, Gate G1)
    // code는 error.value에 중첩되고 HTTP는 401 — top-level code 검사보다 먼저 처리해야 한다.
    if (isRecord(body['error'])) {
      const errObj = body['error'];
      const value = typeof errObj['value'] === 'number' ? errObj['value'] : undefined;
      const name = typeof errObj['name'] === 'string' ? errObj['name'] : undefined;
      const message =
        typeof body['message'] === 'string' && body['message'] !== ''
          ? body['message']
          : (name ?? fallbackMessage);
      return new AlliApiError(message, {
        httpStatus,
        code: value,
        errorName: name,
        shape: 'error-object',
        rawBody: bodyText,
      });
    }

    // back-compat 표준 형태: { type, code, message } — code는 숫자일 때만 신뢰
    if (typeof body['code'] === 'number') {
      const message =
        typeof body['message'] === 'string' && body['message'] !== ''
          ? body['message']
          : fallbackMessage;
      return new AlliApiError(message, {
        httpStatus,
        code: body['code'],
        shape: 'standard',
        rawBody: bodyText,
      });
    }

    // 비표준 형태 1: { "error": "Method Not Allowed POST: ..." } (문자열 error)
    if (typeof body['error'] === 'string') {
      return new AlliApiError(body['error'], { httpStatus, shape: 'error-key', rawBody: bodyText });
    }

    // 비표준 형태 2: { "errors": "internal error. Expecting value: ..." }
    if ('errors' in body) {
      const errors = body['errors'];
      const message = typeof errors === 'string' ? errors : JSON.stringify(errors);
      return new AlliApiError(message, { httpStatus, shape: 'errors-key', rawBody: bodyText });
    }
  }

  // JSON이긴 하지만 알려진 키(code/error/errors)가 전혀 없음 → non-json 취급, 원문만 보존
  return new AlliApiError(fallbackMessage, { httpStatus, shape: 'non-json', rawBody: bodyText });
}

/** fetch 자체가 실패(TypeError 등) — httpStatus 0, shape 'network' (CORS 의심 포함) */
export function networkError(cause: unknown): AlliApiError {
  // 브라우저는 CORS 차단도 TypeError로만 보고하므로 cause 요약 외 상세는 알 수 없다
  const summary = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  return new AlliApiError(`네트워크 오류 — ${summary}`, {
    httpStatus: 0,
    shape: 'network',
    rawBody: '',
  });
}

export type ErrorContext = 'connect' | 'apps' | 'run' | 'ga' | 'kb' | 'conversation';

export interface ErrorExplanation {
  titleKo: string;
  hintsKo: string[];
}

/* 해설 규칙 (M2):
   - 7000 미분류 서버 오류 / 7001 "API 키가 유효하지 않습니다 — Settings > General의 REST API 키인지,
     JS 챗 위젯용 sdkKey와 혼동하지 않았는지 확인하세요" / 7002 JSON 디코딩 실패 /
     7003 파라미터 누락·형식 오류 / 7004 결제(과금) 오류 / 405 HTTP 메서드 오류
   - errors 본문에 "Expecting value" 포함 → §9-1 힌트: "입력 변수(inputs) 누락/형식 오류 가능성 —
     변수명은 Alli 빌더 화면에서 확인하세요"
   - shape 'network' → "네트워크 또는 CORS 차단 가능성" + 체크리스트(Base URL 오타/사내망/브라우저 콘솔 확인)
   - ctx가 'ga'|'apps'|'run'이고 4xx → §9-4 계약 옵션 힌트("가능성" 라벨):
     "App Market·Generative Answer는 계약 옵션입니다 — 계정 매니저를 통해 활성화 여부를 확인하세요" */
/* code → 제목 매핑 (7001은 힌트가 따라붙어 별도 분기) */
const CODE_TITLES_KO: Record<number, string> = {
  7000: '서버 오류(미분류)',
  7002: '요청 본문 JSON 디코딩 실패',
  7003: '파라미터 누락/형식 오류',
  7004: '결제/과금 오류 (연체 등)',
};

export function explainError(e: unknown, ctx?: ErrorContext): ErrorExplanation {
  // AlliApiError가 아닌 일반 오류 — 코드/형태 정보가 없으므로 메시지만 전달
  if (!(e instanceof AlliApiError)) {
    const message = e instanceof Error ? e.message : String(e);
    return { titleKo: '알 수 없는 오류', hintsKo: message ? [message] : [] };
  }

  let titleKo: string;
  const hintsKo: string[] = [];

  // 실측 인증 실패 = error.name 'INVALID_TOKEN' 또는 HTTP 401 (레거시 code 7001도 포용)
  const isAuthError =
    e.errorName === 'INVALID_TOKEN' ||
    e.code === 7001 ||
    (e.shape === 'error-object' && e.httpStatus === 401);

  if (e.shape === 'network') {
    titleKo = '네트워크 또는 CORS 차단 가능성';
    hintsKo.push(
      'Base URL 오타 확인',
      '인터넷·사내망 연결 확인',
      '브라우저 개발자도구 콘솔에서 CORS 메시지 확인 — JS에는 차단 상세가 노출되지 않음',
    );
  } else if (isAuthError) {
    // Flow 1 §4: REST API 키와 JS 챗 위젯용 sdkKey 혼동이 가장 흔한 원인
    titleKo = 'API 키가 유효하지 않습니다';
    hintsKo.push(
      'Settings > General의 REST API 키인지 확인',
      'JS 챗 위젯용 sdkKey와 혼동하지 않았는지 확인',
    );
  } else {
    const mapped = e.code !== undefined ? CODE_TITLES_KO[e.code] : undefined;
    if (mapped !== undefined) {
      titleKo = mapped;
    } else if (e.httpStatus === 405) {
      titleKo = '잘못된 HTTP 메서드';
    } else {
      titleKo = e.message !== '' ? e.message : `HTTP ${e.httpStatus} 오류`;
    }
  }

  // §9-1: inputs 누락/형식 오류 시 서버가 불친절한 "Expecting value" errors 본문을 반환
  if (e.shape === 'errors-key' && e.rawBody.includes('Expecting value')) {
    hintsKo.push(
      '입력 변수(inputs) 누락/형식 오류 가능성 — 변수명은 Alli 빌더 화면에서 확인하세요 (single_action: 앱에 정의된 변수 / 대화형(skill): user 변수만)',
    );
  }

  // §9-4: App Market·GA는 계약 옵션 — 키 오류(7001)가 아닌 4xx에서만 "가능성"으로 안내
  if (
    (ctx === 'ga' || ctx === 'apps' || ctx === 'run') &&
    e.httpStatus >= 400 &&
    e.httpStatus < 500 &&
    !isAuthError
  ) {
    hintsKo.push(
      '(가능성) App Market·Generative Answer는 계약 옵션 기능입니다 — 프로젝트에 활성화돼 있는지 계정 매니저를 통해 확인하세요',
    );
  }

  return { titleKo, hintsKo };
}
