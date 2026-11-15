import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <div role="progressbar" (click)="onClick()"></div>
      <div role="region" (click)="onClick()"></div>
    `
})
export class CaseComponent {}
