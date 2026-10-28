export type Importance = "core" | "important" | "bonus";
export type Difficulty = "beginner" | "intermediate" | "advanced";

/** A single topic extracted from the user's syllabus by the AI. */
export interface Topic {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  importance: Importance;
  difficulty: Difficulty;
  estimatedMinutes: number;
  chapter?: string;
}

/** Raw metadata for one YouTube video, straight from the Data API. */
export interface VideoCandidate {
  id: string;
  title: string;
  description: string;
  channelTitle: string;
  channelId: string;
  publishedAt: string;
  thumbnail: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  hasCaptions: boolean;
  embeddable: boolean;
}

/** A candidate after deterministic (non-AI) scoring. */
export interface ScoredVideo {
  video: VideoCandidate;
  heuristicScore: number;
  aiScore: number | null;
  score: number;
  relevance: number;
  quality: number;
  reasons: string[];
  matchType: "transcript" | "metadata";
  transcriptSnippet?: string;
  aiSummary?: string;
  trustedChannel: boolean;
  rank: number;
}

export interface TopicResult {
  topic: Topic;
  videos: ScoredVideo[];
  candidatesConsidered: number;
  queries: string[];
  aiUsed?: boolean;
  /** True when the topic was skipped because the student already studied it. */
  skipped?: boolean;
  error?: string;
}

export interface AnalyzeResponse {
  ok: boolean;
  subject?: string;
  topics?: Topic[];
  truncated?: boolean;
  provider?: string;
  error?: string;
}

export interface VideosResponse {
  ok: boolean;
  result?: TopicResult;
  error?: string;
}

export interface HealthResponse {
  youtube: boolean;
  llm: "gemini" | "openai" | null;
  model: string | null;
}
