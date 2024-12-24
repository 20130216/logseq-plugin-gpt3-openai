export enum ContentModerationErrorType {
  PROFANITY = 'profanity',
  POLITICS = 'politics',
  VIOLENCE_EXTREME = 'violence_extreme',
  VIOLENCE_MILD = 'violence_mild',
  DISCRIMINATION = 'discrimination',
  HARASSMENT = 'harassment',
  ILLEGAL = 'illegal',
  HATE_SPEECH = 'hate_speech',
  SEXUAL = 'sexual',
  API_ERROR = 'api_error'
}

export interface ContentModerationError {
  type: ContentModerationErrorType;
  message: string;
  words?: string[];
}

export interface PromptData {
  prompt?: string;
  text?: string;
  description?: string;
  size?: string;
  n?: number | string;
  count?: number | string;
}

export class JSONParseError extends Error {
  constructor(message: string, public jsonString?: string) {
    super(message);
    this.name = 'JSONParseError';
  }
} 