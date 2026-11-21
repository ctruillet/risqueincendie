// Composants du design system SGDF utilisés par l'administration (chargés une fois connecté).
// Construit dans public/ui/admin.js par scripts/build-ui.mjs.
import '@sgdf/ui/i18n';
import { setIconsBasePath } from '@sgdf/ui/utils';
import '@sgdf/ui/button';
import '@sgdf/ui/callout';
import '@sgdf/ui/card';
import '@sgdf/ui/date-time-picker';
import '@sgdf/ui/dialog';
import '@sgdf/ui/icon';
import '@sgdf/ui/icon-button';
import '@sgdf/ui/input';
import '@sgdf/ui/select';
import '@sgdf/ui/tab-group';
import '@sgdf/ui/tag';
import '@sgdf/ui/toast';

// Icônes servies par le site lui-même (copiées dans public/ui/icons)
setIconsBasePath('/ui/icons');
