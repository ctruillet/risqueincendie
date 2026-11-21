// API Intranet SGDF simulée, pour le développement local uniquement (docker-compose.dev.yml).
// Répond comme l'API des adhérents : GET /api/v2/adherents/<code> → { data: { …fiche } }.
// Les fiches sont tirées des comptes de test du Keycloak local (attribut « structure »).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const royaume = JSON.parse(readFileSync(new URL('./sgdf_local-realm.json', import.meta.url), 'utf8'));
const fiches = Object.fromEntries(royaume.users.map(u => [u.username, {
    codeAdherent: u.username,
    prenom: u.firstName,
    nom: u.lastName,
    emails: [u.email],
    fonctionPrincipale: { structure: { code: u.attributes.structure[0] } },
    fonctionsSecondaires: []
}]));

createServer((req, res) => {
    const code = req.url.match(/^\/api\/v2\/adherents\/(\w+)$/)?.[1];
    const autorise = /^Bearer \S+/.test(req.headers.authorization ?? '') && req.headers.idappelant;
    const fiche = autorise && fiches[code];
    res.writeHead(!autorise ? 401 : fiche ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(fiche ? { data: fiche } : { errors: [autorise ? 'Adhérent introuvable' : 'Non autorisé'] }));
}).listen(8080, () => console.log('API Intranet simulée sur le port 8080'));
