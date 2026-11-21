// Vérification des identifiants auprès de l'Intranet SGDF (serveur d'authentification Keycloak).
// Même échange que la librairie api-intranet-java (ApiUserAuthenticator) : l'identifiant et le mot de
// passe sont envoyés au point « token » du royaume (grant_type=password), qui renvoie un jeton s'ils
// sont bons. Le mot de passe n'est ni stocké ni journalisé, le jeton n'est pas conservé : on n'en lit
// que l'identité (identifiant, nom, e-mail). Il arrive directement de l'Intranet, en réponse à notre
// requête : sa signature n'a pas besoin d'être vérifiée.
import { INTRANET, intranetConfigure } from './config.mjs';
import { HttpError } from './http.mjs';

const pointJeton = () =>
    `${INTRANET.url}/realms/${encodeURIComponent(INTRANET.realm)}/protocol/openid-connect/token`;

function lireJeton(jwt) {
    const charge = String(jwt ?? '').split('.')[1];
    if (!charge) return null;
    try {
        return JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

// Retourne { identifiant, email, nom } si l'Intranet accepte les identifiants, null s'il les refuse.
// Lève une erreur 503 si l'Intranet ne répond pas ou si la configuration est mauvaise.
export async function verifierIntranet(identifiant, motDePasse) {
    if (!intranetConfigure) throw new HttpError(503, 'Connexion Intranet non configurée (INTRANET_… dans .env)');

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
        reponse = await fetch(pointJeton(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: corps,
            signal: AbortSignal.timeout(10_000)
        });
    } catch (e) {
        console.error(`❌ Intranet injoignable : ${e.message}`);
        throw new HttpError(503, "L'Intranet ne répond pas, réessayez dans quelques minutes");
    }
    const data = await reponse.json().catch(() => ({}));

    // Identifiant inconnu, mauvais mot de passe ou compte désactivé
    if (data.error === 'invalid_grant') return null;
    if (!reponse.ok) {
        console.error(`❌ Intranet : HTTP ${reponse.status} ${data.error ?? ''} ${data.error_description ?? ''}`);
        throw new HttpError(503, "L'Intranet a refusé la demande de connexion. Prévenez le responsable du site.");
    }

    const infos = lireJeton(data.id_token) ?? lireJeton(data.access_token) ?? {};
    const nom = infos.name || [infos.given_name, infos.family_name].filter(Boolean).join(' ');
    return {
        identifiant: String(infos.preferred_username || identifiant).trim(),
        email: infos.email ? String(infos.email).trim() : null,
        nom: String(nom ?? '').trim().slice(0, 80)
    };
}
