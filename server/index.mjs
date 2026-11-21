// Point d'entrée : initialise les données, lance le relevé périodique et sert le site
//   /                 → public/ (site et admin)
//   /camps.json       → camps depuis la base (sans dates ni membres)
//   /historique.json  → historique des niveaux (dans DATA_DIR)
//   /connexion        → connexion avec les identifiants Intranet
//   /<page>           → pages de contenu/site.yml (mentions légales, données personnelles…)
//   /api/…            → API (server/api.mjs)
import { createServer } from 'node:http';
import { readFileSync, existsSync, copyFileSync, statSync, readdirSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { PORT, PUBLIC_DIR, SEED_DIR, DATA_DIR, HISTORY_PATH, massifs, INTRANET, intranetConfigure } from './config.mjs';
import { listCamps, seedCamps } from './db.mjs';
import { api } from './api.mjs';
import { demarrerPlanificateur } from './scheduler.mjs';
import { HttpError, TYPES, envoyerContenu, json, verifierOrigine } from './http.mjs';
import { getParisDate, fetchDept } from './history.mjs';
import { piedDePage, page } from './contenu.mjs';

// --- Premier lancement : import des données de seed/ ---

if (!existsSync(HISTORY_PATH) && existsSync(join(SEED_DIR, 'historique.json'))) {
    copyFileSync(join(SEED_DIR, 'historique.json'), HISTORY_PATH);
    console.log('📥 historique.json initialisé depuis seed/.');
}
seedCamps(join(SEED_DIR, 'camps.json'));
if (!intranetConfigure) console.log('⚠️ Connexion Intranet non configurée : renseigner INTRANET_URL, INTRANET_REALM et INTRANET_CLIENT_ID.');
if (!INTRANET.apiUrl) console.log("⚠️ API Intranet non configurée (INTRANET_API_URL) : personne ne sera reconnu comme responsable du site.");

// --- Fichiers du site ---

// Toutes les pages : rien d'autre que les fichiers du site (ni script ni style en ligne, ni site tiers)
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
    + "object-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'";
const ALIAS = { '/': 'index.html', '/admin': 'admin.html', '/connexion': 'connexion.html' };

// Empreinte d'un fichier du site, recalculée quand il change (mtime)
const empreintes = new Map();
function empreinte(relatif) {
    const fichier = join(PUBLIC_DIR, relatif);
    if (!existsSync(fichier)) return null;
    const mtime = statSync(fichier).mtimeMs;
    const connue = empreintes.get(relatif);
    if (connue?.mtime === mtime) return connue.v;
    const v = createHash('sha1').update(readFileSync(fichier)).digest('base64url').slice(0, 10);
    empreintes.set(relatif, { mtime, v });
    return v;
}

// Dans les pages, chaque fichier local (CSS, JS, images, manifeste) reçoit ?v=<empreinte> : quand il
// change, son adresse change, et aucun cache (navigateur, service worker, proxy) ne peut resservir
// l'ancienne version.
function versionnerLiens(html) {
    return html.replace(/(href|src)="((?![a-z]+:|\/|#)[^"?#]+\.(?:css|js|svg|png|json))"/g, (tout, attr, chemin) => {
        const v = empreinte(chemin);
        return v ? `${attr}="${chemin}?v=${v}"` : tout;
    });
}

// Polices affichées dès l'arrivée sur la page (texte courant, titres, nom du site) : préchargées
function prechargementPolices() {
    const dossier = join(PUBLIC_DIR, 'ui', 'polices');
    if (!existsSync(dossier)) return '';
    return readdirSync(dossier)
        .filter(f => /^(sarabun-latin-(400|700)|raleway-latin-700)-normal-.+\.woff2$/.test(f))
        .map(f => `<link rel="preload" href="ui/polices/${f}" as="font" type="font/woff2" crossorigin>`)
        .join('\n    ');
}

// Pied de page (contenu/site.yml) à la place de <!-- pied-de-page -->, liens versionnés, polices préchargées
function preparerPage(html) {
    return versionnerLiens(html.replace('<!-- pied-de-page -->', piedDePage()))
        .replace('<link rel="stylesheet"', `${prechargementPolices()}\n    <link rel="stylesheet"`);
}

function envoyerPage(req, res, html) {
    envoyerContenu(req, res, 200, preparerPage(html), TYPES['.html'], { 'Content-Security-Policy': CSP });
}

// Page de contenu/site.yml, dans le gabarit public/page.html
function pageContenu(req, res, contenu) {
    const gabarit = readFileSync(join(PUBLIC_DIR, 'page.html'), 'utf8');
    envoyerPage(req, res, gabarit
        .replaceAll('{{titre}}', contenu.titre)
        .replace('{{description}}', contenu.description)
        .replace('{{contenu}}', contenu.html));
}

function fichierPublic(req, res, chemin) {
    let relatif;
    try {
        relatif = ALIAS[chemin] ?? decodeURIComponent(chemin).slice(1);
    } catch {
        throw new HttpError(400, 'Adresse invalide');
    }
    const fichier = normalize(join(PUBLIC_DIR, relatif));
    // Jamais en dehors de public/, jamais de fichier caché
    if (!fichier.startsWith(PUBLIC_DIR + sep) || /(^|[\\/])\./.test(relatif)) throw new HttpError(404, 'Introuvable');
    const type = TYPES[extname(fichier)];
    // page.html n'est qu'un gabarit
    if (!type || relatif === 'page.html' || !existsSync(fichier) || !statSync(fichier).isFile()) throw new HttpError(404, 'Introuvable');
    if (extname(fichier) === '.html') return envoyerPage(req, res, readFileSync(fichier, 'utf8'));
    const entetes = {};
    // Adresse avec empreinte (?v=), morceaux JS et polices au nom unique : le contenu ne change jamais
    const versionne = new URL(req.url, 'http://localhost').searchParams.has('v');
    if (versionne || /^ui\/(communs|polices)\//.test(relatif)) entetes['Cache-Control'] = 'public, max-age=31536000, immutable';
    else if (relatif.startsWith('ui/icons/')) entetes['Cache-Control'] = 'public, max-age=604800';
    envoyerContenu(req, res, 200, readFileSync(fichier), type, entetes);
}

// --- Prévisions en direct ---
// Le navigateur ne peut pas lire le site des préfectures (pas d'autorisation CORS) : le serveur relaie
// les fichiers d'aujourd'hui et de demain des départements connus, gardés 10 minutes.
const previsionsCache = new Map();
async function previsionsEnDirect(req, res, dept, dateStr) {
    const dates = [getParisDate(0), getParisDate(1)].map(d => d.replaceAll('-', ''));
    if (!massifs[dept] || !dates.includes(dateStr)) throw new HttpError(404, 'Introuvable');
    const cle = `${dept}/${dateStr}`;
    let entree = previsionsCache.get(cle);
    if (!entree || entree.expire < Date.now()) {
        entree = { donnees: await fetchDept(dept, dateStr), expire: Date.now() + 10 * 60_000 };
        previsionsCache.set(cle, entree);
        for (const [k, v] of previsionsCache) if (v.expire < Date.now()) previsionsCache.delete(k);
    }
    // Pas encore publié : réponse vide (et non une erreur), le site garde l'historique
    json(req, res, 200, entree.donnees ?? {}, { 'Cache-Control': 'public, max-age=300' });
}

const ROBOTS = 'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /connexion\nDisallow: /api/\n';

// --- Serveur ---

async function router(req, res, chemin) {
    if (chemin.startsWith('/api/')) {
        if (req.method !== 'GET') verifierOrigine(req);
        return api(req, res, chemin);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée');

    switch (chemin) {
        case '/healthz':
            return json(req, res, 200, { ok: true });
        case '/robots.txt':
            return envoyerContenu(req, res, 200, ROBOTS, 'text/plain; charset=utf-8');
        case '/camps.json': {
            // Ni dates ni contacts : on ne publie pas où et quand se trouvent les groupes
            const aujourdhui = getParisDate(0);
            const camps = listCamps().map(({ id, titre, fin, zones }) => ({
                id, titre, zones, ...(fin && fin < aujourdhui && { termine: true })
            }));
            return json(req, res, 200, camps, { 'Cache-Control': 'no-cache' });
        }
        case '/historique.json':
            return envoyerContenu(req, res, 200, existsSync(HISTORY_PATH) ? readFileSync(HISTORY_PATH) : '[]', TYPES['.json']);
        default: {
            const direct = chemin.match(/^\/previsions\/(\d{1,3})\/(\d{8})\.json$/);
            if (direct) return previsionsEnDirect(req, res, direct[1], direct[2]);
            const contenu = page(chemin.slice(1));
            if (contenu) return pageContenu(req, res, contenu);
            return fichierPublic(req, res, chemin);
        }
    }
}

const server = createServer(async (req, res) => {
    const chemin = new URL(req.url, 'http://localhost').pathname;
    try {
        await router(req, res, chemin);
    } catch (e) {
        const status = e.status ?? 500;
        if (status === 500) console.error(`❌ ${req.method} ${chemin} :`, e);
        const message = status === 500 ? 'Erreur interne' : e.message;
        if (chemin.startsWith('/api/')) return json(req, res, status, { erreur: message });
        envoyerContenu(req, res, status, message, 'text/plain; charset=utf-8');
    }
});

server.listen(PORT, () => console.log(`🚀 Site sur le port ${PORT} (données : ${DATA_DIR})`));
demarrerPlanificateur();

for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
