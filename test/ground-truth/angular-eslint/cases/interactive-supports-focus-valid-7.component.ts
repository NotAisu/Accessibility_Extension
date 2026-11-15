import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <input type="text" (keyup)="onKeyUp()">
      <input (keydown)="onKeydown()">
      <input (click)="onClick()" role="combobox">
      <button (click)="onClick()" class="foo">Foo</button>
      <option (click)="onClick()" class="foo">Food</option>
      <select (click)="onClick()" class="foo"></select>
      <summary (click)="onClick()">Foo</summary>
      <textarea (keypress)="onKeypress()" class="foo"></textarea>
    `
})
export class CaseComponent {}
