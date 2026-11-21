// Commandes d'exploitation (les comptes sont créés à la première connexion Intranet).
//   node server/cli.mjs list-users     (comptes déjà connectés)
//   node server/cli.mjs backup         (copie la base et l'historique dans /data/backups)
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { users, backupTo } from './db.mjs';
import { DATA_DIR } from './config.mjs';
import { estSuperAdmin } from './auth.mjs';

const [commande] = process.argv.slice(2);

switch (commande) {
    case 'list-users':
        for (const u of users.list()) {
            console.log(`${u.identifiant}\t${u.nom}\t${u.email ?? ''}\t(dernière connexion ${u.derniere_connexion})${estSuperAdmin(u) ? '\tresponsable' : ''}`);
        }
        break;
    case 'backup': {
        const dossier = join(DATA_DIR, 'backups');
        mkdirSync(dossier, { recursive: true });
        const horodatage = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const fichier = join(dossier, `ne-${horodatage}.db`);
        backupTo(fichier);
        if (existsSync(join(DATA_DIR, 'historique.json'))) {
            copyFileSync(join(DATA_DIR, 'historique.json'), join(dossier, `historique-${horodatage}.json`));
        }
        console.log(`✅ Sauvegarde dans ${dossier} (ne-${horodatage}.db et historique-${horodatage}.json)`);
        break;
    }
    default:
        console.error('Usage : node server/cli.mjs list-users | backup');
        process.exit(1);
}
