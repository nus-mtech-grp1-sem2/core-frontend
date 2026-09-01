import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService } from './api';
import { AuthService } from './auth';

export interface PurchaseResponse {
  readonly orderId: number;
  readonly reference: string;
  readonly eventId: number;
  readonly quantity: number;
}

@Injectable({ providedIn: 'root' })
export class PurchaseService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  buy(ticketTypeId: string, quantity = 1): Observable<PurchaseResponse> {
    return this.api.post<PurchaseResponse>('order', '/orders', {
      email: this.auth.user()?.email ?? '',
      ticketTypeId: Number(ticketTypeId.replace(/\D/g, '')),
      quantity,
    });
  }
}
