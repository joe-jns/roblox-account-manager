# Roblox Account Manager

Gestionnaire local de comptes Roblox (app desktop Electron). 100 % hors-ligne,
aucune donnée n'est envoyée sur Internet.

## Champs par compte
Pseudo · Mot de passe (masqué) · Tranche d'âge · Voice chat · Âge vérifié ·
Jeux bannis · Statut (Actif / Averti / Banni) · Étiquettes · Date d'ajout · Notes.

## Lancer en développement
```bash
npm install
npm start
```

## Générer un .exe portable
```bash
npm run dist
```
Le `.exe` est produit dans `dist/`.

## Où sont mes données ?
Un fichier `accounts.json` dans le dossier de données de l'app
(`%APPDATA%/roblox-account-manager/` sous Windows). Utilise **Exporter**
pour en faire une sauvegarde ailleurs.

> Les mots de passe sont stockés en clair dans ce fichier (choix assumé pour
> un usage perso sur ta machine). Ne partage pas `accounts.json`.
