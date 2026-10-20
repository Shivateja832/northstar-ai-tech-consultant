export interface FeedbackEvent {
  emailType: string;
  unchanged: boolean;
  rating: number;
  sent: boolean;
  createdAt: string;
}

export interface LearningStore {
  history: FeedbackEvent[];
}

const UNSAFE_AUTO_SEND_TYPES = new Set(['billing', 'refund', 'complaint', 'legal', 'security', 'member']);

export function normalizedReply(reply: string): string {
  return reply.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export function qualification(
  store: LearningStore,
  emailType: string,
): { eligible: boolean; unchangedCount: number; reason: string } {
  const categoryHistory = store.history.filter((event) => event.emailType === emailType);
  const latestFive = categoryHistory.slice(-5);
  const qualityIsStable = latestFive.length >= 5 && latestFive.every((event) => event.rating >= 4);
  let unchangedCount = 0;
  for (let index = store.history.length - 1; index >= 0; index -= 1) {
    const event = store.history[index];
    if (event.emailType !== emailType || !event.unchanged || !event.sent || event.rating < 4) break;
    unchangedCount += 1;
  }
  const eligible = unchangedCount >= 20 && qualityIsStable && !UNSAFE_AUTO_SEND_TYPES.has(emailType);
  const reason = UNSAFE_AUTO_SEND_TYPES.has(emailType)
    ? 'This intent is always human-reviewed for safety.'
    : !qualityIsStable
      ? 'Five consecutive high-quality human-reviewed sends are required to maintain eligibility.'
      : `${Math.max(0, 20 - unchangedCount)} more consecutive unchanged human sends are required.`;
  return { eligible, unchangedCount, reason: eligible ? 'Eligible; configured SMTP and the global auto-send switch are still required.' : reason };
}
