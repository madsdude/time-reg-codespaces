# 🕒 Tidregistrering – Docker Guide

## 1. Forudsætninger
- Docker og Docker Compose installeret  
- Git installeret (`apt install -y git`)

## 2. Hent projektet
```bash
git clone https://github.com/madsdude/time-reg-codespaces.git
cd time-reg-codespaces
```

## 3. Start containers
```bash
docker compose up -d --build
```

Dette starter:
- **web** → port `3000`  
- **db** (PostgreSQL) → port `5432`  
- **pgadmin** → port `5050`  

## 4. Tilgå systemet
- App: `http://<serverens-IP>:3000`  
- pgAdmin: `http://<serverens-IP>:5050`  
  - Bruger: `admin@example.com`  
  - Kode: `secret123`  

## 5. Opdater kode
```bash
cd ~/time-reg-codespaces
git pull
docker compose up -d --build
```

## 6. Nyttige kommandoer
```bash
docker compose ps          # se status
docker compose logs -f web # se logs fra web
docker compose down        # stoppe alt
```

## 7. Portainer (valgfrit)
Tilgå på `http://<serverens-IP>:9000` (eller `https://<serverens-IP>:9443`)  
Genstart Portainer hvis den hænger:  
```bash
docker restart portainer
```

## 8. Tilføj en ny person

Sådan tilføjer du en ny medarbejder i systemet:

1. Gå til GitHub-repoet: `https://github.com/madsdude/time-reg-codespaces`
2. Åbn filen **`server.js`** og klik **Edit this file**.
3. Find listen:
   ```js
   const PEOPLE = [
     'Andreas Boje',
     // ...
   ];
   ```
4. Tilføj navnet i **enkeltanførselstegn** og husk **komma** efter, fx:
   ```js
   const PEOPLE = [
     'Andreas Boje',
     'Ny Person',
   ];
   ```
5. Scroll ned og klik **Commit changes**.

**Udrul ændringen på serveren (Proxmox Docker-vært):**
```bash
cd ~/time-reg-codespaces
git pull
docker compose up -d --build
```
