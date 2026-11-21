// Service worker (mode hors ligne) : enregistré après le chargement, pour ne pas ralentir le premier affichage
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => setTimeout(() => navigator.serviceWorker.register('./sw.js'), 2000));
}

const JOURS_HISTORIQUE = 7;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Date demandée via ?date=AAAA-MM-JJ, sinon null
function getQueryDate() {
    const date = new URLSearchParams(window.location.search).get('date');
    return date && DATE_REGEX.test(date) ? date : null;
}

async function fetchLiveData(dept, dateStr) {
    try {
        return await fetchJson(`previsions/${dept}/${dateStr}.json`);
    } catch {
        return null;
    }
}

// Statut d'un massif = clé de regles.json (même logique que server/history.mjs) :
// le niveau, sauf cas particuliers « idMassif:niveau », « niveauPprocédure », « *pProcédure »
function extractStatus(data, idMassif, reglesDept = {}) {
    const value = data?.massifs?.[idMassif];
    if (value == null) return undefined;
    const [niveau, procedure = 0] = Array.isArray(value) ? value : [value];
    const cles = [`${idMassif}:${niveau}`, `${niveau}p${procedure}`, `*p${procedure}`];
    return cles.find(cle => cle in reglesDept) ?? String(niveau);
}

// Icône calendrier (Font Awesome, livrée avec le design system SGDF)
const ICONE_CALENDRIER = '<svg viewBox="0 0 640 640" aria-hidden="true"><path fill="currentColor" d="M224 64C241.7 64 256 78.3 256 96L256 128L384 128L384 96C384 78.3 398.3 64 416 64C433.7 64 448 78.3 448 96L448 128L480 128C515.3 128 544 156.7 544 192L544 480C544 515.3 515.3 544 480 544L160 544C124.7 544 96 515.3 96 480L96 192C96 156.7 124.7 128 160 128L192 128L192 96C192 78.3 206.3 64 224 64zM160 304L160 336C160 344.8 167.2 352 176 352L208 352C216.8 352 224 344.8 224 336L224 304C224 295.2 216.8 288 208 288L176 288C167.2 288 160 295.2 160 304zM288 304L288 336C288 344.8 295.2 352 304 352L336 352C344.8 352 352 344.8 352 336L352 304C352 295.2 344.8 288 336 288L304 288C295.2 288 288 295.2 288 304zM432 288C423.2 288 416 295.2 416 304L416 336C416 344.8 423.2 352 432 352L464 352C472.8 352 480 344.8 480 336L480 304C480 295.2 472.8 288 464 288L432 288zM160 432L160 464C160 472.8 167.2 480 176 480L208 480C216.8 480 224 472.8 224 464L224 432C224 423.2 216.8 416 208 416L176 416C167.2 416 160 423.2 160 432zM304 416C295.2 416 288 423.2 288 432L288 464C288 472.8 295.2 480 304 480L336 480C344.8 480 352 472.8 352 464L352 432C352 423.2 344.8 416 336 416L304 416zM416 432L416 464C416 472.8 423.2 480 432 480L464 480C472.8 480 480 472.8 480 464L480 432C480 423.2 472.8 416 464 416L432 416C423.2 416 416 423.2 416 432z"/></svg>';

// --- Compte : bouton « Se connecter », camps de la personne connectée ---

// Personne connectée et les identifiants de ses camps, ou rien
async function chargerCompte() {
    try {
        const { user } = await fetchJson('api/me');
        if (!user) return { user: null, mesCamps: new Map() };
        const { camps, finSaison } = await fetchJson('api/mes-camps');
        return { user, finSaison, mesCamps: new Map(camps.map(c => [c.id, c])) };
    } catch {
        // Hors ligne ou serveur indisponible : la page reste utilisable sans compte
        return { user: null, mesCamps: new Map() };
    }
}

// Connecté : « Mes camps » (page de gestion) et « Déconnexion » à la place de « Se connecter »
function afficherCompte(user) {
    if (!user) return;
    document.getElementById('compte').innerHTML = `
        <span class="compte-nom">${escapeHtml(user.nom || user.identifiant)}</span>
        <a href="admin" class="bouton-barre principal">Mes camps</a>
        <button type="button" id="btn-deconnexion" class="bouton-barre">Déconnexion</button>`;
    document.getElementById('btn-deconnexion').addEventListener('click', async () => {
        await fetch('api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
        location.reload();
    });
}

function genererStructureCamp(camp, labels, compte) {
    const estMien = compte.mesCamps.has(camp.id);
    const rowsHtml = camp.zones.map(zone => {
        const cle = escapeHtml(zone.cle);
        return `
        <article id="row-${cle}" class="zone-row card-status-unknown">
            <div class="row-header">
                <div class="day-info">
                    <span class="zone-tag">${escapeHtml(zone.label)}</span>
                    <span class="tomorrow-line">
                        <span class="tomorrow-label">${labels.lendemain} :</span>
                        <span id="${cle}-tomorrow" class="badge-tomorrow-sub text-status-unknown">…</span>
                    </span>
                </div>
                <div class="today">
                    <span class="day-label">${labels.jour}</span>
                    <span id="${cle}-today" class="badge-today-main">…</span>
                </div>
            </div>
            <details class="zone-details">
                <summary>Détails et 7 derniers jours</summary>
                <div id="${cle}-detail" class="zone-detail"></div>
            </details>
        </article>`;
    }).join('');

    const lienEte = `camp.html?camp=${encodeURIComponent(camp.id)}`;
    return `
        <section class="carte camp${estMien ? ' camp-mien' : ''}">
            <h2 class="carte-titre"><a href="${lienEte}">${escapeHtml(camp.titre)}</a>${estMien ? '<span class="visually-hidden"> (votre camp)</span>' : ''}</h2>
            <div class="rows-container">${rowsHtml}</div>
            <div class="liens-camp">${liensCamp(camp, compte)}</div>
        </section>`;
}

const finTexte = (jusquAu, finSaison) => jusquAu === finSaison
    ? 'jusqu\'à la fin de l\'été' : `jusqu'au ${dateLongue(jusquAu)}`;

// Historique de l'été, puis selon la personne connectée : « S'abonner aux mails » ou « Mails jusqu'au … · modifier »
function liensCamp(camp, { user, mesCamps, finSaison }) {
    const lienEte = `<a class="lien-action" href="camp.html?camp=${encodeURIComponent(camp.id)}">${ICONE_CALENDRIER}Historique de l'été</a>`;
    const mien = mesCamps.get(camp.id);
    // Discret, à droite : l'essentiel de la carte reste le risque incendie
    const bouton = texte => `<button type="button" class="lien-discret" data-abonner="${escapeHtml(camp.id)}">${texte}</button>`;
    if (!user || (!mien && camp.termine)) return lienEte;
    if (!mien) return `${lienEte}<span class="abonnement">${bouton('S\'abonner aux mails')}</span>`;
    if (mien.role !== 'participant') return lienEte;
    return `${lienEte}<span class="abonnement">Mails ${finTexte(mien.jusqu_au, finSaison)} · ${bouton('modifier')}</span>`;
}

// --- Abonnement à un camp : fenêtre sgdf pour choisir la date de fin (facultative) ---

const dateLongue = iso => formatDate(iso, { day: 'numeric', month: 'long', year: 'numeric' });

// Ouvre la fenêtre. Résout { date } ('' = fin de l'été), { retirer: true }, ou null si annulé.
// mien : abonnement en cours (date préremplie, bouton « Me désabonner »)
async function demanderAbonnement(camp, mien, { user, finSaison }) {
    await import('/ui/admin.js');
    await customElements.whenDefined('sgdf-dialog');
    const $ = id => document.getElementById(id);
    const dialog = $('abonnement');
    const date = $('abonnement-date');
    dialog.title = camp.titre;
    $('abonnement-texte').textContent = 'Chaque soir du camp, un mail avec les accès aux massifs du lendemain.';
    $('abonnement-aide').textContent = user.email
        ? `Sans date : jusqu'à la fin de l'été (${dateLongue(finSaison)}).`
        : "Votre compte Intranet n'a pas d'e-mail : vous ne recevrez pas les mails.";
    date.value = mien && mien.jusqu_au !== finSaison ? mien.jusqu_au : '';
    date.min = getIsoDate(0);
    date.max = finSaison;
    $('abonnement-ok').textContent = mien ? 'Enregistrer' : 'M\'abonner';
    $('abonnement-retirer').hidden = !mien;
    dialog.open = true;
    return new Promise(resolve => {
        let reponse = null;
        const boutons = {
            'abonnement-ok': () => { reponse = { date: date.value || '' }; },
            'abonnement-retirer': () => { reponse = { retirer: true }; },
            'abonnement-annuler': () => {}
        };
        const clic = e => {
            const id = Object.keys(boutons).find(i => e.target.closest(`#${i}`));
            if (!id) return;
            boutons[id]();
            dialog.open = false;
        };
        dialog.addEventListener('click', clic);
        // Le calendrier du champ date émet aussi sgdf-after-hide : seul celui de la fenêtre compte
        const fin = e => {
            if (e.target !== dialog) return;
            dialog.removeEventListener('sgdf-after-hide', fin);
            dialog.removeEventListener('click', clic);
            resolve(reponse);
        };
        dialog.addEventListener('sgdf-after-hide', fin);
    });
}

function notifier(texte, erreur = false) {
    document.getElementById('toast').create(texte, erreur
        ? { variant: 'danger', title: 'Erreur', duration: 8000 }
        : { variant: 'success', title: 'C\'est fait' });
}

async function appelApi(chemin, method, body) {
    const res = await fetch(`api/${chemin}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erreur ?? `Erreur ${res.status}`);
    return data;
}

function activerAbonnement(camps, compte) {
    document.getElementById('dashboard-container').addEventListener('click', async e => {
        const bouton = e.target.closest('[data-abonner]');
        if (!bouton) return;
        const camp = camps.find(c => c.id === bouton.dataset.abonner);
        const mien = compte.mesCamps.get(camp.id);
        const choix = await demanderAbonnement(camp, mien, compte);
        if (!choix) return;
        const chemin = `mes-camps/${encodeURIComponent(camp.id)}`;
        try {
            if (choix.retirer) {
                await appelApi(chemin, 'DELETE');
                compte.mesCamps.delete(camp.id);
                notifier('Désabonné.');
            } else {
                const { jusqu_au } = await appelApi(chemin, 'POST', { jusqu_au: choix.date || null });
                compte.mesCamps.set(camp.id, { id: camp.id, role: 'participant', jusqu_au });
                notifier(`Abonné ${finTexte(jusqu_au, compte.finSaison)}.`);
            }
        } catch (err) {
            return notifier(err.message, true);
        }
        // Contour « mon camp » et liens mis à jour sur place
        const carte = bouton.closest('.camp');
        carte.classList.toggle('camp-mien', compte.mesCamps.has(camp.id));
        carte.querySelector('.liens-camp').innerHTML = liensCamp(camp, compte);
    });
}

function setTitle(el, config) {
    if (config) el.title = config.detail;
    else el.removeAttribute('title');
}

// La ligne prend la couleur du jour affiché, le lendemain n'est qu'un petit badge
function appliquerStyleRow(cle, statusToday, statusTomorrow, reglesDepartement) {
    const row = document.getElementById(`row-${cle}`);
    const txtToday = document.getElementById(`${cle}-today`);
    const txtTomorrow = document.getElementById(`${cle}-tomorrow`);

    const configToday = reglesDepartement?.[statusToday];
    const configTomorrow = reglesDepartement?.[statusTomorrow];

    if (row && txtToday) {
        row.className = `zone-row card-status-${configToday?.color ?? 'unknown'}`;
        txtToday.textContent = configToday?.label ?? 'Non disponible';
        setTitle(row, configToday);
        setTitle(txtToday, configToday);
    }
    if (txtTomorrow) {
        txtTomorrow.className = `badge-tomorrow-sub text-status-${configTomorrow?.color ?? 'unknown'}`;
        txtTomorrow.textContent = configTomorrow?.label ?? 'Non publié';
        setTitle(txtTomorrow, configTomorrow);
    }
}

// Panneau dépliable : texte réglementaire, source des données et tendance sur 7 jours
function genererDetail({ zone, labels, statusToday, statusTomorrow, sources, regles, tendance }) {
    const ligneDetail = (titre, status, source) => {
        const config = regles?.[status];
        const texte = config ? escapeHtml(config.detail) : 'Aucune donnée.';
        const origine = config ? `<span class="source">${source}</span>` : '';
        return `<p><strong>${titre} :</strong> ${texte} ${origine}</p>`;
    };

    const points = tendance.map(({ date, status }) => {
        const config = regles?.[status];
        const label = `${formatDate(date)} : ${config?.label ?? 'inconnu'}`;
        return `<li class="dot dot-${config?.color ?? 'unknown'}" title="${escapeHtml(label)}">
                    <span class="dot-day">${formatDate(date, { weekday: 'narrow' })}</span>
                    <span class="visually-hidden">${escapeHtml(label)}</span>
                </li>`;
    }).join('');

    return `
        ${ligneDetail(labels.jour, statusToday, sources.today[zone.cle])}
        ${ligneDetail(labels.lendemain, statusTomorrow, sources.tomorrow[zone.cle])}
        <p class="trend-title">${JOURS_HISTORIQUE} jours précédents</p>
        <ul class="trend">${points}</ul>`;
}

async function init() {
    const container = document.getElementById('dashboard-container');
    const statusLine = document.getElementById('status-line');

    const dateDemandee = getQueryDate();
    const todayKey = dateDemandee ?? getIsoDate(0);
    const tomorrowKey = getIsoDate(1, todayKey);
    const estAujourdhui = todayKey === getIsoDate(0);
    const labels = estAujourdhui
        ? { jour: "Aujourd'hui", lendemain: 'Demain' }
        : { jour: formatDate(todayKey), lendemain: formatDate(tomorrowKey) };

    let camps, regles, history, compte;
    try {
        [camps, regles, history, compte] = await Promise.all([
            fetchJson('./camps.json'),
            fetchJson('./regles.json'),
            // Seulement les jours affichés : tendance des jours précédents, jour choisi et lendemain
            fetchJson(`./historique.json?du=${getIsoDate(-JOURS_HISTORIQUE, todayKey)}&au=${tomorrowKey}`),
            chargerCompte()
        ]);
    } catch (e) {
        console.error("Erreur d'initialisation :", e);
        container.innerHTML = '<p class="loading">Impossible de charger les données. Réessayez plus tard.</p>';
        return;
    }

    afficherCompte(compte.user);

    // Les camps terminés ne sont plus affichés (leur page « été » reste accessible)
    // (le serveur ne publie pas les dates des camps, seulement s'ils sont terminés)
    if (estAujourdhui) camps = camps.filter(c => !c.termine);
    if (camps.length === 0) {
        container.innerHTML = '<p class="loading">Aucun camp en cours ou à venir.</p>';
        statusLine.textContent = '';
        return;
    }
    // Les camps de la personne connectée passent en premier
    const { mesCamps } = compte;
    camps = [...camps.filter(c => mesCamps.has(c.id)), ...camps.filter(c => !mesCamps.has(c.id))];

    const zones = camps.flatMap(c => c.zones);
    const historyByDate = new Map(history.map(item => [item.date, item]));
    container.innerHTML = camps.map(camp => genererStructureCamp(camp, labels, compte)).join('');
    if (compte.user) activerAbonnement(camps, compte);

    // Statuts courants par clé de zone, initialisés depuis l'historique
    const statuts = {
        today: { ...historyByDate.get(todayKey) },
        tomorrow: { ...historyByDate.get(tomorrowKey) }
    };
    const sources = { today: {}, tomorrow: {} };
    for (const jour of ['today', 'tomorrow']) {
        for (const zone of zones) sources[jour][zone.cle] = '(historique)';
    }

    const datesTendance = Array.from({ length: JOURS_HISTORIQUE },
        (_, i) => getIsoDate(i - JOURS_HISTORIQUE, todayKey));

    const updateUI = () => zones.forEach(zone => {
        const statusToday = statuts.today[zone.cle];
        const statusTomorrow = statuts.tomorrow[zone.cle];
        appliquerStyleRow(zone.cle, statusToday, statusTomorrow, regles[zone.dept]);
        document.getElementById(`${zone.cle}-detail`).innerHTML = genererDetail({
            zone, labels, statusToday, statusTomorrow, sources,
            regles: regles[zone.dept],
            tendance: datesTendance.map(date => ({ date, status: historyByDate.get(date)?.[zone.cle] }))
        });
    });
    updateUI();

    // Pour une date passée, l'historique fait foi : pas d'appel au site officiel
    if (!estAujourdhui) {
        statusLine.textContent = `Données enregistrées pour le ${formatDate(todayKey, { day: 'numeric', month: 'long', year: 'numeric' })}`;
        return;
    }

    statusLine.textContent = 'Vérification des données en direct...';

    // Données en direct : complètent ou remplacent l'historique zone par zone
    const depts = [...new Set(zones.map(z => z.dept))];
    const [liveToday, liveTomorrow] = await Promise.all(
        [todayKey, tomorrowKey].map(async key => {
            const dateStr = key.replaceAll('-', '');
            const results = await Promise.all(depts.map(dept => fetchLiveData(dept, dateStr)));
            return Object.fromEntries(depts.map((dept, i) => [dept, results[i]]));
        })
    );

    let nbLive = 0;
    for (const zone of zones) {
        for (const [jour, live] of [['today', liveToday], ['tomorrow', liveTomorrow]]) {
            const status = extractStatus(live[zone.dept], zone.id_massif, regles[zone.dept]);
            if (status !== undefined) {
                statuts[jour][zone.cle] = status;
                sources[jour][zone.cle] = '(site officiel, en direct)';
                nbLive++;
            }
        }
    }
    if (nbLive > 0) updateUI();

    const heure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date());
    statusLine.textContent = nbLive > 0
        ? `Mis à jour à ${heure} depuis le site officiel`
        : `Rien de publié en direct pour l'instant : données enregistrées (vérifié à ${heure})`;
}

init();
