import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <input
        aria-placeholder="Placeholder"
        aria-orientation="undefined"
        [attr.aria-checked]="test && isChecked"
        [attr.aria-hidden]="'abc' | appAria"
        [attr.aria-invalid]="hasError ? 'grammar' : 'spelling'"
        [attr.aria-label]="inputSchema!.label"
        [attr.aria-live]="inputSchema['live']"
        [attr.aria-required]="inputSchema?.isRequired">
    `
})
export class CaseComponent {}
