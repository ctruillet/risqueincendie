// Administration : camps (dates, massifs, membres) et mails envoyés.
// Responsable du site : tous les camps, création et suppression. Admin d'un camp : ses camps seulement.
// Les composants sgdf-* viennent du design system SGDF (ui/admin.js, chargé après la connexion).
const $ = sel => document.querySelector(sel);

let massifs = {};
let camps = [];
let utilisateur = null;
let campEdite = null;      // null = nouveau camp
let membresEdites = [];    // membres du camp en cours de modification

// --- Outils ---

async function api(chemin, { method = 'GET', body } = {}) {
    const res = await fetch(`api/${chemin}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
        location.replace(`connexion?retour=${encodeURIComponent('/admin' + location.hash)}`);
        throw new Error('Session expirée, reconnectez-vous.');
    }
    if (!res.ok) throw new Error(data.erreur ?? `Erreur ${res.status}`);
    return data;
}

function notifier(texte, { erreur = false } = {}) {
    if (!customElements.get('sgdf-toast')) return alert(texte);
    $('#toast').create(texte, erreur
        ? { variant: 'danger', title: 'Erreur', duration: 8000 }
        : { variant: 'success', title: 'C\'est fait' });
}

function erreurForm(texte) {
    const callout = $('#form-camp .form-error');
    callout.textContent = texte ?? '';
    callout.hidden = !texte;
}

// Indicateur de chargement sur le bouton pendant l'action, erreurs en notification
async function action(bouton, fn) {
    bouton.loading = true;
    try {
        await fn();
    } catch (e) {
        notifier(e.message, { erreur: true });
    } finally {
        bouton.loading = false;
    }
}

// Boîte de confirmation : résout true si l'utilisateur confirme
function confirmer({ titre, texte, bouton = 'Confirmer', variante = 'danger' }) {
    const dialog = $('#confirmation');
    dialog.title = titre;
    $('#confirmation-texte').textContent = texte;
    const ok = $('#confirmation-ok');
    ok.textContent = bouton;
    ok.variant = variante;
    dialog.open = true;
    return new Promise(resolve => {
        let reponse = false;
        const valider = () => { reponse = true; dialog.open = false; };
        const annuler = () => { dialog.open = false; };
        ok.addEventListener('click', valider, { once: true });
        $('#confirmation-annuler').addEventListener('click', annuler, { once: true });
        dialog.addEventListener('sgdf-after-hide', () => {
            ok.removeEventListener('click', valider);
            $('#confirmation-annuler').removeEventListener('click', annuler);
            resolve(reponse);
        }, { once: true });
    });
}

const valeur = (racine, nom) => String(racine.querySelector(`[name=${nom}]`)?.value ?? '').trim();
const dateLongue = iso => formatDate(iso, { day: 'numeric', month: 'long', year: 'numeric' });
// Nom affiché d'un membre : son nom (connu après sa première connexion), sinon ce qu'a saisi l'admin
const nomMembre = m => m.nom || m.email || `N° ${m.identifiant}`;

$('#btn-logout').addEventListener('click', async () => {
    await api('logout', { method: 'POST', body: {} }).catch(() => {});
    location.replace('./');
});

// --- Relevé des prévisions (responsable du site) ---

async function chargerStatus() {
    if (!utilisateur.superAdmin) return;
    const s = await api('status');
    const passage = s.dernierPassage
        ? `${new Date(s.dernierPassage).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} — ${escapeHtml(s.dernierResultat ?? '')}`
        : 'pas encore';
    const jourMois = mmjj => mmjj.split('-').reverse().join('/');
    $('#status-texte').innerHTML = `
        Envoi des mails : <strong>${s.smtp ? 'configuré' : 'non configuré (voir .env)'}</strong><br>
        Toutes les ${s.intervalle} min à partir de ${s.heureDebut}h, du ${jourMois(s.saison[0])} au ${jourMois(s.saison[1])} et pendant les camps.<br>
        Dernier passage : ${passage}`;
}

$('#btn-passage').addEventListener('click', e => action(e.currentTarget, async () => {
    await api('passage', { method: 'POST', body: {} });
    await chargerStatus();
    notifier('Prévisions vérifiées. Les mails nécessaires sont partis (voir « Mails envoyés »).');
}));

$('#btn-test-mail').addEventListener('click', e => action(e.currentTarget, async () => {
    const { to } = await api('test-mail', { method: 'POST', body: {} });
    notifier(`Mail de test envoyé à ${to}.`);
}));

// --- Liste des camps ---

function etiquetteCamp(camp) {
    const tag = (variante, texte) => `<sgdf-tag slot="header-actions" variant="${variante}" size="small">${texte}</sgdf-tag>`;
    if (!camp.debut) return tag('neutral', 'Sans dates');
    if (camp.fin < getIsoDate(0)) return tag('neutral', 'Terminé');
    if (camp.debut <= getIsoDate(0)) return tag('success', 'En cours');
    return tag('warning', 'À venir');
}

function listeNoms(membres, role) {
    const noms = membres.filter(m => m.role === role).map(m => escapeHtml(nomMembre(m)));
    return noms.length ? noms.join(', ') : 'aucun';
}

function afficherCamps() {
    const liste = $('#liste-camps');
    if (camps.length === 0) {
        liste.innerHTML = '<p class="vide">Aucun camp pour l\'instant.</p>';
        return;
    }
    liste.innerHTML = camps.map(camp => `
        <sgdf-card class="camp-item" data-id="${escapeHtml(camp.id)}">
            <h3 slot="header" class="camp-titre">${escapeHtml(camp.titre)}</h3>
            ${etiquetteCamp(camp)}
            <dl class="camp-infos">
                <dt>Dates</dt><dd>${camp.debut ? `du ${dateLongue(camp.debut)} au ${dateLongue(camp.fin)}` : 'pas de dates : aucun mail envoyé'}</dd>
                <dt>Massifs</dt><dd>${camp.zones.map(z => escapeHtml(z.label)).join(', ')}</dd>
                <dt>Admins</dt><dd>${listeNoms(camp.membres, 'admin')}</dd>
                <dt>Participants</dt><dd>${listeNoms(camp.membres, 'participant')}</dd>
            </dl>
            <div slot="footer" class="actions">
                <sgdf-button size="small" variant="primary" data-action="modifier">Modifier</sgdf-button>
                <sgdf-button size="small" appearance="outlined" data-action="envoyer"
                    ${camp.membres.some(m => m.email) ? '' : 'disabled'}>Envoyer la prévision de demain</sgdf-button>
                ${utilisateur.superAdmin ? '<sgdf-button size="small" appearance="text" variant="danger" data-action="supprimer">Supprimer</sgdf-button>' : ''}
            </div>
        </sgdf-card>`).join('');
}

async function chargerCamps() {
    camps = await api('camps');
    afficherCamps();
}

$('#liste-camps').addEventListener('click', async e => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton || bouton.disabled) return;
    const camp = camps.find(c => c.id === bouton.closest('[data-id]').dataset.id);
    const chemin = `camps/${encodeURIComponent(camp.id)}`;

    if (bouton.dataset.action === 'modifier') return ouvrirEdition(camp);
    if (bouton.dataset.action === 'envoyer') {
        if (!await confirmer({
            titre: 'Envoyer la prévision',
            texte: `Envoyer maintenant la prévision de demain aux membres de « ${camp.titre} » ?`,
            bouton: 'Envoyer', variante: 'primary'
        })) return;
        return action(bouton, async () => {
            const r = await api(`${chemin}/envoyer`, { method: 'POST', body: {} });
            notifier(r.erreur ? `Envoyé, avec des erreurs : ${r.erreur}` : 'Mail envoyé aux membres.', { erreur: Boolean(r.erreur) });
        });
    }
    if (bouton.dataset.action === 'supprimer') {
        if (!await confirmer({
            titre: 'Supprimer le camp',
            texte: `Supprimer « ${camp.titre} » et la liste de ses membres ? L'historique des massifs est conservé.`,
            bouton: 'Supprimer'
        })) return;
        return action(bouton, async () => {
            await api(chemin, { method: 'DELETE' });
            await chargerCamps();
            notifier('Camp supprimé.');
        });
    }
});

// --- Massifs du camp ---

const optionsDepts = () => Object.entries(massifs).map(([dept, d]) =>
    `<sgdf-option value="${dept}">${escapeHtml(d.nom)}</sgdf-option>`).join('');

const optionsMassifs = dept => (massifs[dept]?.massifs ?? []).map(m =>
    `<sgdf-option value="${m.id}">${escapeHtml(m.nom)}</sgdf-option>`).join('');

function ajouterZone(zone = {}) {
    const ligne = $('#tpl-zone').content.firstElementChild.cloneNode(true);
    $('#zones').append(ligne);
    const dept = zone.dept ?? Object.keys(massifs)[0];
    const selectDept = ligne.querySelector('[name=dept]');
    const selectMassif = ligne.querySelector('[name=id_massif]');
    selectDept.innerHTML = optionsDepts();
    selectDept.value = dept;
    selectMassif.innerHTML = optionsMassifs(dept);
    selectMassif.value = zone.id_massif ?? massifs[dept]?.massifs[0]?.id ?? '';
    ligne.querySelector('[name=label]').value = zone.label ?? '';
}

// Changer de département recharge la liste de ses massifs
$('#zones').addEventListener('change', e => {
    const dept = e.target.closest('[name=dept]');
    if (!dept) return;
    const selectMassif = dept.closest('.zone-ligne').querySelector('[name=id_massif]');
    selectMassif.innerHTML = optionsMassifs(dept.value);
    selectMassif.value = massifs[dept.value]?.massifs[0]?.id ?? '';
});

$('#zones').addEventListener('click', e => {
    if (e.target.closest('.btn-suppr')) e.target.closest('.ligne-form').remove();
});

$('#btn-ajout-zone').addEventListener('click', () => ajouterZone());

// --- Membres du camp ---

function afficherMembres() {
    $('#membres').innerHTML = membresEdites.length === 0
        ? '<li class="vide">Aucun membre pour l\'instant.</li>'
        : membresEdites.map((m, i) => {
            const details = m.nom
                ? [m.email, m.identifiant && `n° ${m.identifiant}`].filter(Boolean).join(' · ')
                : 'Pas encore connecté';
            return `
            <li class="membre" data-i="${i}">
                <span class="membre-qui"><strong>${escapeHtml(nomMembre(m))}</strong><small>${escapeHtml(details)}</small></span>
                <select class="champ-select" aria-label="Rôle de ${escapeHtml(nomMembre(m))}">
                    <option value="participant" ${m.role === 'participant' ? 'selected' : ''}>Participant</option>
                    <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
                <sgdf-icon-button name="trash-can" library="solid" label="Retirer ${escapeHtml(nomMembre(m))}"></sgdf-icon-button>
            </li>`;
        }).join('');
}

$('#membres').addEventListener('change', e => {
    const li = e.target.closest('.membre');
    if (li) membresEdites[li.dataset.i].role = e.target.value;
});

$('#membres').addEventListener('click', e => {
    if (!e.target.closest('sgdf-icon-button')) return;
    membresEdites.splice(e.target.closest('.membre').dataset.i, 1);
    afficherMembres();
});

// Un seul champ : un e-mail ou un numéro d'adhérent (9 chiffres)
function ajouterMembre() {
    const champ = $('#membre-qui');
    const saisie = champ.value.trim();
    if (!saisie) return champ.focus();
    let membre;
    if (/^\S+@\S+\.\S+$/.test(saisie)) membre = { email: saisie.toLowerCase() };
    else if (/^\d{9}$/.test(saisie.replace(/\s/g, ''))) membre = { identifiant: saisie.replace(/\s/g, '') };
    else return notifier('Saisir un e-mail ou un numéro d\'adhérent à 9 chiffres.', { erreur: true });

    const deja = membresEdites.some(m =>
        (membre.email && m.email?.toLowerCase() === membre.email) || (membre.identifiant && m.identifiant === membre.identifiant));
    if (deja) return notifier('Cette personne est déjà membre du camp.', { erreur: true });

    membresEdites.push({ ...membre, nom: '', role: $('#membre-role').value });
    afficherMembres();
    champ.value = '';
    champ.focus();
}

$('#btn-ajout-membre').addEventListener('click', ajouterMembre);
// Entrée dans le champ ajoute le membre (au lieu d'enregistrer le camp)
$('#membre-qui').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    ajouterMembre();
});

// --- Création et modification d'un camp ---

function ouvrirEdition(camp = null) {
    campEdite = camp;
    const form = $('#form-camp');
    erreurForm();
    $('#titre-edition').textContent = camp ? `Modifier « ${camp.titre} »` : 'Nouveau camp';
    form.querySelector('[name=titre]').value = camp?.titre ?? '';
    form.querySelector('[name=debut]').value = camp?.debut ?? '';
    form.querySelector('[name=fin]').value = camp?.fin ?? '';
    form.querySelector('[name=fin]').min = camp?.debut ?? '';
    $('#zones').innerHTML = '';
    (camp?.zones.length ? camp.zones : [{}]).forEach(ajouterZone);
    membresEdites = structuredClone(camp?.membres ?? []);
    afficherMembres();
    $('#membre-qui').value = '';
    $('#membre-role').value = membresEdites.length ? 'participant' : 'admin';

    $('#vue-liste').hidden = true;
    $('#vue-edition').hidden = false;
    $('#vue-edition').scrollIntoView({ block: 'start' });
}

function fermerEdition() {
    $('#vue-edition').hidden = true;
    $('#vue-liste').hidden = false;
}

$('#btn-nouveau').addEventListener('click', () => ouvrirEdition());
$('#btn-annuler').addEventListener('click', fermerEdition);

// Le début fixe la date minimale de fin
$('#form-camp [name=debut]').addEventListener('change', e => {
    const fin = $('#form-camp [name=fin]');
    fin.min = e.target.value;
    if (e.target.value && (!fin.value || fin.value < e.target.value)) fin.value = e.target.value;
});

$('#form-camp').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    erreurForm();
    // Membre saisi mais pas encore ajouté : on l'ajoute avant d'enregistrer
    if ($('#membre-qui').value.trim()) ajouterMembre();
    const body = {
        titre: valeur(form, 'titre'),
        debut: valeur(form, 'debut') || null,
        fin: valeur(form, 'fin') || null,
        zones: [...document.querySelectorAll('#zones .zone-ligne')].map(l => ({
            dept: valeur(l, 'dept'), id_massif: valeur(l, 'id_massif'), label: valeur(l, 'label')
        })),
        membres: membresEdites.map(({ nom, email, identifiant, role }) => ({ nom, email, identifiant, role }))
    };
    const bouton = form.querySelector('sgdf-button[submit]');
    bouton.loading = true;
    try {
        if (campEdite) await api(`camps/${encodeURIComponent(campEdite.id)}`, { method: 'PUT', body });
        else await api('camps', { method: 'POST', body });
        notifier('Camp enregistré.');
        // Un admin qui s'est retiré du rôle n'a plus accès : retour à l'accueil
        const { user } = await api('me');
        if (!user.admin) return location.replace('./');
        await chargerCamps();
        fermerEdition();
    } catch (err) {
        erreurForm(err.message);
    } finally {
        bouton.loading = false;
    }
});

// --- Mails envoyés ---

async function chargerEnvois() {
    const liste = $('#liste-envois');
    try {
        const envois = await api('envois');
        liste.innerHTML = envois.length === 0
            ? '<p class="vide">Aucun mail envoyé pour l\'instant.</p>'
            : `<ul class="liste-simple">${envois.map(e => `
                <li class="envoi">
                    <div class="envoi-ligne">
                        <span><strong>${escapeHtml(e.titre ?? e.camp_id)}</strong> — prévision du ${formatDate(e.date)}</span>
                        <sgdf-tag size="small" variant="${e.ok ? 'success' : 'danger'}">${e.ok ? 'Envoyé' : 'Échec'}</sgdf-tag>
                    </div>
                    <small>${new Date(`${e.sent_at.replace(' ', 'T')}Z`).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} → ${escapeHtml(e.destinataires)}</small>
                    ${e.erreur ? `<small>${escapeHtml(e.erreur)}</small>` : ''}
                </li>`).join('')}</ul>`;
    } catch (err) {
        liste.innerHTML = `<p class="vide">${escapeHtml(err.message)}</p>`;
    }
}

$('#vue-app').addEventListener('sgdf-tab-show', e => {
    if (e.target === $('#vue-app') && e.detail.name === 'envois') chargerEnvois();
});

// --- Démarrage ---

async function demarrer() {
    const { user } = await api('me');
    if (!user) return api('mes-camps'); // 401 : renvoie vers la connexion
    utilisateur = user;
    $('#user-nom').textContent = user.nom || user.identifiant;
    await import('/ui/admin.js');
    await customElements.whenDefined('sgdf-select');
    if (!user.admin) {
        $('#vue-aucun').hidden = false;
        return;
    }
    if (user.superAdmin) {
        $('#titre-admin').textContent = 'Tous les camps';
        $('#bloc-releve').hidden = false;
        $('#btn-nouveau').hidden = false;
    }
    $('#vue-app').hidden = false;
    massifs = await fetchJson('massifs.json');
    await Promise.all([chargerCamps(), chargerStatus()]);
    // Lien « Gérer le camp » de l'accueil : admin#camp=<id>
    const camp = camps.find(c => c.id === new URLSearchParams(location.hash.slice(1)).get('camp'));
    if (camp) ouvrirEdition(camp);
    history.replaceState(null, '', location.pathname);
}

demarrer().catch(e => notifier(e.message, { erreur: true }));
