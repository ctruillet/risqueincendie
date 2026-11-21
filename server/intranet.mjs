// Intranet SGDF, mêmes échanges que la librairie api-intranet-java :
// 1. l'identifiant et le mot de passe sont vérifiés par le serveur d'authentification (Keycloak,
//    grant_type=password), qui renvoie un jeton s'ils sont bons ;
// 2. avec ce jeton, l'API des adhérents donne le nom, l'e-mail et les structures de la personne.
// Le mot de passe n'est ni stocké ni journalisé, le jeton n'est pas conservé.
import { INTRANET, intranetConfigure, STRUCTURE_RESPONSABLE } from './config.mjs';
import { HttpError } from './http.mjs';

const INDISPONIBLE = "L'Intranet ne répond pas, réessayez dans quelques minutes";

// Le jeton arrive directement de l'Intranet en réponse à notre requête : on lit son contenu sans
// vérifier sa signature
function lireJeton(jwt) {
    try {
        return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8'));
    } catch {
        return {};
    }
}

async function demanderJeton(identifiant, motDePasse) {
    const corps = new URLSearchParams({
        grant_type: 'password',
        client_id: INTRANET.clientId,
        username: identifiant,
        password: motDePasse,
        scope: 'openid'
    });
    if (INTRANET.clientSecret) corps.set('client_secret', INTRANET.clientSecret);
    let reponse;
    try {
        reponse = await fetch(`${INTRANET.url}/realms/${encodeURIComponent(INTRANET.realm)}/protocol/openid-connect/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: corps,
            signal: AbortSignal.timeout(10_000)
        });
    } catch (e) {
        console.error(`❌ Intranet injoignable : ${e.message}`);
        throw new HttpError(503, INDISPONIBLE);
    }
    const data = await reponse.json().catch(() => ({}));
    // Identifiant inconnu, mauvais mot de passe ou compte désactivé
    if (data.error === 'invalid_grant') return null;
    if (!reponse.ok) {
        console.error(`❌ Intranet : HTTP ${reponse.status} ${data.error ?? ''} ${data.error_description ?? ''}`);
        throw new HttpError(503, "L'Intranet a refusé la demande de connexion. Prévenez le responsable du site.");
    }
    return data;
}

// Fiche de l'adhérent, ou null si l'API n'est pas configurée ou ne répond pas
async function ficheAdherent(code, accessToken) {
    if (!INTRANET.apiUrl) return null;
    try {
        const reponse = await fetch(`${INTRANET.apiUrl}/api/v2/adherents/${encodeURIComponent(code)}`, {
            headers: { idAppelant: INTRANET.clientId, Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(10_000)
        });
        if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
        return (await reponse.json()).data ?? null;
    } catch (e) {
        console.error(`⚠️ API Intranet (adhérent ${code}) : ${e.message}`);
        return null;
    }
}

const structuresDe = fiche => [fiche.fonctionPrincipale, ...(fiche.fonctionsSecondaires ?? [])]
    .map(f => String(f?.structure?.code ?? '')).filter(Boolean);

// Retourne { identifiant, email, nom, responsable } si l'Intranet accepte les identifiants, null sinon.
// responsable vaut null quand l'API des adhérents n'a pas répondu (on garde alors le rôle connu).
export async function verifierIntranet(identifiant, motDePasse) {
    if (!intranetConfigure) throw new HttpError(503, 'Connexion Intranet non configurée (INTRANET_… dans .env)');
    const jeton = await demanderJeton(identifiant, motDePasse);
    if (!jeton) return null;

    const infos = lireJeton(jeton.id_token ?? jeton.access_token);
    const code = String(infos.preferred_username || identifiant).trim();
    const fiche = await ficheAdherent(code, jeton.access_token);
    const nom = fiche ? [fiche.prenom, fiche.nom].filter(Boolean).join(' ')
        : infos.name || [infos.given_name, infos.family_name].filter(Boolean).join(' ');
    return {
        identifiant: code,
        email: fiche?.emails?.[0] ?? infos.email ?? null,
        nom: String(nom ?? '').trim().slice(0, 80),
        responsable: fiche ? structuresDe(fiche).includes(STRUCTURE_RESPONSABLE) : null
    };
}
