import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { GoogleFormData } from '../../../extension/src/shared/llm.types';

@Injectable({
  providedIn: 'root',
})
export class LlmService {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:8000';

  connectGroq(formData: GoogleFormData) {
    return this.http.post<any>(this.apiUrl, formData);
  }
}
