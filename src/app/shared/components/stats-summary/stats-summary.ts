import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export interface SummaryStat {
  readonly label: string;
  readonly value: number;
  readonly currency?: boolean;
}

@Component({
  selector: 'app-stats-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe],
  templateUrl: './stats-summary.html',
  styleUrl: './stats-summary.css',
})
export class StatsSummary {
  readonly items = input.required<readonly SummaryStat[]>();
}
