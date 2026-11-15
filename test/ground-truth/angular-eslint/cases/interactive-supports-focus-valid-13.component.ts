import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <a routerLink="route" (click)="onClick()"></a>
      <a [routerLink]="route" (click)="onClick()"></a>
    `
})
export class CaseComponent {}
