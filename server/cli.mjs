// Commandes d'exploitation (les comptes sont créés à la première connexion Intranet).
//   node server/cli.mjs list-users     (comptes déjà connectés)
//   node server/cli.mjs backup         (copie la base, historique compris, dans /data/backups)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { users, backupTo } from './db.mjs';
import { DATA_DIR } from './config.mjs';

const [commande] = process.argv.slice(2);

switch (commande) {
    case 'list-users':
        for (const u of users.list()) {
            console.log(`${u.identifiant}\t${u.nom}\t${u.email ?? ''}\t(dernière connexion ${u.derniere_connexion})${u.responsable ? '\tresponsable' : ''}`);
        }
        break;
    case 'backup': {
        const dossier = join(DATA_DIR, 'backups');
        mkdirSync(dossier, { recursive: true });
        const horodatage = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const fichier = join(dossier, `ne-${horodatage}.db`);
        backupTo(fichier);
        console.log(`✅ Sauvegarde : ${fichier}`);
        break;
    }
    default:
        console.error('Usage : node server/cli.mjs list-users | backup');
        process.exit(1);
}
