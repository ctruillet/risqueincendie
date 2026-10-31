// Gestion des comptes admin en ligne de commande (premier compte, mot de passe oublié).
//   node server/cli.mjs add-user <email> ["Nom"]
//   node server/cli.mjs reset-password <email>
//   node server/cli.mjs list-users
//   node server/cli.mjs backup         (copie la base et l'historique dans /data/backups)
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { users, backupTo } from './db.mjs';
import { DATA_DIR } from './config.mjs';
import { hashPassword, randomPassword } from './auth.mjs';

const [commande, email, nom = ''] = process.argv.slice(2);

switch (commande) {
    case 'add-user': {
        if (!email) usage();
        if (users.byEmail(email)) erreur(`Le compte ${email} existe déjà.`);
        const motDePasse = randomPassword();
        users.create(email, nom, hashPassword(motDePasse));
        console.log(`✅ Compte créé : ${email}\n   Mot de passe provisoire : ${motDePasse}\n   (à changer dans l'admin, onglet « Comptes »)`);
        break;
    }
    case 'reset-password': {
        const user = email && users.byEmail(email);
        if (!user) erreur(`Compte ${email ?? ''} introuvable.`);
        const motDePasse = randomPassword();
        users.setPassword(user.id, hashPassword(motDePasse));
        console.log(`✅ Nouveau mot de passe provisoire pour ${email} : ${motDePasse}`);
        break;
    }
    case 'list-users':
        for (const u of users.list()) console.log(`${u.email}\t${u.nom}\t(créé le ${u.created_at})`);
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
        usage();
}

function usage() {
    erreur('Usage : node server/cli.mjs add-user <email> ["Nom"] | reset-password <email> | list-users | backup');
}

function erreur(message) {
    console.error(message);
    process.exit(1);
}
