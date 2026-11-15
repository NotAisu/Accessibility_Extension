import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <div (keyup)="onKeyUp()" (keydown)="onKeyDown()" (keypress)="onKeyPress()">Cannot be focused</div>
      
    `
})
export class CaseComponent {}
