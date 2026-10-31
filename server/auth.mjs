// Mots de passe (scrypt), sessions par cookie et limitation des tentatives de connexion
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { users, sessions } from './db.mjs';
import { COOKIE_SECURE } from './config.mjs';

const SESSION_DAYS = 30;
const COOKIE_NAME = 'ne_session';
export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password) {
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 64);
    return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
    const [, salt, hash] = stored.split('$');
    const attendu = Buffer.from(hash, 'base64');
    const calcule = scryptSync(password, Buffer.from(salt, 'base64'), attendu.length);
    return timingSafeEqual(attendu, calcule);
}

// Hash factice : une connexion avec un email inconnu prend le même temps
const HASH_FACTICE = hashPassword(randomBytes(16).toString('hex'));

export function randomPassword() {
    return randomBytes(12).toString('base64url');
}

const sha256 = value => createHash('sha256').update(value).digest('hex');

function parseCookies(header = '') {
    return Object.fromEntries(header.split(';').map(p => p.trim().split('=')).filter(([k]) => k)
        .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

function cookie(value, maxAge) {
    return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${COOKIE_SECURE ? '; Secure' : ''}`;
}

// Retourne { cookie } si les identifiants sont bons, sinon null
export function login(email, password) {
    const user = users.byEmail(String(email ?? '').trim());
    const ok = verifyPassword(String(password ?? ''), user?.password_hash ?? HASH_FACTICE);
    if (!user || !ok) return null;
    const token = randomBytes(32).toString('base64url');
    sessions.create(sha256(token), user.id, Date.now() + SESSION_DAYS * 86400_000);
    sessions.purge();
    return { cookie: cookie(token, SESSION_DAYS * 86400) };
}

export function logout(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (token) sessions.delete(sha256(token));
    return cookie('', 0);
}

export function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    return token ? sessions.user(sha256(token)) ?? null : null;
}

export function checkPassword(userId, password) {
    const user = users.byEmail(users.byId(userId)?.email ?? '');
    return !!user && verifyPassword(String(password ?? ''), user.password_hash);
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
