import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <div (click)="onClick()" [attr.aria-label]="clickableThing"></div>
      
    `
})
export class CaseComponent {}
