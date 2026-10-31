// Contrôle des données envoyées par l'admin
import { HttpError } from './http.mjs';
import { listCamps } from './db.mjs';
import { regles, massifs } from './config.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export function texte(value, nom, max, { requis = true } = {}) {
    const v = String(value ?? '').trim();
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

function validerContact(c) {
    const nom = texte(c.nom, 'Le nom du contact', 80, { requis: false });
    const email = texte(c.email, `L'email du contact ${nom}`.trim(), 254);
    if (!EMAIL_RE.test(email)) throw new HttpError(400, `Email invalide : ${email}`);
    return { nom, email };
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

    const contacts = (Array.isArray(body.contacts) ? body.contacts : []).map(validerContact);
    if (contacts.length > 30) throw new HttpError(400, '30 contacts maximum');

    return { titre, debut, fin, zones, contacts };
}
