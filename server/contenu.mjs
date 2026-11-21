// Contenu modifiable sans toucher au code : pied de page et pages obligatoires (contenu/site.yml).
// Le fichier est relu dès qu'il change. S'il contient une erreur, elle est écrite dans le journal et
// la dernière version correcte reste affichée (au démarrage, le serveur s'arrête avec l'erreur).
import { readFileSync, statSync } from 'node:fs';
import { parse } from 'yaml';
import { CONTENU_FICHIER } from './config.mjs';

// Adresses déjà prises par le site : une page ne peut pas les utiliser
const RESERVEES = new Set(['admin', 'connexion', 'api', 'healthz', 'previsions', 'ui', 'css', 'js', 'img']);

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

// Lien autorisé : adresse web, adresse du site (/…) ou e-mail
function lien(texte, adresse) {
    const externe = /^https?:\/\//.test(adresse);
    if (!externe && !/^(\/(?!\/)|mailto:)/.test(adresse)) throw new Error(`Lien refusé : ${adresse}`);
    const cible = externe ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(adresse)}"${cible}>${escapeHtml(texte)}</a>`;
}

// Mise en forme simple : **gras**, [texte](adresse), une ligne vide entre deux paragraphes,
// des lignes commençant par « - » pour une liste
function enligne(texte) {
    return texte.split(/(\[[^\]]+\]\([^)\s]+\))/).map(morceau => {
        const m = morceau.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        return m ? lien(m[1], m[2]) : escapeHtml(morceau).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    }).join('');
}

function texteEnHtml(texte) {
    return String(texte ?? '').trim().split(/\n\s*\n/).map(bloc => {
        const lignes = bloc.split('\n').map(l => l.trim()).filter(Boolean);
        if (lignes.every(l => l.startsWith('- '))) {
            return `<ul>${lignes.map(l => `<li>${enligne(l.slice(2))}</li>`).join('')}</ul>`;
        }
        return `<p>${enligne(lignes.join(' '))}</p>`;
    }).join('\n');
}

const texteRequis = (valeur, ou) => {
    if (typeof valeur !== 'string' || !valeur.trim()) throw new Error(`${ou} : texte attendu`);
    return valeur.trim();
};

// Contrôle le fichier et prépare le HTML une fois pour toutes
function compiler(source) {
    const yaml = parse(source) ?? {};
    const pied = yaml.pied_de_page ?? {};
    const textes = (pied.textes ?? []).map((t, i) => `<p>${enligne(texteRequis(t, `pied_de_page.textes[${i + 1}]`))}</p>`);
    const liens = (pied.liens ?? []).map((l, i) =>
        `<li>${lien(texteRequis(l?.texte, `pied_de_page.liens[${i + 1}].texte`), texteRequis(l?.adresse, `pied_de_page.liens[${i + 1}].adresse`))}</li>`);

    const pages = new Map();
    for (const [adresse, page] of Object.entries(yaml.pages ?? {})) {
        if (!/^[a-z0-9-]+$/.test(adresse) || RESERVEES.has(adresse)) {
            throw new Error(`pages.${adresse} : adresse invalide (minuscules, chiffres et tirets, hors ${[...RESERVEES].join(', ')})`);
        }
        const titre = texteRequis(page?.titre, `pages.${adresse}.titre`);
        const sections = (page.sections ?? []).map((s, i) => `
            <section class="carte page-section">
                ${s?.titre ? `<h2>${escapeHtml(s.titre)}</h2>` : ''}
                ${texteEnHtml(texteRequis(s?.texte, `pages.${adresse}.sections[${i + 1}].texte`))}
            </section>`).join('');
        pages.set(adresse, {
            titre: escapeHtml(titre),
            description: escapeHtml(page.description ?? titre),
            html: (page.introduction ? `<p class="chapeau">${enligne(page.introduction)}</p>` : '') + sections
        });
    }

    return {
        pages,
        piedDePage: `
    <footer class="pied">
        <div class="pied-corps">
            <div class="pied-haut">
                <a href="./" class="marque"><img src="logo.svg" alt="" width="35" height="32">Nature Environnement</a>
                <div class="footer-texte">${textes.join('')}</div>
            </div>
            ${liens.length ? `<ul class="pied-liens">${liens.join('')}</ul>` : ''}
        </div>
    </footer>`
    };
}

let actuel = null;
let mtime = 0;

function contenu() {
    const m = statSync(CONTENU_FICHIER).mtimeMs;
    if (actuel && m === mtime) return actuel;
    try {
        actuel = compiler(readFileSync(CONTENU_FICHIER, 'utf8'));
        if (mtime) console.log(`📝 ${CONTENU_FICHIER} rechargé.`);
    } catch (e) {
        if (!actuel) throw new Error(`${CONTENU_FICHIER} : ${e.message}`);
        console.error(`❌ ${CONTENU_FICHIER} n'est pas valide, l'ancienne version reste affichée : ${e.message}`);
    }
    mtime = m;
    return actuel;
}

// Vérifié au démarrage : une erreur dans le fichier empêche de lancer le site
contenu();

export const piedDePage = () => contenu().piedDePage;
export const page = adresse => contenu().pages.get(adresse) ?? null;
