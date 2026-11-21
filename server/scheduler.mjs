// Relevé périodique des prévisions du lendemain, suivi des mails aux membres des camps
import { listCamps } from './db.mjs';
import { updateHistory, getParisDate, getParisHour } from './history.mjs';
import { notifierCamps, campActifLe } from './notify.mjs';
import { UPDATE_INTERVAL_MINUTES, SEASON_START, SEASON_END, START_HOUR } from './config.mjs';

// Affiché dans l'admin
export const etat = { dernierPassage: null, dernierResultat: null, enCours: false };

// Chaque massif n'est relevé qu'une fois, même s'il sert à plusieurs camps
const zonesSuivies = camps => [...new Map(camps.flatMap(c => c.zones).map(z => [z.cle, z])).values()];

// Relève les prévisions pendant la saison et pendant les camps, à partir de START_HOUR.
// `force` ignore ces conditions (bouton « Vérifier maintenant » de l'admin).
export async function passage({ force = false } = {}) {
    if (etat.enCours) return;
    etat.enCours = true;
    try {
        const camps = listCamps({ avecMembres: true });
        const demain = getParisDate(1);
        const jourMois = demain.slice(5);
        const enSaison = (jourMois >= SEASON_START && jourMois <= SEASON_END)
            || camps.some(c => campActifLe(c, demain));
        if (!force && (!enSaison || getParisHour() < START_HOUR)) {
            etat.dernierResultat = enSaison ? `Avant ${START_HOUR}h, rien à faire` : 'Hors saison, rien à faire';
            return;
        }
        const entry = await updateHistory(zonesSuivies(camps));
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
}
