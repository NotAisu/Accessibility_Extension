import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `<test-component (keydown)="onKeyDown()"></test-component>`
})
export class CaseComponent {}
