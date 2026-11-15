import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
      <a (click)="onClick()" href="http://x.y.z">x.y.z</a>
      <a role="link" (click)="onClick()" href="http://x.y.z">x.y.z</a>
      <a (click)="onClick()" href="javascript:void(0);">Click ALL the things!</a>
    `
})
export class CaseComponent {}
