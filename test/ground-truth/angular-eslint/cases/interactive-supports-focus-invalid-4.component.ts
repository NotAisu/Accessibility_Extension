import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <div [attr.aria-disabled]="false" (click)="onClick()"></div>
      
    `
})
export class CaseComponent {}
