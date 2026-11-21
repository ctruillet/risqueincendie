// Construit public/ui/ à partir du design system SGDF (@sgdf/ui) :
//   admin.js            composants de l'admin (chargés après la connexion)
//   Les pages publiques n'utilisent que sgdf.css : leurs éléments reprennent le rendu SGDF en HTML/CSS.
//   sgdf.css            tokens, thème, styles globaux et polices de la charte (servies localement)
//   icons/              icônes utilisées, chargées à la demande par sgdf-icon
// Lancé par « npm run build » et pendant la construction de l'image Docker.
import { build } from 'esbuild';
import { rmSync, mkdirSync, cpSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const sortie = join(racine, 'public', 'ui');
const sgdf = join(racine, 'node_modules', '@sgdf', 'ui', 'dist');

rmSync(sortie, { recursive: true, force: true });
mkdirSync(sortie, { recursive: true });

await build({
    entryPoints: { admin: join(racine, 'client/admin.js') },
    outdir: sortie,
    bundle: true,
    splitting: true,
    format: 'esm',
    minify: true,
    target: 'es2022',
    chunkNames: 'communs/[name]-[hash]',
    legalComments: 'none',
    logLevel: 'warning'
});

await build({
    entryPoints: { sgdf: join(sgdf, 'styles/index.css') },
    outdir: sortie,
    bundle: true,
    minify: true,
    loader: { '.woff2': 'file' },
    assetNames: 'polices/[name]',
    logLevel: 'warning'
});

// Icônes : seulement celles que les composants ou nos pages peuvent demander (noms cités entre
// guillemets dans le code), pas les ~1 400 de la bibliothèque
const textes = [readFileSync(join(sortie, 'admin.js'), 'utf8'),
    ...['admin.html', 'js/admin.js'].map(f => readFileSync(join(racine, 'public', f), 'utf8'))].join('\n');
const noms = new Set([...textes.matchAll(/["'`]([a-z0-9]+(?:-[a-z0-9]+)*)["'`]/g)].map(m => m[1]));
let copiees = 0;
for (const bibliotheque of ['solid', 'regular', 'sgdf-picto']) {
    const source = join(sgdf, 'icons', bibliotheque);
    mkdirSync(join(sortie, 'icons', bibliotheque), { recursive: true });
    for (const fichier of readdirSync(source)) {
        if (!noms.has(fichier.replace(/\.svg$/, ''))) continue;
        cpSync(join(source, fichier), join(sortie, 'icons', bibliotheque, fichier));
        copiees++;
    }
}
// Licences des bibliothèques embarquées dans public/ui (MIT : la notice doit accompagner les fichiers)
const licences = [
    ['@sgdf/ui (sgdf-ui, Scouts et Guides de France)', null],
    ['@awesome.me/webawesome (Web Awesome)', 'node_modules/@awesome.me/webawesome/LICENSE.md'],
    ['lit', 'node_modules/lit/LICENSE'],
    ['lit-html', 'node_modules/lit-html/LICENSE'],
    ['lit-element', 'node_modules/lit-element/LICENSE'],
    ['@lit/reactive-element', 'node_modules/@lit/reactive-element/LICENSE']
].map(([nom, fichier]) => `== ${nom}\n\n${fichier && existsSync(join(racine, fichier))
    ? readFileSync(join(racine, fichier), 'utf8').trim()
    : 'Licence MIT : https://gitlab.com/sgdf/projets-benevoles/sgdf-ui'}\n`);
licences.push('== Icônes Font Awesome Free (dans icons/) : CC BY 4.0, notice dans chaque fichier SVG\n'
    + '== Polices Raleway, Sarabun, Caveat Brush (dans polices/) : SIL Open Font License 1.1\n');
writeFileSync(join(sortie, 'LICENCES.txt'), licences.join('\n'));

console.log(`✅ public/ui construit (${copiees} icônes)`);
