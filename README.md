# risqueincendie

**Prévisions des massifs pour les camps Nature Environnement**

Site qui affiche, pour les camps Nature Environnement des Scouts et Guides de France, l'accès aux massifs forestiers (risque d'incendie) aujourd'hui et demain, et qui prévient chaque soir les membres d'un camp par mail.

- Prévisions officielles des préfectures, en direct et en historique, pour 13 départements.
- Connexion avec les identifiants de l'**Intranet SGDF** : chacun retrouve ses camps.
- Les responsables d'un camp en gèrent les dates, les massifs et les membres.
- Interface aux couleurs de la charte SGDF ([sgdf-ui](https://gitlab.com/sgdf/projets-benevoles/sgdf-ui)), utilisable hors ligne sur téléphone.

> Initiative personnelle et bénévole, non éditée par les Scouts et Guides de France. Seuls les arrêtés préfectoraux et la [carte officielle](https://www.risque-prevention-incendie.fr) font foi.

## Sommaire

1. [Fonctionnalités](#fonctionnalités)
2. [Comptes et rôles](#comptes-et-rôles)
3. [Démarrage rapide en local](#démarrage-rapide-en-local)
4. [Installation en production](#installation-en-production)
5. [Modifier le pied de page et les pages obligatoires](#modifier-le-pied-de-page-et-les-pages-obligatoires)
6. [Organisation du code](#organisation-du-code)
7. [Fonctionnement détaillé](#fonctionnement-détaillé)
8. [Sécurité et données personnelles](#sécurité-et-données-personnelles)
9. [Contribuer](#contribuer)
10. [Contributeurs](#contributeurs)
11. [Licence](#licence)

## Fonctionnalités

| Page | Pour qui | Contenu |
|---|---|---|
| Accueil `/` | tout le monde | niveau de chaque massif aujourd'hui et demain, détail et 7 derniers jours. Connecté, ses camps passent en premier, avec un contour mis en valeur |
| Été d'un camp `/camp.html?camp=…` | tout le monde | calendrier du 1er juin au 30 septembre, nombre de jours par niveau |
| Connexion `/connexion` | tout le monde | identifiant et mot de passe de l'Intranet SGDF |
| Mes camps `/admin` | personnes connectées | toute la gestion : ses camps, leurs dates et membres, modification, retrait d'un camp, journal des mails |
| Pages obligatoires `/mentions-legales`, `/donnees-personnelles` | tout le monde | contenu modifiable dans [`contenu/site.yml`](contenu/site.yml) |

Un camp sans dates est seulement affiché. Pendant ses dates, ses membres reçoivent chaque soir un mail avec les prévisions du lendemain.

## Comptes et rôles

La connexion utilise l'Intranet SGDF, avec les mêmes échanges que la librairie [api-intranet-java](https://gitlab.com/sgdf/projets-benevoles/api-intranet-java) :

1. le serveur d'authentification de l'Intranet (Keycloak) vérifie l'identifiant et le mot de passe ;
2. l'API des adhérents donne le nom, l'e-mail et les structures de la personne.

Aucun mot de passe ni jeton n'est conservé. Le compte est créé à la première connexion. Le rôle de responsable est revérifié à chaque connexion.

| Rôle | Qui | Peut |
|---|---|---|
| Responsable du site | adhérents de la structure **988220500** (fonction principale ou secondaire) | tout : créer et supprimer les camps, en nommer les responsables, lancer un relevé, tester l'envoi des mails |
| Responsable d'un camp | membre du camp avec le rôle « Responsable » | modifier ce camp (nom, dates, massifs, membres), envoyer la prévision tout de suite |
| Participant d'un camp | ajouté par un responsable du camp, ou abonné de lui-même | voir le camp dans « Mes camps », s'en retirer (après confirmation) |
| Toute personne connectée | | s'abonner à un camp comme participant, jusqu'à une date choisie ou jusqu'à la fin de l'été |

- Un membre est ajouté avec son **e-mail** ou son **numéro d'adhérent** (9 chiffres). À sa connexion, il est reconnu par l'un ou l'autre. Son nom et l'information manquante sont alors complétés depuis l'Intranet.
- Un participant est retiré du camp après sa date de fin d'abonnement. **À la fin de l'été** (dernier jour de `SEASON`, le 30 septembre par défaut), tous les participants sont retirés. Les responsables restent.
- Un camp garde toujours au moins un responsable : le dernier ne peut ni se retirer ni se rétrograder. Le responsable du site, lui, le peut.

## Démarrage rapide en local

Il suffit de Docker. La commande lance le site, un **Intranet simulé** (Keycloak et API des adhérents) et **Mailpit**, une boîte mail de test.

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

| Service | Adresse |
|---|---|
| Site | http://localhost:3000 |
| Mails envoyés par le site | http://localhost:8025 |
| Administration Keycloak | http://localhost:8180 (`admin` / `admin`) |

Comptes de test, avec le mot de passe `chef` (définis dans [`dev/sgdf_local-realm.json`](dev/sgdf_local-realm.json)) :

| Identifiant | Nom | Rôle à tester |
|---|---|---|
| `100000001` | Camille Responsable | responsable du site (structure 988220500) |
| `100000002` | Dominique Admin | à nommer responsable d'un camp (e-mail `dominique.admin@example.org`) |
| `100000003` | Alex Participant | à ajouter comme participant (par son numéro) |

- Après une modification du code, relancer la même commande.
- Pour repartir de zéro : `docker compose -f docker-compose.dev.yml down -v`.
- Sans Docker (Node 24) : `npm install` puis `npm run dev`, avec les variables `INTRANET_…` d'un Keycloak. Le site est alors sur http://localhost:3000, avec les données dans `./data`.

## Installation en production

```bash
cp .env.example .env              # compléter PUBLIC_URL, PORT, INTRANET_… et SMTP_…
docker compose up -d --build
```

Le site écoute sur `127.0.0.1:<PORT>`. Il doit être placé derrière un reverse proxy HTTPS, par exemple avec [`docker/nginx-site.conf`](docker/nginx-site.conf) : le cookie de connexion n'est envoyé qu'en HTTPS. Les données (base SQLite et historique) sont dans le volume Docker `data`.

### Variables d'environnement (`.env`)

| Variable | Rôle |
|---|---|
| `PUBLIC_URL` | adresse publique du site (liens dans les mails) |
| `PORT` | port d'écoute (défaut `3000`) |
| `INTRANET_URL`, `INTRANET_REALM`, `INTRANET_CLIENT_ID`, `INTRANET_CLIENT_SECRET` | client Keycloak de l'Intranet, fourni par le SI SGDF (*Direct access grants*) |
| `INTRANET_API_URL` | adresse de l'API des adhérents de l'Intranet |
| `STRUCTURE_RESPONSABLE` | structure dont les adhérents sont responsables du site (défaut `988220500`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | envoi des mails (tout serveur SMTP) |
| `SEASON`, `START_HOUR`, `UPDATE_INTERVAL_MINUTES`, `NOTIFY_DEADLINE_HOUR` | relevé des prévisions (valeurs par défaut dans [`.env.example`](.env.example)) |
| `CONTENU_FICHIER` | autre emplacement pour `contenu/site.yml` (facultatif) |

### Mettre à jour, sauvegarder

```bash
git pull && docker compose up -d --build                                  # mise à jour
docker compose logs -f                                                    # journal
docker compose exec risqueincendie node server/cli.mjs list-users           # comptes déjà connectés
docker compose exec risqueincendie node server/cli.mjs backup               # sauvegarde dans /data/backups
docker compose cp risqueincendie:/data/backups ./backups                    # récupérer les sauvegardes
```

Lors du passage depuis une version avec comptes à mot de passe, ces comptes sont supprimés. Les contacts des camps deviennent des participants et continuent à recevoir les mails.

### Mails avec Proton Mail

1. Dans *Paramètres > IMAP/SMTP > SMTP tokens*, créer un token pour l'adresse d'envoi (adresse sur un domaine personnalisé).
2. Dans `.env`, mettre cette adresse dans `SMTP_USER` et `MAIL_FROM`, et le token dans `SMTP_PASS`, avec `SMTP_HOST=smtp.protonmail.ch` et `SMTP_PORT=587`.
3. Relancer avec `docker compose up -d`, puis cliquer sur « M'envoyer un mail de test » dans « Mes camps ».

## Modifier le pied de page et les pages obligatoires

Tout est dans [`contenu/site.yml`](contenu/site.yml) :

- `pied_de_page` : les textes et les liens du pied de page, sur toutes les pages ;
- `pages` : une page par clé, servie à `/<clé>`, par exemple les mentions légales et les données personnelles.

Le site relit le fichier dès qu'il est enregistré : pas besoin de redémarrer. Avec Docker, le dossier `contenu/` est monté dans le conteneur, donc il suffit de modifier le fichier sur le serveur. Si le fichier contient une erreur, le journal l'indique et l'ancienne version reste affichée.

Mise en forme possible dans les textes :
- une ligne vide pour changer de paragraphe ;
- des lignes commençant par `- ` pour une liste ;
- `**gras**` ;
- `[texte](https://adresse)` pour un lien.

Remplacer les `[À compléter]` (éditeur, hébergeur, contact) avant la mise en ligne.

## Organisation du code

```
public/                 Site servi aux visiteurs
  index.html            Accueil
  camp.html             Page « été » d'un camp
  connexion.html        Connexion avec l'Intranet
  admin.html            Mes camps (gestion)
  page.html             Gabarit des pages de contenu/site.yml
  css/, js/             Styles et scripts (sans framework)
  regles.json           Consigne, couleur et texte réglementaire de chaque niveau, par département
  massifs.json          Massifs proposés par département
  sw.js, manifest.json  Hors ligne et installation sur téléphone
  ui/                   Design system SGDF, construit par « npm run build » (non commité)
server/                 Serveur Node 24, sans framework
  index.mjs             Point d'entrée : pages, fichiers, prévisions en direct
  api.mjs               API (/api/…) et droits de chacun
  intranet.mjs          Connexion et fiche adhérent auprès de l'Intranet SGDF
  auth.mjs              Sessions et limitation des tentatives de connexion
  db.mjs                Base SQLite : camps, membres, comptes, sessions, journal des mails
  validation.mjs        Contrôle des données saisies
  scheduler.mjs         Relevé des prévisions en soirée, purge des anciennes données
  history.mjs           Lecture des fichiers des préfectures, historique.json
  notify.mjs            Composition et envoi des mails
  contenu.mjs           Pied de page et pages de contenu/site.yml
  config.mjs            Toutes les variables d'environnement
  http.mjs              Réponses HTTP et en-têtes de sécurité
  cli.mjs               Commandes d'exploitation (comptes, sauvegarde)
contenu/site.yml        Pied de page et pages obligatoires
client/admin.js         Composants SGDF utilisés par « Mes camps »
scripts/build-ui.mjs    Construction de public/ui
seed/                   Données importées au premier lancement
dev/                    Intranet simulé pour le développement local
docker/                 Exemple de configuration nginx
```

Dépendances d'exécution : [nodemailer](https://nodemailer.com) (mails) et [yaml](https://eemeli.org/yaml) (contenu). Tout le reste vient de Node 24 (serveur HTTP, SQLite, `fetch`).

## Fonctionnement détaillé

### Relevé des prévisions et mails

- Toutes les 15 minutes à partir de 17h (heure de Paris), du 1er juin au 30 septembre **et** pendant les dates de chaque camp, le serveur récupère les niveaux du lendemain des massifs suivis. Il met à jour `historique.json` dès qu'une valeur change.
- Pour chaque camp dont les dates couvrent le lendemain, un mail part à chaque membre qui a un e-mail :
  - dès que la préfecture a publié tous les massifs du camp ;
  - à 21h au plus tard, avec ce qui est disponible ;
  - à nouveau, avec « [Mise à jour] », si un niveau change dans la soirée.
- Les prévisions « en direct » de l'accueil passent par le serveur (`/previsions/<dept>/<AAAAMMJJ>.json`, cache de 10 minutes), car le site des préfectures refuse les appels depuis un navigateur.
- Pour consulter une date passée, ajouter `?date=AAAA-MM-JJ` à l'adresse de l'accueil.

### Départements et règles

Les données viennent de [risque-prevention-incendie.fr](https://www.risque-prevention-incendie.fr) : 13 départements (06, 07, 11, 13, 17, 26, 30, 34, 42, 66, 81, 83, 84) et 144 massifs.

- L'Ardèche (07), la Drôme (26) et la Loire (42) ne publient qu'un **niveau de risque** : le site l'affiche sans décompte « autorisé / interdit » (règle avec `"acces": false`).
- Les Alpes-de-Haute-Provence (04) et la Corse ne sont pas proposées : leurs données mélangent niveaux et arrêtés de façon trop ambiguë.
- Dans `regles.json`, la clé d'une règle est le niveau publié (`3`). Quelques cas particuliers sont essayés avant :
  - `66:3` : niveau 3 du massif n°66 seulement ;
  - `3p2` : niveau 3 avec la procédure 2 (fermeture par arrêté) ;
  - `*p1` : procédure 1, quel que soit le niveau.
- Pour ajouter un département, ajouter ses massifs dans `massifs.json` (numéro sans zéro initial) et ses règles dans `regles.json`.

### Interface et performances

- Les pages publiques n'utilisent que la feuille de style du design system SGDF (`ui/sgdf.css`) : leurs éléments reproduisent les composants en HTML/CSS, sans JavaScript de composant. « Mes camps » utilise les vrais composants `sgdf-*`, chargés après la connexion.
- Mode sombre, motifs pour les daltoniens sur les niveaux de risque.
- Objectif : 100 sur les quatre catégories Lighthouse pour les pages publiques. Chaque fichier lié reçoit une empreinte de son contenu (`style.css?v=…`), avec un cache d'un an, et les polices principales sont préchargées.
- Pour utiliser un nouveau composant SGDF, l'importer dans `client/admin.js` puis lancer `npm run build`.

## Sécurité et données personnelles

- **Connexion** : identifiants vérifiés par l'Intranet, jamais stockés. Session par cookie `HttpOnly`, `Secure`, `SameSite=Strict`, valable 30 jours, avec 10 tentatives ratées au plus par adresse IP et par quart d'heure.
- **Droits** : vérifiés par le serveur à chaque requête. Les dates d'un camp ne sont montrées qu'à ses membres, et les coordonnées des membres qu'à ses responsables. `/camps.json` ne publie que le nom et les massifs.
- **En-têtes** : Content-Security-Policy stricte sur toutes les pages (aucun script ni style en ligne, aucun site tiers), `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`. HSTS est ajouté par le reverse proxy.
- **Requêtes** : JSON obligatoire et contrôle de l'origine pour toute modification (protection CSRF), corps limité à 200 Ko, chemins de fichiers contrôlés, données saisies validées (caractères de contrôle retirés), envoi manuel des mails limité à un par minute et par camp.
- **Conservation** : participants retirés à la fin de leur abonnement (au plus tard à la fin de l'été), comptes supprimés après 3 ans sans connexion, journal des mails après 1 an (purge quotidienne automatique), sessions expirées purgées.
- **Exploitation** : conteneur sans root, secrets uniquement dans `.env` (exclu du dépôt et de l'image), dépendances fixées à une version exacte et suivies par Renovate, recherche de secrets avant chaque commit.

Le détail affiché aux utilisateurs se trouve sur la page `/donnees-personnelles`.

## Contribuer

Le dépôt suit le [template des projets bénévoles SGDF](https://gitlab.com/sgdf/projets-benevoles/pnb-template) :

- [`.gitlab-ci.yml`](.gitlab-ci.yml) : vérification des messages de commit et CHANGELOG automatique, contrôles de sécurité, construction de l'image ;
- [`renovate.json`](renovate.json) : mise à jour automatique des dépendances ;
- [`.pre-commit-config.yaml`](.pre-commit-config.yaml) : recherche de secrets et vérifications de format, à activer avec `pre-commit install`.

Les messages de commit suivent la convention [Conventional Commits](https://www.conventionalcommits.org/fr/) (`feat: …`, `fix: …`, `docs: …`), qui alimente le CHANGELOG.

## Contributeurs

- **Clément Truillet** ([@ctruillet](https://github.com/ctruillet)) : auteur et mainteneur.
- **github-actions[bot]** : relevé automatique de l'historique des prévisions (ancienne version hébergée sur GitHub Pages).

Merci aux auteurs de [sgdf-ui](https://gitlab.com/sgdf/projets-benevoles/sgdf-ui), du [template PNB](https://gitlab.com/sgdf/projets-benevoles/pnb-template) et d'[api-intranet-java](https://gitlab.com/sgdf/projets-benevoles/api-intranet-java).

## Licence

Le code de ce dépôt est sous licence **[WTFPL](LICENSE)** (*Do What The Fuck You Want To Public License*) : vous pouvez en faire ce que vous voulez.

Les éléments repris d'autres projets gardent leur propre licence, toutes libres et compatibles :

| Élément | Licence |
|---|---|
| Design system SGDF (`@sgdf/ui`), Web Awesome, esbuild | MIT |
| Lit | BSD-3-Clause |
| nodemailer | MIT-0 |
| yaml | ISC |
| Icônes Font Awesome Free | CC BY 4.0 |
| Polices Raleway, Sarabun, Caveat Brush | SIL Open Font License 1.1 |

Les notices de ces licences sont regroupées dans `public/ui/LICENCES.txt` lors de la construction. Les prévisions sont publiées par les préfectures sur [risque-prevention-incendie.fr](https://www.risque-prevention-incendie.fr). « Scouts et Guides de France » est le nom de l'association, qui n'édite pas ce site.
