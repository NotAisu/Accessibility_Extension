import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
        <div (click)="onClick()" [attr.role]="'header'"></div>
        
      `
})
export class CaseComponent {}
