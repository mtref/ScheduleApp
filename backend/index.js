// backend/index.js
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const dayjs = require("dayjs");
const weekday = require("dayjs/plugin/weekday");
const isoWeek = require("dayjs/plugin/isoWeek"); // Add this import for ISO week calculation
dayjs.extend(weekday);
dayjs.extend(isoWeek); // Extend dayjs with isoWeek plugin

const app = express();
const PORT = 3000;

// --- Database Setup ---
const dataDir = path.join(__dirname, "data");
const DB_PATH = path.join(dataDir, "database.db");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// --- Helper for async DB calls ---
const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );
const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
  );
const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve(this);
    })
  );

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("Error opening database", err.message);
  } else {
    console.log("Connected to the SQLite database.");
    db.exec("PRAGMA foreign_keys = ON;", (err) => {
      if (err) console.error("Could not enable foreign keys:", err);
    });
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
      db.run(
        `CREATE TABLE IF NOT EXISTS hourly_schedule (id INTEGER PRIMARY KEY AUTOINCREMENT, name_id INTEGER NOT NULL, scheduled_date TEXT NOT NULL, scheduled_time INTEGER NOT NULL, is_edited INTEGER DEFAULT 0, original_name_id INTEGER, reason TEXT, FOREIGN KEY (name_id) REFERENCES names(id) ON DELETE CASCADE, FOREIGN KEY (original_name_id) REFERENCES names(id) ON DELETE SET NULL, UNIQUE(scheduled_date, scheduled_time))`
      );
      db.run(
        `CREATE TABLE IF NOT EXISTS gate_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, assignment_date TEXT NOT NULL UNIQUE, main_name_id INTEGER NOT NULL, backup_name_id INTEGER, FOREIGN KEY (main_name_id) REFERENCES names(id) ON DELETE CASCADE, FOREIGN KEY (backup_name_id) REFERENCES names(id) ON DELETE SET NULL)`
      );
      db.run(
        `CREATE TABLE IF NOT EXISTS weekly_duty (id INTEGER PRIMARY KEY AUTOINCREMENT, week_start_date TEXT NOT NULL UNIQUE, name_id INTEGER NOT NULL, is_edited INTEGER DEFAULT 0, original_name_id INTEGER, reason TEXT, week_number INTEGER, FOREIGN KEY (name_id) REFERENCES names(id) ON DELETE CASCADE, FOREIGN KEY (original_name_id) REFERENCES names(id) ON DELETE SET NULL)` // Added week_number INTEGER
      );

      const initialNames = ["واحد", "اثنين", "ثلاثة", "اربعه", "خمسة", "سته"];
      const insertNameStmt = db.prepare(
        "INSERT OR IGNORE INTO names (name) VALUES (?)"
      );
      initialNames.forEach((name) => insertNameStmt.run(name));
      insertNameStmt.finalize();
    });

    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  }
});

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- API Routes ---
app.get("/api/names", async (req, res) => {
  try {
    const rows = await dbAll("SELECT * FROM names ORDER BY id ASC");
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/names", async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });
  try {
    const result = await dbRun("INSERT INTO names (name) VALUES (?)", [
      name.trim(),
    ]);
    res.status(201).json({ data: { id: result.lastID, name: name.trim() } });
  } catch (err) {
    res.status(409).json({ error: `Name '${name}' already exists.` });
  }
});
app.delete("/api/names/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await dbRun("DELETE FROM names WHERE id = ?", [id]);
    if (result.changes === 0)
      return res.status(404).json({ error: "Name not found." });
    res.json({ message: "Name deleted successfully", id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/absences", async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "Date is required." });
  try {
    const rows = await dbAll(
      "SELECT name_id FROM absences WHERE absence_date = ?",
      [date]
    );
    res.json({ data: rows.map((r) => r.name_id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/absences/toggle", async (req, res) => {
  const { name_id, date } = req.body;
  if (!name_id || !date)
    return res.status(400).json({ error: "Name ID and date are required." });
  try {
    const row = await dbGet(
      "SELECT id FROM absences WHERE name_id = ? AND absence_date = ?",
      [name_id, date]
    );
    if (row) {
      await dbRun("DELETE FROM absences WHERE id = ?", [row.id]);
      res.json({ message: "Absence removed." });
    } else {
      await dbRun(
        "INSERT INTO absences (name_id, absence_date) VALUES (?, ?)",
        [name_id, date]
      );
      res.status(201).json({ message: "Absence added." });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/daily-data", async (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Valid date query is required." });
  }
  try {
    await regenerateAll(date);

    const hourlyQuery = `SELECT hs.scheduled_time, hs.is_edited, hs.reason, n.name, hs.name_id, o.name as original_name FROM hourly_schedule hs JOIN names n ON hs.name_id = n.id LEFT JOIN names o ON hs.original_name_id = o.id WHERE hs.scheduled_date = ? ORDER BY hs.scheduled_time ASC`;
    const gateQuery = `SELECT main.id as main_id, main.name as main_name, backup.id as backup_id, backup.name as backup_name FROM gate_assignments ga JOIN names main ON ga.main_name_id = main.id LEFT JOIN names backup ON ga.backup_name_id = backup.id WHERE ga.assignment_date = ?`;
    const auditQuery = `SELECT user_name, reason, timestamp FROM audit_log WHERE action_date = ? AND action_type = 'shuffle' ORDER BY timestamp DESC LIMIT 1`;
    const absencesQuery = `SELECT name_id FROM absences WHERE absence_date = ?`;
    const startOfWeek = dayjs(date).weekday(0).format("YYYY-MM-DD");
    const weeklyQuery = `SELECT wd.week_start_date, wd.is_edited, wd.reason, n.name, wd.name_id, o.name as original_name, wd.week_number FROM weekly_duty wd JOIN names n ON wd.name_id = n.id LEFT JOIN names o ON wd.original_name_id = o.id WHERE wd.week_start_date = ?`; // Select week_number

    const [hourlyRows, gateRow, weeklyRow, auditRow, absenceRows] =
      await Promise.all([
        dbAll(hourlyQuery, [date]),
        dbGet(gateQuery, [date]),
        dbGet(weeklyQuery, [startOfWeek]),
        dbGet(auditQuery, [date]),
        dbAll(absencesQuery, [date]),
      ]);

    res.json({
      date,
      hourly: hourlyRows,
      gate: gateRow,
      weeklyDuty: weeklyRow,
      audit: auditRow || null,
      absences: absenceRows.map((r) => r.name_id),
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch daily data.", details: err.message });
  }
});

app.post("/api/schedule/regenerate", async (req, res) => {
  const { date, hour, userName, reason } = req.body;
  if (!date || !userName || !reason)
    return res
      .status(400)
      .json({ error: "Date, user name, and reason are required." });
  try {
    const hourlyData = await regenerateHourlySchedule(
      date,
      hour || 0,
      userName,
      reason
    );
    const auditData = await dbGet(
      `SELECT user_name, reason, timestamp FROM audit_log WHERE action_date = ? AND action_type = 'shuffle' ORDER BY timestamp DESC LIMIT 1`,
      [date]
    );
    res.status(201).json({ hourly: hourlyData, audit: auditData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/schedule/override", async (req, res) => {
  const { date, time, name_id, reason } = req.body;
  if (!date || !time || !name_id || !reason)
    return res.status(400).json({ error: "All fields are required." });
  try {
    await dbRun("BEGIN TRANSACTION;");
    const row = await dbGet(
      "SELECT id, name_id, is_edited FROM hourly_schedule WHERE scheduled_date = ? AND scheduled_time = ?",
      [date, time]
    );
    if (row)
      await dbRun(
        `UPDATE hourly_schedule SET name_id = ?, reason = ?, original_name_id = CASE WHEN is_edited = 0 THEN ? ELSE original_name_id END, is_edited = 1 WHERE id = ?;`,
        [name_id, reason, row.name_id, row.id]
      );
    else
      await dbRun(
        `INSERT INTO hourly_schedule (scheduled_date, scheduled_time, name_id, is_edited, reason) VALUES (?, ?, ?, 1, ?);`,
        [date, time, name_id, reason]
      );
    await dbRun("COMMIT;");
    res.status(200).json({ message: "Slot updated." });
  } catch (err) {
    await dbRun("ROLLBACK;");
    res.status(500).json({ error: "Failed to override slot." });
  }
});

app.post("/api/weekly-duty/postpone", async (req, res) => {
  const { week_start_date } = req.body;
  if (!week_start_date)
    return res.status(400).json({ error: "Week start date is required." });

  try {
    const allNames = await dbAll(`SELECT * FROM names ORDER BY id ASC`);
    const duties = await dbAll(
      `SELECT * FROM weekly_duty WHERE week_start_date >= ? ORDER BY week_start_date ASC`,
      [week_start_date]
    );

    if (duties.length < 2)
      return res
        .status(400)
        .json({ error: "Not enough future duties to postpone." });

    const personToPostpone = duties[0].name_id;

    await dbRun("BEGIN TRANSACTION");

    // Shift all future duties up by one week
    for (let i = 0; i < duties.length - 1; i++) {
      const currentWeek = duties[i];
      const nextWeek = duties[i + 1];
      await dbRun(
        "UPDATE weekly_duty SET name_id = ? WHERE week_start_date = ?",
        [nextWeek.name_id, currentWeek.week_start_date]
      );
    }

    // Assign the postponed person to the last available slot
    const lastWeek = duties[duties.length - 1];
    await dbRun(
      "UPDATE weekly_duty SET name_id = ? WHERE week_start_date = ?",
      [personToPostpone, lastWeek.week_start_date]
    );

    await dbRun("COMMIT");

    res.status(200).json({ message: "Weekly duty postponed successfully." });
  } catch (err) {
    await dbRun("ROLLBACK");
    res
      .status(500)
      .json({ error: "Failed to postpone weekly duty.", details: err.message });
  }
});

// Add new API endpoint for fetching multiple weekly duties
app.get("/api/weekly-duties/upcoming", async (req, res) => {
  const { count = 12 } = req.query; // Default to 12 weeks
  try {
    const today = dayjs().format("YYYY-MM-DD");
    const rows = await dbAll(
      `SELECT wd.week_start_date, wd.week_number, n.name, wd.is_edited, wd.reason, o.name as original_name
       FROM weekly_duty wd
       JOIN names n ON wd.name_id = n.id
       LEFT JOIN names o ON wd.original_name_id = o.id
       WHERE wd.week_start_date >= ?
       ORDER BY wd.week_start_date ASC
       LIMIT ?`,
      [today, count]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({
      error: "Failed to fetch upcoming weekly duties.",
      details: err.message,
    });
  }
});

// New API endpoint for overriding a weekly duty slot
app.post("/api/weekly-duty/override", async (req, res) => {
  const { week_start_date, name_id, reason } = req.body;
  if (!week_start_date || !name_id || !reason) {
    return res.status(400).json({
      error: "All fields are required: week_start_date, name_id, reason.",
    });
  }

  try {
    await dbRun("BEGIN TRANSACTION;");

    const row = await dbGet(
      "SELECT id, name_id, is_edited FROM weekly_duty WHERE week_start_date = ?",
      [week_start_date]
    );

    if (row) {
      // If a record exists, update it
      await dbRun(
        `UPDATE weekly_duty SET name_id = ?, reason = ?, original_name_id = CASE WHEN is_edited = 0 THEN ? ELSE original_name_id END, is_edited = 1 WHERE id = ?;`,
        [name_id, reason, row.name_id, row.id]
      );
    } else {
      // If no record exists for the date, insert a new one (marked as edited)
      // This scenario should be less common for weekly duty which is regenerated,
      // but good for robustness. Original_name_id would be null here.
      await dbRun(
        `INSERT INTO weekly_duty (week_start_date, name_id, is_edited, reason) VALUES (?, ?, 1, ?);`,
        [week_start_date, name_id, reason]
      );
    }

    await dbRun("COMMIT;");
    res.status(200).json({ message: "Weekly duty slot updated successfully." });
  } catch (err) {
    await dbRun("ROLLBACK;");
    console.error("Failed to override weekly duty slot:", err.message);
    res.status(500).json({
      error: "Failed to override weekly duty slot.",
      details: err.message,
    });
  }
});

// --- Regeneration Logic ---
async function regenerateAll(date) {
  const allNames = await dbAll(`SELECT * FROM names ORDER BY id`);
  const absences = await dbAll(
    `SELECT name_id FROM absences WHERE absence_date = ?`,
    [date]
  );
  const absentNameIds = new Set(absences.map((a) => a.name_id));
  const presentNames = allNames.filter((name) => !absentNameIds.has(name.id));

  await regenerateGateAssignment(date, presentNames);
  await regenerateHourlySchedule(date, 0, null, null, presentNames);
  await regenerateWeeklyDuty(date, allNames);
}

async function regenerateGateAssignment(date, presentNames) {
  const existing = await dbGet(
    "SELECT * FROM gate_assignments WHERE assignment_date = ?",
    [date]
  );
  if (existing) return;
  if (presentNames.length === 0) return;
  const prevDate = dayjs(date).subtract(1, "day").format("YYYY-MM-DD");
  const prevAssignment = await dbGet(
    `SELECT main_name_id, backup_name_id FROM gate_assignments WHERE assignment_date = ?`,
    [prevDate]
  );
  let newMain = null;
  if (
    prevAssignment?.backup_name_id &&
    presentNames.some((p) => p.id === prevAssignment.backup_name_id)
  )
    newMain = presentNames.find((p) => p.id === prevAssignment.backup_name_id);
  else if (prevAssignment?.main_name_id) {
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
  await dbRun(
    `INSERT INTO gate_assignments (assignment_date, main_name_id, backup_name_id) VALUES (?, ?, ?)`,
    [date, newMain.id, newBackup ? newBackup.id : null]
  );
}

async function regenerateHourlySchedule(
  date,
  fromHour = 0,
  userName,
  reason,
  presentNamesList
) {
  const existing = await dbGet(
    "SELECT * FROM hourly_schedule WHERE scheduled_date = ?",
    [date]
  );
  if (existing && !userName) return;
  const presentNames =
    presentNamesList ||
    (await (async () => {
      const allNames = await dbAll(`SELECT * FROM names ORDER BY id`);
      const absences = await dbAll(
        `SELECT name_id FROM absences WHERE absence_date = ?`,
        [date]
      );
      const absentNameIds = new Set(absences.map((a) => a.name_id));
      return allNames.filter((name) => !absentNameIds.has(name.id));
    })());
  await dbRun("BEGIN TRANSACTION;");
  try {
    await dbRun(
      "DELETE FROM hourly_schedule WHERE scheduled_date = ? AND scheduled_time >= ? AND is_edited = 0",
      [date, fromHour]
    );
    if (presentNames.length > 0) {
      let shuffledNames = [...presentNames].sort(() => 0.5 - Math.random());
      const timeSlots = [8, 9, 10, 11, 12, 13].filter(
        (time) => time >= fromHour
      );
      for (const time of timeSlots) {
        const assignedName =
          shuffledNames[timeSlots.indexOf(time) % shuffledNames.length];
        await dbRun(
          "INSERT OR IGNORE INTO hourly_schedule (name_id, scheduled_date, scheduled_time, is_edited) VALUES (?, ?, ?, 0)",
          [assignedName.id, date, time]
        );
      }
    }
    if (userName && reason)
      await dbRun(
        "INSERT INTO audit_log (action_date, action_type, user_name, reason) VALUES (?, 'shuffle', ?, ?)",
        [date, userName, reason]
      );
    await dbRun("COMMIT;");
  } catch (err) {
    await dbRun("ROLLBACK;");
    throw err;
  }
}

async function regenerateWeeklyDuty(date, allNames) {
  if (allNames.length === 0) return;

  const WEEKS_TO_GENERATE = 12;
  const startOfWeekForRequest = dayjs(date).weekday(0).format("YYYY-MM-DD");

  for (let i = 0; i < WEEKS_TO_GENERATE; i++) {
    const weekStartDate = dayjs(startOfWeekForRequest)
      .add(i, "week")
      .format("YYYY-MM-DD");
    const existing = await dbGet(
      "SELECT * FROM weekly_duty WHERE week_start_date = ?",
      [weekStartDate]
    );
    if (existing && existing.is_edited === 0) {
      continue;
    }
    if (existing && existing.is_edited === 1) {
      continue;
    }

    try {
      const prevWeekDate = dayjs(weekStartDate)
        .subtract(1, "week")
        .format("YYYY-MM-DD");
      const lastDuty = await dbGet(
        `SELECT name_id FROM weekly_duty WHERE week_start_date = ?`,
        [prevWeekDate]
      );

      let lastPersonIndex = -1;
      if (lastDuty) {
        const foundIndex = allNames.findIndex((n) => n.id === lastDuty.name_id);
        if (foundIndex !== -1) {
          lastPersonIndex = foundIndex;
        }
      } else {
        const mostRecentDuty = await dbGet(
          `SELECT name_id FROM weekly_duty ORDER BY week_start_date DESC LIMIT 1`
        );
        if (mostRecentDuty) {
          const foundIndex = allNames.findIndex(
            (n) => n.id === mostRecentDuty.name_id
          );
          if (foundIndex !== -1) {
            lastPersonIndex = foundIndex;
          }
        }
      }
      const nextPersonIndex = (lastPersonIndex + 1) % allNames.length;
      const newDutyPerson = allNames[nextPersonIndex];

      if (newDutyPerson) {
        const weekNumber = dayjs(weekStartDate).isoWeek();
        await dbRun(
          `INSERT OR IGNORE INTO weekly_duty (week_start_date, name_id, week_number) VALUES (?, ?, ?)`,
          [weekStartDate, newDutyPerson.id, weekNumber]
        );
      }
    } catch (err) {
      console.error("Failed to generate a weekly duty slot:", err);
    }
  }
}

// --- Serve Frontend ---
app.use(express.static(path.join(__dirname, "frontend", "dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "dist", "index.html"));
});
