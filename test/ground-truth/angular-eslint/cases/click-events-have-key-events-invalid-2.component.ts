import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <div (click)="onClick()" (handleSomething)="handleSomething()"></div>
      
    `
})
export class CaseComponent {}
