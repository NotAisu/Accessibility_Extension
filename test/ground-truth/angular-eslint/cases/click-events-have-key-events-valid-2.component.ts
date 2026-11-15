import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `<div (click)="onClick()" (keyup.enter)="onKeyup()"></div>`
})
export class CaseComponent {}
