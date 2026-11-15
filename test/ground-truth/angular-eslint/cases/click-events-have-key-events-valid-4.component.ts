import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
        <div (click)="onClick()" aria-hidden></div>
        <div (click)="onClick()" aria-hidden="true"></div>
        <div (click)="onClick()" [attr.aria-hidden]="true"></div>
      `
})
export class CaseComponent {}
