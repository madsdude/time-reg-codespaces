# Tidregistrering — Web + PostgreSQL + pgAdmin (klar til VS Code & Codespaces)

En simpel tidregistreringsapp: opret registreringer pr. dag/projekt, se liste og ugens total. Kører i Docker, med devcontainer til VS Code og GitHub Codespaces.

## Hurtig start (lokalt)
```bash
docker compose up -d --build
```
Åbn:
- App: http://localhost:3000
- pgAdmin: http://localhost:5050  (login: `admin@example.com` / `secret123`)

**Live notifikationer i pgAdmin**
1) pgAdmin → `Tools → Query Tool` på `appdb`
2) Kør: `LISTEN time_entries_changes;`
3) Åbn fanen **Notifications** for push-events ved nye/ændrede registreringer.

## API
- `GET /api/projects` — liste projekter
- `GET /api/time-entries?from=YYYY-MM-DD&to=YYYY-MM-DD` — filtreret liste (valgfrit)
- `POST /api/time-entries`
  ```json
  {
    "user_id": 1,
    "project_id": 1,
    "work_date": "2025-08-27",
    "start_time": "08:00",
    "end_time": "16:00",
    "break_minutes": 30,
    "note": "Opsætning af miljø"
  }
  ```

## Useful
```bash
docker compose ps
docker compose logs -f web
docker compose down          # stop (data bevares)
docker compose down -v       # stop + slet data (init-scripts kører igen)
```

## Struktur
```text
.
├─ .devcontainer/
│  └─ devcontainer.json
├─ db/
│  └─ init/
│     ├─ 01_schema.sql
│     └─ 02_notify_time_entries.sql
├─ public/
│  └─ index.html
├─ .github/workflows/ci.yml
├─ .gitignore
├─ .env.example
├─ docker-compose.yml
├─ Dockerfile
├─ package.json
├─ server.js
└─ README.md
```

## Klar til GitHub
```bash
git init
git add .
git commit -m "Initial: Tidregistrering (web + db + pgAdmin + devcontainer + notify)"
git branch -M main
git remote add origin https://github.com/<brugernavn>/<repo>.git
git push -u origin main
```
