import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <div (click)="onClick()" tabindex="invalid"></div>
      <div (click)="onClick()" [attr.tabindex]="undefined"></div>
      <span (click)="onClick()" [attr.tabindex]=="false">Submit</span>
      <span (click)="onClick()" [attr.tabindex]=="null">Submit</span>
    `
})
export class CaseComponent {}
