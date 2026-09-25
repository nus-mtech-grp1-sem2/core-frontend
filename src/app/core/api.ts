import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL, BackendService } from './api-config';

/** Response shape of `GET /health` on every backend service. */
export interface HealthResponse {
  status: string;
  service: string;
}

/**
 * Thin wrapper over HttpClient that builds gateway URLs from a service name,
 * so components never hardcode routes or hosts.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  url(service: BackendService, path: string): string {
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}/${service}${suffix}`;
  }

  get<T>(
    service: BackendService,
    path: string,
    options?: { headers?: Record<string, string> },
  ): Observable<T> {
    return this.http.get<T>(this.url(service, path), options);
  }

  post<T>(
    service: BackendService,
    path: string,
    body: unknown,
    options?: { headers?: Record<string, string> },
  ): Observable<T> {
    return this.http.post<T>(this.url(service, path), body, options);
  }

  put<T>(service: BackendService, path: string, body: unknown): Observable<T> {
    return this.http.put<T>(this.url(service, path), body);
  }

  patch<T>(service: BackendService, path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(this.url(service, path), body);
  }

  delete<T>(service: BackendService, path: string): Observable<T> {
    return this.http.delete<T>(this.url(service, path));
  }

  health(service: BackendService): Observable<HealthResponse> {
    return this.get<HealthResponse>(service, '/health');
  }
}
