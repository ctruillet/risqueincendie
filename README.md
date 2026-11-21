# Nature Environnement - Prévisions des Massifs

Site pour suivre les restrictions d'accès aux massifs forestiers (risques d'incendie) pendant les camps SGDF. Connexion avec les identifiants Intranet SGDF : chacun retrouve ses camps, les admins de camp gèrent dates, massifs et membres, et les membres sont prévenus par mail.

Le dépôt suit le [template des projets bénévoles SGDF](https://gitlab.com/sgdf/projets-benevoles/pnb-template) : `.gitlab-ci.yml`, `renovate.json`, `.pre-commit-config.yaml` (à activer avec `pre-commit install`, détecte notamment les secrets) et image Docker sans root.

## Organisation du projet

```
public/                 Site servi aux visiteurs
  index.html            Accueil : niveaux du jour et du lendemain par camp
  camp.html             Page « été » d'un camp (calendrier et nombre de jours par niveau)
  connexion.html        Connexion avec les identifiants Intranet
  admin.html            Administration (camps, dates, massifs, membres)
  css/                  style.css (site), admin.css (admin)
  js/                   common.js (partagé), app.js, camp.js, connexion.js, admin.js
  ui/                   Design system SGDF construit par « npm run build » (non commité)
  regles.json           Consigne, couleur et texte réglementaire de chaque niveau, par département
  massifs.json          Liste des massifs par département, proposée dans l'admin
  sw.js, manifest.json  Fonctionnement hors ligne / installation sur mobile
server/                 Serveur Node 24
  index.mjs             Point d'entrée : sert le site, lance le relevé périodique
  config.mjs            Toutes les variables d'environnement
  api.mjs               API (/api/…) et droits de chacun
  validation.mjs        Contrôle des données saisies dans l'admin
  scheduler.mjs         Relevé des prévisions toutes les 15 min en soirée
  history.mjs           Récupération des niveaux sur le site des préfectures, historique.json
  notify.mjs            Composition et envoi des mails
  db.mjs                Base SQLite (camps, membres, comptes, sessions, journal des mails)
  intranet.mjs          Vérification des identifiants auprès de l'Intranet SGDF (Keycloak)
  auth.mjs              Sessions, responsables du site, limitation des tentatives de connexion
  http.mjs              Outils HTTP (réponses, sécurité)
  cli.mjs               Liste des comptes et sauvegardes en ligne de commande
client/                 Composants SGDF de l'admin (admin.js, admin-app.js)
scripts/build-ui.mjs    Construit public/ui à partir de @sgdf/ui
seed/                   Données importées au premier lancement (camps.json, historique.json)
docker/                 Exemple de configuration nginx (HTTPS)
keycloak/               Royaume Keycloak qui simule l'Intranet en local (comptes de test)
docker-compose.dev.yml  Environnement local : site + Keycloak + boîte mail de test
```

Les données vivantes sont dans `DATA_DIR` (le volume Docker `data`, ou `./data` en local) :
`ne.db` (base SQLite) et `historique.json`.

## Fonctionnement

- **Relevé des prévisions** : toutes les 15 minutes à partir de 17h (heure de Paris), du 1er juin au 30 septembre **et** pendant les dates de chaque camp, le serveur récupère les niveaux du lendemain de tous les massifs suivis et met à jour `historique.json` dès qu'une valeur change (les préfectures publient parfois des mises à jour dans la soirée).
- **Mails** : pour chaque camp dont les dates couvrent le lendemain, à chaque membre du camp qui a un e-mail (admins et participants) :
  - un mail part dès que la préfecture a publié tous les massifs du camp ;
  - si ce n'est pas le cas à 21h, il part avec ce qui est disponible ;
  - si un niveau change plus tard dans la soirée, un mail « [Mise à jour] » est renvoyé.
- **Page d'accueil** : affiche les camps, sauf ceux qui sont terminés (leur page « été » reste accessible). Les dates des camps ne sont pas publiées. Une fois connecté, ses propres camps passent en premier, mis en avant avec leurs dates et son rôle.
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

## Comptes et rôles

Bouton **Se connecter** en haut de l'accueil : connexion avec l'identifiant (numéro d'adhérent) et le mot de passe de l'**Intranet SGDF**. Le site transmet l'identifiant et le mot de passe au serveur d'authentification de l'Intranet (Keycloak, même échange que la librairie [api-intranet-java](https://gitlab.com/sgdf/projets-benevoles/api-intranet-java)) et ne garde que le nom, l'identifiant et l'e-mail renvoyés. Aucun mot de passe n'est conservé. Le compte est créé à la première connexion.

| Rôle | Qui | Peut |
|---|---|---|
| Responsable du site | identifiants ou e-mails listés dans `SUPER_ADMINS` | tout : créer, supprimer et ordonner les camps, en nommer les admins, lancer un relevé |
| Admin d'un camp | membre du camp avec le rôle « Admin » | modifier ce camp (nom, dates, massifs), ajouter ou retirer ses membres, envoyer la prévision tout de suite |
| Participant d'un camp | membre du camp avec le rôle « Participant » | voir le camp mis en avant sur l'accueil, s'en retirer (après confirmation) |

- Un membre est ajouté avec son **e-mail**, son **numéro d'adhérent**, ou les deux. À sa connexion, il est reconnu par l'un ou l'autre, et l'information manquante est complétée depuis l'Intranet (un membre ajouté par numéro reçoit donc les mails dès sa première connexion).
- Un camp garde toujours au moins un admin : le dernier admin ne peut ni se retirer ni se rétrograder (le responsable du site, lui, peut).
- Page `/admin` : les camps que l'on administre (tous pour le responsable) et le journal des mails envoyés pour ces camps.

## Installation avec Docker

```bash
cp .env.example .env              # compléter PUBLIC_URL, PORT, INTRANET_…, SUPER_ADMINS et la partie SMTP
docker compose up -d --build
```

Les valeurs `INTRANET_URL`, `INTRANET_REALM`, `INTRANET_CLIENT_ID` et `INTRANET_CLIENT_SECRET` sont fournies par le SI SGDF : un client Keycloak autorisé à vérifier les identifiants (*Direct access grants*). Mettre son propre identifiant Intranet dans `SUPER_ADMINS`, puis se connecter : on crée alors les camps et on en nomme les admins.

Lors de la mise à jour depuis une version avec comptes à mot de passe, ces comptes sont supprimés et les contacts des camps deviennent des participants (ils continuent à recevoir les mails).

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
docker compose exec risquemassif node server/cli.mjs list-users              # comptes déjà connectés
docker compose exec risquemassif node server/cli.mjs backup                  # sauvegarde dans /data/backups
docker compose cp risquemassif:/data/backups ./backups                       # récupérer les sauvegardes
```

### Mails

N'importe quel serveur SMTP convient : `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` et `MAIL_FROM` dans `.env`. Avec Proton Mail :

1. *Paramètres > IMAP/SMTP > SMTP tokens* : créer un token pour l'adresse d'envoi (adresse sur domaine personnalisé).
2. Dans `.env` : `SMTP_USER` et `MAIL_FROM` = cette adresse, `SMTP_PASS` = le token.
3. `docker compose up -d` puis, dans l'admin, « M'envoyer un mail de test ».

### Confidentialité

- Les membres et les dates des camps ne sont jamais publiés : `/camps.json` ne donne que le nom, les massifs et si le camp est terminé. Les dates ne sont montrées qu'aux membres du camp, et les coordonnées des membres qu'à ses admins.
- Les membres et les comptes sont uniquement dans la base, jamais dans le dépôt. Aucun mot de passe n'est stocké.
- `.env` (secret du client Intranet, token SMTP) est exclu du dépôt et de l'image Docker.

## Développement en local

Avec Docker, sans rien installer d'autre : le site, un **Keycloak qui simule l'Intranet** et **Mailpit**, une boîte mail de test.

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

- Site : http://localhost:3000
- Mails envoyés par le site : http://localhost:8025
- Administration Keycloak : http://localhost:8180 (`admin` / `admin`)

Comptes de test (mot de passe `chef`, dans `keycloak/sgdf_local-realm.json`) :

| Identifiant | Nom | Pour tester |
|---|---|---|
| `100000001` | Camille Responsable | responsable du site (`SUPER_ADMINS`) |
| `100000002` | Dominique Admin | à nommer admin d'un camp (e-mail `dominique.admin@example.org`) |
| `100000003` | Alex Participant | à ajouter comme participant (par son numéro) |

Après une modification du code : relancer la même commande. Pour repartir de zéro : `docker compose -f docker-compose.dev.yml down -v`.

Sans Docker (Node 24) : `npm install`, puis `npm run dev` avec les variables `INTRANET_…` d'un Keycloak (http://localhost:3000, données dans `./data`). `npm run dev` désactive l'option `Secure` du cookie pour pouvoir se connecter en http.
