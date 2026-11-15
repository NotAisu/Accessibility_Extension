import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `<textarea [attr.aria-readonly]="readonly"></textarea>`
})
export class CaseComponent {}
