import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <div role="presentation" (click)="onClick()"></div>
      <div role="none" (click)="onClick()"></div>
    `
})
export class CaseComponent {}
