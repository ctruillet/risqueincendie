// API du site : /api/…
// Trois niveaux d'accès, après connexion avec les identifiants Intranet :
//   responsable du site (structure STRUCTURE_RESPONSABLE) : tout, y compris créer et supprimer les camps
//   admin d'un camp                    : modifie ce camp (dates, massifs, membres) et envoie ses mails
//   participant d'un camp              : voit ce camp mis en avant sur l'accueil et peut s'en retirer
import { listCamps, getCamp, saveCamp, deleteCamp, membres, envois } from './db.mjs';
import { login, logout, currentUser, tropDeTentatives, noterEchec } from './auth.mjs';
import { readHistory, getParisDate } from './history.mjs';
import { envoyerCamp, envoyerTest, smtpConfigure } from './notify.mjs';
import { passage, etat } from './scheduler.mjs';
import { HttpError, json, lireJson, ipClient } from './http.mjs';
import { validerCamp, slug } from './validation.mjs';
import { UPDATE_INTERVAL_MINUTES, SEASON_START, SEASON_END, START_HOUR } from './config.mjs';

// --- Droits ---

// Rôle de l'utilisateur dans chaque camp : { campId: 'admin' | 'participant' }
const rolesDe = user => membres.roles(user);

const campsAdmin = user => user.superAdmin
    ? listCamps({ avecMembres: true })
    : listCamps({ avecMembres: true }).filter(c => rolesDe(user)[c.id] === 'admin');

function exigerSuperAdmin(user) {
    if (!user.superAdmin) throw new HttpError(403, 'Réservé au responsable du site');
}

function exigerAdmin(user, camp) {
    if (!user.superAdmin && rolesDe(user)[camp.id] !== 'admin') {
        throw new HttpError(403, "Vous n'êtes pas admin de ce camp");
    }
}

// Admin d'au moins un camp (accès à la page d'administration)
function exigerUnCamp(user) {
    if (!user.superAdmin && !Object.values(rolesDe(user)).includes('admin')) {
        throw new HttpError(403, "Vous n'êtes admin d'aucun camp");
    }
}

const ADMIN_REQUIS = 'Le camp doit garder au moins un admin : nommez-en un autre avant';

// --- Routes sans connexion ---

async function routeLogin(req, res) {
    const ip = ipClient(req);
    if (tropDeTentatives(ip)) throw new HttpError(429, 'Trop de tentatives, réessayer dans 15 minutes');
    const body = await lireJson(req);
    const session = await login(body.identifiant, body.password);
    if (!session) {
        noterEchec(ip);
        throw new HttpError(401, 'Identifiant ou mot de passe incorrect');
    }
    json(req, res, 200, { ok: true }, { 'Set-Cookie': session.cookie });
}

const profil = user => user && {
    identifiant: user.identifiant,
    nom: user.nom,
    email: user.email,
    superAdmin: user.superAdmin,
    admin: user.superAdmin || Object.values(rolesDe(user)).includes('admin')
};

// --- Mes camps (tout utilisateur connecté) ---

async function routeMesCamps(req, res, user, id) {
    const roles = rolesDe(user);
    if (req.method === 'GET' && !id) {
        const camps = listCamps({ avecMembres: true }).filter(c => roles[c.id]).map(({ membres: liste, ...camp }) => ({
            ...camp,
            role: roles[camp.id],
            // Les coordonnées des autres membres ne sont montrées qu'aux admins du camp
            ...(roles[camp.id] === 'admin' && { membres: liste })
        }));
        return json(req, res, 200, camps);
    }
    // Se retirer d'un camp
    if (req.method === 'DELETE' && id) {
        if (!roles[id]) throw new HttpError(404, "Vous n'êtes pas membre de ce camp");
        if (roles[id] === 'admin' && membres.nbAdmins(id) <= 1) {
            throw new HttpError(400, `${ADMIN_REQUIS} de vous retirer.`);
        }
        membres.quitter(id, user);
        console.log(`👋 ${user.identifiant} s'est retiré du camp ${id}`);
        return json(req, res, 200, { ok: true });
    }
    throw new HttpError(404, 'Introuvable');
}

// --- Camps (admins) ---

async function routeCamps(req, res, user, id, action) {
    const m = req.method;
    if (m === 'GET' && !id) {
        exigerUnCamp(user);
        return json(req, res, 200, campsAdmin(user));
    }
    if (m === 'POST' && !id) {
        exigerSuperAdmin(user);
        const camp = validerCamp(await lireJson(req));
        camp.id = slug(camp.titre);
        saveCamp(camp);
        return json(req, res, 201, getCamp(camp.id));
    }

    const camp = getCamp(id);
    if (!camp) throw new HttpError(404, 'Camp introuvable');
    exigerAdmin(user, camp);

    if (m === 'PUT' && !action) {
        const modifie = validerCamp(await lireJson(req));
        if (!user.superAdmin && !modifie.membres.some(x => x.role === 'admin')) {
            throw new HttpError(400, `${ADMIN_REQUIS} d'enregistrer.`);
        }
        saveCamp({ ...modifie, id });
        return json(req, res, 200, getCamp(id));
    }
    if (m === 'DELETE' && !action) {
        exigerSuperAdmin(user);
        deleteCamp(id);
        return json(req, res, 200, { ok: true });
    }
    // Envoi immédiat de la prévision du lendemain aux membres
    if (m === 'POST' && action === 'envoyer') {
        const date = getParisDate(1);
        const entry = readHistory().find(e => e.date === date) ?? { date };
        const resultat = await envoyerCamp(camp, date, entry);
        if (!resultat.ok) throw new HttpError(502, resultat.erreur);
        return json(req, res, 200, { ok: true, erreur: resultat.erreur });
    }
    throw new HttpError(404, 'Introuvable');
}

// --- Aiguillage ---

export async function api(req, res, chemin) {
    const m = req.method;
    const [ressource, id, action] = chemin.split('/').filter(Boolean).slice(1).map(decodeURIComponent);

    if (m === 'POST' && ressource === 'login') return routeLogin(req, res);
    if (m === 'POST' && ressource === 'logout') return json(req, res, 200, { ok: true }, { 'Set-Cookie': logout(req) });
    if (m === 'GET' && ressource === 'me') return json(req, res, 200, { user: profil(currentUser(req)) });

    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Connexion requise');

    if (ressource === 'mes-camps') return routeMesCamps(req, res, user, id);
    if (ressource === 'camps') return routeCamps(req, res, user, id, action);

    switch (`${m} ${ressource}`) {
        case 'GET status':
            exigerSuperAdmin(user);
            return json(req, res, 200, {
                smtp: smtpConfigure, ...etat, demain: getParisDate(1),
                intervalle: UPDATE_INTERVAL_MINUTES, saison: [SEASON_START, SEASON_END], heureDebut: START_HOUR
            });
        case 'GET envois':
            exigerUnCamp(user);
            return json(req, res, 200, envois.recents(50, user.superAdmin ? null : campsAdmin(user).map(c => c.id)));
        case 'POST passage':
            exigerSuperAdmin(user);
            await passage({ force: true });
            return json(req, res, 200, etat);
        case 'POST test-mail':
            exigerSuperAdmin(user);
            if (!user.email) throw new HttpError(400, "Votre compte Intranet n'a pas d'e-mail");
            try {
                await envoyerTest(user.email);
            } catch (e) {
                throw new HttpError(502, e.message);
            }
            return json(req, res, 200, { ok: true, to: user.email });
    }
    throw new HttpError(404, 'Introuvable');
}
