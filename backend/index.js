// backend/index.js
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const dayjs = require("dayjs");

const app = express();
const PORT = 3000;

// --- Database Setup ---
const dataDir = path.join(__dirname, "data");
const DB_PATH = path.join(dataDir, "database.db");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("Error opening database", err.message);
  } else {
    console.log("Connected to the SQLite database.");
    db.exec("PRAGMA foreign_keys = ON;", (err) => {
      if (err) console.error("Could not enable foreign keys:", err);
    });
    // Use serialize to ensure tables are created in order
    db.serialize(() => {
      db.run(
        `CREATE TABLE IF NOT EXISTS names (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)`
      );
      db.run(
        `CREATE TABLE IF NOT EXISTS absences (id INTEGER PRIMARY KEY AUTOINCREMENT, name_id INTEGER NOT NULL, absence_date TEXT NOT NULL, FOREIGN KEY (name_id) REFERENCES names(id) ON DELETE CASCADE, UNIQUE(name_id, absence_date))`
      );
      db.run(
        `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action_date TEXT NOT NULL, action_type TEXT NOT NULL, user_name TEXT NOT NULL, reason TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`
      );

      // Table for Hourly Schedule
      db.run(
        `CREATE TABLE IF NOT EXISTS hourly_schedule (id INTEGER PRIMARY KEY AUTOINCREMENT, name_id INTEGER NOT NULL, scheduled_date TEXT NOT NULL, scheduled_time INTEGER NOT NULL, is_edited INTEGER DEFAULT 0, original_name_id INTEGER, reason TEXT, FOREIGN KEY (name_id) REFERENCES names(id) ON DELETE CASCADE, FOREIGN KEY (original_name_id) REFERENCES names(id) ON DELETE SET NULL, UNIQUE(scheduled_date, scheduled_time))`
      );

      // Table for Daily Gate Assignment
      db.run(
        `CREATE TABLE IF NOT EXISTS gate_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, assignment_date TEXT NOT NULL UNIQUE, main_name_id INTEGER NOT NULL, backup_name_id INTEGER, FOREIGN KEY (main_name_id) REFERENCES names(id) ON DELETE CASCADE, FOREIGN KEY (backup_name_id) REFERENCES names(id) ON DELETE SET NULL)`
      );
    });

    // --- Start Server ---
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  }
});

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- API Routes for Managing Names & Absences ---
app.get("/api/names", (req, res) => {
  db.all("SELECT * FROM names ORDER BY name ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ data: rows });
  });
});
app.post("/api/names", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });
  db.run("INSERT INTO names (name) VALUES (?)", [name.trim()], function (err) {
    if (err)
      return res.status(409).json({ error: `Name '${name}' already exists.` });
    res.status(201).json({ data: { id: this.lastID, name: name.trim() } });
  });
});
app.delete("/api/names/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM names WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0)
      return res.status(404).json({ error: "Name not found." });
    res.json({ message: "Name deleted successfully", id });
  });
});
app.get("/api/absences", (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "Date is required." });
  db.all(
    "SELECT name_id FROM absences WHERE absence_date = ?",
    [date],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ data: rows.map((r) => r.name_id) });
    }
  );
});
app.post("/api/absences/toggle", (req, res) => {
  const { name_id, date } = req.body;
  if (!name_id || !date)
    return res.status(400).json({ error: "Name ID and date are required." });
  db.get(
    "SELECT id FROM absences WHERE name_id = ? AND absence_date = ?",
    [name_id, date],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (row) {
        db.run("DELETE FROM absences WHERE id = ?", [row.id], (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Absence removed." });
        });
      } else {
        db.run(
          "INSERT INTO absences (name_id, absence_date) VALUES (?, ?)",
          [name_id, date],
          (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ message: "Absence added." });
          }
        );
      }
    }
  );
});

// --- Combined API Route for All Daily Data ---
app.get("/api/daily-data", (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res
      .status(400)
      .json({ error: "Valid date query (YYYY-MM-DD) is required." });
  }

  const hourlyQuery = `SELECT hs.scheduled_time, hs.is_edited, hs.reason, n.name, hs.name_id, o.name as original_name FROM hourly_schedule hs JOIN names n ON hs.name_id = n.id LEFT JOIN names o ON hs.original_name_id = o.id WHERE hs.scheduled_date = ? ORDER BY hs.scheduled_time ASC`;
  const gateQuery = `SELECT main.id as main_id, main.name as main_name, backup.id as backup_id, backup.name as backup_name FROM gate_assignments ga JOIN names main ON ga.main_name_id = main.id LEFT JOIN names backup ON ga.backup_name_id = backup.id WHERE ga.assignment_date = ?`;
  const auditQuery = `SELECT user_name, reason, timestamp FROM audit_log WHERE action_date = ? AND action_type = 'shuffle' ORDER BY timestamp DESC LIMIT 1`;
  const absencesQuery = `SELECT name_id FROM absences WHERE absence_date = ?`;

  Promise.all([
    new Promise((resolve, reject) =>
      db.all(hourlyQuery, [date], (err, rows) =>
        err ? reject(err) : resolve(rows)
      )
    ),
    new Promise((resolve, reject) =>
      db.get(gateQuery, [date], (err, row) =>
        err ? reject(err) : resolve(row)
      )
    ),
    new Promise((resolve, reject) =>
      db.get(auditQuery, [date], (err, row) =>
        err ? reject(err) : resolve(row)
      )
    ),
    new Promise((resolve, reject) =>
      db.all(absencesQuery, [date], (err, rows) =>
        err ? reject(err) : resolve(rows)
      )
    ),
  ])
    .then(async ([hourlyRows, gateRow, auditRow, absenceRows]) => {
      let finalHourly = hourlyRows;
      let finalGate = gateRow;

      if (hourlyRows.length === 0 || gateRow === undefined) {
        const { hourly, gate } = await regenerateAll(date);
        finalHourly = hourly;
        finalGate = gate;
      }

      res.json({
        date,
        hourly: finalHourly,
        gate: finalGate,
        audit: auditRow || null,
        absences: absenceRows.map((r) => r.name_id),
      });
    })
    .catch((err) => {
      res
        .status(500)
        .json({ error: "Failed to fetch daily data.", details: err.message });
    });
});

// --- API Route to Regenerate Hourly Schedule ---
app.post("/api/schedule/regenerate", (req, res) => {
  const { date, hour, userName, reason } = req.body;
  if (!date || !userName || !reason)
    return res
      .status(400)
      .json({ error: "Date, user name, and reason are required." });

  regenerateHourlySchedule(date, hour || 0, userName, reason)
    .then((result) => res.status(201).json({ hourly: result }))
    .catch((err) => res.status(500).json({ error: err.message }));
});

// --- API Route to Manually Override a Slot ---
app.post("/api/schedule/override", (req, res) => {
  const { date, time, name_id, reason } = req.body;
  if (!date || !time || !name_id || !reason)
    return res.status(400).json({ error: "All fields are required." });

  const selectSql =
    "SELECT id, name_id, is_edited FROM hourly_schedule WHERE scheduled_date = ? AND scheduled_time = ?";
  db.get(selectSql, [date, time], (err, row) => {
    if (err) return res.status(500).json({ error: "DB error." });
    let query, params;
    if (row) {
      query = `UPDATE hourly_schedule SET name_id = ?, reason = ?, original_name_id = CASE WHEN is_edited = 0 THEN ? ELSE original_name_id END, is_edited = 1 WHERE id = ?;`;
      params = [name_id, reason, row.name_id, row.id];
    } else {
      query = `INSERT INTO hourly_schedule (scheduled_date, scheduled_time, name_id, is_edited, reason) VALUES (?, ?, ?, 1, ?);`;
      params = [date, time, name_id, reason];
    }
    db.run(query, params, (err) => {
      if (err)
        return res.status(500).json({ error: "Failed to override slot." });
      res.status(200).json({ message: "Slot updated." });
    });
  });
});

// --- Regeneration Logic ---
async function regenerateAll(date) {
  const allNames = await new Promise((resolve, reject) =>
    db.all(`SELECT * FROM names`, [], (err, rows) =>
      err ? reject(err) : resolve(rows)
    )
  );
  const absences = await new Promise((resolve, reject) =>
    db.all(
      `SELECT name_id FROM absences WHERE absence_date = ?`,
      [date],
      (err, rows) => (err ? reject(err) : resolve(rows))
    )
  );

  const absentNameIds = new Set(absences.map((a) => a.name_id));
  const presentNames = allNames.filter((name) => !absentNameIds.has(name.id));

  const gateResult = await regenerateGateAssignment(date, presentNames);
  const hourlyResult = await regenerateHourlySchedule(
    date,
    0,
    null,
    null,
    presentNames
  );

  return { gate: gateResult, hourly: hourlyResult };
}

async function regenerateGateAssignment(date, presentNames) {
  return new Promise(async (resolve, reject) => {
    await new Promise((resolve, reject) =>
      db.run(
        "DELETE FROM gate_assignments WHERE assignment_date = ?",
        [date],
        (err) => (err ? reject(err) : resolve())
      )
    );

    if (presentNames.length === 0) return resolve(null);

    const prevDate = dayjs(date).subtract(1, "day").format("YYYY-MM-DD");
    const prevAssignment = await new Promise((resolve, reject) =>
      db.get(
        `SELECT main_name_id, backup_name_id FROM gate_assignments WHERE assignment_date = ?`,
        [prevDate],
        (err, row) => (err ? reject(err) : resolve(row))
      )
    );

    let newMain = null;
    if (
      prevAssignment?.backup_name_id &&
      presentNames.some((p) => p.id === prevAssignment.backup_name_id)
    ) {
      newMain = presentNames.find(
        (p) => p.id === prevAssignment.backup_name_id
      );
    } else if (prevAssignment?.main_name_id) {
      const prevMainIndex = presentNames.findIndex(
        (p) => p.id === prevAssignment.main_name_id
      );
      if (prevMainIndex !== -1)
        newMain = presentNames[(prevMainIndex + 1) % presentNames.length];
    }
    if (!newMain) newMain = presentNames[0];

    let newBackup = null;
    if (presentNames.length > 1) {
      const mainIndexInPresentList = presentNames.findIndex(
        (p) => p.id === newMain.id
      );
      newBackup =
        presentNames[(mainIndexInPresentList + 1) % presentNames.length];
    }

    const newMainId = newMain.id;
    const newBackupId = newBackup ? newBackup.id : null;

    await new Promise((resolve, reject) =>
      db.run(
        `INSERT INTO gate_assignments (assignment_date, main_name_id, backup_name_id) VALUES (?, ?, ?)`,
        [date, newMainId, newBackupId],
        (err) => (err ? reject(err) : resolve())
      )
    );

    resolve({
      main_id: newMainId,
      main_name: newMain.name,
      backup_id: newBackupId,
      backup_name: newBackup ? newBackup.name : null,
    });
  });
}

function regenerateHourlySchedule(
  date,
  fromHour = 0,
  userName,
  reason,
  presentNamesList
) {
  return new Promise(async (resolve, reject) => {
    const presentNames =
      presentNamesList ||
      (await (async () => {
        const allNames = await new Promise((resolve, reject) =>
          db.all(`SELECT * FROM names`, [], (err, rows) =>
            err ? reject(err) : resolve(rows)
          )
        );
        const absences = await new Promise((resolve, reject) =>
          db.all(
            `SELECT name_id FROM absences WHERE absence_date = ?`,
            [date],
            (err, rows) => (err ? reject(err) : resolve(rows))
          )
        );
        const absentNameIds = new Set(absences.map((a) => a.name_id));
        return allNames.filter((name) => !absentNameIds.has(name.id));
      })());

    db.serialize(() => {
      db.run("BEGIN TRANSACTION;");
      db.run(
        "DELETE FROM hourly_schedule WHERE scheduled_date = ? AND scheduled_time >= ? AND is_edited = 0",
        [date, fromHour]
      );

      if (presentNames.length > 0) {
        let shuffledNames = [...presentNames].sort(() => 0.5 - Math.random());
        const timeSlots = [8, 9, 10, 11, 12, 13].filter(
          (time) => time >= fromHour
        );
        const insertStmt = db.prepare(
          "INSERT OR IGNORE INTO hourly_schedule (name_id, scheduled_date, scheduled_time, is_edited) VALUES (?, ?, ?, 0)"
        );
        timeSlots.forEach((time, index) => {
          const assignedName = shuffledNames[index % shuffledNames.length];
          insertStmt.run(assignedName.id, date, time);
        });
        insertStmt.finalize();
      }

      if (userName && reason) {
        db.run(
          "INSERT INTO audit_log (action_date, action_type, user_name, reason) VALUES (?, 'shuffle', ?, ?)",
          [date, userName, reason]
        );
      }

      db.run("COMMIT;", (err) => {
        if (err) return reject(err);
        const finalQuery = `SELECT hs.scheduled_time, hs.is_edited, hs.reason, n.name, hs.name_id, o.name as original_name FROM hourly_schedule hs JOIN names n ON hs.name_id = n.id LEFT JOIN names o ON hs.original_name_id = o.id WHERE hs.scheduled_date = ? ORDER BY hs.scheduled_time ASC`;
        db.all(finalQuery, [date], (err, rows) =>
          err ? reject(err) : resolve(rows)
        );
      });
    });
  });
}

// --- Serve Frontend ---
app.use(express.static(path.join(__dirname, "frontend", "dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "dist", "index.html"));
});
