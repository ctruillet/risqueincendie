// Connexion par l'Intranet, sessions par cookie, rôles et limitation des tentatives de connexion
import { randomBytes, createHash } from 'node:crypto';
import { users, sessions } from './db.mjs';
import { COOKIE_SECURE, SUPER_ADMINS } from './config.mjs';
import { verifierIntranet } from './intranet.mjs';

const SESSION_DAYS = 30;
const COOKIE_NAME = 'ne_session';

const sha256 = value => createHash('sha256').update(value).digest('hex');

function parseCookies(header = '') {
    return Object.fromEntries(header.split(';').map(p => p.trim().split('=')).filter(([k]) => k)
        .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

function cookie(value, maxAge) {
    return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${COOKIE_SECURE ? '; Secure' : ''}`;
}

// Responsable du site : son identifiant Intranet ou son e-mail est dans SUPER_ADMINS
export const estSuperAdmin = user => Boolean(user)
    && (SUPER_ADMINS.has(user.identifiant.toLowerCase()) || (Boolean(user.email) && SUPER_ADMINS.has(user.email.toLowerCase())));

// Retourne { cookie } si l'Intranet accepte les identifiants, sinon null
export async function login(identifiant, motDePasse) {
    const id = String(identifiant ?? '').trim();
    const mdp = String(motDePasse ?? '');
    if (!id || !mdp || id.length > 100 || mdp.length > 200) return null;
    const profil = await verifierIntranet(id, mdp);
    if (!profil) return null;
    // Crée ou met à jour le compte, et le relie aux camps où il a été ajouté (par e-mail ou identifiant)
    const userId = users.connexion(profil);
    const token = randomBytes(32).toString('base64url');
    sessions.create(sha256(token), userId, Date.now() + SESSION_DAYS * 86400_000);
    sessions.purge();
    console.log(`🔑 Connexion de ${profil.identifiant}`);
    return { cookie: cookie(token, SESSION_DAYS * 86400) };
}

export function logout(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (token) sessions.delete(sha256(token));
    return cookie('', 0);
}

export function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    const user = token ? sessions.user(sha256(token)) : null;
    return user ? { ...user, superAdmin: estSuperAdmin(user) } : null;
}

// 10 tentatives ratées par adresse IP et par quart d'heure
const MAX_ECHECS = 10;
const FENETRE_MS = 15 * 60_000;
const echecs = new Map();

export function tropDeTentatives(ip) {
    const e = echecs.get(ip);
    if (!e || e.debut + FENETRE_MS < Date.now()) return false;
    return e.n >= MAX_ECHECS;
}

export function noterEchec(ip) {
    const e = echecs.get(ip);
    if (!e || e.debut + FENETRE_MS < Date.now()) echecs.set(ip, { debut: Date.now(), n: 1 });
    else e.n++;
    if (echecs.size > 10_000) echecs.clear();
}
