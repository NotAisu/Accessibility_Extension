import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <div aria-hidden (click)="onClick()"></div>
      <div aria-hidden="true" (click)="onClick()"></div>
      <div [attr.aria-hidden]="true" (click)="onClick()"></div>
    `
})
export class CaseComponent {}
