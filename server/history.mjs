// Récupération des niveaux de risque du lendemain et mise à jour de historique.json
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { HISTORY_PATH, regles } from './config.mjs';

const API_URL = 'https://www.risque-prevention-incendie.fr/static';

// Date du jour (+ offset en jours) au format AAAA-MM-JJ, à l'heure de Paris
export function getParisDate(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
}

export function getParisHour() {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Paris' }).formatToParts(new Date());
    return Number(parts.find(p => p.type === 'hour').value);
}

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

export function readHistory() {
    return existsSync(HISTORY_PATH) ? JSON.parse(readFileSync(HISTORY_PATH, 'utf8')) : [];
}

// Écriture atomique : le site ne lit jamais un fichier à moitié écrit
function writeHistory(history) {
    const tmp = `${HISTORY_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(history, null, 2));
    renameSync(tmp, HISTORY_PATH);
}

// Récupère les niveaux du lendemain pour les zones données et met à jour l'historique.
// Une valeur absente du site garde la valeur déjà enregistrée.
// Retourne l'entrée du lendemain (date + niveau par clé de zone).
export async function updateHistory(zones) {
    const dateKey = getParisDate(1);
    const dateStr = dateKey.replaceAll('-', '');
    const history = readHistory();
    const existant = history.find(item => item.date === dateKey);

    const depts = [...new Set(zones.map(z => z.dept))];
    const dataByDept = Object.fromEntries(
        await Promise.all(depts.map(async dept => [dept, await fetchDept(dept, dateStr)]))
    );

    const entry = { ...existant, date: dateKey };
    const manquants = [];
    const changements = [];
    for (const zone of zones) {
        const ancien = existant?.[zone.cle] ?? 'unknown';
        const nouveau = extractStatus(dataByDept[zone.dept], zone.id_massif, regles[zone.dept]);
        if (nouveau === null) manquants.push(zone.cle);
        entry[zone.cle] = nouveau ?? ancien;
        if (entry[zone.cle] !== ancien) changements.push(`${zone.cle} ${ancien} → ${entry[zone.cle]}`);
    }

    if (manquants.length > 0) {
        console.log(`⏳ Pas encore publié pour le ${dateKey} : ${manquants.join(', ')}.`);
    }
    if (changements.length === 0) {
        console.log(`✅ Aucun changement pour le ${dateKey}.`);
        return entry;
    }

    const nouvelHistorique = history.filter(item => item.date !== dateKey);
    nouvelHistorique.push(entry);
    nouvelHistorique.sort((a, b) => a.date.localeCompare(b.date));
    writeHistory(nouvelHistorique);
    console.log(`✅ Historique mis à jour pour le ${dateKey} : ${changements.join(', ')}`);
    return entry;
}
