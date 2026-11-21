// Connexion avec les identifiants Intranet, puis retour à la page demandée (?retour=/admin) ou à l'accueil
const form = document.getElementById('form-login');
const erreur = form.querySelector('.form-error');

// Seulement une adresse de ce site (jamais « //autre-site »)
function pageDeRetour() {
    const retour = new URLSearchParams(location.search).get('retour') ?? '';
    return /^\/(?!\/)/.test(retour) ? retour : '/';
}

function afficherErreur(texte) {
    erreur.textContent = texte ?? '';
    erreur.hidden = !texte;
}

form.addEventListener('submit', async e => {
    e.preventDefault();
    afficherErreur();
    const bouton = form.querySelector('button');
    bouton.disabled = true;
    bouton.textContent = 'Vérification…';
    try {
        const res = await fetch('api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                identifiant: form.identifiant.value.trim(),
                password: form.password.value
            })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.erreur ?? `Erreur ${res.status}`);
        location.replace(pageDeRetour());
    } catch (err) {
        afficherErreur(err.message === 'Failed to fetch' ? 'Pas de connexion réseau.' : err.message);
        form.password.value = '';
        form.password.focus();
        bouton.disabled = false;
        bouton.textContent = 'Se connecter';
    }
});

// Déjà connecté : directement à la page demandée
fetch('api/me').then(r => r.json()).then(({ user }) => {
    if (user) location.replace(pageDeRetour());
}).catch(() => {});
