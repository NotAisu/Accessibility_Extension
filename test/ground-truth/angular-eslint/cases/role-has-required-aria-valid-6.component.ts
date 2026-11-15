import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `<summary (click)="onClick()">Foo</summary>`
})
export class CaseComponent {}
