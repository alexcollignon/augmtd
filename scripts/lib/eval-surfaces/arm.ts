// W28 — side-effect import: arms the route bridge (route-shim.ts) the moment it is imported, so an
// entry script can place it FIRST among its imports (imports evaluate in order, before the body).
import { installRouteBridge } from './route-shim';
installRouteBridge();
