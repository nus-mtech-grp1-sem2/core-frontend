export type EventTier = 'TIER1_GA' | 'TIER2_SEATED';
export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
export interface ManagedEvent {
  readonly event_id: number;
  readonly title: string;
  readonly description: string | null;
  readonly venue: string | null;
  readonly starts_at: string;
  readonly total_seats: number;
  readonly available_buyers: number | null;
  readonly tier: EventTier;
  readonly status: EventStatus;
  readonly price_cents: number | null;
  readonly remaining_qty?: number;
}
