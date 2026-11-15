import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <input disabled type="text" (click)="onClick()">
      <button disabled (click)="onClick()" class="foo">Foo</button>
      <select disabled (click)="onClick()" class="foo"></select>
    `
})
export class CaseComponent {}
