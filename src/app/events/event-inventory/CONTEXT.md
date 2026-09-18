# Event Inventory — context & decision log

Organiser-facing screen (`OR-03 Configure Inventory` in `onestage-user-stories.md`) for drawing
the venue grid: rectangular **zones** on a virtual grid, row 0 nearest the stage. A `TIER2_SEATED`
event turns each cell in a zone into an individually-tracked seat; a `TIER1_GA` event just uses the
rectangle's area as a capacity number. Zones can't overlap; a zone with sold/held seats
(`committedZoneIds`) can't be resized, moved, or removed.

## Current state (as of this entry)

### Shipped this cycle
- **Drag-to-draw / resize / move zones** via 8-way resize handles (`handleKindAt`) and
  interior-cell dragging (`isZoneMovable`). Handles only appear on axes that actually have two
  distinct sides (`hasRowSpan`/`hasColSpan`), so a 1-row or 1-col zone doesn't wrongly claim every
  cell as an edge handle.
- **Fixed**: a zone whose `gridRow`/`gridCol` come back `null` from the API (legacy data that
  predates this grid feature) no longer gets coerced by JS (`null >= 0` → `true`, `null + 1` → `1`)
  into falsely occupying cell (0,0). See `rectContains`'s `Number.isFinite` guard. Covered by the
  "doesn't treat a zone with no real grid position..." test.
- **Fixed**: the `+`/`-` row and column controls and the `STAGE` bar are now grid items inside
  `.grid-map-canvas` itself (not siblings positioned over the whole canvas), so they're centered
  against the actual cell grid instead of the whole card width.

### Deferred to a later cycle: "Tag seats" editing
The seat-tagging **mode toggle** ("Draw zones" / "Tag seats", click-a-seat-to-cycle
none → accessible → maintenance) has been **removed** from the UI and component
(`mode` signal, `setMode`, `toggleTagAt`, `TAG_CYCLE`, `updatingSeatId` all deleted). Reasons:
1. It depended on `[disabled]="updatingSeatId() === seat?.seatId"` +
   `.seat-cell:disabled { cursor: wait; }` — if a PATCH to `/events/:id/seats/:seatId` ever hung
   (plausible; this environment's DB is a shared remote MySQL instance, not a local container),
   that one seat stayed disabled forever, which is what produced the "spinning circle on hover"
   report.
2. On the event used for manual testing (id 40), both zones had a corrupted/`null` grid position
   (see below), so the grid rendered with **zero** seat-cells — there was nothing to tag, making
   the mode look broken even independent of (1).
3. Editing seat tags isn't in the OR-03 acceptance criteria for this milestone; drawing/resizing
   zones is the load-bearing path.

**Kept**: passive display of a seat's existing `tag` (`tag-accessible`/`tag-maintenance` CSS
classes, `seatTagLabel()` in the `aria-label`/`title`) — this just reflects data the backend
already returns, isn't editable from this screen anymore, and costs nothing to leave in. The
`SeatDto`/`SeatCell.tag` field is unchanged since the API contract still returns it.

**Next cycle**: reinstate an editing path for `tag` (accessible / maintenance), this time with a
request that can't leave a seat stuck disabled indefinitely (e.g. a timeout + re-enable, or
optimistic update with rollback instead of a blocking `disabled` state).

## Known pending issue — NOT fixed, needs a human decision

Event id 40 (used for manual verification) has two corrupted `inventory_items` rows, discovered by
a **read-only** query against the shared inventory DB:

| id | name | grid_row | grid_col | grid_row_span | grid_col_span | real seats |
|----|------|----------|----------|----------------|----------------|------------|
| 30 | Balcony | `NULL` | `NULL` | 1 | 1 | 6 (A1–A3, B1–B3) |
| 31 | Unassigned | `NULL` | `NULL` | 1 | 1 | 0 |

This is legacy/external data — the current save path (`parseZones` in
`services/inventory/src/index.ts`) strictly requires `typeof gridRow === 'number'`, so today's code
cannot produce a `null` position. It must predate the grid-zone feature.

Effect: every zone on event 40 fails to render as occupying any cell (correct, post-fix, per
`rectContains`), so the grid looks empty and "Save" is blocked until every zone has a valid
rectangle.

Two ways to fix it — **neither has been done**, pending an explicit decision (per this repo's
`CLAUDE.md`: no data migration without human approval):
- **(a) UI redraw**: delete both `Balcony` and `Unassigned` from the inventory screen and redraw
  Balcony as a proper rectangle, then Save.
- **(b) DB backfill**: set `Balcony` to `grid_row=0, grid_col=0, grid_row_span=2, grid_col_span=3`
  (matches its 6 real seats) and delete the empty `Unassigned` row (id 31, 0 real seats).

## Test coverage

`event-inventory.spec.ts` — 16 tests, all green — covers: seat labelling, seated vs. GA save
payloads (GA sends no per-seat data), zone-overlap blocking on draw/resize/move, all 8 resize
handles (corner + edge), moving a zone by its body, grid row/column count clamping, the
null-position legacy-data guard, and (this cycle) that no "Tag seats" mode exists anymore.

## Live E2E verification (this cycle)

Manual browser verification against the running local stack (`localhost:4200` + Kong on `:8000`),
using two freshly-created, uncorrupted events (avoiding event 40's known-bad rows above):

**Organiser: event creation → inventory setup — both tiers pass end-to-end.**
- **GA event** ("E2E GA Test", `TIER1_GA`): created via `Organiser → Events → New event`, drew a
  3×3 zone ("GA Floor", $50, 9 capacity) on the grid, "Save inventory" → `Inventory saved.`, code
  auto-assigned (`#GAFL`). Reloaded the page cold — zone persisted, confirming the round-trip
  through `POST/GET /api/inventory/events/:id/inventory` actually works, not just optimistic local
  state.
- **Seated event** ("E2E Seated Test", `TIER2_SEATED`): same flow, drew a 3×3 zone ("Front
  Stalls", $80) — grid rendered individual seat labels (A1–A3, B1–B3, C1–C3) as expected for this
  tier, "9 seats" (vs. GA's "9 capacity" wording). Saved, reloaded cold, persisted.
- Both events were then published ("Publish" → status flips to "On sale") to make them purchasable
  for the next check.

**Customer: ticket purchase — blocked on both tiers, by the backend, not the frontend.**
Confirms the standing note (see `backend-repo` service audit) that `order` and `queue` are
`/health`-only stub services with zero business routes. Observed directly, not just inferred from
code:
- **GA** (`/events/66`, no queue step for `TIER1_GA`): clicking "Buy tickets" fires
  `POST /api/order/orders` → **404**. The frontend has no specific handling for this and falls back
  to a generic error copy, so the user sees **"This event was not found."** — misleading (the event
  clearly exists and is on-sale on the same page), but root-caused to the 404, not a frontend bug.
- **Seated** (`/events/67`): `TIER2_SEATED` requires joining the waiting room first. Clicking "Join
  the queue" fires `POST /api/queue/events/67/queue/join` → **404**, and the frontend correctly
  surfaces this as **"Couldn't join the queue"** with a "Try again" retry action — better handled
  than the GA case, but still a dead end since the queue service has no route to retry into.

**Conclusion**: the organiser-side scope of this cycle (draw/resize/move zones, save inventory) is
fully working for both `TIER1_GA` and `TIER2_SEATED`. Customer ticket purchase cannot be completed
end-to-end in this environment until `order` and `queue` gain real implementations — that is a
backend gap outside this cycle's scope, not a defect in the inventory screen or its removal of the
Tag Seats mode.
