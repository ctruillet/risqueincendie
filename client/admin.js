// Administration : composants de base (champs, boutons, messages, icônes).
// Chargé avec client/admin-app.js une fois la personne connectée (la connexion se fait sur /connexion).
import '@sgdf/ui/i18n';
import { setIconsBasePath } from '@sgdf/ui/utils';
import '@sgdf/ui/input';
import '@sgdf/ui/button';
import '@sgdf/ui/callout';
import '@sgdf/ui/icon';

// Icônes servies par le site lui-même (copiées dans public/ui/icons par scripts/build-ui.mjs)
setIconsBasePath('/ui/icons');
