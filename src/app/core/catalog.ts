/**
 * Placeholder catalogue data for the marketing pages.
 *
 * Everything here is static sample content standing in for the `event`,
 * `inventory` and `ticket` services; swap these arrays for `ApiService` calls
 * once those endpoints exist.
 *
 * Photography lives in `public/images` (sourced from Unsplash and pre-cropped
 * to the size each slot renders) so the pages do not depend on a third-party
 * CDN being reachable.
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
  readonly category: EventCategory;
  readonly venue: string;
  readonly date: string;
  readonly time: string;
  readonly priceFrom: number;
  readonly image: string;
  readonly alt: string;
  readonly status: 'On sale' | 'Few left' | 'Sold out';
}

export interface TicketRow {
  readonly id: string;
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

export const FEATURED_SLIDES: readonly FeaturedSlide[] = [
  {
    id: 1,
    category: 'Concerts',
    title: 'Neon Skyline Tour',
    subtitle: 'Three nights only, with a full live orchestra.',
    venue: 'Marina Bay Arena',
    date: 'Fri 12 Sep 2026',
    priceFrom: 'S$88',
    image: 'images/hero-concert.jpg',
    alt: 'Crowd with raised hands lit by golden stage lights at an outdoor concert',
  },
  {
    id: 2,
    category: 'Sports',
    title: 'ASEAN Cup Final',
    subtitle: 'The decider, under the lights at a full house.',
    venue: 'Kallang Grand Stadium',
    date: 'Mon 28 Sep 2026',
    priceFrom: 'S$45',
    image: 'images/hero-stadium.jpg',
    alt: 'Packed football stadium viewed from the stands during an evening match',
  },
  {
    id: 3,
    category: 'Theatre',
    title: 'Midnight at the Esplanade',
    subtitle: 'A sold-out season returns for six performances.',
    venue: 'Bayfront Concert Hall',
    date: 'Sat 10 Oct 2026',
    priceFrom: 'S$65',
    image: 'images/hero-theatre.jpg',
    alt: 'Silhouetted performers on stage against a deep red theatre curtain',
  },
];

export const VENUES: readonly Venue[] = [
  {
    id: 1,
    name: 'Marina Bay Arena',
    city: 'Singapore',
    capacity: '12,000 capacity',
    upcoming: 14,
    image: 'images/venue-arena.jpg',
    alt: 'Arena crowd facing a brightly lit stage',
  },
  {
    id: 2,
    name: 'Kallang Grand Stadium',
    city: 'Singapore',
    capacity: '55,000 capacity',
    upcoming: 8,
    image: 'images/venue-stadium.jpg',
    alt: 'Aerial view of a full stadium at dusk',
  },
  {
    id: 3,
    name: 'Bayfront Concert Hall',
    city: 'Singapore',
    capacity: '2,400 capacity',
    upcoming: 21,
    image: 'images/venue-theatre.jpg',
    alt: 'Performers silhouetted against a red stage curtain',
  },
  {
    id: 4,
    name: 'Sentosa Open Air',
    city: 'Singapore',
    capacity: '18,000 capacity',
    upcoming: 6,
    image: 'images/venue-openair.jpg',
    alt: 'Concertgoer with a raised hand in front of stage smoke and lights',
  },
  {
    id: 5,
    name: 'Clarke Quay Live House',
    city: 'Singapore',
    capacity: '900 capacity',
    upcoming: 32,
    image: 'images/venue-livehouse.jpg',
    alt: 'Empty club stage with a drum kit under a spotlight',
  },
  {
    id: 6,
    name: 'Jurong Festival Grounds',
    city: 'Singapore',
    capacity: '30,000 capacity',
    upcoming: 4,
    image: 'images/venue-festival.jpg',
    alt: 'Festival crowd under a shower of confetti at night',
  },
];

export const TICKETS: readonly TicketRow[] = [
  {
    id: 'TKT-1001',
    event: 'Neon Skyline Tour',
    category: 'Concerts',
    venue: 'Marina Bay Arena',
    date: 'Fri 12 Sep 2026',
    time: '8:00 PM',
    section: 'Cat 1 — Floor',
    price: 188,
    status: 'On sale',
  },
  {
    id: 'TKT-1002',
    event: 'Marina Jazz Nights',
    category: 'Concerts',
    venue: 'Bayfront Concert Hall',
    date: 'Sat 19 Sep 2026',
    time: '7:30 PM',
    section: 'Stalls',
    price: 120,
    status: 'Few left',
  },
  {
    id: 'TKT-1003',
    event: 'ASEAN Cup Final',
    category: 'Sports',
    venue: 'Kallang Grand Stadium',
    date: 'Mon 28 Sep 2026',
    time: '5:00 PM',
    section: 'North Stand',
    price: 250,
    status: 'On sale',
  },
  {
    id: 'TKT-1004',
    event: 'Indie Weekender',
    category: 'Concerts',
    venue: 'Sentosa Open Air',
    date: 'Sun 04 Oct 2026',
    time: '6:00 PM',
    section: 'General Admission',
    price: 95,
    status: 'Sold out',
  },
  {
    id: 'TKT-1005',
    event: 'Midnight at the Esplanade',
    category: 'Theatre',
    venue: 'Bayfront Concert Hall',
    date: 'Sat 10 Oct 2026',
    time: '8:30 PM',
    section: 'Circle',
    price: 210,
    status: 'On sale',
  },
  {
    id: 'TKT-1006',
    event: 'Island Derby',
    category: 'Sports',
    venue: 'Kallang Grand Stadium',
    date: 'Sat 17 Oct 2026',
    time: '7:45 PM',
    section: 'West Grandstand',
    price: 78,
    status: 'Few left',
  },
  {
    id: 'TKT-1007',
    event: 'Late Night Improv',
    category: 'Theatre',
    venue: 'Clarke Quay Live House',
    date: 'Fri 23 Oct 2026',
    time: '10:00 PM',
    section: 'Standing',
    price: 45,
    status: 'On sale',
  },
];

export const EVENTS: readonly EventListing[] = [
  {
    id: 1,
    title: 'Neon Skyline Tour',
    category: 'Concerts',
    venue: 'Marina Bay Arena',
    date: 'Fri 12 Sep 2026',
    time: '8:00 PM',
    priceFrom: 88,
    image: 'images/hero-concert.jpg',
    alt: 'Crowd with raised hands lit by golden stage lights at an outdoor concert',
    status: 'On sale',
  },
  {
    id: 2,
    title: 'ASEAN Cup Final',
    category: 'Sports',
    venue: 'Kallang Grand Stadium',
    date: 'Mon 28 Sep 2026',
    time: '5:00 PM',
    priceFrom: 45,
    image: 'images/hero-stadium.jpg',
    alt: 'Packed football stadium viewed from the stands during an evening match',
    status: 'On sale',
  },
  {
    id: 3,
    title: 'Midnight at the Esplanade',
    category: 'Theatre',
    venue: 'Bayfront Concert Hall',
    date: 'Sat 10 Oct 2026',
    time: '8:30 PM',
    priceFrom: 65,
    image: 'images/hero-theatre.jpg',
    alt: 'Silhouetted performers on stage against a deep red theatre curtain',
    status: 'Few left',
  },
  {
    id: 4,
    title: 'Marina Jazz Nights',
    category: 'Concerts',
    venue: 'Clarke Quay Live House',
    date: 'Sat 19 Sep 2026',
    time: '7:30 PM',
    priceFrom: 60,
    image: 'images/venue-livehouse.jpg',
    alt: 'Club stage with a drum kit under a spotlight',
    status: 'Few left',
  },
  {
    id: 5,
    title: 'Indie Weekender',
    category: 'Concerts',
    venue: 'Sentosa Open Air',
    date: 'Sun 04 Oct 2026',
    time: '6:00 PM',
    priceFrom: 95,
    image: 'images/venue-openair.jpg',
    alt: 'Concertgoer with a raised hand in front of stage smoke and lights',
    status: 'Sold out',
  },
  {
    id: 6,
    title: 'Island Derby',
    category: 'Sports',
    venue: 'Kallang Grand Stadium',
    date: 'Sat 17 Oct 2026',
    time: '7:45 PM',
    priceFrom: 78,
    image: 'images/venue-stadium.jpg',
    alt: 'Aerial view of a full stadium at dusk',
    status: 'On sale',
  },
  {
    id: 7,
    title: 'Late Night Improv',
    category: 'Theatre',
    venue: 'Clarke Quay Live House',
    date: 'Fri 23 Oct 2026',
    time: '10:00 PM',
    priceFrom: 45,
    image: 'images/venue-theatre.jpg',
    alt: 'Performers silhouetted against a red stage curtain',
    status: 'On sale',
  },
  {
    id: 8,
    title: 'Harbour Lights Festival',
    category: 'Concerts',
    venue: 'Jurong Festival Grounds',
    date: 'Sat 31 Oct 2026',
    time: '4:00 PM',
    priceFrom: 130,
    image: 'images/venue-festival.jpg',
    alt: 'Festival crowd under a shower of confetti at night',
    status: 'On sale',
  },
];

/** A customer's own purchases, for the signed-in area of the home page. */
export interface Order {
  readonly reference: string;
  readonly event: string;
  readonly venue: string;
  readonly date: string;
  readonly time: string;
  readonly seats: string;
  readonly quantity: number;
}

export const MY_ORDERS: readonly Order[] = [
  {
    reference: 'ONE-4471',
    event: 'Neon Skyline Tour',
    venue: 'Marina Bay Arena',
    date: 'Fri 12 Sep 2026',
    time: '8:00 PM',
    seats: 'Cat 1 — Floor, Row C 14-15',
    quantity: 2,
  },
  {
    reference: 'ONE-4483',
    event: 'Midnight at the Esplanade',
    venue: 'Bayfront Concert Hall',
    date: 'Sat 10 Oct 2026',
    time: '8:30 PM',
    seats: 'Circle, Row F 22',
    quantity: 1,
  },
];

/** Door shifts assigned to an event helper. */
export interface Shift {
  readonly id: number;
  readonly event: string;
  readonly venue: string;
  readonly gate: string;
  readonly date: string;
  readonly doorsOpen: string;
  readonly expected: number;
  readonly today: boolean;
}

export const MY_SHIFTS: readonly Shift[] = [
  {
    id: 1,
    event: 'Neon Skyline Tour',
    venue: 'Marina Bay Arena',
    gate: 'Gate B — East concourse',
    date: 'Fri 12 Sep 2026',
    doorsOpen: '6:30 PM',
    expected: 11840,
    today: true,
  },
  {
    id: 2,
    event: 'Island Derby',
    venue: 'Kallang Grand Stadium',
    gate: 'Gate 4 — North Stand',
    date: 'Sat 17 Oct 2026',
    doorsOpen: '5:45 PM',
    expected: 48200,
    today: false,
  },
  {
    id: 3,
    event: 'Late Night Improv',
    venue: 'Clarke Quay Live House',
    gate: 'Main door',
    date: 'Fri 23 Oct 2026',
    doorsOpen: '9:15 PM',
    expected: 860,
    today: false,
  },
];
