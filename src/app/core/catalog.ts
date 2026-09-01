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

/** A venue as returned by `GET /event/venues` — organisers create these implicitly by naming a new venue on their event. */
export interface Venue {
  readonly id: number;
  readonly name: string;
  readonly city: string;
  readonly capacity: string;
  readonly upcoming: number;
  readonly image: string;
  readonly alt: string;
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

export interface TicketRow {
  readonly id: string;
  /** The event this ticket type belongs to — see `EventListing.id`. */
  readonly eventId: number;
  readonly event: string;
  readonly category: EventCategory;
  readonly venue: string;
  readonly date: string;
  readonly time: string;
  readonly section: string;
  readonly price: number;
  readonly status: 'On sale' | 'Few left' | 'Sold out';
}

/** Intrinsic size of the hero artwork, in pixels. */
export const HERO_IMAGE_SIZE = { width: 1800, height: 900 } as const;

/** Intrinsic size of the venue card artwork, in pixels. */
export const VENUE_IMAGE_SIZE = { width: 800, height: 600 } as const;

/** A customer's own purchases, from `GET /order/orders?email=`. */
export interface Order {
  readonly eventId: number;
  readonly reference: string;
  readonly event: string;
  readonly venue: string;
  readonly date: string;
  readonly time: string;
  readonly seats: string;
  readonly quantity: number;
}
