import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `<form (keydown)="onKeyDown()"></form>`
})
export class CaseComponent {}
