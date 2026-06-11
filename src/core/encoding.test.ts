import { describe, it, expect } from 'vitest';
import { isAscii, encodeOwnUserId } from './encoding';

describe('isAscii', () => {
  it('빈 문자열은 ASCII로 본다', () => {
    expect(isAscii('')).toBe(true);
  });

  it('0x00~0x7F 전 범위는 true', () => {
    expect(isAscii('EMP12345')).toBe(true);
    expect(isAscii('RPA-INVOICE-BOT')).toBe(true);
    expect(isAscii('\x00\x1f ~\x7f')).toBe(true); // 경계: 0x00, 0x7F 포함
  });

  it('0x7F 초과 코드포인트가 하나라도 있으면 false', () => {
    expect(isAscii('\u0080')).toBe(false); // 경계 바로 위
    expect(isAscii('홍길동')).toBe(false);
    expect(isAscii('emp김')).toBe(false); // 혼합
    expect(isAscii('café')).toBe(false);
    expect(isAscii('😀')).toBe(false); // 서로게이트 쌍
  });
});

describe('encodeOwnUserId', () => {
  it('ASCII ID는 그대로 반환 (빈 문자열 포함)', () => {
    expect(encodeOwnUserId('EMP12345')).toBe('EMP12345');
    expect(encodeOwnUserId('RPA-INVOICE-BOT')).toBe('RPA-INVOICE-BOT');
    expect(encodeOwnUserId('')).toBe('');
  });

  it("SSOT §3.2 고정값: '홍길동' → 'base64:7ZmN6ri464+Z'", () => {
    expect(encodeOwnUserId('홍길동')).toBe('base64:7ZmN6ri464+Z');
  });

  it('혼합 문자열도 전체를 base64 인코딩', () => {
    const encoded = encodeOwnUserId('emp김');
    expect(encoded.startsWith('base64:')).toBe(true);
    // utf-8 디코딩 왕복으로 검증
    const b64 = encoded.slice('base64:'.length);
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('emp김');
    expect(encoded).toBe('base64:ZW1w6rmA');
  });

  it('긴 비ASCII 입력도 청크 처리로 정상 인코딩', () => {
    const long = '가'.repeat(50_000); // utf-8 150,000바이트 — fromCharCode 인자 한도 초과 영역
    const encoded = encodeOwnUserId(long);
    expect(encoded.startsWith('base64:')).toBe(true);
    const b64 = encoded.slice('base64:'.length);
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe(long);
  });
});
