import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `<object [attr.aria-label]="desc" [custom]="x"></object>`
})
export class CaseComponent {}
