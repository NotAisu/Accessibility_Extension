import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `<area [attr.aria-label]="label" [prop]="p">`
})
export class CaseComponent {}
