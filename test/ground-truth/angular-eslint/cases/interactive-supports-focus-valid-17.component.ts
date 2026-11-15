import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <div contenteditable="true" (keyup)="onKeyUp()">Edit this text</div>
      <div [attr.contenteditable]="true" (keydown)="onKeyDown()">Edit this text</div>
      <div contenteditable (keypress)="onKeyPress()">Edit this too!</div>
    `
})
export class CaseComponent {}
