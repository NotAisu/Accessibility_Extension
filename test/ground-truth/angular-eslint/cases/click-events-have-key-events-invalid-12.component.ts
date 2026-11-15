import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <div (click)="onClick()" [attr.hidden]="hidden"></div>
      
    `
})
export class CaseComponent {}
