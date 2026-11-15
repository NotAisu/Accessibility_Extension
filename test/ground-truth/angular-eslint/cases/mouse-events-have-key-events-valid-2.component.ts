import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `<app-test (mouseout)="onMouseOut()"></app-test>`
})
export class CaseComponent {}
