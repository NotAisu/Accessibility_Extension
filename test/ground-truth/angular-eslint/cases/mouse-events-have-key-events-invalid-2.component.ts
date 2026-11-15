import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <div (mouseout)="onMouseOut()" (focus)="onFocus()"></div>
      
    `
})
export class CaseComponent {}
