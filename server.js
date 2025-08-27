const express = require('express');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://appuser:apprandompass@db:5432/appdb';
const pool = new Pool({ connectionString: DATABASE_URL });

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

  // Seed if empty
  await pool.query(`
    INSERT INTO users(name) SELECT 'Mads'
    WHERE NOT EXISTS (SELECT 1 FROM users);
    INSERT INTO projects(name) SELECT 'Drift'
    WHERE NOT EXISTS (SELECT 1 FROM projects);
    INSERT INTO projects(name) SELECT 'Udvikling'
    WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name='Udvikling');
  `);
}

// Parse HH:MM
function parseTimeHHMM(s) {
  if (!/^\d{2}:\d{2}$/.test(s || '')) return null;
  const [h, m] = s.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

// Over-midnight minutes
function minutesBetween(start, end) {
  let diff = (end.h * 60 + end.m) - (start.h * 60 + start.m);
  if (diff < 0) diff += 24 * 60; // next day
  return diff;
}

// Shared query for list & export
function buildEntriesQuery(from, to) {
  let sql = `
    SELECT te.id, te.work_date, te.start_time, te.end_time, te.break_minutes, te.duration_minutes, te.note,
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
    sql += ` WHERE te.work_date >= $1`;
    params.push(from);
  } else if (to) {
    sql += ` WHERE te.work_date <= $1`;
    params.push(to);
  }
  sql += ` ORDER BY te.work_date DESC, te.id DESC;`;
  return { sql, params };
}

// Routes
app.get('/api/projects', async (_req, res) => {
  try {
    const r = await pool.query('SELECT id, name FROM projects ORDER BY name;');
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
    const { user_id = 1, project_id, work_date, start_time, end_time, break_minutes = 0, note } = req.body || {};

    if (!project_id) return res.status(400).json({ error: 'project_id er påkrævet' });
    if (!work_date) return res.status(400).json({ error: 'work_date er påkrævet (YYYY-MM-DD)' });

    const st = parseTimeHHMM(start_time);
    const et = parseTimeHHMM(end_time);
    if (!st || !et) return res.status(400).json({ error: 'start_time / end_time skal være HH:MM' });

    const span = minutesBetween(st, et);
    const pause = Math.max(0, Number(break_minutes || 0));

    if (span <= 0) return res.status(400).json({ error: 'Start/slut giver ingen varighed' });
    if (span > 24 * 60) return res.status(400).json({ error: 'Maks ét døgn pr. registrering' });
    if (pause >= span) return res.status(400).json({ error: 'Pause kan ikke være længere end tidsrummet' });

    const dur = span - pause;

    const r = await pool.query(
      `INSERT INTO time_entries (user_id, project_id, work_date, start_time, end_time, break_minutes, duration_minutes, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, user_id, project_id, work_date, start_time, end_time, break_minutes, duration_minutes, note;`,
      [user_id, project_id, work_date, start_time, end_time, break_minutes, dur, note || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB fejl' });
  }
});

// CSV export
app.get('/api/export.csv', async (req, res) => {
  try {
    const { from, to } = req.query;
    const { sql, params } = buildEntriesQuery(from, to);
    const r = await pool.query(sql, params);

    const head = ['Dato','Projekt','Bruger','Start','Slut','Pause_min','Timer_min','Timer','Note'];
    const lines = [head.join(';')];

    for (const row of r.rows) {
      const date = String(row.work_date).slice(0,10);
      const start = String(row.start_time).slice(0,5);
      const end   = String(row.end_time).slice(0,5);
      const hours = (Number(row.duration_minutes)/60).toFixed(2).replace('.', ',');
      const note  = (row.note || '').replaceAll('"','""');

      lines.push([
        date, row.project_name, row.user_name, start, end,
        row.break_minutes, row.duration_minutes, hours, `"${note}"`
      ].join(';'));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="time_entries.csv"');
    res.send('\ufeff' + lines.join('\n'));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Eksport CSV fejlede' });
  }
});

// Excel export
app.get('/api/export.xlsx', async (req, res) => {
  try {
    const { from, to } = req.query;
    const { sql, params } = buildEntriesQuery(from, to);
    const r = await pool.query(sql, params);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tid');

    ws.columns = [
      { header: 'Dato',        key: 'dato',       width: 12 },
      { header: 'Projekt',     key: 'projekt',    width: 24 },
      { header: 'Bruger',      key: 'bruger',     width: 18 },
      { header: 'Start',       key: 'start',      width: 10 },
      { header: 'Slut',        key: 'slut',       width: 10 },
      { header: 'Pause (min)', key: 'pause',      width: 12 },
      { header: 'Minutter',    key: 'minutter',   width: 10 },
      { header: 'Timer',       key: 'timer',      width: 10 },
      { header: 'Note',        key: 'note',       width: 50 }
    ];

    for (const row of r.rows) {
      const date = String(row.work_date).slice(0,10);
      const start = String(row.start_time).slice(0,5);
      const end   = String(row.end_time).slice(0,5);
      const hours = (Number(row.duration_minutes)/60).toFixed(2).replace('.', ',');

      ws.addRow({
        dato: date,
        projekt: row.project_name,
        bruger: row.user_name,
        start: start,
        slut: end,
        pause: row.break_minutes,
        minutter: row.duration_minutes,
        timer: hours,
        note: row.note || ''
      });
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

app.listen(PORT, async () => {
  try {
    await initDb();
    console.log(`Tidregistrering kører på http://0.0.0.0:${PORT}`);
  } catch (e) {
    console.error('DB init fejl:', e);
    process.exit(1);
  }
});
