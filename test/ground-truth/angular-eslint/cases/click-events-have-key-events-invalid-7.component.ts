import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
        <div (click)="onClick()" [attr.aria-hidden]="'false'"></div>
        
      `
})
export class CaseComponent {}
