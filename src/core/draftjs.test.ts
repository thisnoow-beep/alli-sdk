import { describe, it, expect } from 'vitest';
import { tryExtractDraftJs } from './draftjs';

/* 실제 DraftJS raw content 형태 픽스처 — 블록 2개, inlineStyleRanges/entityRanges 포함 */
const draftFixture = JSON.stringify({
  blocks: [
    {
      key: 'a1b2c',
      text: '첫 번째 문단입니다.',
      type: 'unstyled',
      depth: 0,
      inlineStyleRanges: [{ offset: 0, length: 4, style: 'BOLD' }],
      entityRanges: [],
      data: {},
    },
    {
      key: 'd3e4f',
      text: '두 번째 문단 — 링크 포함.',
      type: 'unstyled',
      depth: 0,
      inlineStyleRanges: [],
      entityRanges: [{ offset: 9, length: 2, key: 0 }],
      data: {},
    },
  ],
  entityMap: {
    '0': { type: 'LINK', mutability: 'MUTABLE', data: { url: 'https://example.com' } },
  },
});

describe('tryExtractDraftJs', () => {
  it('DraftJS 형태면 blocks[].text를 \\n으로 join해 반환', () => {
    expect(tryExtractDraftJs(draftFixture)).toBe(
      '첫 번째 문단입니다.\n두 번째 문단 — 링크 포함.',
    );
  });

  it("blocks가 비어 있고 entityMap이 있으면 ''(빈 문자열) 반환", () => {
    expect(tryExtractDraftJs(JSON.stringify({ blocks: [], entityMap: {} }))).toBe('');
  });

  it('DraftJS가 아닌 JSON 문자열은 null', () => {
    expect(tryExtractDraftJs('{"answer":"마크다운 답변"}')).toBe(null);
    // blocks는 있으나 entityMap 키가 없으면 null
    expect(tryExtractDraftJs(JSON.stringify({ blocks: [{ text: 'x' }] }))).toBe(null);
    // entityMap은 있으나 blocks가 배열이 아니면 null
    expect(tryExtractDraftJs(JSON.stringify({ blocks: 'x', entityMap: {} }))).toBe(null);
    // 원소에 string text가 없으면 null
    expect(
      tryExtractDraftJs(JSON.stringify({ blocks: [{ text: 1 }], entityMap: {} })),
    ).toBe(null);
    // 객체가 아닌 JSON(배열/스칼라)도 null
    expect(tryExtractDraftJs('[1,2,3]')).toBe(null);
    expect(tryExtractDraftJs('"그냥 JSON 문자열"')).toBe(null);
    expect(tryExtractDraftJs('null')).toBe(null);
  });

  it('일반 텍스트는 null', () => {
    expect(tryExtractDraftJs('그냥 평범한 답변 텍스트입니다.')).toBe(null);
  });

  it('깨진 JSON은 null', () => {
    expect(tryExtractDraftJs('{"blocks": [')).toBe(null);
    expect(tryExtractDraftJs('')).toBe(null);
  });
});
