// Feedback form types, shared by the About page and the Worker.

export const FEEDBACK_KINDS = ['bug', 'idea', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export interface NewFeedback {
  kind: FeedbackKind;
  message: string;
  email?: string;
  /** The page the sender was on before opening About. */
  page?: string;
  /** Viewport size, e.g. "390x844". */
  screen?: string;
  /** Turnstile token. */
  token?: string;
}
