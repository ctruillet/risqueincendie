// Base SQLite (module node:sqlite intégré à Node 24) : camps et leurs massifs, historique des niveaux,
// membres des camps, comptes (connexion par l'Intranet), sessions et journal des mails envoyés.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, SEASON_END } from './config.mjs';
import { getParisDate } from './dates.mjs';

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, 'ne.db'));

// Migration : les comptes à mot de passe local sont remplacés par la connexion Intranet
if (db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'password_hash'").get()) {
    db.exec('DROP TABLE IF EXISTS sessions; DROP TABLE users;');
    console.log("🔑 Anciens comptes à mot de passe supprimés : la connexion passe par l'Intranet.");
}

// Un massif est identifié par « département-massif » (ex. 13-133), dans l'historique comme sur le site
export const cleMassif = (dept, idMassif) => `${dept}-${idMassif}`;

// Migration : les massifs avaient une clé choisie à la main (table zones, ex. « sainteBaume13 »).
// Les massifs des camps sont repris ; la correspondance sert à importer l'ancien historique.json.
// (les clés de la toute première version, publiée sur GitHub Pages, sont connues d'avance)
const anciennesCles = new Map(Object.entries({
    calanques: '13-133', sainteBaume13: '13-1322', sainteBaume83: '83-832', garrigues: '34-344'
}));
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'zones'").get()) {
    for (const z of db.prepare('SELECT cle, dept, id_massif FROM zones').all()) anciennesCles.set(z.cle, cleMassif(z.dept, z.id_massif));
    db.exec(`
        PRAGMA foreign_keys = OFF;
        BEGIN;
        CREATE TABLE camp_massifs_ancien AS
            SELECT cz.camp_id, z.dept, z.id_massif, cz.label, cz.position FROM camp_zones cz JOIN zones z ON z.cle = cz.cle;
        DROP TABLE camp_zones;
        DROP TABLE zones;
        COMMIT;
    `);
}

db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS camps (
        id       TEXT PRIMARY KEY,
        titre    TEXT NOT NULL,
        debut    TEXT,              -- AAAA-MM-JJ, inclus
        fin      TEXT               -- AAAA-MM-JJ, inclus
    );

    -- Massifs suivis par un camp, dans l'ordre d'affichage
    CREATE TABLE IF NOT EXISTS camp_massifs (
        camp_id   TEXT NOT NULL REFERENCES camps(id) ON DELETE CASCADE ON UPDATE CASCADE,
        dept      TEXT NOT NULL,
        id_massif TEXT NOT NULL,
        label     TEXT NOT NULL,
        position  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (camp_id, dept, id_massif)
    );

    -- Historique : niveau publié par la préfecture pour un massif et un jour (statut = clé de regles.json).
    -- Indépendant des camps : un nouveau camp sur le même massif retrouve son historique.
    CREATE TABLE IF NOT EXISTS releves (
        date      TEXT NOT NULL,        -- AAAA-MM-JJ
        dept      TEXT NOT NULL,
        id_massif TEXT NOT NULL,
        statut    TEXT NOT NULL,
        PRIMARY KEY (date, dept, id_massif)
    );

    -- Membres d'un camp : ajoutés par un admin du camp (e-mail et/ou identifiant Intranet) ou abonnés
    -- d'eux-mêmes. Tous ceux qui ont un e-mail reçoivent les prévisions pendant les dates du camp.
    --   admin       : modifie le camp et ses membres
    --   participant : voit le camp mis en avant sur l'accueil, peut s'en retirer. Retiré du camp
    --                 après jusqu_au (inclus), au plus tard à la fin de l'été (fin de SEASON).
    CREATE TABLE IF NOT EXISTS membres (
        id          INTEGER PRIMARY KEY,
        camp_id     TEXT NOT NULL REFERENCES camps(id) ON DELETE CASCADE ON UPDATE CASCADE,
        role        TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('admin', 'participant')),
        nom         TEXT NOT NULL DEFAULT '',
        email       TEXT COLLATE NOCASE,
        identifiant TEXT COLLATE NOCASE,
        jusqu_au    TEXT,               -- AAAA-MM-JJ, inclus ; participants seulement
        CHECK (email IS NOT NULL OR identifiant IS NOT NULL),
        UNIQUE (camp_id, email),
        UNIQUE (camp_id, identifiant)
    );

    -- Comptes : créés à la première connexion Intranet. Aucun mot de passe n'est conservé.
    -- responsable = 1 : membre de la structure responsable du site (vérifié à chaque connexion)
    CREATE TABLE IF NOT EXISTS users (
        id                 INTEGER PRIMARY KEY,
        identifiant        TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email              TEXT COLLATE NOCASE,
        nom                TEXT NOT NULL DEFAULT '',
        responsable        INTEGER NOT NULL DEFAULT 0,
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

// Migration : date de fin d'abonnement des participants
if (!db.prepare("SELECT 1 FROM pragma_table_info('membres') WHERE name = 'jusqu_au'").get()) {
    db.exec('ALTER TABLE membres ADD COLUMN jusqu_au TEXT');
}

// Dernier jour de l'été en cours (ou du prochain, si celui de cette année est passé)
export function finSaison(aujourdhui = getParisDate(0)) {
    const annee = Number(aujourdhui.slice(0, 4)) + (aujourdhui.slice(5) > SEASON_END ? 1 : 0);
    return `${annee}-${SEASON_END}`;
}

// Fin d'abonnement d'un participant : la date demandée, au plus tard la fin de l'été
const finAbonnement = jusquAu => (jusquAu && jusquAu < finSaison() ? jusquAu : finSaison());

if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'camp_massifs_ancien'").get()) {
    db.exec(`
        INSERT OR IGNORE INTO camp_massifs SELECT * FROM camp_massifs_ancien;
        DROP TABLE camp_massifs_ancien;
    `);
    console.log('🗺️ Massifs des camps repris (clé département-massif).');
}

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
db.prepare("UPDATE membres SET jusqu_au = ? WHERE role = 'participant' AND jusqu_au IS NULL").run(finSaison());

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

// --- Camps ---

export function listCamps({ avecMembres = false } = {}) {
    // Camps datés dans l'ordre chronologique, puis les autres par nom
    const camps = db.prepare('SELECT id, titre, debut, fin FROM camps ORDER BY debut IS NULL, debut, titre').all();
    const zones = db.prepare('SELECT camp_id, dept, id_massif, label FROM camp_massifs ORDER BY position').all();
    const membres = avecMembres
        ? db.prepare(`SELECT id, camp_id, role, nom, email, identifiant, jusqu_au FROM membres
                      ORDER BY role = 'admin' DESC, id`).all()
        : [];
    return camps.map(camp => ({
        ...camp,
        zones: zones.filter(z => z.camp_id === camp.id)
            .map(({ dept, id_massif, label }) => ({ cle: cleMassif(dept, id_massif), label, dept, id_massif })),
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
            db.prepare('INSERT INTO camps (id, titre, debut, fin) VALUES (?, ?, ?, ?)')
                .run(camp.id, camp.titre, camp.debut, camp.fin);
        }
        db.prepare('DELETE FROM camp_massifs WHERE camp_id = ?').run(camp.id);
        camp.zones.forEach((zone, i) => {
            db.prepare('INSERT OR IGNORE INTO camp_massifs (camp_id, dept, id_massif, label, position) VALUES (?, ?, ?, ?, ?)')
                .run(camp.id, zone.dept, zone.id_massif, zone.label, i);
        });
        db.prepare('DELETE FROM membres WHERE camp_id = ?').run(camp.id);
        for (const m of camp.membres ?? []) {
            db.prepare('INSERT INTO membres (camp_id, role, nom, email, identifiant, jusqu_au) VALUES (?, ?, ?, ?, ?, ?)')
                .run(camp.id, m.role, m.nom ?? '', m.email ?? null, m.identifiant ?? null,
                    m.role === 'participant' ? finAbonnement(m.jusqu_au) : null);
        }
    });
}

export function deleteCamp(id) {
    return db.prepare('DELETE FROM camps WHERE id = ?').run(id).changes > 0;
}

// Premier lancement : camps de seed/camps.json
export function seedCamps(campsJsonPath) {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM camps').get();
    if (n > 0 || !existsSync(campsJsonPath)) return;
    const camps = JSON.parse(readFileSync(campsJsonPath, 'utf8'));
    for (const camp of camps) saveCamp({ debut: null, fin: null, ...camp });
    console.log(`📥 ${camps.length} camp(s) importé(s) depuis ${campsJsonPath}.`);
}

// --- Historique des niveaux ---

// Lignes { date, dept, id_massif, statut } → [{ date, '13-133': statut, … }] (format de /historique.json)
function parJour(lignes) {
    const jours = new Map();
    for (const l of lignes) {
        if (!jours.has(l.date)) jours.set(l.date, { date: l.date });
        jours.get(l.date)[cleMassif(l.dept, l.id_massif)] = l.statut;
    }
    return [...jours.values()];
}

export const releves = {
    vide: () => !db.prepare('SELECT 1 FROM releves LIMIT 1').get(),
    enregistrer: (date, dept, idMassif, statut) => db.prepare(`
        INSERT INTO releves (date, dept, id_massif, statut) VALUES (?, ?, ?, ?)
        ON CONFLICT (date, dept, id_massif) DO UPDATE SET statut = excluded.statut`).run(date, dept, idMassif, statut),
    // Niveaux d'un jour : { date, '13-133': statut, … }
    jour: date => parJour(db.prepare('SELECT * FROM releves WHERE date = ?').all(date))[0] ?? { date },
    // Jours entre du et au (inclus), dans l'ordre
    periode: (du = '0000-00-00', au = '9999-99-99') => parJour(db.prepare(
        'SELECT * FROM releves WHERE date BETWEEN ? AND ? ORDER BY date').all(du, au)),
    // Années pour lesquelles l'un de ces massifs a un historique
    annees: zones => db.prepare(`
        SELECT DISTINCT substr(r.date, 1, 4) AS annee
        FROM releves r JOIN json_each(?) z ON r.dept = z.value ->> 'dept' AND r.id_massif = z.value ->> 'id_massif'
        ORDER BY annee DESC`).all(JSON.stringify(zones)).map(r => r.annee)
};

// Reprise d'un historique.json ([{ date, clé: statut }]) dans la base. Une valeur déjà en base est gardée.
// Les clés sont « département-massif », ou une ancienne clé de la table zones.
export function importerHistorique(fichier) {
    if (!existsSync(fichier)) return;
    let lignes = 0;
    const ignorees = new Set();
    transaction(() => {
        for (const jour of JSON.parse(readFileSync(fichier, 'utf8'))) {
            for (const [cle, statut] of Object.entries(jour)) {
                if (cle === 'date' || statut == null || statut === 'unknown') continue;
                const massif = anciennesCles.get(cle) ?? cle;
                const m = massif.match(/^(\w+)-(\w+)$/);
                if (!m) { ignorees.add(cle); continue; }
                lignes += db.prepare('INSERT OR IGNORE INTO releves (date, dept, id_massif, statut) VALUES (?, ?, ?, ?)')
                    .run(jour.date, m[1], m[2], String(statut)).changes;
            }
        }
    });
    console.log(`📥 Historique repris de ${fichier} : ${lignes} niveau(x).${ignorees.size ? ` Clés inconnues ignorées : ${[...ignorees].join(', ')}.` : ''}`);
    return lignes;
}

// --- Comptes et sessions ---

// Un membre correspond à un compte par son identifiant Intranet ou son e-mail
const EST_LUI = '(m.identifiant = $identifiant OR (m.email IS NOT NULL AND m.email = $email))';

export const users = {
    list: () => db.prepare('SELECT identifiant, email, nom, responsable, derniere_connexion FROM users ORDER BY nom, identifiant').all(),
    // À chaque connexion : crée ou met à jour le compte avec les informations de l'Intranet, puis
    // complète les membres qui lui correspondent (e-mail ajouté par l'admin → identifiant, et inversement)
    // responsable null (API Intranet indisponible) : on garde le rôle connu
    connexion: ({ identifiant, email, nom, responsable }) => transaction(() => {
        const { id } = db.prepare(`
            INSERT INTO users (identifiant, email, nom, responsable) VALUES ($identifiant, $email, $nom, COALESCE($responsable, 0))
            ON CONFLICT (identifiant) DO UPDATE SET
                email = excluded.email, nom = excluded.nom, derniere_connexion = datetime('now'),
                responsable = COALESCE($responsable, users.responsable)
            RETURNING id`).get({ $identifiant: identifiant, $email: email, $nom: nom, $responsable: responsable === null ? null : Number(responsable) });
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

const lui = user => ({ $identifiant: user.identifiant, $email: user.email ?? null });

export const membres = {
    // Camps de l'utilisateur : [{ id, role: 'admin' | 'participant', jusqu_au }]
    miens: user => db.prepare(`
        SELECT m.camp_id AS id, CASE WHEN MAX(m.role = 'admin') THEN 'admin' ELSE 'participant' END AS role,
               CASE WHEN MAX(m.role = 'admin') THEN NULL ELSE MAX(m.jusqu_au) END AS jusqu_au
        FROM membres m WHERE ${EST_LUI} GROUP BY m.camp_id`).all(lui(user)),
    // { campId: 'admin' | 'participant' }
    roles: user => Object.fromEntries(membres.miens(user).map(c => [c.id, c.role])),
    // Abonnement de l'utilisateur comme participant (ou nouvelle date de fin s'il l'est déjà)
    abonner: (campId, user, jusquAu) => transaction(() => {
        const fin = finAbonnement(jusquAu);
        const { changes } = db.prepare(`UPDATE membres AS m SET jusqu_au = $fin
            WHERE m.camp_id = $camp AND m.role = 'participant' AND ${EST_LUI}`)
            .run({ ...lui(user), $camp: campId, $fin: fin });
        if (!changes) {
            db.prepare(`INSERT INTO membres (camp_id, role, nom, email, identifiant, jusqu_au)
                        VALUES (?, 'participant', ?, ?, ?, ?)`)
                .run(campId, user.nom ?? '', user.email ?? null, user.identifiant, fin);
        }
        return fin;
    }),
    quitter: (campId, user) => db.prepare(`DELETE FROM membres AS m WHERE m.camp_id = $camp AND ${EST_LUI}`)
        .run({ ...lui(user), $camp: campId }).changes > 0,
    nbAdmins: campId => db.prepare("SELECT COUNT(*) AS n FROM membres WHERE camp_id = ? AND role = 'admin'").get(campId).n
};

export const sessions = {
    create: (tokenHash, userId, expiresAt) =>
        db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, userId, expiresAt),
    user: tokenHash => db.prepare(`
        SELECT u.id, u.identifiant, u.email, u.nom, u.responsable FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?`).get(tokenHash, Date.now()),
    delete: tokenHash => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash),
    purge: () => db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
};

// --- Durées de conservation (annoncées sur la page « Données personnelles ») ---

export function purgerAnciennesDonnees() {
    const envoisSupprimes = db.prepare("DELETE FROM envois WHERE sent_at < datetime('now', '-1 year')").run().changes;
    const comptesSupprimes = db.prepare("DELETE FROM users WHERE derniere_connexion < datetime('now', '-3 years')").run().changes;
    // Participants arrivés au bout de leur abonnement (au plus tard à la fin de l'été)
    const participantsRetires = db.prepare("DELETE FROM membres WHERE role = 'participant' AND jusqu_au < ?")
        .run(getParisDate(0)).changes;
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    if (envoisSupprimes || comptesSupprimes || participantsRetires) {
        console.log(`🧹 Purge : ${envoisSupprimes} mail(s) du journal, ${comptesSupprimes} compte(s) inactif(s), ${participantsRetires} participant(s) en fin d'abonnement.`);
    }
}

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
