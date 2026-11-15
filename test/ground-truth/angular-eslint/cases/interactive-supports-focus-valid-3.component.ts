import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <div role="button" aria-disabled="true" (click)="onClick()"></div>
      <div role="button" [attr.aria-disabled]="true" (click)="onClick()"></div>
    `
})
export class CaseComponent {}
