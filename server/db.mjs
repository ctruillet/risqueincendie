// Base SQLite (module node:sqlite intégré à Node 24) : camps, contacts, comptes admin,
// sessions et journal des mails envoyés.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.mjs';

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, 'ne.db'));

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

    CREATE TABLE IF NOT EXISTS contacts (
        id        INTEGER PRIMARY KEY,
        camp_id   TEXT NOT NULL REFERENCES camps(id) ON DELETE CASCADE ON UPDATE CASCADE,
        nom       TEXT NOT NULL DEFAULT '',
        email     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
        nom           TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
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

// Migration : les téléphones ne sont plus enregistrés (aucun SMS n'est envoyé)
if (db.prepare("SELECT 1 FROM pragma_table_info('contacts') WHERE name = 'telephone'").get()) {
    db.exec(`
        DELETE FROM contacts WHERE email IS NULL OR email = '';
        ALTER TABLE contacts DROP COLUMN telephone;
    `);
    console.log('🧹 Téléphones des contacts supprimés de la base.');
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

export function listCamps({ avecContacts = false } = {}) {
    const camps = db.prepare('SELECT id, titre, debut, fin FROM camps ORDER BY position, titre').all();
    const zones = db.prepare(`
        SELECT cz.camp_id, cz.cle, cz.label, z.dept, z.id_massif
        FROM camp_zones cz JOIN zones z ON z.cle = cz.cle
        ORDER BY cz.position`).all();
    const contacts = avecContacts
        ? db.prepare('SELECT id, camp_id, nom, email FROM contacts ORDER BY id').all()
        : [];
    return camps.map(camp => ({
        ...camp,
        zones: zones.filter(z => z.camp_id === camp.id)
            .map(({ cle, label, dept, id_massif }) => ({ cle, label, dept, id_massif })),
        ...(avecContacts && {
            contacts: contacts.filter(c => c.camp_id === camp.id)
                .map(({ id, nom, email }) => ({ id, nom, email }))
        })
    }));
}

export function getCamp(id) {
    return listCamps({ avecContacts: true }).find(c => c.id === id) ?? null;
}

// Crée ou remplace un camp (zones et contacts compris)
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
        db.prepare('DELETE FROM contacts WHERE camp_id = ?').run(camp.id);
        for (const c of camp.contacts ?? []) {
            db.prepare('INSERT INTO contacts (camp_id, nom, email) VALUES (?, ?, ?)')
                .run(camp.id, c.nom ?? '', c.email);
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

export const users = {
    count: () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    list: () => db.prepare('SELECT id, email, nom, created_at FROM users ORDER BY email').all(),
    byEmail: email => db.prepare('SELECT * FROM users WHERE email = ?').get(email),
    byId: id => db.prepare('SELECT id, email, nom FROM users WHERE id = ?').get(id),
    create: (email, nom, hash) =>
        db.prepare('INSERT INTO users (email, nom, password_hash) VALUES (?, ?, ?)').run(email, nom, hash).lastInsertRowid,
    setPassword: (id, hash) => {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    },
    delete: id => db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0
};

export const sessions = {
    create: (tokenHash, userId, expiresAt) =>
        db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, userId, expiresAt),
    user: tokenHash => db.prepare(`
        SELECT u.id, u.email, u.nom FROM sessions s JOIN users u ON u.id = s.user_id
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
    recents: (limit = 50) => db.prepare(`
        SELECT e.id, e.camp_id, c.titre, e.date, e.destinataires, e.ok, e.erreur, e.sent_at
        FROM envois e LEFT JOIN camps c ON c.id = e.camp_id
        ORDER BY e.id DESC LIMIT ?`).all(limit)
};
