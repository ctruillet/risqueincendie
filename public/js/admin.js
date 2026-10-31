// Interface d'administration : camps (dates, massifs, contacts), mails envoyés, comptes.
// Les composants sgdf-* viennent du design system SGDF (ui/admin.js).
const $ = sel => document.querySelector(sel);

let massifs = {};
let camps = [];
let utilisateur = null;
let campEdite = null; // null = nouveau camp

// --- Appels à l'API ---

async function api(chemin, { method = 'GET', body } = {}) {
    const res = await fetch(`api/${chemin}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && chemin !== 'login') {
        afficherLogin();
        throw new Error('Session expirée, reconnectez-vous.');
    }
    if (!res.ok) throw new Error(data.erreur ?? `Erreur ${res.status}`);
    return data;
}

// --- Messages ---

function notifier(texte, { erreur = false } = {}) {
    // Avant la connexion, les notifications ne sont pas encore chargées : message dans le formulaire
    if (!customElements.get('sgdf-toast')) return erreurForm($('#form-login'), texte);
    $('#toast').create(texte, erreur
        ? { variant: 'danger', title: 'Erreur', duration: 8000 }
        : { variant: 'success', title: 'C\'est fait' });
}

// Erreur affichée dans le formulaire (ou le bloc) qui contient `el`
function erreurForm(el, texte) {
    const callout = el.querySelector('.form-error') ?? el.parentElement.querySelector('.form-error');
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
    dialog.variant = variante;
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

// --- Connexion ---

function afficherLogin() {
    $('#vue-app').hidden = true;
    $('#session').hidden = true;
    $('#vue-login').hidden = false;
    $('#form-login [name=email]').focus();
}

$('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    erreurForm(form);
    try {
        await api('login', { method: 'POST', body: { email: valeur(form, 'email'), password: form.querySelector('[name=password]').value } });
        form.reset();
        await demarrer();
    } catch (err) {
        erreurForm(form, err.message);
    }
});

$('#btn-logout').addEventListener('click', async () => {
    await api('logout', { method: 'POST', body: {} }).catch(() => {});
    afficherLogin();
});

// --- Onglets ---

$('#vue-app').addEventListener('sgdf-tab-show', e => {
    if (e.target !== $('#vue-app')) return;
    if (e.detail.name === 'envois') chargerEnvois();
    if (e.detail.name === 'comptes') chargerUsers();
    if (e.detail.name === 'camps') chargerStatus();
});

// --- Statut du relevé ---

async function chargerStatus() {
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
    if (!camp.debut) return '<sgdf-tag slot="header-actions" variant="neutral" size="small">Sans dates</sgdf-tag>';
    if (camp.fin < getIsoDate(0)) return '<sgdf-tag slot="header-actions" variant="neutral" size="small">Terminé</sgdf-tag>';
    if (camp.debut <= getIsoDate(1)) return '<sgdf-tag slot="header-actions" variant="success" size="small">En cours</sgdf-tag>';
    return '<sgdf-tag slot="header-actions" variant="warning" size="small">À venir</sgdf-tag>';
}

// Bouton icône avec infobulle (le libellé sert aussi aux lecteurs d'écran)
const iconeAction = (nom, icone, libelle, desactive = false, variante = '') =>
    `<sgdf-icon-button name="${icone}" library="solid" label="${libelle}" title="${libelle}" data-action="${nom}"
        ${variante ? `variant="${variante}"` : ''} ${desactive ? 'disabled' : ''}></sgdf-icon-button>`;

const dateLongue = iso => formatDate(iso, { day: 'numeric', month: 'long', year: 'numeric' });

function afficherCamps() {
    const liste = $('#liste-camps');
    if (camps.length === 0) {
        liste.innerHTML = '<p class="vide">Aucun camp pour l\'instant.</p>';
        return;
    }
    liste.innerHTML = camps.map((camp, i) => {
        const dates = camp.debut ? `Du ${dateLongue(camp.debut)} au ${dateLongue(camp.fin)}` : 'Pas de dates : aucun mail envoyé';
        const zones = camp.zones.map(z => escapeHtml(z.label)).join(', ');
        const contacts = camp.contacts.length
            ? camp.contacts.map(c => escapeHtml(c.nom || c.email)).join(', ')
            : 'Aucun contact';
        return `
        <sgdf-card class="camp-item" data-id="${escapeHtml(camp.id)}">
            <h3 slot="header" class="camp-titre">${escapeHtml(camp.titre)}</h3>
            ${etiquetteCamp(camp)}
            <ul class="camp-meta">
                <li><sgdf-icon name="calendar-days" library="solid"></sgdf-icon>${dates}</li>
                <li><sgdf-icon name="tree" library="solid"></sgdf-icon>${zones}</li>
                <li><sgdf-icon name="envelope" library="solid"></sgdf-icon>${contacts}</li>
            </ul>
            <div slot="footer" class="actions actions-camp">
                <sgdf-button size="small" appearance="outlined" data-action="modifier">
                    <sgdf-icon slot="prefix" name="pen" library="solid"></sgdf-icon>Modifier
                </sgdf-button>
                <span class="actions-icones">
                    ${iconeAction('envoyer', 'paper-plane', 'Envoyer la prévision de demain aux contacts', !camp.contacts.length)}
                    ${iconeAction('monter', 'arrow-up', 'Monter', i === 0)}
                    ${iconeAction('descendre', 'arrow-down', 'Descendre', i === camps.length - 1)}
                    ${iconeAction('supprimer', 'trash-can', 'Supprimer le camp', false, 'danger')}
                </span>
            </div>
        </sgdf-card>`;
    }).join('');
}

async function chargerCamps() {
    camps = await api('camps');
    afficherCamps();
}

$('#liste-camps').addEventListener('click', async e => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton || bouton.disabled) return;
    const id = bouton.closest('[data-id]').dataset.id;
    const camp = camps.find(c => c.id === id);
    const i = camps.indexOf(camp);

    switch (bouton.dataset.action) {
        case 'modifier':
            return ouvrirEdition(camp);
        case 'envoyer':
            if (!await confirmer({
                titre: 'Envoyer la prévision',
                texte: `Envoyer maintenant la prévision de demain aux contacts de « ${camp.titre} » ?`,
                bouton: 'Envoyer', variante: 'primary'
            })) return;
            return action(bouton, async () => {
                const r = await api(`camps/${encodeURIComponent(id)}/envoyer`, { method: 'POST', body: {} });
                notifier(r.erreur ? `Envoyé, avec des erreurs : ${r.erreur}` : 'Mail envoyé aux contacts.', { erreur: Boolean(r.erreur) });
            });
        case 'supprimer':
            if (!await confirmer({
                titre: 'Supprimer le camp',
                texte: `Supprimer « ${camp.titre} » ? Ses contacts seront supprimés (l'historique des massifs est conservé).`,
                bouton: 'Supprimer'
            })) return;
            return action(bouton, async () => {
                await api(`camps/${encodeURIComponent(id)}`, { method: 'DELETE' });
                await chargerCamps();
                notifier('Camp supprimé.');
            });
        case 'monter':
        case 'descendre': {
            const j = bouton.dataset.action === 'monter' ? i - 1 : i + 1;
            [camps[i], camps[j]] = [camps[j], camps[i]];
            afficherCamps();
            return api('camps/ordre', { method: 'POST', body: { ids: camps.map(c => c.id) } })
                .catch(err => notifier(err.message, { erreur: true }));
        }
    }
});

// --- Édition d'un camp ---

function optionsDepts() {
    return Object.entries(massifs).map(([dept, d]) =>
        `<sgdf-option value="${dept}">${escapeHtml(d.nom)}</sgdf-option>`).join('');
}

function optionsMassifs(dept) {
    return (massifs[dept]?.massifs ?? []).map(m =>
        `<sgdf-option value="${m.id}">${escapeHtml(m.nom)}</sgdf-option>`).join('');
}

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

function ajouterContact(contact = {}) {
    const ligne = $('#tpl-contact').content.firstElementChild.cloneNode(true);
    $('#contacts').append(ligne);
    ligne.querySelector('[name=nom]').value = contact.nom ?? '';
    ligne.querySelector('[name=email]').value = contact.email ?? '';
}

// Changer de département recharge la liste de ses massifs
$('#zones').addEventListener('change', e => {
    const dept = e.target.closest('[name=dept]');
    if (!dept) return;
    const selectMassif = dept.closest('.zone-ligne').querySelector('[name=id_massif]');
    selectMassif.innerHTML = optionsMassifs(dept.value);
    selectMassif.value = massifs[dept.value]?.massifs[0]?.id ?? '';
});

for (const conteneur of ['#zones', '#contacts']) {
    $(conteneur).addEventListener('click', e => {
        if (e.target.closest('.btn-suppr')) e.target.closest('.ligne-form').remove();
    });
}

$('#btn-ajout-zone').addEventListener('click', () => ajouterZone());
$('#btn-ajout-contact').addEventListener('click', () => ajouterContact());

function ouvrirEdition(camp = null) {
    campEdite = camp;
    const form = $('#form-camp');
    erreurForm(form);
    $('#titre-edition').textContent = camp ? `Modifier « ${camp.titre} »` : 'Nouveau camp';
    form.querySelector('[name=titre]').value = camp?.titre ?? '';
    form.querySelector('[name=debut]').value = camp?.debut ?? '';
    form.querySelector('[name=fin]').value = camp?.fin ?? '';
    form.querySelector('[name=fin]').min = camp?.debut ?? '';
    $('#zones').innerHTML = '';
    $('#contacts').innerHTML = '';
    (camp?.zones.length ? camp.zones : [{}]).forEach(ajouterZone);
    (camp?.contacts.length ? camp.contacts : [{}]).forEach(ajouterContact);

    $('#vue-liste').hidden = true;
    $('#vue-edition').hidden = false;
    $('#vue-edition').scrollIntoView({ block: 'start' });
    form.querySelector('[name=titre]').focus();
}

function fermerEdition() {
    $('#vue-edition').hidden = true;
    $('#vue-liste').hidden = false;
    chargerStatus().catch(() => {});
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
    erreurForm(form);
    const body = {
        titre: valeur(form, 'titre'),
        debut: valeur(form, 'debut') || null,
        fin: valeur(form, 'fin') || null,
        zones: [...document.querySelectorAll('#zones .zone-ligne')].map(l => ({
            dept: valeur(l, 'dept'), id_massif: valeur(l, 'id_massif'), label: valeur(l, 'label')
        })),
        contacts: [...document.querySelectorAll('#contacts .contact-ligne')]
            .map(l => ({ nom: valeur(l, 'nom'), email: valeur(l, 'email') }))
            .filter(c => c.nom || c.email)
    };
    const bouton = form.querySelector('sgdf-button[submit]');
    bouton.loading = true;
    try {
        if (campEdite) await api(`camps/${encodeURIComponent(campEdite.id)}`, { method: 'PUT', body });
        else await api('camps', { method: 'POST', body });
        await chargerCamps();
        fermerEdition();
        notifier('Camp enregistré.');
    } catch (err) {
        erreurForm(form, err.message);
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

// --- Comptes ---

async function chargerUsers() {
    const liste = await api('users');
    $('#liste-users').innerHTML = liste.map(u => `
        <li data-id="${u.id}" data-email="${escapeHtml(u.email)}">
            <span><strong>${escapeHtml(u.email)}</strong>${u.nom ? ` — ${escapeHtml(u.nom)}` : ''}</span>
            ${u.id === utilisateur.id
                ? '<sgdf-tag size="small" variant="neutral">Vous</sgdf-tag>'
                : `<sgdf-button size="small" appearance="text" variant="danger" data-action="suppr-user">
                       <sgdf-icon slot="prefix" name="trash-can" library="solid"></sgdf-icon>Supprimer
                   </sgdf-button>`}
        </li>`).join('');
}

$('#liste-users').addEventListener('click', async e => {
    const bouton = e.target.closest('[data-action=suppr-user]');
    if (!bouton) return;
    const li = bouton.closest('li');
    if (!await confirmer({ titre: 'Supprimer le compte', texte: `Supprimer le compte ${li.dataset.email} ?`, bouton: 'Supprimer' })) return;
    action(bouton, async () => {
        await api(`users/${li.dataset.id}`, { method: 'DELETE' });
        await chargerUsers();
        notifier('Compte supprimé.');
    });
});

$('#form-user').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    erreurForm(form);
    try {
        const r = await api('users', { method: 'POST', body: { email: valeur(form, 'email'), nom: valeur(form, 'nom') } });
        form.reset();
        await chargerUsers();
        $('#mdp-cree-texte').textContent = `Mot de passe provisoire de ${r.email} :`;
        $('#mdp-cree-valeur').textContent = r.motDePasse;
        $('#mdp-cree').open = true;
    } catch (err) {
        erreurForm(form, err.message);
    }
});

$('#mdp-cree-ok').addEventListener('click', () => { $('#mdp-cree').open = false; });

$('#form-password').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    erreurForm(form);
    try {
        await api('password', {
            method: 'POST',
            body: { actuel: form.querySelector('[name=actuel]').value, nouveau: form.querySelector('[name=nouveau]').value }
        });
        form.reset();
        notifier('Mot de passe changé. Les autres appareils connectés ont été déconnectés.');
    } catch (err) {
        erreurForm(form, err.message);
    }
});

// --- Démarrage ---

async function demarrer() {
    const { user } = await api('me');
    if (!user) return afficherLogin();
    // Composants de l'admin connecté, chargés seulement maintenant (page de connexion plus légère)
    await Promise.all([import('/ui/admin.js'), import('/ui/admin-app.js')]);
    await customElements.whenDefined('sgdf-select');
    utilisateur = user;
    $('#user-email').textContent = user.email;
    $('#form-password [name=email]').value = user.email;
    $('#vue-login').hidden = true;
    $('#session').hidden = false;
    $('#vue-app').hidden = false;
    massifs = await fetchJson('massifs.json');
    await Promise.all([chargerCamps(), chargerStatus()]);
}

demarrer().catch(e => notifier(e.message, { erreur: true }));
