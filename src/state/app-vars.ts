/* 앱별 입력 변수 정의 — SSOT §9-1: API가 입력 변수 스키마를 제공하지 않으므로
   사용자가 플레이그라운드에서 직접 정의하고(이름/타입/필수/기본값) 로컬에 보관한다.
   목표 3.4(필수/타입/기본값 검증)는 이 정의에 대한 클라이언트 측 검증으로 구현. */

export interface VarDef {
  name: string;
  /** string: 문자열 그대로 / json: JSON.parse 후 전달 (KB ID 배열 등) */
  type: 'string' | 'json';
  required: boolean;
  defaultValue: string;
}

const keyFor = (appId: string) => `alli-sdk:vars:v1:${appId}`;

export function loadVarDefs(appId: string): VarDef[] {
  try {
    const raw = localStorage.getItem(keyFor(appId));
    return raw ? (JSON.parse(raw) as VarDef[]) : [];
  } catch {
    return [];
  }
}

export function saveVarDefs(appId: string, defs: VarDef[]): void {
  if (defs.length === 0) localStorage.removeItem(keyFor(appId));
  else localStorage.setItem(keyFor(appId), JSON.stringify(defs));
}

export interface BuildInputsResult {
  inputs: Record<string, unknown>;
  errors: { name: string; message: string }[];
}

/** 변수 정의 + 입력값 → run의 inputs 객체. 기본값 채움/필수/JSON 형식 검증 포함. */
export function buildInputs(defs: VarDef[], values: Record<string, string>): BuildInputsResult {
  const inputs: Record<string, unknown> = {};
  const errors: { name: string; message: string }[] = [];
  for (const def of defs) {
    const name = def.name.trim();
    if (!name) continue;
    let raw = values[name] ?? '';
    if (raw === '' && def.defaultValue !== '') raw = def.defaultValue;
    if (raw === '') {
      if (def.required) errors.push({ name, message: '필수 변수입니다 — 값을 입력하세요' });
      continue;
    }
    if (def.type === 'json') {
      try {
        inputs[name] = JSON.parse(raw);
      } catch {
        errors.push({ name, message: 'JSON 형식 오류 — 예: ["id1","id2"] 또는 {"k":"v"}' });
      }
    } else {
      inputs[name] = raw;
    }
  }
  return { inputs, errors };
}
