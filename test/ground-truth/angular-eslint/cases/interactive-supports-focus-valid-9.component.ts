import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <area href="#" (click)="onClick()" class="foo"/>
      <area (click)="onClick()" tabindex=0 class="foo"/>
    `
})
export class CaseComponent {}
