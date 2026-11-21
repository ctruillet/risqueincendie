// Base SQLite (module node:sqlite intégré à Node 24) : camps, membres des camps, comptes (connexion
// par l'Intranet), sessions et journal des mails envoyés.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.mjs';

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, 'ne.db'));

// Migration : les comptes à mot de passe local sont remplacés par la connexion Intranet
if (db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'password_hash'").get()) {
    db.exec('DROP TABLE IF EXISTS sessions; DROP TABLE users;');
    console.log("🔑 Anciens comptes à mot de passe supprimés : la connexion passe par l'Intranet (voir SUPER_ADMINS).");
}

db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS camps (
        id       TEXT PRIMARY KEY,
        titre    TEXT NOT NULL,
        debut    TEXT,              -- AAAA-MM-JJ, inclus
        fin      TEXT,              -- AAAA-MM-JJ, inclus
        position INTEGER NOT NULL DEFAULT 0
    );

    -- Une zone = un massif d'un département. La clé est celle utilisée dans historique.json.
    -- Les zones ne sont jamais supprimées : un nouveau camp sur le même massif retrouve son historique.
    CREATE TABLE IF NOT EXISTS zones (
        cle       TEXT PRIMARY KEY,
        dept      TEXT NOT NULL,
        id_massif TEXT NOT NULL,
        UNIQUE (dept, id_massif)
    );

    CREATE TABLE IF NOT EXISTS camp_zones (
        camp_id  TEXT NOT NULL REFERENCES camps(id) ON DELETE CASCADE ON UPDATE CASCADE,
        cle      TEXT NOT NULL REFERENCES zones(cle),
        label    TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (camp_id, cle)
    );

    -- Membres d'un camp, ajoutés par un admin du camp avec leur e-mail et/ou leur identifiant Intranet.
    -- Tous ceux qui ont un e-mail reçoivent les prévisions pendant les dates du camp.
    --   admin       : modifie le camp et ses membres
    --   participant : voit le camp mis en avant sur l'accueil, peut s'en retirer
    CREATE TABLE IF NOT EXISTS membres (
        id          INTEGER PRIMARY KEY,
        camp_id     TEXT NOT NULL REFERENCES camps(id) ON DELETE CASCADE ON UPDATE CASCADE,
        role        TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('admin', 'participant')),
        nom         TEXT NOT NULL DEFAULT '',
        email       TEXT COLLATE NOCASE,
        identifiant TEXT COLLATE NOCASE,
        CHECK (email IS NOT NULL OR identifiant IS NOT NULL),
        UNIQUE (camp_id, email),
        UNIQUE (camp_id, identifiant)
    );

    -- Comptes : créés à la première connexion Intranet. Aucun mot de passe n'est conservé.
    CREATE TABLE IF NOT EXISTS users (
        id                 INTEGER PRIMARY KEY,
        identifiant        TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email              TEXT COLLATE NOCASE,
        nom                TEXT NOT NULL DEFAULT '',
        derniere_connexion TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    );

    -- Une ligne par tentative d'envoi de la notification d'un camp pour une date
    CREATE TABLE IF NOT EXISTS envois (
        id           INTEGER PRIMARY KEY,
        camp_id      TEXT NOT NULL REFERENCES camps(id) ON DELETE CASCADE ON UPDATE CASCADE,
        date         TEXT NOT NULL,
        signature    TEXT NOT NULL,
        destinataires TEXT NOT NULL,
        ok           INTEGER NOT NULL,
        erreur       TEXT,
        sent_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS envois_camp_date ON envois (camp_id, date);
`);

// Copie cohérente de la base, même pendant que le serveur tourne
export function backupTo(path) {
    db.prepare('VACUUM INTO ?').run(path);
}

// Migration : les contacts deviennent des membres « participant » (ils continuent à recevoir les mails)
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'contacts'").get()) {
    db.exec(`
        INSERT OR IGNORE INTO membres (camp_id, role, nom, email)
            SELECT camp_id, 'participant', nom, email FROM contacts WHERE email IS NOT NULL AND email <> '';
        DROP TABLE contacts;
    `);
    console.log('👥 Contacts des camps repris comme participants.');
}

function transaction(fn) {
    db.exec('BEGIN');
    try {
        const result = fn();
        db.exec('COMMIT');
        return result;
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
}

// --- Zones ---

// Retourne la clé d'historique du massif, en la créant au besoin
function cleZone(dept, idMassif) {
    const existante = db.prepare('SELECT cle FROM zones WHERE dept = ? AND id_massif = ?').get(dept, idMassif);
    if (existante) return existante.cle;
    const cle = `m${dept}_${idMassif}`;
    db.prepare('INSERT INTO zones (cle, dept, id_massif) VALUES (?, ?, ?)').run(cle, dept, idMassif);
    return cle;
}

// --- Camps ---

export function listCamps({ avecMembres = false } = {}) {
    const camps = db.prepare('SELECT id, titre, debut, fin FROM camps ORDER BY position, titre').all();
    const zones = db.prepare(`
        SELECT cz.camp_id, cz.cle, cz.label, z.dept, z.id_massif
        FROM camp_zones cz JOIN zones z ON z.cle = cz.cle
        ORDER BY cz.position`).all();
    const membres = avecMembres
        ? db.prepare(`SELECT id, camp_id, role, nom, email, identifiant FROM membres
                      ORDER BY role = 'admin' DESC, id`).all()
        : [];
    return camps.map(camp => ({
        ...camp,
        zones: zones.filter(z => z.camp_id === camp.id)
            .map(({ cle, label, dept, id_massif }) => ({ cle, label, dept, id_massif })),
        ...(avecMembres && {
            membres: membres.filter(m => m.camp_id === camp.id)
                .map(({ camp_id, ...m }) => m)
        })
    }));
}

export function getCamp(id) {
    return listCamps({ avecMembres: true }).find(c => c.id === id) ?? null;
}

// Crée ou remplace un camp (zones et membres compris)
export function saveCamp(camp) {
    transaction(() => {
        const existe = db.prepare('SELECT 1 FROM camps WHERE id = ?').get(camp.id);
        if (existe) {
            db.prepare('UPDATE camps SET titre = ?, debut = ?, fin = ? WHERE id = ?')
                .run(camp.titre, camp.debut, camp.fin, camp.id);
        } else {
            const { pos } = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM camps').get();
            db.prepare('INSERT INTO camps (id, titre, debut, fin, position) VALUES (?, ?, ?, ?, ?)')
                .run(camp.id, camp.titre, camp.debut, camp.fin, pos);
        }
        db.prepare('DELETE FROM camp_zones WHERE camp_id = ?').run(camp.id);
        camp.zones.forEach((zone, i) => {
            const cle = zone.cle ?? cleZone(zone.dept, zone.id_massif);
            db.prepare('INSERT OR IGNORE INTO camp_zones (camp_id, cle, label, position) VALUES (?, ?, ?, ?)')
                .run(camp.id, cle, zone.label, i);
        });
        db.prepare('DELETE FROM membres WHERE camp_id = ?').run(camp.id);
        for (const m of camp.membres ?? []) {
            db.prepare('INSERT INTO membres (camp_id, role, nom, email, identifiant) VALUES (?, ?, ?, ?, ?)')
                .run(camp.id, m.role, m.nom ?? '', m.email ?? null, m.identifiant ?? null);
        }
    });
}

export function deleteCamp(id) {
    return db.prepare('DELETE FROM camps WHERE id = ?').run(id).changes > 0;
}

export function reorderCamps(ids) {
    transaction(() => {
        ids.forEach((id, i) => db.prepare('UPDATE camps SET position = ? WHERE id = ?').run(i, id));
    });
}

// Premier lancement : reprend les camps de camps.json (et leurs clés d'historique)
export function seedCamps(campsJsonPath) {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM camps').get();
    if (n > 0 || !existsSync(campsJsonPath)) return;
    const camps = JSON.parse(readFileSync(campsJsonPath, 'utf8'));
    transaction(() => {
        for (const camp of camps) {
            for (const z of camp.zones) {
                db.prepare('INSERT OR IGNORE INTO zones (cle, dept, id_massif) VALUES (?, ?, ?)')
                    .run(z.cle, z.dept, z.id_massif);
            }
            const { pos } = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM camps').get();
            db.prepare('INSERT INTO camps (id, titre, debut, fin, position) VALUES (?, ?, ?, ?, ?)')
                .run(camp.id, camp.titre, camp.debut ?? null, camp.fin ?? null, pos);
            camp.zones.forEach((z, i) => {
                db.prepare('INSERT INTO camp_zones (camp_id, cle, label, position) VALUES (?, ?, ?, ?)')
                    .run(camp.id, z.cle, z.label, i);
            });
        }
    });
    console.log(`📥 ${camps.length} camp(s) importé(s) depuis camps.json.`);
}

// --- Comptes et sessions ---

// Un membre correspond à un compte par son identifiant Intranet ou son e-mail
const EST_LUI = '(m.identifiant = $identifiant OR (m.email IS NOT NULL AND m.email = $email))';

export const users = {
    list: () => db.prepare('SELECT id, identifiant, email, nom, derniere_connexion FROM users ORDER BY nom, identifiant').all(),
    // À chaque connexion : crée ou met à jour le compte avec les informations de l'Intranet, puis
    // complète les membres qui lui correspondent (e-mail ajouté par l'admin → identifiant, et inversement)
    connexion: ({ identifiant, email, nom }) => transaction(() => {
        const { id } = db.prepare(`
            INSERT INTO users (identifiant, email, nom) VALUES (?, ?, ?)
            ON CONFLICT (identifiant) DO UPDATE SET
                email = excluded.email, nom = excluded.nom, derniere_connexion = datetime('now')
            RETURNING id`).get(identifiant, email, nom);
        // node:sqlite refuse un paramètre nommé que la requête n'utilise pas : un objet par requête
        const lui = { $identifiant: identifiant, $email: email };
        db.prepare(`UPDATE OR IGNORE membres SET identifiant = $identifiant
                    WHERE identifiant IS NULL AND $email IS NOT NULL AND email = $email`).run(lui);
        db.prepare(`UPDATE OR IGNORE membres SET email = $email
                    WHERE email IS NULL AND $email IS NOT NULL AND identifiant = $identifiant`).run(lui);
        db.prepare(`UPDATE membres AS m SET nom = $nom WHERE nom = '' AND $nom <> '' AND ${EST_LUI}`)
            .run({ ...lui, $nom: nom });
        return id;
    })
};

export const membres = {
    // Camps de l'utilisateur et son rôle dans chacun : { campId: 'admin' | 'participant' }
    roles: user => Object.fromEntries(db.prepare(`
        SELECT m.camp_id, MAX(m.role = 'admin') AS admin FROM membres m WHERE ${EST_LUI} GROUP BY m.camp_id`)
        .all({ $identifiant: user.identifiant, $email: user.email ?? null })
        .map(r => [r.camp_id, r.admin ? 'admin' : 'participant'])),
    quitter: (campId, user) => db.prepare(`DELETE FROM membres AS m WHERE m.camp_id = $camp AND ${EST_LUI}`)
        .run({ $camp: campId, $identifiant: user.identifiant, $email: user.email ?? null }).changes > 0,
    nbAdmins: campId => db.prepare("SELECT COUNT(*) AS n FROM membres WHERE camp_id = ? AND role = 'admin'").get(campId).n
};

export const sessions = {
    create: (tokenHash, userId, expiresAt) =>
        db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, userId, expiresAt),
    user: tokenHash => db.prepare(`
        SELECT u.id, u.identifiant, u.email, u.nom FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?`).get(tokenHash, Date.now()),
    delete: tokenHash => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash),
    purge: () => db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
};

// --- Journal des envois ---

export const envois = {
    dernierReussi: (campId, date) => db.prepare(`
        SELECT * FROM envois WHERE camp_id = ? AND date = ? AND ok = 1
        ORDER BY id DESC LIMIT 1`).get(campId, date),
    add: ({ campId, date, signature, destinataires, ok, erreur }) => db.prepare(`
        INSERT INTO envois (camp_id, date, signature, destinataires, ok, erreur)
        VALUES (?, ?, ?, ?, ?, ?)`).run(campId, date, signature, destinataires, ok ? 1 : 0, erreur ?? null),
    // campIds : seulement ces camps (admin d'un camp) ; null : tous (responsable du site)
    recents: (limit = 50, campIds = null) => db.prepare(`
        SELECT e.id, e.camp_id, c.titre, e.date, e.destinataires, e.ok, e.erreur, e.sent_at
        FROM envois e LEFT JOIN camps c ON c.id = e.camp_id
        ${campIds ? 'WHERE e.camp_id IN (SELECT value FROM json_each(?))' : ''}
        ORDER BY e.id DESC LIMIT ?`).all(...(campIds ? [JSON.stringify(campIds)] : []), limit)
};
