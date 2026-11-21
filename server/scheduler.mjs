// Relevé périodique des prévisions du lendemain, suivi des mails aux membres des camps
import { listCamps, purgerAnciennesDonnees } from './db.mjs';
import { updateHistory, rattraper } from './history.mjs';
import { getParisDate, getParisHour } from './dates.mjs';
import { notifierCamps, campActifLe } from './notify.mjs';
import { UPDATE_INTERVAL_MINUTES, SEASON_START, SEASON_END, START_HOUR } from './config.mjs';

// Affiché dans l'admin
export const etat = { dernierPassage: null, dernierResultat: null, enCours: false };

// Chaque massif n'est relevé qu'une fois, même s'il sert à plusieurs camps
const zonesSuivies = camps => [...new Map(camps.flatMap(c => c.zones).map(z => [z.cle, z])).values()];

const enSaison = date => date.slice(5) >= SEASON_START && date.slice(5) <= SEASON_END;

// Massifs à relever pour une date : tous pendant la saison, sinon ceux des camps en cours
const massifsDuJour = camps => date =>
    zonesSuivies(enSaison(date) ? camps : camps.filter(c => campActifLe(c, date)));

// Jours manquants des 7 derniers jours (serveur arrêté, préfecture en retard…)
async function rattrapage() {
    try {
        await rattraper(massifsDuJour(listCamps()));
    } catch (e) {
        console.error('❌ Rattrapage en erreur :', e);
    }
}

// Relève les prévisions pendant la saison et pendant les camps, à partir de START_HOUR.
// `force` ignore ces conditions (bouton « Vérifier maintenant » de l'admin).
export async function passage({ force = false } = {}) {
    if (etat.enCours) return;
    etat.enCours = true;
    try {
        const camps = listCamps({ avecMembres: true });
        const demain = getParisDate(1);
        const zones = massifsDuJour(camps)(demain);
        if (!force && (zones.length === 0 || getParisHour() < START_HOUR)) {
            etat.dernierResultat = zones.length ? `Avant ${START_HOUR}h, rien à faire` : 'Hors saison, rien à faire';
            return;
        }
        // Forcé hors saison : tous les massifs des camps
        const entry = await updateHistory(zones.length ? zones : zonesSuivies(camps));
        await notifierCamps(camps, entry);
        etat.dernierResultat = `Prévisions du ${demain} vérifiées`;
    } catch (e) {
        console.error('❌ Passage en erreur :', e);
        etat.dernierResultat = `Erreur : ${e.message}`;
    } finally {
        etat.dernierPassage = new Date().toISOString();
        etat.enCours = false;
    }
}

export function demarrerPlanificateur() {
    setTimeout(passage, 5_000);
    setInterval(passage, UPDATE_INTERVAL_MINUTES * 60_000);
    // Jours manquants et données trop anciennes : au démarrage puis une fois par jour
    setTimeout(rattrapage, 30_000);
    purgerAnciennesDonnees();
    setInterval(() => { purgerAnciennesDonnees(); rattrapage(); }, 24 * 3600_000);
}
