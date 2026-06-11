/* 13개 엔드포인트 요청/응답 타입 — SSOT.md §5 기준.
   응답 스키마가 OpenAPI에 미상세한 곳은 [k: string]: unknown 으로 관용 처리 (§9-2/9-3). */

/* ---------- 앱 (§5.2~5.5) ---------- */

/** API 용어 ↔ 화면 용어: skill=대화형 앱, single_action=답변형 앱, agent=에이전트형 앱, campaign=대화형 앱 구명칭 */
export type AppType = 'single_action' | 'skill' | 'campaign' | 'agent' | (string & {});

export interface AppInfo {
  id: string;
  name: string;
  type: AppType;
  description?: string;
  category?: string;
  published?: boolean;
  agentPermission?: unknown;
  userPermission?: unknown;
  cursor?: string;
  [k: string]: unknown;
}

export interface ListAppsQuery {
  searchTerm?: string;
  categories?: string[];
  type?: 'single_action' | 'skill';
  published?: boolean;
  pageSize?: number;
  cursor?: string;
}

/** §5.4 POST /webapi/apps/{app_id}/run body */
export interface RunAppBody {
  inputs?: Record<string, unknown>;
  mode?: 'sync' | 'stream' | 'background';
  chat?: {
    message?: string;
    source?: { knowledgeBaseIds?: string[]; folderIds?: string[]; webSites?: string[] };
    useNodeDefaultInputSource?: boolean;
  };
  isStateful?: boolean;
  conversationId?: string;
  llmModel?: string;
  llmPromptId?: string;
  gaPromptGroupId?: string;
  temperature?: number;
  requiredVariables?: string[];
  [k: string]: unknown;
}

export interface Citation {
  clueId?: string;
  source?: 'DOCUMENT' | 'FAQ' | 'WEB' | (string & {});
  title?: string;
  knowledgeBaseId?: string;
  pageNo?: number;
  url?: string;
  text?: string;
  [k: string]: unknown;
}

export interface RunResponseItem {
  id?: string;
  type?: string;
  message?: unknown;
  source?: unknown;
  sender?: unknown;
  createdAt?: unknown;
  completed?: boolean;
  citations?: Citation[];
  error?: unknown;
  intermediateStep?: unknown;
  [k: string]: unknown;
}

/** §9-3: v2 스펙은 result.responses[], 레거시 예시는 result.choices[] — 둘 다 허용 */
export interface RunResult {
  id?: string;
  name?: string;
  type?: string;
  category?: string;
  responses?: RunResponseItem[];
  choices?: unknown[];
  variables?: unknown;
  conversation?: { id?: string; state?: string; [k: string]: unknown };
  [k: string]: unknown;
}

export interface RunResponse {
  result?: RunResult;
  [k: string]: unknown;
}

/* ---------- Generative Answer (§5.6~5.7) ---------- */

export type HashtagOption = 'and' | 'or';

export interface HashtagsFilter {
  qnaInclude?: string[];
  qnaIncludeOption?: HashtagOption;
  qnaExclude?: string[];
  qnaExcludeOption?: HashtagOption;
  docsInclude?: string[];
  docsIncludeOption?: HashtagOption;
  docsExclude?: string[];
  docsExcludeOption?: HashtagOption;
}

export type SearchFrom = 'web' | 'qna' | 'document';

export interface GenerativeAnswerBody {
  query: string;
  model?: string;
  /** SDK는 항상 'MARKDOWN' 지정 (§3.4 — DraftJS 기본값 회피) */
  answerFormat?: 'MARKDOWN' | 'DRAFTJS';
  isStateful?: boolean;
  threadId?: string;
  promptGroupId?: string;
  mode?: 'sync' | 'stream';
  clues?: boolean;
  clueText?: boolean;
  hashtags?: HashtagsFilter;
  search_from?: SearchFrom[];
  [k: string]: unknown;
}

export interface Clue {
  clueId?: string;
  source?: 'DOCUMENT' | 'FAQ' | (string & {});
  title?: string;
  pageNo?: number;
  kbId?: string;
  faqId?: string;
  text?: string;
  [k: string]: unknown;
}

export interface GaResponse {
  /** answerFormat에 따라 Markdown 문자열 또는 DraftJS 객체 */
  answer?: unknown;
  intent?: 'SEARCH' | 'END_OF_CONVERSATION' | (string & {});
  clues?: Clue[];
  threadId?: string;
  /** 멀티턴 시 재작성된 질문 */
  fuQuestion?: string;
  [k: string]: unknown;
}

/** 프로젝트에 등록된 모델만 유효 — UI는 자유 입력 + 제안 목록 (§5.6) */
export const GA_MODEL_SUGGESTIONS: readonly string[] = [
  'gpt4_o',
  'gpt4_o_mini',
  'gpt4_turbo',
  'gpt4',
  'turbo',
  'azure_gpt4',
  'azure_turbo',
  'anthropic_claude_3_opus',
  'anthropic_claude_3_sonnet',
  'anthropic_claude_3_haiku',
  'gemini_pro',
  'hyper_clova_x_lk_0',
];

/** §5.7 GET /webapi/hashtags → { result: { 해시태그명: 사용수 } } */
export interface HashtagsResponse {
  result?: Record<string, number>;
  [k: string]: unknown;
}

/* ---------- Knowledge Base = 화면 "문서" 메뉴 (§5.8~5.11) ---------- */

export type KbProcessState =
  | 'initializing'
  | 'parsing'
  | 'completed'
  | 'post_parsing'
  | 'post_completed'
  | 'parsing_fail'
  | 'post_parsing_fail'
  | 'retrying'
  | 'post_retrying'
  | (string & {});

export interface KbNode {
  id: string;
  name?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  nodeType?: 'file' | 'folder';
  hashtags?: string[];
  status?: 'on' | 'off';
  size?: number;
  processState?: KbProcessState;
  cursor?: string;
  [k: string]: unknown;
}

export interface KbSearchFilter {
  searchTerm?: string;
  parentFolderIds?: (string | null)[];
  hashtags?: string[];
  hashtagsSearchOperator?: HashtagOption;
  excludingHashtags?: string[];
  excludingHashtagsSearchOperator?: HashtagOption;
  processState?: string[];
  status?: ('on' | 'off')[];
  nodeType?: ('file' | 'folder')[];
  knowledgeBaseIds?: string[];
  [k: string]: unknown;
}

export interface KbSearchBody {
  filter_?: KbSearchFilter;
  order?:
    | 'name_asc'
    | 'name_desc'
    | 'updated_at_asc'
    | 'updated_at_desc'
    | 'created_at_asc'
    | 'created_at_desc';
  limit?: number;
  after?: string;
}

/** §5.9 업로드 폼 텍스트 필드 (file 자체는 MultipartPart로) */
export interface KbUploadFields {
  fileName: string;
  hashtags?: string[];
  targetFolderId?: string;
  useLayout?: boolean;
  useImageDescription?: boolean;
  useOcr?: boolean;
}

export interface IngestionStep {
  name?: string;
  subLabel?: string;
  startedAt?: unknown;
  endedAt?: unknown;
  status?: string;
  [k: string]: unknown;
}

export interface IngestionStatus {
  status?: KbProcessState;
  startedAt?: unknown;
  endedAt?: unknown;
  elapsed?: unknown;
  steps?: IngestionStep[];
  [k: string]: unknown;
}

/* ---------- 대화 (§5.12~5.13) ---------- */

export interface ChatMessage {
  id?: string;
  message?: unknown;
  sender?: unknown;
  createdAt?: unknown;
  [k: string]: unknown;
}

export interface ConversationInfo {
  id?: string;
  state?: string;
  /** 단건 조회 시 최근 챗 20개 포함 (§5.12) */
  chats?: ChatMessage[];
  [k: string]: unknown;
}
