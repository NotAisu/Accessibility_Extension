import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <input type="hidden" (click)="onClick()">
      <input type="hidden" (click)="onClick()" tabindex="-1">
      <input type="hidden" (click)="onClick()" [attr.tabindex]="-1">
    `
})
export class CaseComponent {}
