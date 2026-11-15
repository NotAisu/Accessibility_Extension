import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `<summary (click)="onClick()" aria-expanded="false">Bar</summary>`
})
export class CaseComponent {}
