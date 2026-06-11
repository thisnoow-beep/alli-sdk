/* RequestSpec — 패리티의 중추.
   같은 spec 객체를 ① client.execute(실제 호출) ② multipart 미리보기 ③ 코드 생성 4종이 소비하므로
   화면에서 테스트한 요청과 생성된 코드가 구조적으로 일치한다. */

export interface MultipartPart {
  name: string;
  kind: 'text' | 'file';
  /** kind=text일 때 값 */
  value?: string;
  /** kind=file일 때 파일 (코드 생성 시에는 file.name만 사용) */
  file?: File;
}

export type QueryValue = string | number | boolean | string[] | undefined;

export type RequestBody =
  | { kind: 'none' }
  | { kind: 'json'; value: unknown }
  | { kind: 'multipart'; parts: MultipartPart[] };

export interface RequestSpec {
  /** 엔드포인트 식별자 (코드 생성 라벨/주석용), 예: 'generative_answer' */
  id: string;
  method: 'GET' | 'POST' | 'DELETE';
  /** '/webapi/...' 절대 경로 */
  path: string;
  query?: Record<string, QueryValue>;
  body: RequestBody;
  /** 응답을 스트리밍으로 소비할지 (SSOT §3.5 — SSE 아님, JSON 조각) */
  stream: boolean;
}

export function buildUrl(baseUrl: string, spec: RequestSpec): string {
  const base = baseUrl.replace(/\/+$/, '');
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(spec.query ?? {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) params.append(k, item);
    else params.append(k, String(v));
  }
  const qs = params.toString();
  return `${base}${spec.path}${qs ? `?${qs}` : ''}`;
}

/** multipart parts → FormData (실호출용). Content-Type은 명시하지 않는다 — boundary 자동 설정 (§7-3). */
export function toFormData(parts: MultipartPart[]): FormData {
  const fd = new FormData();
  for (const p of parts) {
    if (p.kind === 'text') fd.append(p.name, p.value ?? '');
    else if (p.file) fd.append(p.name, p.file, p.file.name);
  }
  return fd;
}

/** 텍스트 파트 헬퍼 — undefined/빈 값은 건너뛰어 parts 배열을 깔끔하게 유지 */
export function textPart(name: string, value: string | undefined | null): MultipartPart[] {
  return value === undefined || value === null || value === '' ? [] : [{ name, kind: 'text', value }];
}

export function filePart(name: string, file: File): MultipartPart {
  return { name, kind: 'file', file };
}
