# Roblox Account Manager — Design

Date : 2026-07-01

## But
App desktop locale (Electron) pour gérer une collection de comptes Roblox : identifiants,
statut de ban, voice chat, vérification d'âge, jeux bannis, étiquettes et notes.
100 % local, aucune connexion réseau, aucune donnée envoyée à l'extérieur.

## Direction UI — AUCUN AI slop
- Vraie esthétique d'outil desktop : dense, fonctionnel, calme.
- Thème sombre soigné, palette restreinte, **un seul** accent.
- Typographie système (Segoe UI), monospace pour mot de passe / valeurs techniques.
- Statuts en pastilles de couleur (vert / ambre / rouge).
- Interdits : dégradés violet/indigo, glassmorphism, ombres lourdes, cartes à emojis,
  hero marketing, coins ultra-arrondis « bubble ».

## Modèle de données
Fichier unique `accounts.json` dans `app.getPath('userData')`, en clair.

Compte :
| Champ        | Type                                            |
|--------------|-------------------------------------------------|
| id           | uuid (auto)                                     |
| pseudo       | string (obligatoire)                            |
| password     | string (masqué, voir + copier)                  |
| ageRange     | `<13` \| `13+` \| `17+` \| `Inconnu`            |
| voiceChat    | bool                                            |
| ageVerified  | bool                                            |
| bannedGames  | string[] (noms de jeux)                         |
| status       | `Actif` \| `Averti` \| `Banni`                  |
| tags         | string[]                                        |
| dateAdded    | ISO date (auto, modifiable)                     |
| notes        | string                                          |

## Écran (une fenêtre, 2 colonnes)
- **Barre haute** : `+ Nouveau`, `Exporter`, `Importer`, compteur de comptes.
- **Colonne gauche** : recherche (pseudo/tag) + filtres cliquables (statut, voice, âge vérifié)
  + liste des comptes avec pastille de statut.
- **Colonne droite** : fiche du compte sélectionné (édition), boutons copier pseudo / copier mdp,
  Enregistrer, Supprimer.

## Comportements
- Sauvegarde auto (débounce) à chaque modif.
- Import : demander **Fusionner** ou **Remplacer**.
- Export : dialogue « enregistrer sous » -> fichier .json.
- Aucun accès réseau.

## Architecture
- `main.js` — BrowserWindow + IPC (load/save accounts, export/import via dialog).
- `preload.js` — contextBridge, API sûre, pas de Node exposé au renderer.
- `index.html` / `styles.css` / `renderer.js` — interface.
- `package.json` — `npm start` (lancer), `npm run dist` (electron-builder -> .exe).

## Sécurité / scope
- Usage perso, machine locale. Mots de passe en clair par choix explicite.
- `contextIsolation: true`, `nodeIntegration: false`.
- Pas de chiffrement au repos (hors scope V1).
