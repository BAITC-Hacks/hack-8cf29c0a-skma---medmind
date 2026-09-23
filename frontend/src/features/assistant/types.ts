// Типы «ленивого режима» — 1:1 с backend/src/app/assistant/schemas.py.

export type AssistantMode = 'fast' | 'standard' | 'deep';

export interface AssistantModelInfo {
  mode: AssistantMode;
  model: string;
  description: string;
}

export interface AssistantStatus {
  enabled: boolean;
  reason: string | null;
  default_mode: AssistantMode;
  models: AssistantModelInfo[];
}

/** actual — сплошная линия, forecast — пунктир, series — прочие ряды (сравнения). */
export type ChartSeriesKind = 'actual' | 'forecast' | 'series';

export interface ChartSeries {
  key: string;
  name: string;
  kind: ChartSeriesKind;
}

export type ChartPoint = Record<string, string | number | null>;

export interface ChartSpec {
  id: string;
  type: 'line';
  title: string;
  subtitle: string | null;
  x_key: string;
  y_label: string;
  series: ChartSeries[];
  data: ChartPoint[];
}

export interface ToolCall {
  name: string;
  arguments: string;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  charts: ChartSpec[];
  file_ids: string[];
  tool_calls: ToolCall[];
  model: string | null;
  created_at: string;
}

export interface AssistantFileSummary {
  kind?: 'long' | 'wide';
  kind_label?: string;
  rows?: number;
  skus?: number;
  period_from?: string;
  period_to?: string;
  months?: number;
  total_qty?: number;
}

export interface AssistantFile {
  id: string;
  filename: string;
  size: number;
  summary: AssistantFileSummary;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: AssistantMessage[];
  files: AssistantFile[];
}

export interface TurnResult {
  user_message: AssistantMessage;
  assistant_message: AssistantMessage;
}
