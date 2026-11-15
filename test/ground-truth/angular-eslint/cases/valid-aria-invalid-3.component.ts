import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
        <div aria-expanded="notABoolean">notABoolean</div>
                                        
        <div aria-haspopup="notAToken">notAToken</div>
                                      
        <input [attr.aria-rowcount]="{ a: 2 }">notAnInteger
                                              
        <div aria-relevant="notATokenList">notATokenList</div>
                                          
        <div aria-checked="notATristate">notATristate</div>
                                        
        <div role="slider" [attr.aria-valuemin]="[1, 2]">notANumber</div>
                                                        
        <input [attr.aria-placeholder]="4">notAPlaceholder
               
      `
})
export class CaseComponent {}
