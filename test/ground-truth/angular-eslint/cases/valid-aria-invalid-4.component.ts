import { Component } from '@angular/core';

@Component({
    selector: 'app-case',
    template: `
        <div aria-relevant="additions notAToken">Text</div>
                                                
        <div aria-dropeffect="copy notAToken">Text</div>
                                             
        <div aria-relevant="   ">Text</div>
             
      `
})
export class CaseComponent {}
