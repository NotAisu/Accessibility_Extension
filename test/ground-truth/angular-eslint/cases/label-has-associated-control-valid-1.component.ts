import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
    <ng-container *ngFor="let item of items; index as index">
      <label for="item-{{index}}">Label #{{index}</label>
      <input id="item-{{index}}" [(ngModel)]="item.name">
    </ng-container>
    <label for="id"></label>
    <label for="{{id}}"></label>
    <label [attr.for]="id"></label>
    <label [htmlFor]="id"></label>
    `
})
export class CaseComponent {}
