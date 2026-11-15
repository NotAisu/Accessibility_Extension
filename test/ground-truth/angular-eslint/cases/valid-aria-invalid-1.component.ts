import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
        <div aria-roledescriptio="text">Text</div>
                                       
        <input [aria-labelby]="label">
                                     
        <input [attr.aria-requiredIf]="required">
               
      `
})
export class CaseComponent {}
