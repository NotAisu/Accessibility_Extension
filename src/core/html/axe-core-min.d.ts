// The same axe-core build, loaded from its own file so it is a separate module instance
declare module 'axe-core/axe.min.js' {
    import axe = require('axe-core');
    export = axe;
}
