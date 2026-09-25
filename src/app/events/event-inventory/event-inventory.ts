import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api';
import { WorkspaceShell } from '../../layout/components/workspace-shell/workspace-shell';

type EventTier = 'TIER1_GA' | 'TIER2_SEATED';

interface EventSummary {
  readonly event_id: number;
  readonly title: string;
  readonly tier: EventTier;
}

interface EventSummaryResponse {
  readonly event: EventSummary;
}

type SeatStatus = 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED';
type SeatTag = 'NONE' | 'ACCESSIBLE' | 'MAINTENANCE';

interface ZoneDto {
  readonly inventoryItemId: number;
  readonly name: string;
  readonly code: string;
  readonly priceCents: number;
  readonly color: string;
  readonly seatCount: number;
  readonly soldCount: number;
  readonly heldCount: number;
  readonly gridRow: number;
  readonly gridCol: number;
  readonly gridRowSpan: number;
  readonly gridColSpan: number;
}

interface SeatDto {
  readonly seatId: number;
  readonly gridRow: number;
  readonly gridCol: number;
  readonly seatLabel: string;
  readonly inventoryItemId: number;
  readonly status: SeatStatus;
  readonly tag: SeatTag;
}

interface InventoryResponse {
  readonly gridRows: number;
  readonly gridCols: number;
  readonly zones: readonly ZoneDto[];
  readonly seats: readonly SeatDto[];
}

/** Virtual venue-map grid — row 0 is nearest the stage. Kept in sync with
 * DEFAULT_GRID_ROWS/DEFAULT_GRID_COLS/MIN_GRID_DIM/MAX_GRID_DIM and MAX_ZONES
 * in services/inventory/src/index.ts. */
const DEFAULT_GRID_ROWS = 6;
const DEFAULT_GRID_COLS = 8;
const MIN_GRID_DIM = 1;
const MAX_GRID_DIM = 20;
const MAX_ZONES = 50;

const DEFAULT_ZONE_COLORS = ['#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#DB2777', '#0891B2', '#65A30D'];

function defaultColorFor(index: number): string {
  return DEFAULT_ZONE_COLORS[index % DEFAULT_ZONE_COLORS.length]!;
}

/** Spreadsheet-style row labels: 0 -> A, 25 -> Z, 26 -> AA, 27 -> AB, ... — mirrors the backend's generator. */
function rowLabel(index: number): string {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function seatKey(row: number, col: number): string {
  return `${row},${col}`;
}

interface GridRect {
  readonly gridRow: number;
  readonly gridCol: number;
  readonly gridRowSpan: number;
  readonly gridColSpan: number;
}

function buildZoneGroup(fb: NonNullableFormBuilder, zone?: ZoneDto, colorIndex = 0, rect?: GridRect) {
  const bounds: GridRect = zone ?? rect ?? { gridRow: 0, gridCol: 0, gridRowSpan: 1, gridColSpan: 1 };
  return fb.group({
    inventoryItemId: fb.control<number | null>(zone?.inventoryItemId ?? null),
    code: fb.control({ value: zone?.code ?? '', disabled: true }),
    name: fb.control(zone?.name ?? '', Validators.required),
    price: fb.control((zone?.priceCents ?? 0) / 100, [Validators.required, Validators.min(0)]),
    color: fb.control(zone?.color ?? defaultColorFor(colorIndex), [Validators.required, Validators.pattern(/^#[0-9A-Fa-f]{6}$/)]),
    gridRow: fb.control(bounds.gridRow),
    gridCol: fb.control(bounds.gridCol),
    gridRowSpan: fb.control(bounds.gridRowSpan),
    gridColSpan: fb.control(bounds.gridColSpan),
  });
}

type ZoneGroup = ReturnType<typeof buildZoneGroup>;

interface GridCell {
  readonly row: number;
  readonly col: number;
}

/** A seat's zone/colour is derived spatially (via `zoneAt`) rather than
 * tracked per-seat — every seat is guaranteed to lie inside its zone's
 * rectangle, since the backend only ever creates seats for cells a zone
 * rectangle covers. */
interface SeatCell {
  readonly seatId: number | null;
  readonly gridRow: number;
  readonly gridCol: number;
  readonly status: SeatStatus;
  readonly tag: SeatTag;
}

/** Some legacy inventory items predate the grid-zone feature and come back
 * from the API with a `null` gridRow/gridCol (nullable DB columns) rather
 * than a real position. Without this guard, JS numeric coercion treats
 * `null` as `0` (`0 >= null` and `null + 1` both evaluate as if gridRow were
 * 0), so such a zone would wrongly appear to occupy cell (0,0). A zone with
 * no real position occupies no cells at all. */
function rectContains(rect: GridRect, row: number, col: number): boolean {
  if (!Number.isFinite(rect.gridRow) || !Number.isFinite(rect.gridCol)) return false;
  return row >= rect.gridRow && row < rect.gridRow + rect.gridRowSpan && col >= rect.gridCol && col < rect.gridCol + rect.gridColSpan;
}

/** The eight drag handles around a zone's border: the four corners resize
 * from their diagonally-opposite corner; the four edges resize just one
 * axis, keeping the other axis exactly as it was. */
type HandleKind = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

function boundingBox(a: GridCell, b: GridCell): GridRect {
  const gridRow = Math.min(a.row, b.row);
  const gridCol = Math.min(a.col, b.col);
  return {
    gridRow,
    gridCol,
    gridRowSpan: Math.max(a.row, b.row) - gridRow + 1,
    gridColSpan: Math.max(a.col, b.col) - gridCol + 1,
  };
}

/** Which handle (if any) a cell on a zone's border corresponds to.
 *
 * Corners always win where they coincide with an edge (e.g. a 1x1 zone's
 * only cell is unambiguously its "nw" corner) — there's no interior to grab,
 * so the whole thing resizes.
 *
 * Edges only claim a cell when the zone actually has two *distinct* sides on
 * that axis (`hasRowSpan`/`hasColSpan` below). A zone that's just one row
 * tall has no separate "top" and "bottom" to drag apart, so without this
 * guard every non-corner cell in it would wrongly become a "top edge"
 * handle, leaving the zone with no cell a user can grab to move it. */
function handleKindAt(row: number, col: number, rect: GridRect): HandleKind | null {
  const top = rect.gridRow;
  const left = rect.gridCol;
  const bottom = rect.gridRow + rect.gridRowSpan - 1;
  const right = rect.gridCol + rect.gridColSpan - 1;
  const atTop = row === top;
  const atBottom = row === bottom;
  const atLeft = col === left;
  const atRight = col === right;
  const hasRowSpan = bottom > top;
  const hasColSpan = right > left;
  if (atTop && atLeft) return 'nw';
  if (atTop && atRight) return 'ne';
  if (atBottom && atLeft) return 'sw';
  if (atBottom && atRight) return 'se';
  if (atTop && hasRowSpan) return 'n';
  if (atBottom && hasRowSpan) return 's';
  if (atLeft && hasColSpan) return 'w';
  if (atRight && hasColSpan) return 'e';
  return null;
}

/** The opposite corner a given corner handle keeps fixed while dragging. */
function fixedCornerFor(kind: 'nw' | 'ne' | 'sw' | 'se', original: GridRect): GridCell {
  const top = original.gridRow;
  const left = original.gridCol;
  const bottom = original.gridRow + original.gridRowSpan - 1;
  const right = original.gridCol + original.gridColSpan - 1;
  switch (kind) {
    case 'nw':
      return { row: bottom, col: right };
    case 'ne':
      return { row: bottom, col: left };
    case 'sw':
      return { row: top, col: right };
    case 'se':
      return { row: top, col: left };
  }
}

/** Computes the rectangle a resize handle produces as the pointer moves to
 * `current`. Corner handles fall out of the same bounding-box math as
 * freehand drawing (anchor = the fixed opposite corner). Edge handles only
 * ever change the one axis they sit on — the other axis is pinned to the
 * zone's original bounds. */
function computeResizeRect(kind: HandleKind, original: GridRect, current: GridCell): GridRect {
  if (kind === 'nw' || kind === 'ne' || kind === 'sw' || kind === 'se') {
    return boundingBox(fixedCornerFor(kind, original), current);
  }
  const top = original.gridRow;
  const left = original.gridCol;
  const bottom = original.gridRow + original.gridRowSpan - 1;
  const right = original.gridCol + original.gridColSpan - 1;
  switch (kind) {
    case 'e': {
      const newRight = Math.max(current.col, left);
      return { gridRow: top, gridRowSpan: original.gridRowSpan, gridCol: left, gridColSpan: newRight - left + 1 };
    }
    case 'w': {
      const newLeft = Math.min(current.col, right);
      return { gridRow: top, gridRowSpan: original.gridRowSpan, gridCol: newLeft, gridColSpan: right - newLeft + 1 };
    }
    case 's': {
      const newBottom = Math.max(current.row, top);
      return { gridRow: top, gridRowSpan: newBottom - top + 1, gridCol: left, gridColSpan: original.gridColSpan };
    }
    case 'n': {
      const newTop = Math.min(current.row, bottom);
      return { gridRow: newTop, gridRowSpan: bottom - newTop + 1, gridCol: left, gridColSpan: original.gridColSpan };
    }
  }
}

@Component({
  selector: 'app-event-inventory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, WorkspaceShell],
  templateUrl: './event-inventory.html',
  styleUrl: './event-inventory.css',
})
export class EventInventory {
  private readonly api = inject(ApiService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly id = input('');

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal('');
  protected readonly event = signal<EventSummary | null>(null);
  protected readonly zones = this.fb.array<ZoneGroup>([]);
  protected readonly seats = signal<readonly SeatCell[]>([]);
  protected readonly committedZoneIds = signal<ReadonlySet<number>>(new Set());

  protected readonly maxZones = MAX_ZONES;
  protected readonly minGridDim = MIN_GRID_DIM;
  protected readonly maxGridDim = MAX_GRID_DIM;

  protected readonly gridRowCount = signal(DEFAULT_GRID_ROWS);
  protected readonly gridColCount = signal(DEFAULT_GRID_COLS);
  protected readonly gridRows = computed(() => Array.from({ length: this.gridRowCount() }, (_, i) => i));
  protected readonly gridCols = computed(() => Array.from({ length: this.gridColCount() }, (_, i) => i));

  protected readonly seatsByKey = computed(() => {
    const map = new Map<string, SeatCell>();
    for (const seat of this.seats()) map.set(seatKey(seat.gridRow, seat.gridCol), seat);
    return map;
  });

  protected readonly hasCommittedSeats = computed(() => this.committedZoneIds().size > 0);
  protected readonly isSeatedTier = computed(() => this.event()?.tier === 'TIER2_SEATED');

  protected readonly dragStart = signal<GridCell | null>(null);
  protected readonly dragCurrent = signal<GridCell | null>(null);
  /** Set while dragging an existing zone's resize handle instead of drawing a
   * brand-new zone. `original` is the zone's rectangle as it was when the
   * drag started, so the handle's fixed edge/corner can be recomputed even
   * as the FormGroup isn't touched until the drag finishes. */
  protected readonly resizeState = signal<{ index: number; kind: HandleKind; original: GridRect } | null>(null);
  /** Set while dragging a zone by its body to move it elsewhere. `grabRow`/
   * `grabCol` are the offset between the cell the user grabbed and the
   * zone's top-left corner, so the zone tracks the pointer naturally instead
   * of snapping its corner to the cursor. */
  protected readonly moveState = signal<{ index: number; original: GridRect; grabRow: number; grabCol: number } | null>(null);

  protected readonly dragRect = computed<GridRect | null>(() => {
    const current = this.dragCurrent();
    if (!current) return null;
    const resize = this.resizeState();
    if (resize) return computeResizeRect(resize.kind, resize.original, current);
    const move = this.moveState();
    if (move) return this.computeMoveRect(move, current);
    const start = this.dragStart();
    if (!start) return null;
    return boundingBox(start, current);
  });

  protected readonly dragBlocked = computed(() => {
    const rect = this.dragRect();
    if (rect === null) return false;
    const excludeIndex = this.resizeState()?.index ?? this.moveState()?.index;
    return this.rectOverlapsExistingZone(rect, excludeIndex);
  });

  constructor() {
    effect(() => {
      void this.id();
      void this.load();
    });

    const finishDragOnWindow = () => this.finishDrag();
    window.addEventListener('mouseup', finishDragOnWindow);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('mouseup', finishDragOnWindow));
  }

  protected seatAt(row: number, col: number): SeatCell | undefined {
    return this.seatsByKey().get(seatKey(row, col));
  }

  /** Finds the zone (if any) whose rectangle covers this cell. Plain method,
   * not a computed — called per-cell during render and during drag-overlap
   * checks, over a small (<= 20x20) grid. */
  protected zoneAt(row: number, col: number): { index: number; group: ZoneGroup } | undefined {
    for (let index = 0; index < this.zones.length; index += 1) {
      const group = this.zones.at(index) as ZoneGroup;
      const c = group.controls;
      if (rectContains({ gridRow: c.gridRow.value, gridCol: c.gridCol.value, gridRowSpan: c.gridRowSpan.value, gridColSpan: c.gridColSpan.value }, row, col)) {
        return { index, group };
      }
    }
    return undefined;
  }

  private rectOverlapsExistingZone(rect: GridRect, excludeIndex?: number): boolean {
    for (let r = rect.gridRow; r < rect.gridRow + rect.gridRowSpan; r += 1) {
      for (let c = rect.gridCol; c < rect.gridCol + rect.gridColSpan; c += 1) {
        const owner = this.zoneAt(r, c);
        if (owner && owner.index !== excludeIndex) return true;
      }
    }
    return false;
  }

  private rectOf(group: ZoneGroup): GridRect {
    const c = group.controls;
    return { gridRow: c.gridRow.value, gridCol: c.gridCol.value, gridRowSpan: c.gridRowSpan.value, gridColSpan: c.gridColSpan.value };
  }

  /** Which resize handle (if any) a cell is for its owning zone. Zones with
   * sold/held seats can't be resized or moved, so they never expose one. */
  protected zoneHandleKind(row: number, col: number, owner: { index: number; group: ZoneGroup }): HandleKind | null {
    if (this.zoneHasCommitted(owner.index)) return null;
    return handleKindAt(row, col, this.rectOf(owner.group));
  }

  /** True for a zone's interior cells — the area a user can grab to drag the
   * whole zone somewhere else, as opposed to a border cell that resizes it. */
  protected isZoneMovable(row: number, col: number, owner: { index: number; group: ZoneGroup }): boolean {
    return !this.zoneHasCommitted(owner.index) && this.zoneHandleKind(row, col, owner) === null;
  }

  private computeMoveRect(move: { original: GridRect; grabRow: number; grabCol: number }, current: GridCell): GridRect {
    const maxRow = Math.max(0, this.gridRowCount() - move.original.gridRowSpan);
    const maxCol = Math.max(0, this.gridColCount() - move.original.gridColSpan);
    const gridRow = Math.min(Math.max(current.row - move.grabRow, 0), maxRow);
    const gridCol = Math.min(Math.max(current.col - move.grabCol, 0), maxCol);
    return { gridRow, gridCol, gridRowSpan: move.original.gridRowSpan, gridColSpan: move.original.gridColSpan };
  }

  protected isDragPreview(row: number, col: number): boolean {
    const rect = this.dragRect();
    return rect !== null && rectContains(rect, row, col);
  }

  protected seatLabelFor(seat: SeatCell): string {
    return this.cellLabel(seat.gridRow, seat.gridCol);
  }

  /** The seat label a cell will have once saved — computed purely from grid
   * position, so it's available immediately for a freshly drawn zone even
   * before the backend has generated real seat rows for it. */
  protected cellLabel(row: number, col: number): string {
    return `${rowLabel(row)}${col + 1}`;
  }

  protected seatTagLabel(tag: SeatTag): string {
    return tag === 'ACCESSIBLE' ? 'Accessible' : tag === 'MAINTENANCE' ? 'Maintenance' : 'No tag';
  }

  protected onCellPointerDown(row: number, col: number, event: MouseEvent): void {
    event.preventDefault();
    const owner = this.zoneAt(row, col);
    if (owner) {
      // Cells already claimed by a zone can't start a new zone — but a
      // committed zone's own border/interior can be dragged to resize or
      // move it instead.
      if (this.zoneHasCommitted(owner.index)) return;
      const original = this.rectOf(owner.group);
      const kind = handleKindAt(row, col, original);
      if (kind) {
        this.resizeState.set({ index: owner.index, kind, original });
      } else {
        this.moveState.set({ index: owner.index, original, grabRow: row - original.gridRow, grabCol: col - original.gridCol });
      }
      this.dragCurrent.set({ row, col });
      return;
    }
    this.dragStart.set({ row, col });
    this.dragCurrent.set({ row, col });
  }

  protected onCellPointerEnter(row: number, col: number): void {
    if (this.dragStart() === null && this.resizeState() === null && this.moveState() === null) return;
    this.dragCurrent.set({ row, col });
  }

  protected finishDrag(): void {
    const rect = this.dragRect();
    const resize = this.resizeState();
    const move = this.moveState();
    this.dragStart.set(null);
    this.dragCurrent.set(null);
    this.resizeState.set(null);
    this.moveState.set(null);
    if (!rect) return;

    if (resize || move) {
      const index = (resize ?? move)!.index;
      if (this.rectOverlapsExistingZone(rect, index)) {
        this.error.set("Zones can't overlap — pick an empty area.");
        return;
      }
      const group = this.zones.at(index) as ZoneGroup | undefined;
      if (!group) return;
      this.error.set('');
      group.patchValue({
        gridRow: rect.gridRow,
        gridCol: rect.gridCol,
        gridRowSpan: rect.gridRowSpan,
        gridColSpan: rect.gridColSpan,
      });
      this.saved.set(false);
      return;
    }

    if (this.rectOverlapsExistingZone(rect)) {
      this.error.set("Zones can't overlap — pick an empty area.");
      return;
    }
    if (this.zones.length >= MAX_ZONES) {
      this.error.set(`You can only have up to ${MAX_ZONES} zones.`);
      return;
    }
    this.error.set('');
    this.zones.push(buildZoneGroup(this.fb, undefined, this.zones.length, rect));
    this.saved.set(false);
  }

  protected zoneHasCommitted(index: number): boolean {
    const group = this.zones.at(index) as ZoneGroup | undefined;
    const id = group?.controls.inventoryItemId.value;
    return id !== null && id !== undefined && this.committedZoneIds().has(id);
  }

  protected removeZone(index: number): void {
    if (this.zoneHasCommitted(index)) {
      this.error.set('This zone has sold or held seats and cannot be removed.');
      return;
    }
    this.zones.removeAt(index);
    this.saved.set(false);
  }

  protected zoneSeatCount(index: number): number {
    const group = this.zones.at(index) as ZoneGroup | undefined;
    if (!group) return 0;
    return group.controls.gridRowSpan.value * group.controls.gridColSpan.value;
  }

  private lastRowOccupied(): boolean {
    const lastRow = this.gridRowCount() - 1;
    return this.zones.controls.some((g) => {
      const c = (g as ZoneGroup).controls;
      return lastRow >= c.gridRow.value && lastRow < c.gridRow.value + c.gridRowSpan.value;
    });
  }

  private lastColOccupied(): boolean {
    const lastCol = this.gridColCount() - 1;
    return this.zones.controls.some((g) => {
      const c = (g as ZoneGroup).controls;
      return lastCol >= c.gridCol.value && lastCol < c.gridCol.value + c.gridColSpan.value;
    });
  }

  protected canRemoveGridRow(): boolean {
    return this.gridRowCount() > MIN_GRID_DIM && !this.lastRowOccupied();
  }

  protected canRemoveGridCol(): boolean {
    return this.gridColCount() > MIN_GRID_DIM && !this.lastColOccupied();
  }

  /** Smallest row count that still contains every zone's rectangle. */
  private minRowsRequired(): number {
    let max = MIN_GRID_DIM;
    for (const g of this.zones.controls) {
      const c = (g as ZoneGroup).controls;
      max = Math.max(max, c.gridRow.value + c.gridRowSpan.value);
    }
    return max;
  }

  /** Smallest column count that still contains every zone's rectangle. */
  private minColsRequired(): number {
    let max = MIN_GRID_DIM;
    for (const g of this.zones.controls) {
      const c = (g as ZoneGroup).controls;
      max = Math.max(max, c.gridCol.value + c.gridColSpan.value);
    }
    return max;
  }

  /** Sets the row count directly (typed into the number input), clamped
   * between MIN/MAX_GRID_DIM and never below the last row a zone occupies. */
  protected setGridRowCount(value: number): void {
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(MAX_GRID_DIM, Math.max(this.minRowsRequired(), Math.round(value)));
    if (clamped === this.gridRowCount()) return;
    this.gridRowCount.set(clamped);
    this.saved.set(false);
  }

  /** Sets the column count directly (typed into the number input), clamped
   * between MIN/MAX_GRID_DIM and never below the last column a zone occupies. */
  protected setGridColCount(value: number): void {
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(MAX_GRID_DIM, Math.max(this.minColsRequired(), Math.round(value)));
    if (clamped === this.gridColCount()) return;
    this.gridColCount.set(clamped);
    this.saved.set(false);
  }

  protected onGridRowCountInput(event: Event): void {
    this.setGridRowCount((event.target as HTMLInputElement).valueAsNumber);
  }

  protected onGridColCountInput(event: Event): void {
    this.setGridColCount((event.target as HTMLInputElement).valueAsNumber);
  }

  protected addGridRow(): void {
    if (this.gridRowCount() >= MAX_GRID_DIM) return;
    this.gridRowCount.update((n) => n + 1);
    this.saved.set(false);
  }

  protected addGridCol(): void {
    if (this.gridColCount() >= MAX_GRID_DIM) return;
    this.gridColCount.update((n) => n + 1);
    this.saved.set(false);
  }

  protected removeGridRow(): void {
    if (!this.canRemoveGridRow()) return;
    this.gridRowCount.update((n) => n - 1);
    this.saved.set(false);
  }

  protected removeGridCol(): void {
    if (!this.canRemoveGridCol()) return;
    this.gridColCount.update((n) => n - 1);
    this.saved.set(false);
  }

  protected async save(): Promise<void> {
    const event = this.event();
    if (!event || this.saving()) return;

    if (this.zones.invalid) {
      this.zones.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.saved.set(false);
    this.error.set('');
    try {
      const zonesPayload = this.zones.getRawValue().map((zone) => ({
        inventoryItemId: zone.inventoryItemId,
        name: zone.name,
        price: zone.price,
        color: zone.color,
        gridRow: zone.gridRow,
        gridCol: zone.gridCol,
        gridRowSpan: zone.gridRowSpan,
        gridColSpan: zone.gridColSpan,
      }));
      const body = {
        zones: zonesPayload,
        gridRows: this.gridRowCount(),
        gridCols: this.gridColCount(),
      };
      await firstValueFrom(this.api.put('inventory', `/events/${event.event_id}/inventory`, body));
      await this.load();
      this.saved.set(true);
    } catch (error) {
      this.error.set(describeSaveError(error));
    } finally {
      this.saving.set(false);
    }
  }

  private async load(): Promise<void> {
    const eventId = Number(this.id());
    if (!Number.isSafeInteger(eventId) || eventId <= 0) {
      this.event.set(null);
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set('');
    try {
      const [eventResult, inventoryResult] = await Promise.all([
        firstValueFrom(this.api.get<EventSummaryResponse>('event', `/events/${eventId}`)),
        firstValueFrom(this.api.get<InventoryResponse>('inventory', `/events/${eventId}/inventory`)),
      ]);
      this.event.set(eventResult.event);
      this.gridRowCount.set(inventoryResult.gridRows || DEFAULT_GRID_ROWS);
      this.gridColCount.set(inventoryResult.gridCols || DEFAULT_GRID_COLS);

      this.zones.clear();
      inventoryResult.zones.forEach((zone, index) => {
        this.zones.push(buildZoneGroup(this.fb, zone, index));
      });

      this.committedZoneIds.set(
        new Set(inventoryResult.zones.filter((z) => z.soldCount > 0 || z.heldCount > 0).map((z) => z.inventoryItemId)),
      );

      this.seats.set(
        inventoryResult.seats.map((seat) => ({
          seatId: seat.seatId,
          gridRow: seat.gridRow,
          gridCol: seat.gridCol,
          status: seat.status,
          tag: seat.tag,
        })),
      );
    } catch (error) {
      this.event.set(null);
      this.error.set(describeSaveError(error));
    } finally {
      this.loading.set(false);
    }
  }
}

function describeSaveError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const code = (error.error as { error?: string } | null)?.error;
    if (code === 'cannot_modify_committed_seat') {
      return "A zone with sold or held seats can't be resized or removed — its name, price, and colour are still editable.";
    }
    if (code === 'zone_has_reservation_history') {
      return "This zone can't be removed — it has past reservation history. Rename or resize it instead of deleting it.";
    }
    if (code === 'duplicate_seat_label' || code === 'invalid_inventory_payload') {
      return 'Check that every zone has a name and colour, then try again.';
    }
    if (error.status === 401) return 'Please sign in again before configuring inventory.';
    if (error.status === 403) return 'You do not have permission to configure this event.';
    if (error.status === 404) return 'This event was not found.';
  }
  return 'Unable to save inventory. Please try again.';
}
