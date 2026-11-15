import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <div [attr.contenteditable]="false" (keyup)="onKeyUp()">Cannot be focused</div>
      
    `
})
export class CaseComponent {}
