import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `<img src="foo" [attr.alt]="altText">`
})
export class CaseComponent {}
