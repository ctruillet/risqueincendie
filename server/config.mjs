// Configuration : toutes les variables d'environnement sont lues ici (voir .env.example)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = fileURLToPath(new URL('..', import.meta.url));
const env = process.env;

export const PORT = Number(env.PORT ?? 3000);
export const PUBLIC_DIR = env.PUBLIC_DIR ?? join(racine, 'public');
export const SEED_DIR = env.SEED_DIR ?? join(racine, 'seed');
export const DATA_DIR = env.DATA_DIR ?? join(racine, 'data');
export const HISTORY_PATH = join(DATA_DIR, 'historique.json');

// Relevé des prévisions
export const UPDATE_INTERVAL_MINUTES = Number(env.UPDATE_INTERVAL_MINUTES ?? 15);
export const [SEASON_START, SEASON_END] = (env.SEASON ?? '06-01:09-30').split(':');
export const START_HOUR = Number(env.START_HOUR ?? 17);

// Mails
export const PUBLIC_URL = (env.PUBLIC_URL ?? '').replace(/\/$/, '');
export const NOTIFY_DEADLINE_HOUR = Number(env.NOTIFY_DEADLINE_HOUR ?? 21);
export const SMTP = {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT ?? 587),
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM,
    // STARTTLS exigé sauf pour un serveur de test local (SMTP_STARTTLS=0)
    starttls: env.SMTP_STARTTLS !== '0'
};

// Le cookie de session n'est envoyé qu'en HTTPS, sauf COOKIE_SECURE=0 (développement en http)
export const COOKIE_SECURE = env.COOKIE_SECURE !== '0';

// Référentiels partagés avec le site : niveaux par département et liste des massifs
const lireJson = fichier => JSON.parse(readFileSync(join(PUBLIC_DIR, fichier), 'utf8'));
export const regles = lireJson('regles.json');
export const massifs = lireJson('massifs.json');
