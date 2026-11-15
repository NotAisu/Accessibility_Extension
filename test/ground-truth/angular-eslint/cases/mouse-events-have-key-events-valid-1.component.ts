import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `<app-test (mouseover)="onMouseOver()"></app-test>`
})
export class CaseComponent {}
