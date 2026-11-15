import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <div (click)="onClick()" [attr.aria-hidden]="ariaHidden"></div>
      
    `
})
export class CaseComponent {}
