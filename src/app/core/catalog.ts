/**
 * Types for the catalogue data the app fetches from the `event`/`ticket`/
 * `order` services — events, venues, featured slides and a customer's own
 * orders are all real rows from MySQL, not fixtures. Only display constants
 * live here now (image intrinsic sizes); every array of records was removed
 * once its backing endpoint existed.
 *
 * Photography lives in `public/images` (sourced from Unsplash and pre-cropped
 * to the size each slot renders) so the pages do not depend on a third-party
 * CDN being reachable. The event/venue services choose which bundled image to
 * point at based on the real category/venue-type of each row.
 */

export type EventCategory = 'Concerts' | 'Sports' | 'Theatre';

export interface FeaturedSlide {
  readonly id: number;
  readonly category: EventCategory;
  readonly title: string;
  readonly subtitle: string;
  readonly venue: string;
  readonly date: string;
  readonly priceFrom: string;
  readonly image: string;
  readonly alt: string;
}

/**
 * A venue and how many published events are happening there, from
 * `GET /event/venues`. There is no venues table — a venue is just the free
 * text `events.venue` column, grouped and counted — so there is no id, city
 * or capacity to return. `sampleEventId` is one published event at that
 * venue, so the frontend can show that event's real uploaded artwork
 * (`GET /event/events/{id}/image`) rather than a placeholder.
 */
export interface Venue {
  readonly venue: string;
  readonly upcoming: number;
  readonly sample_event_id: number;
}

export interface EventListing {
  readonly id: number;
  readonly title: string;
  readonly description: string;
  readonly category: EventCategory;
  readonly venueId: number;
  readonly venue: string;
  readonly date: string;
  readonly time: string;
  readonly featured: boolean;
  readonly priceFrom: number;
  readonly image: string;
  readonly alt: string;
  readonly status: 'On sale' | 'Few left' | 'Sold out';
}

/** Intrinsic size of the hero artwork, in pixels. */
export const HERO_IMAGE_SIZE = { width: 1800, height: 900 } as const;

/** Intrinsic size of the venue card artwork, in pixels. */
export const VENUE_IMAGE_SIZE = { width: 800, height: 600 } as const;
