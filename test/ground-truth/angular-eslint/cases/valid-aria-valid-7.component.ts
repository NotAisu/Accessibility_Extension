import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `<div [attr.aria-pressed]="undefined">aria-pressed</div>`
})
export class CaseComponent {}
