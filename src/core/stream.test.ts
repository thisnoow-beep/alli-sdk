/* stream.ts 고문 테스트 — SSOT §3.5: SSE가 아닌 JSON 조각 스트리밍.
   garbage의 분할 방식은 구현 세부사항이므로 연결(join) 결과 기준으로만 단언한다. */

import { describe, expect, it } from 'vitest';
import { createJsonScanner } from './stream';
import type { ScanResult } from './stream';

type ValueResult = Extract<ScanResult, { kind: 'value' }>;

function valuesOf(results: ScanResult[]): unknown[] {
  return results.filter((r): r is ValueResult => r.kind === 'value').map((r) => r.value);
}

function garbageTextOf(results: ScanResult[]): string {
  return results
    .filter((r) => r.kind === 'garbage')
    .map((r) => r.raw)
    .join('');
}

describe('createJsonScanner', () => {
  it('① 객체 1개를 3번의 push로 분할해도 마지막 push에서 한 번만 방출한다', () => {
    const s = createJsonScanner();
    expect(s.push('{"a":')).toEqual([]);
    expect(s.push('1,"b":[2,')).toEqual([]);
    expect(s.push('3]}')).toEqual([
      { kind: 'value', value: { a: 1, b: [2, 3] }, raw: '{"a":1,"b":[2,3]}' },
    ]);
    expect(s.end()).toEqual([]);
  });

  it('② push 경계가 문자열 이스케이프(\\")의 백슬래시와 따옴표 사이에 걸려도 정상', () => {
    const full = '{"msg":"say \\"안녕\\" to alli"}';
    const cut = full.indexOf('\\') + 1; // 백슬래시 바로 뒤에서 절단
    const s = createJsonScanner();
    expect(s.push(full.slice(0, cut))).toEqual([]);
    const out = s.push(full.slice(cut));
    expect(valuesOf(out)).toEqual([{ msg: 'say "안녕" to alli' }]);
    expect(s.end()).toEqual([]);
  });

  it('③ 문자열 값 안의 중괄호/대괄호는 깊이에 영향을 주지 않는다', () => {
    const full = '{"t":"중괄호 } { 대괄호 ] [ 텍스트","u":["]","}"]}';
    // 문자열 안의 가짜 닫는 중괄호 직후에서 절단 — 여기서 값이 방출되면 안 됨
    const fakeClose = full.indexOf('}') + 1;
    const s = createJsonScanner();
    expect(s.push(full.slice(0, fakeClose))).toEqual([]);
    const out = s.push(full.slice(fakeClose));
    expect(valuesOf(out)).toEqual([{ t: '중괄호 } { 대괄호 ] [ 텍스트', u: [']', '}'] }]);
    expect(garbageTextOf(out)).toBe('');
  });

  it('④ 한 push에 값 2개가 들어오면 둘 다 순서대로 방출한다', () => {
    const s = createJsonScanner();
    const out = s.push('{"a":1},{"b":2}');
    expect(valuesOf(out)).toEqual([{ a: 1 }, { b: 2 }]);
    expect(garbageTextOf(out)).toBe('');
  });

  it('⑤ NDJSON(개행 구분)을 push 경계와 무관하게 줄 단위 값으로 추출한다', () => {
    const s = createJsonScanner();
    const out1 = s.push('{"i":1}\n{"i"');
    expect(valuesOf(out1)).toEqual([{ i: 1 }]);
    const out2 = s.push(':2}\n{"i":3}\n');
    expect(valuesOf(out2)).toEqual([{ i: 2 }, { i: 3 }]);
    expect(garbageTextOf([...out1, ...out2])).toBe('');
    expect(s.end()).toEqual([]);
  });

  it('⑥ ~100KB 중첩 대형 단일 값을 작은 청크로 나눠 push해도 1개 값으로 복원한다', () => {
    const leaf = { 본문: '한글 채움 텍스트 — 스트리밍 파서 검증용 문장. '.repeat(4), n: 12345.678 };
    const list = Array.from({ length: 1000 }, (_, i) => ({ id: i, ...leaf }));
    let big: unknown = { list };
    for (let i = 0; i < 60; i += 1) big = [big, i]; // 60단 중첩
    const raw = JSON.stringify(big);
    expect(raw.length).toBeGreaterThan(100_000);

    const s = createJsonScanner();
    const collected: ScanResult[] = [];
    for (let i = 0; i < raw.length; i += 4096) collected.push(...s.push(raw.slice(i, i + 4096)));
    collected.push(...s.end());

    expect(collected).toHaveLength(1);
    expect(collected[0].kind).toBe('value');
    expect(valuesOf(collected)).toEqual([big]);
  });

  it('⑦ 잔여 partial은 end()에서 garbage로 플러시된다', () => {
    const s = createJsonScanner();
    expect(s.push('{"a": 1, "b": "잘리')).toEqual([]);
    expect(s.end()).toEqual([{ kind: 'garbage', raw: '{"a": 1, "b": "잘리' }]);
  });

  it("⑧ 'data: ' 같은 선행 잡텍스트는 garbage로 모이고 값은 정상 추출된다", () => {
    const s = createJsonScanner();
    const out = [...s.push('data: {"a":1}\n\ndata: {"b":2}'), ...s.end()];
    expect(valuesOf(out)).toEqual([{ a: 1 }, { b: 2 }]);
    // 분할 방식은 고정하지 않고 연결 결과로만 단언 (값 밖 공백/개행은 garbage에 포함되지 않음)
    expect(garbageTextOf(out)).toBe('data: data: ');
  });

  it('⑨ 값 안의 한글 텍스트(중괄호 포함)를 그대로 보존한다', () => {
    const s = createJsonScanner();
    const out = s.push('{"질문":"연차 이월 규정 알려줘","조항":"제8조 {별표 1} 참조"}');
    expect(valuesOf(out)).toEqual([
      { 질문: '연차 이월 규정 알려줘', 조항: '제8조 {별표 1} 참조' },
    ]);
  });

  it('⑩ 디코더 통합 — 한글 멀티바이트 한가운데서 바이트를 잘라도 stream 디코딩 후 정상', () => {
    const text = '{"메시지":"안녕하세요, 알리입니다"}\n{"메시지":"두 번째 청크 — 확인 🙂"}';
    const bytes = new TextEncoder().encode(text);
    // '메'(3바이트)는 byte 2~4 — byte 3에서 자르면 멀티바이트 한가운데임을 검증
    expect(bytes[3] & 0xc0).toBe(0x80);

    const decoder = new TextDecoder('utf-8');
    const s = createJsonScanner();
    const collected: ScanResult[] = [];
    const cuts = [0, 3, 10, 17, 24, 31, 45, bytes.length];
    for (let i = 0; i < cuts.length - 1; i += 1) {
      const chunk = bytes.subarray(cuts[i], cuts[i + 1]);
      collected.push(...s.push(decoder.decode(chunk, { stream: true })));
    }
    collected.push(...s.push(decoder.decode())); // 디코더 잔여 플러시
    collected.push(...s.end());

    expect(valuesOf(collected)).toEqual([
      { 메시지: '안녕하세요, 알리입니다' },
      { 메시지: '두 번째 청크 — 확인 🙂' },
    ]);
    expect(garbageTextOf(collected)).toBe('');
  });

  it('⑪ top-level 배열도 단일 값으로 인정한다', () => {
    const s = createJsonScanner();
    const out = s.push('[{"k":"v"},[1,2],"셋",null,4]');
    expect(valuesOf(out)).toEqual([[{ k: 'v' }, [1, 2], '셋', null, 4]]);
  });

  it('⑫ 임의 바이너리 잡텍스트에도 절대 throw하지 않고, 이후에도 정상 동작한다', () => {
    // 시드 고정 LCG — 재현 가능한 의사 난수 바이트
    let seed = 0xc0ffee;
    const nextByte = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed >>> 16) & 0xff;
    };
    const bytes = Uint8Array.from({ length: 8192 }, nextByte);
    const junk = new TextDecoder('utf-8').decode(bytes); // 비정상 시퀀스는 U+FFFD로 치환

    const s = createJsonScanner();
    const collected: ScanResult[] = [];
    expect(() => {
      for (let i = 0; i < junk.length; i += 97) collected.push(...s.push(junk.slice(i, i + 97)));
      collected.push(...s.end());
    }).not.toThrow();

    for (const r of collected) {
      expect(r.kind === 'value' || r.kind === 'garbage').toBe(true);
      expect(typeof r.raw).toBe('string');
    }
    // 잡텍스트 이후에도 스캐너는 멀쩡해야 한다
    expect(valuesOf(s.push('{"ok":true}'))).toEqual([{ ok: true }]);
  });

  it('top-level 원시값 — 구분자(공백/개행)에서 확정, 버퍼 끝(end)도 구분자로 인정', () => {
    const s1 = createJsonScanner();
    const out = [...s1.push('42 "안녕" true\n'), ...s1.end()];
    expect(valuesOf(out)).toEqual([42, '안녕', true]);
    expect(garbageTextOf(out)).toBe('');

    // 숫자가 push 경계에서 쪼개져도 합쳐질 때까지 대기한다
    const s2 = createJsonScanner();
    expect(s2.push('12')).toEqual([]);
    expect(s2.push('3')).toEqual([]);
    expect(s2.end()).toEqual([{ kind: 'value', value: 123, raw: '123' }]);
  });

  it('값 없이 잡텍스트만 흐르면 end()에서 garbage로만 나온다', () => {
    const s = createJsonScanner();
    const out = [...s.push('hello'), ...s.push(' world'), ...s.end()];
    expect(valuesOf(out)).toEqual([]);
    expect(garbageTextOf(out)).toBe('hello world');
  });
});
