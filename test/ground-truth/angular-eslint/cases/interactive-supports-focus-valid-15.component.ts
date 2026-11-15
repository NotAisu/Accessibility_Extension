import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <span (click)="onClick()" tabindex="0">Click me!</span>
      <span (click)="onClick()" [attr.tabindex]="0">Click me!</span>
      <span (click)="onClick()" tabindex="-1">Click me!</span>
      <span (click)="onClick()" [attr.tabindex]="-1">Click me!</span>
    `
})
export class CaseComponent {}
