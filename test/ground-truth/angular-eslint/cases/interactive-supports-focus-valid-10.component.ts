import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <a (click)="onClick()" tabindex="0">Click me</a>
      <a (click)="onClick()" tabindex={{0}}>Click me</a>
      <a (click)="onClick()" [attr.tabindex]="0">Click me</a>
      <a (click)="onClick()" tabindex="bad">Click me</a>
      <a (click)="onClick()" [attr.tabindex]="undefined"}>Click me</a>
      <a (click)="onClick()" [attr.tabindex]="dynamicTabindex">Click me</a>
    `
})
export class CaseComponent {}
