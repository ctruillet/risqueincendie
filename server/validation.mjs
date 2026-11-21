// Contrôle des données envoyées par l'admin
import { HttpError } from './http.mjs';
import { listCamps } from './db.mjs';
import { regles, massifs } from './config.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export function texte(value, nom, max, { requis = true } = {}) {
    // Caractères de contrôle (retours à la ligne…) remplacés : rien ne peut s'insérer dans les en-têtes des mails
    const v = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (requis && !v) throw new HttpError(400, `${nom} est obligatoire`);
    if (v.length > max) throw new HttpError(400, `${nom} : ${max} caractères maximum`);
    return v;
}

// Identifiant d'un nouveau camp, tiré de son titre (sert dans l'adresse camp.html?camp=…)
export function slug(titre) {
    const base = titre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'camp';
    const pris = new Set(listCamps().map(c => c.id));
    let id = base;
    for (let i = 2; pris.has(id); i++) id = `${base}-${i}`;
    return id;
}

function validerZone(z) {
    const dept = String(z.dept ?? '');
    const idMassif = String(z.id_massif ?? '');
    const massif = massifs[dept]?.massifs.find(m => m.id === idMassif);
    if (!massif || !regles[dept]) throw new HttpError(400, `Massif inconnu (${dept} / ${idMassif})`);
    const label = texte(z.label, 'Le nom affiché du massif', 80, { requis: false }) || massif.nom;
    return { dept, id_massif: idMassif, label };
}

// Numéro d'adhérent SGDF : 9 chiffres
const NUMERO_RE = /^\d{9}$/;

function validerMembre(m) {
    const nom = texte(m.nom, 'Le nom du membre', 80, { requis: false });
    const qui = nom || 'un membre';
    const email = texte(m.email, `L'e-mail de ${qui}`, 254, { requis: false }) || null;
    const identifiant = texte(m.identifiant, `Le numéro d'adhérent de ${qui}`, 60, { requis: false }) || null;
    if (!email && !identifiant) throw new HttpError(400, `Indiquer l'e-mail ou le numéro d'adhérent de ${qui}`);
    if (email && !EMAIL_RE.test(email)) throw new HttpError(400, `E-mail invalide : ${email}`);
    if (identifiant && !NUMERO_RE.test(identifiant)) throw new HttpError(400, `Numéro d'adhérent invalide (9 chiffres) : ${identifiant}`);
    const jusquAu = m.jusqu_au && /^\d{4}-\d{2}-\d{2}$/.test(m.jusqu_au) ? m.jusqu_au : null;
    return { nom, email, identifiant, role: m.role === 'admin' ? 'admin' : 'participant', jusqu_au: jusquAu };
}

const doublon = valeurs => {
    const vues = valeurs.filter(Boolean).map(v => v.toLowerCase());
    return new Set(vues).size !== vues.length;
};

// Fin d'abonnement choisie par un participant : vide (fin de l'été) ou une date à venir
export function validerFinAbonnement(valeur, aujourdhui) {
    if (!valeur) return null;
    if (!DATE_RE.test(valeur)) throw new HttpError(400, 'Date invalide');
    if (valeur < aujourdhui) throw new HttpError(400, 'La date est déjà passée');
    return valeur;
}

export function validerCamp(body) {
    const titre = texte(body.titre, 'Le titre', 120);
    const debut = body.debut || null;
    const fin = body.fin || null;
    if ((debut && !DATE_RE.test(debut)) || (fin && !DATE_RE.test(fin))) throw new HttpError(400, 'Dates invalides');
    if (Boolean(debut) !== Boolean(fin)) throw new HttpError(400, 'Indiquer la date de début et la date de fin');
    if (debut && fin < debut) throw new HttpError(400, 'La date de fin est avant la date de début');

    if (!Array.isArray(body.zones) || body.zones.length === 0) throw new HttpError(400, 'Ajouter au moins un massif');
    if (body.zones.length > 10) throw new HttpError(400, '10 massifs maximum');
    const zones = body.zones.map(validerZone);
    if (new Set(zones.map(z => `${z.dept}/${z.id_massif}`)).size !== zones.length) {
        throw new HttpError(400, 'Le même massif est présent deux fois');
    }

    const membres = (Array.isArray(body.membres) ? body.membres : []).map(validerMembre);
    if (membres.length > 50) throw new HttpError(400, '50 membres maximum');
    if (doublon(membres.map(m => m.email)) || doublon(membres.map(m => m.identifiant))) {
        throw new HttpError(400, 'Le même membre est présent deux fois');
    }

    return { titre, debut, fin, zones, membres };
}
