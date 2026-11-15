import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `<div (mouseout)="onMouseOut()" (blur)="onBlur()"></div>`
})
export class CaseComponent {}
