# Nature Environnement - Prévisions des Massifs

Site pour suivre les restrictions d'accès aux massifs forestiers (risques d'incendie) pendant les camps SGDF, avec une page d'administration pour gérer les camps et prévenir leurs contacts par mail.

## Organisation du projet

```
public/                 Site servi aux visiteurs
  index.html            Accueil : niveaux du jour et du lendemain par camp
  camp.html             Page « été » d'un camp (calendrier et nombre de jours par niveau)
  admin.html            Administration (camps, dates, contacts, comptes)
  css/                  style.css (site), admin.css (admin)
  js/                   common.js (partagé), app.js, camp.js, admin.js
  ui/                   Design system SGDF construit par « npm run build » (non commité)
  regles.json           Consigne, couleur et texte réglementaire de chaque niveau, par département
  massifs.json          Liste des massifs par département, proposée dans l'admin
  sw.js, manifest.json  Fonctionnement hors ligne / installation sur mobile
server/                 Serveur Node 24
  index.mjs             Point d'entrée : sert le site, lance le relevé périodique
  config.mjs            Toutes les variables d'environnement
  api.mjs               API de l'admin (/api/…)
  validation.mjs        Contrôle des données saisies dans l'admin
  scheduler.mjs         Relevé des prévisions toutes les 15 min en soirée
  history.mjs           Récupération des niveaux sur le site des préfectures, historique.json
  notify.mjs            Composition et envoi des mails
  db.mjs                Base SQLite (camps, contacts, comptes, sessions, journal des mails)
  auth.mjs              Mots de passe, sessions, limitation des tentatives de connexion
  http.mjs              Outils HTTP (réponses, sécurité)
  cli.mjs               Comptes et sauvegardes en ligne de commande
client/                 Composants SGDF de l'admin (admin.js : connexion, admin-app.js : le reste)
scripts/build-ui.mjs    Construit public/ui à partir de @sgdf/ui
seed/                   Données importées au premier lancement (camps.json, historique.json)
docker/                 Exemple de configuration nginx (HTTPS)
```

Les données vivantes sont dans `DATA_DIR` (le volume Docker `data`, ou `./data` en local) :
`ne.db` (base SQLite) et `historique.json`.

## Fonctionnement

- **Relevé des prévisions** : toutes les 15 minutes à partir de 17h (heure de Paris), du 1er juin au 30 septembre **et** pendant les dates de chaque camp, le serveur récupère les niveaux du lendemain de tous les massifs suivis et met à jour `historique.json` dès qu'une valeur change (les préfectures publient parfois des mises à jour dans la soirée).
- **Mails** : pour chaque camp dont les dates couvrent le lendemain, et qui a au moins un contact :
  - un mail part dès que la préfecture a publié tous les massifs du camp ;
  - si ce n'est pas le cas à 21h, il part avec ce qui est disponible ;
  - si un niveau change plus tard dans la soirée, un mail « [Mise à jour] » est renvoyé.
- **Page d'accueil** : affiche les camps, sauf ceux qui sont terminés (leur page « été » reste accessible). Les dates des camps ne sont pas affichées.
- **Date passée** : ajouter `?date=AAAA-MM-JJ` à l'adresse (données de l'historique uniquement).

## Départements couverts

Les données viennent de https://www.risque-prevention-incendie.fr. 13 départements sont proposés dans l'admin (144 massifs) : 06, 07, 11, 13, 17, 26, 30, 34, 42, 66, 81, 83, 84.

- L'Ardèche (07), la Drôme (26) et la Loire (42) ne publient qu'un **niveau de risque**, sans consigne d'accès : le site l'affiche tel quel, sans décompte « autorisé / interdit ».
- Les Alpes-de-Haute-Provence (04) et la Corse (2A/2B) ne sont pas proposées : leur site mélange niveaux et arrêtés de fermeture de façon trop ambiguë pour en tirer une consigne fiable.

Dans `regles.json`, la clé d'une règle est le niveau publié (« 3 »). Quelques cas particuliers sont possibles, essayés avant le niveau :
- `66:3` : niveau 3 du massif n°66 seulement ;
- `3p2` : niveau 3 avec la procédure 2 (fermeture par arrêté) ;
- `*p1` : procédure 1, quel que soit le niveau.

Une règle avec `"acces": false` est un simple niveau de risque.

Pour ajouter un département : ses massifs dans `massifs.json` (identifiant = numéro utilisé dans les fichiers du site, sans zéro initial, ex. `6` pour les Alpes-Maritimes) et ses règles dans `regles.json`.

## Interface : design system SGDF

L'interface utilise [sgdf-ui](https://gitlab.com/sgdf/projets-benevoles/sgdf-ui) (`@sgdf/ui`, licence MIT) : polices, couleurs et thème clair/sombre de la charte SGDF partout, composants `sgdf-*` dans l'admin.

- **Pages publiques** (accueil, page « été ») : elles n'utilisent que la feuille de style du design system (`ui/sgdf.css`). La barre, le titre, les cartes, les onglets, la liste des étés et le pied de page reprennent le rendu des composants SGDF en HTML/CSS (`public/css/style.css`), sans charger leur JavaScript : affichage immédiat, sans décalage, rapide sur téléphone.
- **Admin** : vrais composants `sgdf-*`. La page de connexion est en HTML/CSS ; les composants (`ui/admin.js`, `ui/admin-app.js`) ne sont chargés qu'une fois connecté.
- **Mode sombre** : palette bleu nuit définie dans `public/css/style.css` (surcharge des tokens `--sgdf-*`), pour le thème du système comme pour `data-theme="dark"`.

- Le paquet vient du registre GitLab du projet (voir `.npmrc`), sans jeton. Sa version est fixée dans `package.json` ; Web Awesome (`@awesome.me/webawesome`) doit rester dans la plage demandée par `@sgdf/ui`.
- `npm run build` (lancé aussi dans l'image Docker) regroupe les composants utilisés (`client/`) dans `public/ui/` avec esbuild, ainsi que la feuille de style, les polices et les icônes : tout est servi par le site, sans requête vers un service extérieur.
- Pour utiliser un nouveau composant dans l'admin, l'importer dans `client/admin-app.js`, puis relancer `npm run build`.
- Les licences des bibliothèques embarquées sont regroupées dans `public/ui/LICENCES.txt` au moment de la construction.
- Les couleurs des niveaux de risque (vert, jaune, orange, rouge, noir, avec motifs pour les daltoniens) restent propres au site, dans `public/css/style.css`.

## Performances et cache

Objectif : 100 sur les quatre catégories Lighthouse (performance, accessibilité, bonnes pratiques, SEO) pour les pages publiques, sur mobile et ordinateur.

- Le serveur ajoute à chaque fichier lié depuis une page une empreinte de son contenu (`style.css?v=…`) : ces adresses sont mises en cache un an, et une nouvelle version change d'adresse.
- Les polices affichées dès l'arrivée sont préchargées.
- Les prévisions « en direct » passent par le serveur (`/previsions/<dept>/<AAAAMMJJ>.json`, aujourd'hui et demain, cache de 10 minutes), le site des préfectures n'autorisant pas les appels depuis un navigateur.
- L'admin est volontairement exclu des moteurs de recherche (`noindex`, `robots.txt`) : c'est le seul point SEO à moins de 100.

## Administration

Page `/admin`, avec un compte par personne.
- **Camps** : nom, dates, massifs (choisis dans la liste par département) et contacts (nom, email).
- **Mails envoyés** : journal des envois et des erreurs.
- **Comptes** : créer ou supprimer des comptes, changer son mot de passe.

Boutons utiles : « Vérifier les prévisions maintenant », « M'envoyer un mail de test », et « Envoyer la prévision de demain » sur chaque camp.

## Installation avec Docker

```bash
cp .env.example .env              # compléter PUBLIC_URL, PORT et la partie SMTP
docker compose up -d --build
docker compose exec risquemassif node server/cli.mjs add-user moi@example.fr "Mon Nom"
```

La dernière commande crée le premier compte admin et affiche un mot de passe provisoire, à changer dans l'admin (onglet « Comptes »). Les comptes suivants se créent depuis l'admin.

Le site écoute sur `127.0.0.1:<PORT>`. Placez devant un reverse proxy HTTPS, par exemple avec le bloc nginx de [`docker/nginx-site.conf`](docker/nginx-site.conf) : le cookie de connexion à l'admin n'est envoyé qu'en HTTPS (pour un essai local en http, ajouter `COOKIE_SECURE=0` dans `.env`).

Les données (base SQLite et historique) sont dans le volume Docker `data` : une mise à jour du code ne les touche pas.

### Mettre à jour

```bash
git pull
docker compose up -d --build
```

### Commandes utiles

```bash
docker compose logs -f                                                    # journal
docker compose exec risquemassif node server/cli.mjs reset-password <email>  # mot de passe oublié
docker compose exec risquemassif node server/cli.mjs backup                  # sauvegarde dans /data/backups
docker compose cp risquemassif:/data/backups ./backups                       # récupérer les sauvegardes
```

### Mails

N'importe quel serveur SMTP convient : `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` et `MAIL_FROM` dans `.env`. Avec Proton Mail :

1. *Paramètres > IMAP/SMTP > SMTP tokens* : créer un token pour l'adresse d'envoi (adresse sur domaine personnalisé).
2. Dans `.env` : `SMTP_USER` et `MAIL_FROM` = cette adresse, `SMTP_PASS` = le token.
3. `docker compose up -d` puis, dans l'admin, « M'envoyer un mail de test ».

### Confidentialité

- Les contacts et les dates des camps ne sont jamais publiés : `/camps.json` ne donne que le nom, les massifs et si le camp est terminé.
- Les contacts, comptes et mots de passe (hachés) sont uniquement dans la base, jamais dans le dépôt.
- `.env` (token SMTP) est exclu du dépôt et de l'image Docker.

## Développement en local

Nécessite Node 24.

```bash
npm install
npm run dev                                          # construit l'interface, puis http://localhost:3000 (données dans ./data)
node server/cli.mjs add-user moi@example.fr "Moi"   # premier compte
```

`npm run dev` désactive l'option `Secure` du cookie pour pouvoir se connecter en http.
