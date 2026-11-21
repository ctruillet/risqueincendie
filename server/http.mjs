// Outils HTTP : réponses (gzip, ETag, en-têtes de sécurité), lecture du JSON, contrôles
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { COOKIE_SECURE } from './config.mjs';

export class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

export const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8'
};

const COMPRESSIBLE = /^(text\/|application\/json|image\/svg)/;

// Versions compressées déjà calculées, par empreinte (fichiers du site, réponses identiques)
const compresses = new Map();
function compresser(etag, buffer) {
    let gz = compresses.get(etag);
    if (!gz) {
        gz = gzipSync(buffer);
        if (compresses.size >= 300) compresses.delete(compresses.keys().next().value);
        compresses.set(etag, gz);
    }
    return gz;
}

export function envoyerContenu(req, res, status, contenu, type, entetes = {}) {
    const buffer = Buffer.isBuffer(contenu) ? contenu : Buffer.from(contenu);
    const etag = `"${createHash('sha1').update(buffer).digest('base64url')}"`;
    const base = {
        'Content-Type': type,
        'Cache-Control': 'no-cache',
        'ETag': etag,
        'Vary': 'Accept-Encoding',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
        'X-Frame-Options': 'DENY',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-origin',
        // HTTPS obligatoire pour ce domaine (sauf en développement, en http)
        ...(COOKIE_SECURE && { 'Strict-Transport-Security': 'max-age=31536000' }),
        ...entetes
    };
    if (status === 200 && req.headers['if-none-match'] === etag) {
        res.writeHead(304, base);
        return res.end();
    }
    const corps = req.method === 'HEAD' ? undefined : buffer;
    if (buffer.length > 1024 && COMPRESSIBLE.test(type) && /gzip/.test(req.headers['accept-encoding'] ?? '')) {
        res.writeHead(status, { ...base, 'Content-Encoding': 'gzip' });
        return res.end(corps && compresser(etag, corps));
    }
    res.writeHead(status, { ...base, 'Content-Length': buffer.length });
    res.end(corps);
}

export function json(req, res, status, data, entetes = {}) {
    envoyerContenu(req, res, status, JSON.stringify(data), TYPES['.json'], { 'Cache-Control': 'no-store', ...entetes });
}

export async function lireJson(req) {
    if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'JSON attendu');
    let taille = 0;
    const morceaux = [];
    for await (const m of req) {
        taille += m.length;
        if (taille > 200_000) throw new HttpError(413, 'Requête trop grosse');
        morceaux.push(m);
    }
    try {
        return JSON.parse(Buffer.concat(morceaux).toString('utf8') || '{}');
    } catch {
        throw new HttpError(400, 'JSON invalide');
    }
}

// Le site n'est joignable que par le reverse proxy : on lui fait confiance pour l'IP
export const ipClient = req =>
    req.headers['x-real-ip'] ?? req.headers['x-forwarded-for']?.split(',')[0].trim() ?? req.socket.remoteAddress;

// Protection CSRF : en plus du cookie SameSite=Strict, une requête venant d'un autre site est refusée
export function verifierOrigine(req) {
    const origin = req.headers.origin;
    if (!origin) return;
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.headers.host) throw new HttpError(403, 'Origine refusée');
}
