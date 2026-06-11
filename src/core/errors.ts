/* 에러 파서 + 한글 해설 — SSOT §3.3.
   표준 형태  : { "type": "APIError", "code": 7000, "message": "..." }
   비표준 형태: { "error": "Method Not Allowed POST: ..." } / { "errors": "internal error. Expecting value: ..." }
   둘 다 처리해야 한다 (§3.3 경고). */

export type ErrorShape = 'standard' | 'error-key' | 'errors-key' | 'non-json' | 'network';

export interface AlliApiErrorOptions {
  httpStatus: number;
  code?: number;
  shape: ErrorShape;
  rawBody: string;
}

export class AlliApiError extends Error {
  readonly httpStatus: number;
  /** 7000~7004 (표준 형태일 때만) */
  readonly code?: number;
  readonly shape: ErrorShape;
  readonly rawBody: string;

  constructor(message: string, opts: AlliApiErrorOptions) {
    super(message);
    this.name = 'AlliApiError';
    this.httpStatus = opts.httpStatus;
    if (opts.code !== undefined) this.code = opts.code;
    this.shape = opts.shape;
    this.rawBody = opts.rawBody;
  }
}

/** 비 2xx 응답 본문 → AlliApiError (code | error | errors | 비JSON 모두 대응) */
export function parseAlliError(httpStatus: number, bodyText: string): AlliApiError {
  void httpStatus;
  void bodyText;
  throw new Error('TODO(M2): parseAlliError 구현');
}

/** fetch 자체가 실패(TypeError 등) — httpStatus 0, shape 'network' (CORS 의심 포함) */
export function networkError(cause: unknown): AlliApiError {
  void cause;
  throw new Error('TODO(M2): networkError 구현');
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
export function explainError(e: unknown, ctx?: ErrorContext): ErrorExplanation {
  void e;
  void ctx;
  throw new Error('TODO(M2): explainError 구현');
}
