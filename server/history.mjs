// Récupération des niveaux publiés par les préfectures et enregistrement dans l'historique (base)
import { regles } from './config.mjs';
import { releves } from './db.mjs';
import { getParisDate } from './dates.mjs';

const API_URL = 'https://www.risque-prevention-incendie.fr/static';

// Statut d'un massif = clé de regles.json. La valeur publiée est [niveau, procédure] ou le niveau seul.
// En général le statut est le niveau, mais certains départements ont des cas particuliers,
// essayés dans cet ordre : « idMassif:niveau », « niveauPprocédure », « *pProcédure ».
// (même logique dans public/js/app.js)
function extractStatus(data, idMassif, reglesDept = {}) {
    const value = data?.massifs?.[idMassif];
    if (value == null) return null;
    const [niveau, procedure = 0] = Array.isArray(value) ? value : [value];
    const cles = [`${idMassif}:${niveau}`, `${niveau}p${procedure}`, `*p${procedure}`];
    return cles.find(cle => cle in reglesDept) ?? String(niveau);
}

// Fichier de prévisions d'un département pour une date (AAAAMMJJ), ou null s'il n'est pas publié
export async function fetchDept(dept, dateStr) {
    try {
        const res = await fetch(`${API_URL}/${dept}/import_data/${dateStr}.json`, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e) {
        console.log(`⚠️ Fichier du département ${dept} indisponible (${e.message}).`);
        return null;
    }
}

// Niveaux d'une date pour les massifs donnés, enregistrés dans l'historique.
// Un massif non publié garde la valeur déjà enregistrée. Retourne { date, clé: statut, … }.
async function releverJour(date, zones) {
    const dateStr = date.replaceAll('-', '');
    const existant = releves.jour(date);
    const depts = [...new Set(zones.map(z => z.dept))];
    const dataByDept = Object.fromEntries(
        await Promise.all(depts.map(async dept => [dept, await fetchDept(dept, dateStr)]))
    );

    const manquants = [];
    const changements = [];
    for (const zone of zones) {
        const ancien = existant[zone.cle];
        const nouveau = extractStatus(dataByDept[zone.dept], zone.id_massif, regles[zone.dept]);
        if (nouveau === null) { manquants.push(zone.cle); continue; }
        if (nouveau === ancien) continue;
        releves.enregistrer(date, zone.dept, zone.id_massif, nouveau);
        changements.push(`${zone.cle} ${ancien ?? '?'} → ${nouveau}`);
    }
    if (manquants.length) console.log(`⏳ Pas encore publié pour le ${date} : ${manquants.join(', ')}.`);
    console.log(changements.length
        ? `✅ Historique du ${date} : ${changements.join(', ')}`
        : `✅ Aucun changement pour le ${date}.`);
    return releves.jour(date);
}

// Niveaux du lendemain (relevé du soir)
export const updateHistory = zones => releverJour(getParisDate(1), zones);

// Rattrapage : jours des 7 derniers jours (et aujourd'hui) sans niveau enregistré pour un massif suivi,
// par exemple si le serveur était arrêté le soir. Les préfectures gardent leurs fichiers en ligne.
// suivi(date) : massifs à relever ce jour-là (saison ou camp en cours)
export async function rattraper(suivi) {
    for (let i = -7; i <= 0; i++) {
        const date = getParisDate(i);
        const connus = releves.jour(date);
        const manquants = suivi(date).filter(z => !(z.cle in connus));
        if (manquants.length) await releverJour(date, manquants);
    }
}
