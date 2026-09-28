import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';

import { EventInventory } from './event-inventory';

interface EventFixture {
  readonly event_id: number;
  readonly title: string;
  readonly tier: 'TIER1_GA' | 'TIER2_SEATED';
  readonly status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
}

// Configuring zones/seats happens before publishing, so the default fixtures
// are DRAFT — matching the real pre-publish flow and every existing test
// below, which exercises normal editing.
const SEATED_EVENT: EventFixture = { event_id: 1, title: 'ASEAN Cup Final', tier: 'TIER2_SEATED', status: 'DRAFT' };
const GA_EVENT: EventFixture = { event_id: 2, title: 'Neon Skyline Tour', tier: 'TIER1_GA', status: 'DRAFT' };
const PUBLISHED_EVENT: EventFixture = { event_id: 3, title: 'Sold Out Show', tier: 'TIER1_GA', status: 'PUBLISHED' };

const EMPTY_INVENTORY = { gridRows: 6, gridCols: 8, zones: [], seats: [] };

/** Zoneless change detection doesn't know about our component's internal
 * `firstValueFrom`/`Promise.all` chains, so a single `whenStable()` can
 * resolve before every `.then()` in `load()`/`save()` has actually run.
 * Draining a couple of extra microtask/macrotask ticks after each HTTP flush
 * reliably lets those chains finish before we assert on the DOM. */
async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

async function renderFor(event: EventFixture, inventory: object = EMPTY_INVENTORY) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [EventInventory],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  }).compileComponents();

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(EventInventory);
  fixture.componentRef.setInput('id', String(event.event_id));
  fixture.detectChanges();

  httpMock.expectOne(`/api/event/events/${event.event_id}`).flush({ event });
  httpMock.expectOne(`/api/inventory/events/${event.event_id}/inventory`).flush(inventory);
  await settle(fixture);

  return { fixture, httpMock, host: fixture.nativeElement as HTMLElement };
}

/** Simulates the one-motion drag gesture: mousedown on the start cell, a
 * mouseenter on the end cell (the component only tracks start + "current"
 * cell reactively, so intermediate cells don't need their own events), then
 * mouseup on window. The resulting rectangle is the bounding box between the
 * two corners, same as the component computes it. */
function dragRectangle(host: HTMLElement, startRow: number, startCol: number, endRow: number, endCol: number): void {
  const cellAt = (row: number, col: number): HTMLButtonElement => {
    const button = host.querySelector<HTMLButtonElement>(`[data-grid-row="${row}"][data-grid-col="${col}"]`);
    if (!button) throw new Error(`no grid cell at (${row},${col})`);
    return button;
  };
  cellAt(startRow, startCol).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  cellAt(endRow, endCol).dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  window.dispatchEvent(new MouseEvent('mouseup'));
}

/** Simulates a plain click with zero mouse movement: mousedown then mouseup
 * on window, with no `mouseenter` in between at all — a real single click
 * never re-fires `mouseenter` on the cell the pointer is already sitting on,
 * unlike `dragRectangle`'s same-cell case which explicitly dispatches one. */
function clickCellNoDrag(host: HTMLElement, row: number, col: number): void {
  const button = host.querySelector<HTMLButtonElement>(`[data-grid-row="${row}"][data-grid-col="${col}"]`);
  if (!button) throw new Error(`no grid cell at (${row},${col})`);
  button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  window.dispatchEvent(new MouseEvent('mouseup'));
}

function setInputValue(host: HTMLElement, selector: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`no input matching ${selector}`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('EventInventory', () => {
  it('labels every cell of a freshly drawn zone with its seat coordinate, even before saving', async () => {
    const { fixture, host } = await renderFor(SEATED_EVENT);

    dragRectangle(host, 0, 0, 1, 2); // 2 rows x 3 cols — no seats exist server-side yet
    fixture.detectChanges();

    const cellAt = (row: number, col: number) => host.querySelector(`[data-grid-row="${row}"][data-grid-col="${col}"]`);
    expect(cellAt(0, 0)?.textContent?.trim()).toBe('A1');
    expect(cellAt(0, 1)?.textContent?.trim()).toBe('A2');
    expect(cellAt(0, 2)?.textContent?.trim()).toBe('A3');
    expect(cellAt(1, 0)?.textContent?.trim()).toBe('B1');
    expect(cellAt(1, 1)?.textContent?.trim()).toBe('B2');
    expect(cellAt(1, 2)?.textContent?.trim()).toBe('B3');
  });

  it('drags a rectangle to create a seated zone, and saves the rectangle with no seats field', async () => {
    const { fixture, httpMock, host } = await renderFor(SEATED_EVENT);

    dragRectangle(host, 0, 0, 1, 2); // 2 rows x 3 cols
    fixture.detectChanges();

    expect(host.querySelectorAll('.zone-card').length).toBe(1);

    setInputValue(host, '.zone-name-input', 'Front Stalls');
    setInputValue(host, '.zone-price input', '75');
    fixture.detectChanges();

    const saveButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.trim().startsWith('Save'),
    );
    saveButton?.click();
    fixture.detectChanges();

    const putReq = httpMock.expectOne(`/api/inventory/events/${SEATED_EVENT.event_id}/inventory`);
    expect(putReq.request.method).toBe('PUT');
    const body = putReq.request.body as { zones: unknown[]; seats?: unknown };
    expect(body.zones.length).toBe(1);
    expect(body.zones[0]).toEqual(
      expect.objectContaining({ name: 'Front Stalls', gridRow: 0, gridCol: 0, gridRowSpan: 2, gridColSpan: 3 }),
    );
    expect(body.seats).toBeUndefined();

    putReq.flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);

    // A successful save navigates away (see the dedicated navigation test
    // below) rather than reloading this same page's data.
    httpMock.verify();
  });

  it('navigates back to the organiser events list after a successful save, instead of staying on the page', async () => {
    const { fixture, httpMock, host } = await renderFor(SEATED_EVENT);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    dragRectangle(host, 0, 0, 1, 2);
    fixture.detectChanges();
    setInputValue(host, '.zone-name-input', 'Front Stalls');
    setInputValue(host, '.zone-price input', '75');
    fixture.detectChanges();

    const saveButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.trim().startsWith('Save'),
    );
    saveButton?.click();
    fixture.detectChanges();

    const putReq = httpMock.expectOne(`/api/inventory/events/${SEATED_EVENT.event_id}/inventory`);
    putReq.flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);

    // No reload of this same page's data — the organiser is taken straight
    // back to their events list instead.
    expect(navigate).toHaveBeenCalledWith(['/organiser/events']);
    httpMock.verify();
  });

  it('shows an actionable message when shrinking capacity below the available buyers count', async () => {
    const { fixture, httpMock, host } = await renderFor(GA_EVENT);

    dragRectangle(host, 0, 0, 0, 4); // 1 row x 5 cols
    fixture.detectChanges();
    setInputValue(host, '.zone-name-input', 'General Admission');
    setInputValue(host, '.zone-price input', '25');
    fixture.detectChanges();

    const saveButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.trim().startsWith('Save'),
    );
    saveButton?.click();
    fixture.detectChanges();

    const putReq = httpMock.expectOne(`/api/inventory/events/${GA_EVENT.event_id}/inventory`);
    putReq.flush(
      { error: 'capacity_below_available_buyers', availableBuyers: 8 },
      { status: 409, statusText: 'Conflict' },
    );
    await settle(fixture);

    expect(host.querySelector('.error')?.textContent).toContain('8');
    expect(host.querySelector('.error')?.textContent).toContain('at least');
    httpMock.verify();
  });

  it('drags a rectangle on a GA event; capacity comes from the rectangle and no per-seat tag UI is shown', async () => {
    const { fixture, httpMock, host } = await renderFor(GA_EVENT);

    // No "Tag seats" toggle at all for a GA event — there are no individual seats to tag.
    const toggle = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Tag seats',
    );
    expect(toggle).toBeUndefined();

    dragRectangle(host, 0, 0, 1, 2); // 2 rows x 3 cols = capacity 6
    fixture.detectChanges();

    expect(host.querySelectorAll('.zone-card').length).toBe(1);
    expect(host.querySelector('.zone-seat-total')?.textContent?.trim()).toBe('6 capacity');

    setInputValue(host, '.zone-name-input', 'General Admission');
    setInputValue(host, '.zone-price input', '25');
    fixture.detectChanges();

    const saveButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.trim().startsWith('Save'),
    );
    saveButton?.click();
    fixture.detectChanges();

    const putReq = httpMock.expectOne(`/api/inventory/events/${GA_EVENT.event_id}/inventory`);
    const body = putReq.request.body as { zones: unknown[]; seats?: unknown };
    expect(body.zones[0]).toEqual(
      expect.objectContaining({ name: 'General Admission', gridRow: 0, gridCol: 0, gridRowSpan: 2, gridColSpan: 3 }),
    );
    expect(body.seats).toBeUndefined();

    putReq.flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);

    httpMock.verify();
  });

  it('adds a zone at the first empty cell via a button, with no drag gesture needed', async () => {
    const { fixture, host } = await renderFor(GA_EVENT);

    expect(host.querySelectorAll('.zone-card').length).toBe(0);

    const addButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Add zone',
    );
    expect(addButton).toBeDefined();
    addButton?.click();
    fixture.detectChanges();

    expect(host.querySelectorAll('.zone-card').length).toBe(1);
    const card = host.querySelector('.zone-card')!;
    expect(card.querySelector<HTMLInputElement>('.zone-row-input')?.value).toBe('0');
    expect(card.querySelector<HTMLInputElement>('.zone-col-input')?.value).toBe('0');
  });

  it('repositions and resizes a zone by typing row/column/span numbers, with no drag gesture needed', async () => {
    const { fixture, host } = await renderFor(SEATED_EVENT);

    dragRectangle(host, 0, 0, 0, 0); // 1x1 zone to start from
    fixture.detectChanges();
    const card = host.querySelector('.zone-card')!;

    setInputValue(host, '.zone-row-input', '2');
    fixture.detectChanges();
    setInputValue(host, '.zone-col-input', '3');
    fixture.detectChanges();
    setInputValue(host, '.zone-row-span-input', '2');
    fixture.detectChanges();
    setInputValue(host, '.zone-col-span-input', '3');
    fixture.detectChanges();

    expect(card.querySelector<HTMLInputElement>('.zone-row-input')?.value).toBe('2');
    expect(card.querySelector<HTMLInputElement>('.zone-col-input')?.value).toBe('3');
    expect(card.querySelector<HTMLInputElement>('.zone-row-span-input')?.value).toBe('2');
    expect(card.querySelector<HTMLInputElement>('.zone-col-span-input')?.value).toBe('3');

    // The zone actually moved on the map — its old top-left cell (0,0) is
    // free again, and its new top-left cell (2,3) is now claimed.
    const cellAt = (row: number, col: number) => host.querySelector(`[data-grid-row="${row}"][data-grid-col="${col}"]`);
    expect(cellAt(0, 0)?.className).toContain('grid-cell');
    expect(cellAt(2, 3)?.className).toContain('seat-cell');
  });

  it('rejects a typed position that would overlap another zone, leaving both zones where they were', async () => {
    const existingZone = {
      inventoryItemId: 9,
      name: 'Balcony',
      code: 'BALC',
      priceCents: 4000,
      color: '#00FF00',
      seatCount: 2,
      soldCount: 0,
      heldCount: 0,
      gridRow: 3,
      gridCol: 0,
      gridRowSpan: 1,
      gridColSpan: 2,
    };
    const { fixture, host } = await renderFor(SEATED_EVENT, { gridRows: 6, gridCols: 8, zones: [existingZone], seats: [] });

    dragRectangle(host, 3, 3, 3, 3); // a fresh 1x1 zone, on the same row as the existing one
    fixture.detectChanges();
    const cards = host.querySelectorAll('.zone-card');
    const newCard = cards[1] as HTMLElement;

    // Moving it left onto the existing zone's columns (same row already).
    setInputValue(newCard, '.zone-col-input', '0');
    fixture.detectChanges();

    expect(host.querySelector('.error')?.textContent).toContain("Zones can't overlap");
    // The typed value was rejected — the zone stayed at its original column.
    expect(newCard.querySelector<HTMLInputElement>('.zone-col-input')?.value).toBe('3');
  });

  it("blocks dragging a new zone over cells an existing zone already covers", async () => {
    const existingZone = {
      inventoryItemId: 9,
      name: 'Balcony',
      code: 'BALC',
      priceCents: 4000,
      color: '#00FF00',
      seatCount: 2,
      soldCount: 0,
      heldCount: 0,
      gridRow: 0,
      gridCol: 0,
      gridRowSpan: 1,
      gridColSpan: 2,
    };
    const { fixture, host } = await renderFor(SEATED_EVENT, { gridRows: 6, gridCols: 8, zones: [existingZone], seats: [] });

    expect(host.querySelectorAll('.zone-card').length).toBe(1);

    // Start on an empty cell and drag toward the origin — the bounding
    // rectangle (rows 0-1, cols 0-2) swallows the existing zone's cells.
    dragRectangle(host, 1, 2, 0, 0);
    fixture.detectChanges();

    // No new zone was created — still just the one from the server.
    expect(host.querySelectorAll('.zone-card').length).toBe(1);
    expect(host.querySelector('.error')?.textContent).toContain("Zones can't overlap");
  });

  it("drags an existing zone's bottom-right corner handle to grow it", async () => {
    const existingZone = {
      inventoryItemId: 9,
      name: 'Balcony',
      code: 'BALC',
      priceCents: 4000,
      color: '#00FF00',
      seatCount: 4,
      soldCount: 0,
      heldCount: 0,
      gridRow: 0,
      gridCol: 0,
      gridRowSpan: 2,
      gridColSpan: 2,
    };
    const { fixture, host } = await renderFor(SEATED_EVENT, { gridRows: 6, gridCols: 8, zones: [existingZone], seats: [] });

    expect(host.querySelector('.zone-seat-total')?.textContent?.trim()).toBe('4 seats');

    // Drag from the zone's bottom-right corner (1,1) out to (2,2) to grow it to 3x3 = 9 seats.
    dragRectangle(host, 1, 1, 2, 2);
    fixture.detectChanges();

    expect(host.querySelectorAll('.zone-card').length).toBe(1);
    expect(host.querySelector('.zone-seat-total')?.textContent?.trim()).toBe('9 seats');
  });

  it("won't grow a zone's corner handle over another zone's cells", async () => {
    const resizable = {
      inventoryItemId: 9,
      name: 'Balcony',
      code: 'BALC',
      priceCents: 4000,
      color: '#00FF00',
      seatCount: 4,
      soldCount: 0,
      heldCount: 0,
      gridRow: 0,
      gridCol: 0,
      gridRowSpan: 2,
      gridColSpan: 2,
    };
    const blocker = {
      inventoryItemId: 10,
      name: 'Pit',
      code: 'PIT',
      priceCents: 4000,
      color: '#0000FF',
      seatCount: 1,
      soldCount: 0,
      heldCount: 0,
      gridRow: 0,
      gridCol: 3,
      gridRowSpan: 1,
      gridColSpan: 1,
    };
    const { fixture, host } = await renderFor(SEATED_EVENT, { gridRows: 6, gridCols: 8, zones: [resizable, blocker], seats: [] });

    // Growing to (0,3) would swallow the "Pit" zone's only cell.
    dragRectangle(host, 1, 1, 0, 3);
    fixture.detectChanges();

    expect(host.querySelector('.zone-seat-total')?.textContent?.trim()).toBe('4 seats');
    expect(host.querySelector('.error')?.textContent).toContain("Zones can't overlap");
  });

  it("drags an existing zone's top-left corner handle to grow it, keeping the opposite corner fixed", async () => {
    const existingZone = {
      inventoryItemId: 9,
      name: 'Balcony',
      code: 'BALC',
      priceCents: 4000,
      color: '#00FF00',
      seatCount: 4,
      soldCount: 0,
      heldCount: 0,
      gridRow: 2,
      gridCol: 2,
      gridRowSpan: 2,
      gridColSpan: 2,
    };
    const { fixture, host } = await renderFor(SEATED_EVENT, { gridRows: 6, gridCols: 8, zones: [existingZone], seats: [] });

    // Drag the top-left corner (2,2) out to (0,0) — the bottom-right corner
    // (3,3) stays fixed, so the zone grows to rows 0-3, cols 0-3 = 16 seats.
    dragRectangle(host, 2, 2, 0, 0);
    fixture.detectChanges();

    expect(host.querySelectorAll('.zone-card').length).toBe(1);
    expect(host.querySelector('.zone-seat-total')?.textContent?.trim()).toBe('16 seats');
    expect(host.querySelector('[data-grid-row="0"][data-grid-col="0"]')?.classList.contains('seat-cell')).toBe(true);
  });

  it("drags an existing zone's right-edge handle to grow only its column span", async () => {
    const existingZone = {
      inventoryItemId: 9,
      name: 'Balcony',
      code: 'BALC',
      priceCents: 4000,
      color: '#00FF00',
      seatCount: 9,
      soldCount: 0,
      heldCount: 0,
      gridRow: 1,
      gridCol: 1,
      gridRowSpan: 3,
      gridColSpan: 3,
    };
    const { fixture, host } = await renderFor(SEATED_EVENT, { gridRows: 6, gridCols: 8, zones: [existingZone], seats: [] });

    // (2,3) is the middle of the right edge (row 2 is interior, col 3 is the
    // right edge). Dragging it out to (2,5) should only widen the zone.
    dragRectangle(host, 2, 3, 2, 5);
    fixture.detectChanges();

    expect(host.querySelectorAll('.zone-card').length).toBe(1);
    expect(host.querySelector('.zone-seat-total')?.textContent?.trim()).toBe('15 seats');
    // Row bounds didn't move — row 0 is still untouched, empty grid.
    expect(host.querySelector('[data-grid-row="0"][data-grid-col="1"]')?.classList.contains('grid-cell')).toBe(true);
  });

  it('drags a zone by its body to move it to an unoccupied area', async () => {
    const existingZone = {
      inventoryItemId: 9,
      name: 'Balcony',
      code: 'BALC',
      priceCents: 4000,
      color: '#00FF00',
      seatCount: 9,
      soldCount: 0,
      heldCount: 0,
      gridRow: 1,
      gridCol: 1,
      gridRowSpan: 3,
      gridColSpan: 3,
    };
    const { fixture, host } = await renderFor(SEATED_EVENT, { gridRows: 6, gridCols: 8, zones: [existingZone], seats: [] });

    // (2,2) is the interior cell of a 3x3 zone (rows 1-3, cols 1-3) — not on
    // any edge or corner, so dragging it moves the whole zone.
    dragRectangle(host, 2, 2, 1, 4);
    fixture.detectChanges();

    expect(host.querySelectorAll('.zone-card').length).toBe(1);
    expect(host.querySelector('.zone-seat-total')?.textContent?.trim()).toBe('9 seats');
    expect(host.querySelector('[data-grid-row="1"][data-grid-col="1"]')?.classList.contains('grid-cell')).toBe(true);
    expect(host.querySelector('[data-grid-row="0"][data-grid-col="3"]')?.classList.contains('seat-cell')).toBe(true);
  });

  it("won't move a zone on top of another zone's cells", async () => {
    const movable = {
      inventoryItemId: 9,
      name: 'Balcony',
      code: 'BALC',
      priceCents: 4000,
      color: '#00FF00',
      seatCount: 9,
      soldCount: 0,
      heldCount: 0,
      gridRow: 1,
      gridCol: 1,
      gridRowSpan: 3,
      gridColSpan: 3,
    };
    const blocker = {
      inventoryItemId: 10,
      name: 'Pit',
      code: 'PIT',
      priceCents: 4000,
      color: '#0000FF',
      seatCount: 1,
      soldCount: 0,
      heldCount: 0,
      gridRow: 0,
      gridCol: 5,
      gridRowSpan: 1,
      gridColSpan: 1,
    };
    const { fixture, host } = await renderFor(SEATED_EVENT, { gridRows: 6, gridCols: 8, zones: [movable, blocker], seats: [] });

    // Moving from (2,2) to (1,4) would land the zone on rows 0-2, cols 3-5 —
    // swallowing the "Pit" zone's cell at (0,5).
    dragRectangle(host, 2, 2, 1, 4);
    fixture.detectChanges();

    expect(host.querySelector('[data-grid-row="1"][data-grid-col="1"]')?.classList.contains('seat-cell')).toBe(true);
    expect(host.querySelector('.error')?.textContent).toContain("Zones can't overlap");
  });

  it('a single-cell zone still shows a resize handle so it can be grown', async () => {
    const existingZone = {
      inventoryItemId: 9,
      name: 'Balcony',
      code: 'BALC',
      priceCents: 4000,
      color: '#00FF00',
      seatCount: 1,
      soldCount: 0,
      heldCount: 0,
      gridRow: 2,
      gridCol: 2,
      gridRowSpan: 1,
      gridColSpan: 1,
    };
    const { fixture, host } = await renderFor(SEATED_EVENT, { gridRows: 6, gridCols: 8, zones: [existingZone], seats: [] });

    // A 1x1 zone has no interior to grab-and-move, so dragging its only cell
    // should resize it, not relocate it.
    dragRectangle(host, 2, 2, 4, 4);
    fixture.detectChanges();

    expect(host.querySelectorAll('.zone-card').length).toBe(1);
    expect(host.querySelector('.zone-seat-total')?.textContent?.trim()).toBe('9 seats');
  });

  it('moves a single-row zone by dragging one of its middle cells', async () => {
    const existingZone = {
      inventoryItemId: 9,
      name: 'Front Row',
      code: 'FRNT',
      priceCents: 4000,
      color: '#00FF00',
      seatCount: 4,
      soldCount: 0,
      heldCount: 0,
      gridRow: 2,
      gridCol: 1,
      gridRowSpan: 1,
      gridColSpan: 4, // occupies row 2, cols 1-4 — only one row thick
    };
    const { fixture, host } = await renderFor(SEATED_EVENT, { gridRows: 6, gridCols: 8, zones: [existingZone], seats: [] });

    // (2,2) is a middle cell of this 1-row zone — not a corner — so it should
    // move the whole zone rather than being treated as an edge handle.
    dragRectangle(host, 2, 2, 4, 5);
    fixture.detectChanges();

    expect(host.querySelectorAll('.zone-card').length).toBe(1);
    expect(host.querySelector('.zone-seat-total')?.textContent?.trim()).toBe('4 seats');
    expect(host.querySelector('[data-grid-row="2"][data-grid-col="1"]')?.classList.contains('grid-cell')).toBe(true);
  });

  it('typing a column count directly resizes the grid to that many columns', async () => {
    const { fixture, host } = await renderFor(SEATED_EVENT); // default 6 rows x 8 cols

    setInputValue(host, '.grid-col-count-input', '12');
    fixture.detectChanges();

    expect(host.querySelectorAll('[data-grid-row="0"]').length).toBe(12);
  });

  it("clamps a typed column count so it can't shrink below an existing zone's rightmost column", async () => {
    const existingZone = {
      inventoryItemId: 9,
      name: 'Balcony',
      code: 'BALC',
      priceCents: 4000,
      color: '#00FF00',
      seatCount: 2,
      soldCount: 0,
      heldCount: 0,
      gridRow: 0,
      gridCol: 6,
      gridRowSpan: 1,
      gridColSpan: 2, // occupies columns 6-7, so the grid needs at least 8 columns
    };
    const { fixture, host } = await renderFor(SEATED_EVENT, { gridRows: 6, gridCols: 8, zones: [existingZone], seats: [] });

    setInputValue(host, '.grid-col-count-input', '3');
    fixture.detectChanges();

    expect(host.querySelectorAll('[data-grid-row="0"]').length).toBe(8);
  });

  it("doesn't treat a zone with no real grid position (legacy data) as if it occupied cell (0,0)", async () => {
    // Mirrors a real, pre-existing "Unassigned" inventory item that has seats
    // but was never given a grid position — its gridRow/gridCol come back as
    // null from the API rather than a number.
    const positionless = {
      inventoryItemId: 31,
      name: 'Unassigned',
      code: 'UNASSIGNED',
      priceCents: 0,
      color: '#D1D5DB',
      seatCount: 6,
      soldCount: 0,
      heldCount: 0,
      gridRow: null,
      gridCol: null,
      gridRowSpan: 1,
      gridColSpan: 1,
    };
    const { fixture, host } = await renderFor(SEATED_EVENT, { gridRows: 6, gridCols: 8, zones: [positionless], seats: [] });

    // Cell (0,0) must still be an empty, drawable cell — JS's `null >= 0`
    // (true) / `null + 1` (1) coercion must not let a position-less zone's
    // rect arithmetic accidentally claim it.
    const cell = host.querySelector('[data-grid-row="0"][data-grid-col="0"]');
    expect(cell?.classList.contains('grid-cell')).toBe(true);
    expect(cell?.classList.contains('seat-cell')).toBe(false);

    // Drawing a brand new zone over (0,0) should work exactly as if the grid
    // were empty there — it must not be blocked as an "overlap".
    dragRectangle(host, 0, 0, 1, 1);
    fixture.detectChanges();

    expect(host.querySelectorAll('.zone-card').length).toBe(2);
  });

  it('a plain click with no drag on an empty cell does not create a stray zone', async () => {
    const { fixture, host } = await renderFor(GA_EVENT);

    clickCellNoDrag(host, 0, 0);
    fixture.detectChanges();

    // No zone should appear from a click alone — only an actual drag draws one.
    expect(host.querySelectorAll('.zone-card').length).toBe(0);
  });

  it('locks a published event: shows a notice, blocks drawing new zones, and disables Save', async () => {
    const { fixture, httpMock, host } = await renderFor(PUBLISHED_EVENT);

    expect(host.querySelector('.lock-note')?.textContent).toContain('published');

    // Dragging over the empty grid must not create a zone once locked.
    dragRectangle(host, 0, 0, 1, 2);
    fixture.detectChanges();
    expect(host.querySelectorAll('.zone-card').length).toBe(0);

    const saveButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.trim().startsWith('Save'),
    );
    expect(saveButton?.disabled).toBe(true);

    saveButton?.click();
    fixture.detectChanges();

    // No PUT is ever issued for a locked event.
    httpMock.expectNone(`/api/inventory/events/${PUBLISHED_EVENT.event_id}/inventory`);
    httpMock.verify();
  });

  it('no longer offers a "Tag seats" mode for a seated event — deferred to a later cycle', async () => {
    const zone = {
      inventoryItemId: 9,
      name: 'Balcony',
      code: 'BALC',
      priceCents: 4000,
      color: '#00FF00',
      seatCount: 1,
      soldCount: 0,
      heldCount: 0,
      gridRow: 0,
      gridCol: 0,
      gridRowSpan: 1,
      gridColSpan: 1,
    };
    const seat = {
      seatId: 101,
      gridRow: 0,
      gridCol: 0,
      seatLabel: 'A1',
      inventoryItemId: 9,
      status: 'AVAILABLE',
      tag: 'NONE',
    };
    const { fixture, httpMock, host } = await renderFor(SEATED_EVENT, { gridRows: 6, gridCols: 8, zones: [zone], seats: [seat] });

    const buttonLabels = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).map((button) => button.textContent?.trim());
    expect(buttonLabels).not.toContain('Tag seats');
    expect(buttonLabels).not.toContain('Draw zones');

    // Clicking the seat still only edits zone geometry — no per-seat tag PATCH is ever issued.
    dragRectangle(host, 0, 0, 0, 0);
    fixture.detectChanges();

    httpMock.expectNone(`/api/inventory/events/${SEATED_EVENT.event_id}/seats/${seat.seatId}`);
  });
});
