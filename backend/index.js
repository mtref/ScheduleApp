// backend/index.js
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const cors = require("cors");

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
        `CREATE TABLE IF NOT EXISTS names (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE
        )`
      );
      db.run(
        `CREATE TABLE IF NOT EXISTS daily_schedule (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name_id INTEGER NOT NULL,
          scheduled_date TEXT NOT NULL,
          scheduled_time INTEGER NOT NULL,
          is_edited INTEGER DEFAULT 0,
          original_name_id INTEGER,
          reason TEXT,
          FOREIGN KEY (name_id) REFERENCES names (id) ON DELETE CASCADE,
          FOREIGN KEY (original_name_id) REFERENCES names (id) ON DELETE SET NULL,
          UNIQUE(scheduled_date, scheduled_time)
        )`
      );
      db.run(
        `CREATE TABLE IF NOT EXISTS absences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name_id INTEGER NOT NULL,
            absence_date TEXT NOT NULL,
            FOREIGN KEY (name_id) REFERENCES names(id) ON DELETE CASCADE,
            UNIQUE(name_id, absence_date)
        )`
      );
      // ADD reason column to audit log
      db.run(
        `CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action_date TEXT NOT NULL,
          action_type TEXT NOT NULL,
          user_name TEXT NOT NULL,
          reason TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      );
    });
  }
});

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "frontend", "dist")));

// --- API Routes for Managing Names ---
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

// --- API Routes for Absences ---
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

// --- API Route for Generating and Fetching Schedule ---
app.get("/api/schedule", (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res
      .status(400)
      .json({ error: "Valid date query (YYYY-MM-DD) is required." });
  }

  const scheduleQuery = `
        SELECT 
            ds.scheduled_time, ds.is_edited, ds.reason, current_name.name, ds.name_id,
            original_name.name AS original_name
        FROM daily_schedule ds
        JOIN names AS current_name ON ds.name_id = current_name.id
        LEFT JOIN names AS original_name ON ds.original_name_id = original_name.id
        WHERE ds.scheduled_date = ? ORDER BY ds.scheduled_time ASC`;

  const auditQuery = `SELECT user_name, reason, timestamp FROM audit_log WHERE action_date = ? AND action_type = 'shuffle' ORDER BY timestamp DESC LIMIT 1`;

  Promise.all([
    new Promise((resolve, reject) =>
      db.all(scheduleQuery, [date], (err, rows) =>
        err ? reject(err) : resolve(rows)
      )
    ),
    new Promise((resolve, reject) =>
      db.get(auditQuery, [date], (err, row) =>
        err ? reject(err) : resolve(row)
      )
    ),
  ])
    .then(([scheduleRows, auditRow]) => {
      if (scheduleRows.length > 0) {
        return res.json({ date, data: scheduleRows, audit: auditRow || null });
      }
      regenerateSchedule(date, res);
    })
    .catch((err) => {
      res
        .status(500)
        .json({
          error: "Failed to fetch schedule data.",
          details: err.message,
        });
    });
});

// --- API Route to Regenerate Today's Schedule ---
app.post("/api/schedule/regenerate", (req, res) => {
  const { date, hour, userName, reason } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: "A valid date is required." });
  if (!userName)
    return res.status(400).json({ error: "User name for audit is required." });
  if (!reason)
    return res.status(400).json({ error: "Reason for shuffle is required." });

  regenerateSchedule(date, res, hour || 0, userName, reason);
});

// --- API Route to Manually Override a Slot ---
app.post("/api/schedule/override", (req, res) => {
  const { date, time, name_id, reason } = req.body;
  if (!date || !time || !name_id || !reason) {
    return res
      .status(400)
      .json({ error: "Date, time, name_id, and reason are required." });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION;");
    const selectSql =
      "SELECT id, name_id, is_edited FROM daily_schedule WHERE scheduled_date = ? AND scheduled_time = ?";
    db.get(selectSql, [date, time], (err, row) => {
      if (err) {
        db.run("ROLLBACK;");
        return res.status(500).json({ error: "DB error selecting slot." });
      }

      let query, params;
      if (row) {
        query = `UPDATE daily_schedule SET name_id = ?, reason = ?, original_name_id = CASE WHEN is_edited = 0 THEN ? ELSE original_name_id END, is_edited = 1 WHERE id = ?;`;
        params = [name_id, reason, row.name_id, row.id];
      } else {
        query = `INSERT INTO daily_schedule (scheduled_date, scheduled_time, name_id, is_edited, reason) VALUES (?, ?, ?, 1, ?);`;
        params = [date, time, name_id, reason];
      }

      db.run(query, params, function (err) {
        if (err) {
          db.run("ROLLBACK;");
          return res.status(500).json({ error: "Failed to override slot." });
        }
        db.run("COMMIT;", (err) => {
          if (err)
            return res
              .status(500)
              .json({ error: "Failed to commit override." });
          res
            .status(200)
            .json({ message: "Schedule slot updated successfully." });
        });
      });
    });
  });
});

// --- Reusable function to generate/regenerate a schedule for a given date ---
function regenerateSchedule(date, res, fromHour = 0, userName, reason) {
  const allNamesQuery = `SELECT * FROM names`;
  const absencesQuery = `SELECT name_id FROM absences WHERE absence_date = ?`;

  Promise.all([
    new Promise((resolve, reject) =>
      db.all(allNamesQuery, [], (err, rows) =>
        err ? reject(err) : resolve(rows)
      )
    ),
    new Promise((resolve, reject) =>
      db.all(absencesQuery, [date], (err, rows) =>
        err ? reject(err) : resolve(rows)
      )
    ),
  ])
    .then(([allNames, absences]) => {
      const absentNameIds = new Set(absences.map((a) => a.name_id));
      const availableForShuffling = allNames.filter(
        (name) => !absentNameIds.has(name.id)
      );

      db.serialize(() => {
        db.run("BEGIN TRANSACTION;");
        db.run(
          "DELETE FROM daily_schedule WHERE scheduled_date = ? AND scheduled_time >= ? AND is_edited = 0",
          [date, fromHour]
        );

        if (availableForShuffling.length > 0) {
          let shuffledNames = [...availableForShuffling];
          for (let i = shuffledNames.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledNames[i], shuffledNames[j]] = [
              shuffledNames[j],
              shuffledNames[i],
            ];
          }
          const allTimeSlots = [8, 9, 10, 11, 12, 13];
          const futureTimeSlots = allTimeSlots.filter(
            (time) => time >= fromHour
          );
          const insertStmt = db.prepare(
            "INSERT OR IGNORE INTO daily_schedule (name_id, scheduled_date, scheduled_time, is_edited, original_name_id) VALUES (?, ?, ?, 0, NULL)"
          );
          futureTimeSlots.forEach((time, index) => {
            const assignedName = shuffledNames[index % shuffledNames.length];
            if (assignedName) insertStmt.run(assignedName.id, date, time);
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
          if (err) {
            db.run("ROLLBACK;");
            return res
              .status(500)
              .json({ error: "Failed to commit schedule regeneration." });
          }

          const scheduleQuery = `SELECT ds.scheduled_time, ds.is_edited, ds.reason, n.name, ds.name_id, o.name as original_name FROM daily_schedule ds JOIN names n ON ds.name_id = n.id LEFT JOIN names o ON ds.original_name_id = o.id WHERE ds.scheduled_date = ? ORDER BY ds.scheduled_time ASC`;
          const auditQuery = `SELECT user_name, reason, timestamp FROM audit_log WHERE action_date = ? AND action_type = 'shuffle' ORDER BY timestamp DESC LIMIT 1`;
          Promise.all([
            new Promise((resolve, reject) =>
              db.all(scheduleQuery, [date], (err, rows) =>
                err ? reject(err) : resolve(rows)
              )
            ),
            new Promise((resolve, reject) =>
              db.get(auditQuery, [date], (err, row) =>
                err ? reject(err) : resolve(row)
              )
            ),
          ]).then(([scheduleRows, auditRow]) => {
            res
              .status(201)
              .json({
                date: date,
                data: scheduleRows,
                audit: auditRow || null,
              });
          });
        });
      });
    })
    .catch((err) => {
      res
        .status(500)
        .json({
          error: "Failed to fetch necessary data for schedule generation.",
          details: err.message,
        });
    });
}

// --- Serve Frontend ---
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "dist", "index.html"));
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
