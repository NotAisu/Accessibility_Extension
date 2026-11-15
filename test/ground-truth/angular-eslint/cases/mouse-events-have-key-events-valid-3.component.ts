import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `<div (mouseover)="onMouseOver()" (focus)="onFocus()"></div>`
})
export class CaseComponent {}
