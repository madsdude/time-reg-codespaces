
const express = require('express');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://appuser:apprandompass@db:5432/appdb';
const pool = new Pool({ connectionString: DATABASE_URL });

// ---- Personer (seed-list) ----
const PEOPLE = [
  'Andreas Boje',
  'Benjamin Borup',
  'Benjamin Fagerlund',
  'Cathrine Christensen',
  'Cecilie Carstensen',
  'Cecilie Dalsgaard',
  'Christina Løvkvist',
  'Claus DM',
  'Denys Leheta',
  'Emilie Risgaard',
  'Hartvig',
  'Kasper Petersen',
  'Kevin Ravichandran',
  'Lasse Hejgaard',
  'Laura Ladekarl',
  'Mads Churchill',
  'Maj Andersen',
  'Maria Krøgh',
  'Mark Nielsen',
  'Mark Poulsen',
  'Martin DM',
  'Martin Laigaard',
  'Mathias Schaldemose',
  'Michel Nielsen',
  'Natascha Løgstrup',
  'Nicolai Bjerregaard',
  'Nicole-Nathalie',
  'Niels DM',
  'Nikolaj DM',
  'Sara Murray',
  'Silke Hjortshøj',
  'Simon Bødker',
  'Theresa Andersen',
  'Trine Munkholm',
];

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS time_entries (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      work_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      break_minutes INTEGER NOT NULL DEFAULT 0,
      duration_minutes INTEGER NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Teknisk standard-projekt til at udfylde project_id (vi viser ikke projekter i UI)
  await pool.query(`
    INSERT INTO projects(name)
    SELECT 'Drift'
    WHERE NOT EXISTS (SELECT 1 FROM projects);
  `);

  // Ryd gamle test-brugere
  await pool.query(`DELETE FROM users WHERE name = ANY($1::text[])`, [[ 'Mads', 'Maria', 'Guest' ]]);

  // Seed personer, hvis de mangler
  for (const name of PEOPLE) {
    await pool.query(
      `INSERT INTO users(name)
       SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM users WHERE name = $1);`,
      [name]
    );
  }
}

// Helpers
function parseTimeHHMM(s) {
  if (!/^\d{2}:\d{2}$/.test(s || '')) return null;
  const [h, m] = s.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}
function minutesBetween(st, et) {
  let diff = (et.h*60 + et.m) - (st.h*60 + st.m);
  if (diff < 0) diff += 24*60; // over midnat
  return diff;
}

// Fælles query til liste/eksport (inkl. te.user_id til sletning i UI)
function buildEntriesQuery(from, to) {
  let sql = `
    SELECT te.id, te.user_id, te.work_date, te.start_time, te.end_time,
           te.duration_minutes, te.note,
           u.name AS user_name, p.name AS project_name
    FROM time_entries te
    JOIN users u ON u.id = te.user_id
    JOIN projects p ON p.id = te.project_id
  `;
  const params = [];
  if (from && to) {
    sql += ` WHERE te.work_date BETWEEN $1 AND $2`;
    params.push(from, to);
  } else if (from) {
    sql += ` WHERE te.work_date >= $1`; params.push(from);
  } else if (to) {
    sql += ` WHERE te.work_date <= $1`; params.push(to);
  }
  sql += ` ORDER BY te.work_date DESC, te.id DESC;`;
  return { sql, params };
}

// ---- API ----
app.get('/api/users', async (_req, res) => {
  try {
    const r = await pool.query('SELECT id, name FROM users ORDER BY name;');
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB fejl' });
  }
});

app.get('/api/time-entries', async (req, res) => {
  try {
    const { from, to } = req.query;
    const { sql, params } = buildEntriesQuery(from, to);
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB fejl' });
  }
});

app.post('/api/time-entries', async (req, res) => {
  try {
    const { user_id, work_date, start_time, end_time, note } = req.body || {};
    if (!user_id)  return res.status(400).json({ error: 'user_id er påkrævet' });
    if (!work_date) return res.status(400).json({ error: 'work_date er påkrævet (YYYY-MM-DD)' });

    const st = parseTimeHHMM(start_time);
    const et = parseTimeHHMM(end_time);
    if (!st || !et) return res.status(400).json({ error: 'start_time / end_time skal være HH:MM' });

    const span = minutesBetween(st, et);
    if (span <= 0)      return res.status(400).json({ error: 'Start/slut giver ingen varighed' });
    if (span > 24*60)   return res.status(400).json({ error: 'Maks ét døgn pr. registrering' });

    const pr = await pool.query('SELECT id FROM projects ORDER BY id LIMIT 1;');
    const project_id = pr.rows[0]?.id;
    if (!project_id) return res.status(500).json({ error: 'Intet projekt i DB (kræves teknisk)' });

    const duration = span; // ingen pause

    const r = await pool.query(
      `INSERT INTO time_entries (user_id, project_id, work_date, start_time, end_time, break_minutes, duration_minutes, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, user_id, project_id, work_date, start_time, end_time, duration_minutes, note;`,
      [user_id, project_id, work_date, start_time, end_time, 0, duration, note || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB fejl' });
  }
});

// Slet registrering – kun hvis user_id matcher (let "sikkerhed" uden login)
app.delete('/api/time-entries/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const user_id = Number(req.query.user_id);
    if (!id) return res.status(400).json({ error: 'id mangler' });
    if (!user_id) return res.status(400).json({ error: 'user_id mangler' });

    const r = await pool.query(
      'DELETE FROM time_entries WHERE id = $1 AND user_id = $2 RETURNING id;',
      [id, user_id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Ingen post at slette (forkert id eller bruger)' });
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Sletning fejlede' });
  }
});

app.get('/api/summary', async (req, res) => {
  try {
    const { from, to } = req.query;
    let sql = `
      SELECT te.user_id, u.name AS user_name,
             COUNT(*) AS entries, COALESCE(SUM(te.duration_minutes),0) AS minutes
      FROM time_entries te
      JOIN users u ON u.id = te.user_id
    `;
    const params = [];
    if (from && to)      { sql += ` WHERE te.work_date BETWEEN $1 AND $2`; params.push(from, to); }
    else if (from)       { sql += ` WHERE te.work_date >= $1`; params.push(from); }
    else if (to)         { sql += ` WHERE te.work_date <= $1`; params.push(to); }
    sql += ` GROUP BY te.user_id, u.name ORDER BY u.name;`;

    const r = await pool.query(sql, params);
    const out = r.rows.map(x => ({
      user_id: x.user_id,
      user_name: x.user_name,
      entries: Number(x.entries),
      minutes: Number(x.minutes || 0),
      hours: Number(((x.minutes || 0)/60).toFixed(2))
    }));
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB fejl' });
  }
});

// Eksporter detaljer (CSV)
app.get('/api/export.csv', async (req, res) => {
  try {
    const { from, to } = req.query;
    const { sql, params } = buildEntriesQuery(from, to);
    const r = await pool.query(sql, params);

    const head = ['Dato','Person','Start','Slut','Minutter','Timer','Note'];
    const lines = [head.join(';')];
    for (const row of r.rows) {
      const date  = String(row.work_date).slice(0,10);
      const start = String(row.start_time).slice(0,5);
      const end   = String(row.end_time).slice(0,5);
      const mins  = Number(row.duration_minutes);
      const hours = (mins/60).toFixed(2).replace('.', ',');
      const note  = (row.note || '').replaceAll('"','""');
      lines.push([date, row.user_name, start, end, mins, hours, `"${note}"`].join(';'));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="time_entries.csv"');
    res.send('\ufeff' + lines.join('\n'));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Eksport CSV fejlede' });
  }
});

// Eksporter detaljer (Excel)
app.get('/api/export.xlsx', async (req, res) => {
  try {
    const { from, to } = req.query;
    const { sql, params } = buildEntriesQuery(from, to);
    const r = await pool.query(sql, params);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tid (detaljer)');
    ws.columns = [
      { header: 'Dato', key: 'dato', width: 12 },
      { header: 'Person', key: 'person', width: 22 },
      { header: 'Start', key: 'start', width: 10 },
      { header: 'Slut', key: 'slut', width: 10 },
      { header: 'Minutter', key: 'minutter', width: 10 },
      { header: 'Timer', key: 'timer', width: 10 },
      { header: 'Note', key: 'note', width: 50 }
    ];
    for (const row of r.rows) {
      const date  = String(row.work_date).slice(0,10);
      const start = String(row.start_time).slice(0,5);
      const end   = String(row.end_time).slice(0,5);
      const mins  = Number(row.duration_minutes);
      const hours = +(mins/60).toFixed(2);
      ws.addRow({ dato: date, person: row.user_name, start, slut: end, minutter: mins, timer: hours, note: row.note || '' });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="time_entries.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Eksport Excel fejlede' });
  }
});

// Eksporter opsummering (Excel)
app.get('/api/export-summary.xlsx', async (req, res) => {
  try {
    const { from, to } = req.query;
    let sql = `
      SELECT u.name AS user_name,
             COUNT(*)::int AS entries,
             COALESCE(SUM(te.duration_minutes),0)::int AS minutes
      FROM time_entries te
      JOIN users u ON u.id = te.user_id
    `;
    const params = [];
    if (from && to)      { sql += ` WHERE te.work_date BETWEEN $1 AND $2`; params.push(from, to); }
    else if (from)       { sql += ` WHERE te.work_date >= $1`; params.push(from); }
    else if (to)         { sql += ` WHERE te.work_date <= $1`; params.push(to); }
    sql += ` GROUP BY u.name ORDER BY u.name;`;

    const r = await pool.query(sql, params);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Opsummering');
    ws.columns = [
      { header: 'Person', key: 'person', width: 24 },
      { header: 'Registreringer', key: 'entries', width: 16 },
      { header: 'Minutter', key: 'minutes', width: 12 },
      { header: 'Timer', key: 'hours', width: 10 }
    ];
    let totalMin = 0, totalEntries = 0;
    for (const row of r.rows) {
      const mins = Number(row.minutes || 0);
      const hours = +(mins/60).toFixed(2);
      totalMin += mins; totalEntries += Number(row.entries || 0);
      ws.addRow({ person: row.user_name, entries: Number(row.entries||0), minutes: mins, hours });
    }
    const tr = ws.addRow({ person: 'TOTAL', entries: totalEntries, minutes: totalMin, hours: +(totalMin/60).toFixed(2) });
    tr.font = { bold: true };
    ws.getRow(1).font = { bold: true };
    ws.eachRow(r => { r.alignment = { vertical: 'middle' }; });

    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="time_summary.xlsx"');
    await wb.xlsx.write(res); res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Eksport summary Excel fejlede' });
  }
});

app.listen(PORT, async () => {
  try {
    await initDb();
    console.log(`Tidregistrering v2.3 kører på http://0.0.0.0:${PORT}`);
  } catch (e) {
    console.error('DB init fejl:', e);
    process.exit(1);
  }
});
