import { TestBed } from '@angular/core/testing';

import { Llm } from './llm.service';

describe('Llm', () => {
  let service: Llm;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Llm);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
