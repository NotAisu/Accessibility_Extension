import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
        <div (click)="onClick()" (keyup)="onKeyup()"></div>
        <div (keyup)="onKeyup()" (click)="onClick()"></div>
        <div (click)="onClick()" (keyup)="onKeyup()" (handleSomething)="handleSomething()"></div>
      `
})
export class CaseComponent {}
