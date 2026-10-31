// API de l'admin : /api/…
import { listCamps, getCamp, saveCamp, deleteCamp, reorderCamps, users, envois } from './db.mjs';
import { login, logout, currentUser, hashPassword, randomPassword, checkPassword,
    tropDeTentatives, noterEchec, MIN_PASSWORD_LENGTH } from './auth.mjs';
import { readHistory, getParisDate } from './history.mjs';
import { envoyerCamp, envoyerTest, smtpConfigure } from './notify.mjs';
import { passage, etat } from './scheduler.mjs';
import { HttpError, json, lireJson, ipClient } from './http.mjs';
import { validerCamp, slug, texte, EMAIL_RE } from './validation.mjs';
import { UPDATE_INTERVAL_MINUTES, SEASON_START, SEASON_END, START_HOUR } from './config.mjs';

// --- Routes sans connexion ---

async function routeLogin(req, res) {
    const ip = ipClient(req);
    if (tropDeTentatives(ip)) throw new HttpError(429, 'Trop de tentatives, réessayer dans 15 minutes');
    const body = await lireJson(req);
    const session = login(body.email, body.password);
    if (!session) {
        noterEchec(ip);
        throw new HttpError(401, 'Email ou mot de passe incorrect');
    }
    json(req, res, 200, { ok: true }, { 'Set-Cookie': session.cookie });
}

// --- Camps ---

async function routeCamps(req, res, id, action) {
    const m = req.method;
    if (m === 'GET' && !id) return json(req, res, 200, listCamps({ avecContacts: true }));
    if (m === 'POST' && id === 'ordre') {
        const { ids } = await lireJson(req);
        if (!Array.isArray(ids)) throw new HttpError(400, 'Liste attendue');
        reorderCamps(ids.map(String));
        return json(req, res, 200, { ok: true });
    }
    if (m === 'POST' && !id) {
        const camp = validerCamp(await lireJson(req));
        camp.id = slug(camp.titre);
        saveCamp(camp);
        return json(req, res, 201, getCamp(camp.id));
    }

    const camp = getCamp(id);
    if (!camp) throw new HttpError(404, 'Camp introuvable');
    if (m === 'PUT' && !action) {
        saveCamp({ ...validerCamp(await lireJson(req)), id });
        return json(req, res, 200, getCamp(id));
    }
    if (m === 'DELETE' && !action) {
        deleteCamp(id);
        return json(req, res, 200, { ok: true });
    }
    // Envoi immédiat de la prévision du lendemain aux contacts
    if (m === 'POST' && action === 'envoyer') {
        const date = getParisDate(1);
        const entry = readHistory().find(e => e.date === date) ?? { date };
        const resultat = await envoyerCamp(camp, date, entry);
        if (!resultat.ok) throw new HttpError(502, resultat.erreur);
        return json(req, res, 200, { ok: true, erreur: resultat.erreur });
    }
    throw new HttpError(404, 'Introuvable');
}

// --- Comptes ---

async function routeUsers(req, res, id, user) {
    if (req.method === 'GET') return json(req, res, 200, users.list());
    if (req.method === 'POST') {
        const body = await lireJson(req);
        const email = texte(body.email, "L'email", 254);
        if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email invalide');
        if (users.byEmail(email)) throw new HttpError(409, 'Ce compte existe déjà');
        const motDePasse = randomPassword();
        users.create(email, texte(body.nom, 'Le nom', 80, { requis: false }), hashPassword(motDePasse));
        return json(req, res, 201, { email, motDePasse });
    }
    if (req.method === 'DELETE' && id) {
        if (Number(id) === user.id) throw new HttpError(400, 'Impossible de supprimer son propre compte');
        if (!users.delete(Number(id))) throw new HttpError(404, 'Compte introuvable');
        return json(req, res, 200, { ok: true });
    }
    throw new HttpError(404, 'Introuvable');
}

async function routePassword(req, res, user) {
    const body = await lireJson(req);
    if (!checkPassword(user.id, body.actuel)) throw new HttpError(400, 'Mot de passe actuel incorrect');
    if (String(body.nouveau ?? '').length < MIN_PASSWORD_LENGTH) {
        throw new HttpError(400, `Le nouveau mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères`);
    }
    users.setPassword(user.id, hashPassword(String(body.nouveau)));
    // Les autres sessions sont fermées : on reconnecte celle-ci
    const session = login(user.email, String(body.nouveau));
    json(req, res, 200, { ok: true }, { 'Set-Cookie': session.cookie });
}

// --- Aiguillage ---

export async function api(req, res, chemin) {
    const m = req.method;
    const [ressource, id, action] = chemin.split('/').filter(Boolean).slice(1).map(decodeURIComponent);

    if (m === 'POST' && ressource === 'login') return routeLogin(req, res);
    if (m === 'POST' && ressource === 'logout') return json(req, res, 200, { ok: true }, { 'Set-Cookie': logout(req) });
    if (m === 'GET' && ressource === 'me') return json(req, res, 200, { user: currentUser(req) });

    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Connexion requise');

    switch (`${m} ${ressource}`) {
        case 'GET status':
            return json(req, res, 200, {
                smtp: smtpConfigure, ...etat, demain: getParisDate(1),
                intervalle: UPDATE_INTERVAL_MINUTES, saison: [SEASON_START, SEASON_END], heureDebut: START_HOUR
            });
        case 'GET envois':
            return json(req, res, 200, envois.recents(50));
        case 'POST passage':
            await passage({ force: true });
            return json(req, res, 200, etat);
        case 'POST test-mail':
            try {
                await envoyerTest(user.email);
            } catch (e) {
                throw new HttpError(502, e.message);
            }
            return json(req, res, 200, { ok: true, to: user.email });
        case 'POST password':
            return routePassword(req, res, user);
    }
    if (ressource === 'camps') return routeCamps(req, res, id, action);
    if (ressource === 'users') return routeUsers(req, res, id, user);
    throw new HttpError(404, 'Introuvable');
}
