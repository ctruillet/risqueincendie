// Mails envoyés aux membres des camps : niveaux du lendemain pendant les dates du camp
import nodemailer from 'nodemailer';
import { envois } from './db.mjs';
import { getParisHour } from './dates.mjs';
import { PUBLIC_URL, NOTIFY_DEADLINE_HOUR, SMTP, regles } from './config.mjs';

const COULEURS = { 1: '#15803d', 2: '#a16207', 3: '#c2410c', 4: '#b91c1c', 5: '#0f172a', unknown: '#64748b' };

export const smtpConfigure = Boolean(SMTP.host && SMTP.from);

const transport = smtpConfigure && nodemailer.createTransport({
    host: SMTP.host,
    port: SMTP.port,
    // 465 = TLS direct ; sinon STARTTLS
    secure: SMTP.port === 465,
    requireTLS: SMTP.starttls,
    auth: SMTP.user ? { user: SMTP.user, pass: SMTP.pass } : undefined
});

async function envoyer({ to, subject, text, html }) {
    if (!transport) throw new Error('SMTP non configuré (SMTP_HOST et MAIL_FROM dans .env)');
    await transport.sendMail({ from: SMTP.from, to, subject, text, html });
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

const formatDate = iso => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${iso}T12:00:00Z`));

export function campActifLe(camp, date) {
    return Boolean(camp.debut && camp.fin && camp.debut <= date && date <= camp.fin);
}

function niveaux(camp, entry) {
    return camp.zones.map(zone => {
        const status = entry?.[zone.cle] ?? 'unknown';
        const config = regles[zone.dept]?.[status];
        return {
            label: zone.label,
            status,
            niveau: config?.label ?? 'Non publié',
            detail: config?.detail ?? "La préfecture n'a pas encore publié la prévision.",
            couleur: COULEURS[config?.color] ?? COULEURS.unknown,
            gravite: Number(config?.color ?? 0)
        };
    });
}

function composerMail(camp, date, entry, { miseAJour = false } = {}) {
    const lignes = niveaux(camp, entry);
    const pire = lignes.reduce((a, b) => (b.gravite > a.gravite ? b : a), lignes[0]);
    const jour = formatDate(date);
    const lien = PUBLIC_URL ? `${PUBLIC_URL}/?date=${date}` : '';
    const periode = camp.debut ? ` (du ${formatDate(camp.debut)} au ${formatDate(camp.fin)})` : '';
    const pourquoi = `Vous recevez ce mail car vous êtes membre ou abonné du camp « ${camp.titre} »${periode}.`;
    const desinscription = PUBLIC_URL
        ? `Pour ne plus les recevoir, connectez-vous sur ${PUBLIC_URL} et retirez-vous du camp, ou répondez simplement à ce mail.`
        : 'Pour ne plus recevoir ces mails ou faire supprimer vos coordonnées, répondez simplement à ce mail.';

    const subject = `${miseAJour ? '[Mise à jour] ' : ''}${camp.titre} – ${jour} : ${pire?.niveau ?? 'Non publié'}`;
    const text = [
        `${camp.titre}`,
        `Accès aux massifs pour le ${jour}${miseAJour ? ' (mise à jour de la préfecture)' : ''} :`,
        '',
        ...lignes.map(l => `• ${l.label} : ${l.niveau}\n  ${l.detail}`),
        '',
        ...(lien ? [`Détails : ${lien}`] : []),
        pourquoi,
        desinscription
    ].join('\n');

    const html = `<!doctype html><html lang="fr"><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1e293b;max-width:560px;margin:auto;padding:16px">
${PUBLIC_URL ? `<img src="${escapeHtml(PUBLIC_URL)}/icon-192.png" alt="" width="48" height="48" style="display:block;margin-bottom:10px;border-radius:11px">` : ''}
<h2 style="margin:0 0 4px;color:#003a5d">${escapeHtml(camp.titre)}</h2>
<p style="margin:0 0 16px;color:#64748b">Accès aux massifs pour le <strong>${escapeHtml(jour)}</strong>${miseAJour ? ' — <strong>mise à jour de la préfecture</strong>' : ''}</p>
${lignes.map(l => `<div style="border:1px solid #e2e8f0;border-left:6px solid ${l.couleur};border-radius:10px;padding:12px 14px;margin-bottom:10px">
<div style="display:flex;justify-content:space-between;font-weight:700"><span>${escapeHtml(l.label)}</span>
<span style="color:${l.couleur}">${escapeHtml(l.niveau)}</span></div>
<div style="font-size:14px;color:#475569;margin-top:6px">${escapeHtml(l.detail)}</div></div>`).join('\n')}
${lien ? `<p><a href="${escapeHtml(lien)}" style="color:#003a5d">Voir le détail sur le site</a></p>` : ''}
<p style="font-size:12px;color:#94a3b8;margin-top:24px">${escapeHtml(pourquoi)}<br>${escapeHtml(desinscription)}</p>
</body></html>`;

    return { subject, text, html, signature: JSON.stringify(lignes.map(l => [l.label, l.status])), complet: lignes.every(l => l.status !== 'unknown') };
}

// E-mails des membres du camp (admins, et participants abonnés jusqu'à cette date au moins), sans doublon
const destinatairesDe = (camp, date) => [...new Map(camp.membres
    .filter(m => m.email && (m.role === 'admin' || !m.jusqu_au || m.jusqu_au >= date))
    .map(m => [m.email.toLowerCase(), m.email])).values()];

// Envoie le mail d'un camp à tous ses membres ayant un e-mail et l'enregistre dans le journal
export async function envoyerCamp(camp, date, entry, options = {}) {
    const destinataires = destinatairesDe(camp, date);
    if (destinataires.length === 0) return { ok: false, erreur: 'Aucun membre avec un e-mail' };
    const mail = composerMail(camp, date, entry, options);
    const erreurs = [];
    for (const to of destinataires) {
        try {
            await envoyer({ to, ...mail });
        } catch (e) {
            erreurs.push(`${to} : ${e.message}`);
        }
    }
    const ok = erreurs.length < destinataires.length;
    const erreur = erreurs.join(' ; ') || null;
    envois.add({ campId: camp.id, date, signature: mail.signature, destinataires: destinataires.join(', '), ok, erreur });
    console.log(`${ok ? '📧' : '❌'} ${camp.id} (${date}) → ${destinataires.join(', ')}${erreur ? ` : ${erreur}` : ''}`);
    return { ok, erreur };
}

// Appelé après chaque mise à jour de l'historique : prévient les camps en cours le lendemain.
// Un premier mail part dès que toutes les zones du camp sont publiées (ou à NOTIFY_DEADLINE_HOUR),
// puis un nouveau mail si la préfecture change un niveau dans la soirée.
export async function notifierCamps(camps, entry) {
    for (const camp of camps) {
        if (!campActifLe(camp, entry.date) || camp.zones.length === 0) continue;
        if (destinatairesDe(camp, entry.date).length === 0) continue;

        const { signature, complet } = composerMail(camp, entry.date, entry);
        const dernier = envois.dernierReussi(camp.id, entry.date);
        if (dernier?.signature === signature) continue;
        if (!dernier && !complet && getParisHour() < NOTIFY_DEADLINE_HOUR) continue;

        await envoyerCamp(camp, entry.date, entry, { miseAJour: Boolean(dernier) });
    }
}

export async function envoyerTest(to) {
    await envoyer({
        to,
        subject: 'Test des notifications – Prévisions des Massifs',
        text: 'Ce mail confirme que la configuration SMTP fonctionne.',
        html: '<p>Ce mail confirme que la configuration SMTP fonctionne.</p>'
    });
}
