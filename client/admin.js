// Administration, page de connexion : seulement les composants du formulaire.
// Le reste de l'admin (client/admin-app.js) est chargé après la connexion.
import '@sgdf/ui/i18n';
import { setIconsBasePath } from '@sgdf/ui/utils';
import '@sgdf/ui/input';
import '@sgdf/ui/button';
import '@sgdf/ui/callout';
import '@sgdf/ui/icon';

// Icônes servies par le site lui-même (copiées dans public/ui/icons par scripts/build-ui.mjs)
setIconsBasePath('/ui/icons');
