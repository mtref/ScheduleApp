// backend/index.js
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const dayjs = require("dayjs");
const weekday = require("dayjs/plugin/weekday");
const isoWeek = require("dayjs/plugin/isoWeek");
dayjs.extend(weekday);
dayjs.extend(isoWeek);

const app = express();
const PORT = 3000;

// --- Database Setup ---
const dataDir = path.join(__dirname, "data");
const DB_PATH = path.join(dataDir, "database.db");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// --- Helper for async DB calls --
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
        `CREATE TABLE IF NOT EXISTS weekly_duty (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          week_start_date TEXT NOT NULL UNIQUE,
          name_id INTEGER,
          is_edited INTEGER DEFAULT 0,
          original_name_id INTEGER,
          reason TEXT,
          week_number INTEGER,
          is_off_week INTEGER DEFAULT 0,
          FOREIGN KEY (name_id) REFERENCES names(id) ON DELETE SET NULL,
          FOREIGN KEY (original_name_id) REFERENCES names(id) ON DELETE SET NULL
        )`
      );
      // NEW TABLE: oncall_schedule
      db.run(
        `CREATE TABLE IF NOT EXISTS oncall_schedule (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              week_start_date TEXT NOT NULL,
              day_of_week TEXT NOT NULL, -- 'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'
              name_id INTEGER NOT NULL,
              UNIQUE (week_start_date, day_of_week),
              FOREIGN KEY (name_id) REFERENCES names(id) ON DELETE CASCADE
          )`
      );
      // NEW TABLE: oncall_rotation_state (to persist the last assigned person in the global rotation)
      db.run(
        `CREATE TABLE IF NOT EXISTS oncall_rotation_state (
              id INTEGER PRIMARY KEY DEFAULT 1, -- Only one row in this table
              last_assigned_name_id INTEGER NOT NULL,
              FOREIGN KEY (last_assigned_name_id) REFERENCES names(id) ON DELETE RESTRICT
          )`
      );

      const initialNames = ["المؤيد", "محسن", "عمر", "الحارث", "هلال", "جابر"];
      const insertNameStmt = db.prepare(
        "INSERT OR IGNORE INTO names (name) VALUES (?)"
      );
      initialNames.forEach((name) => insertNameStmt.run(name));
      insertNameStmt.finalize();

      // **MODIFIED PART: Ensure oncall_rotation_state initializes with the first person**
      db.get(
        `SELECT COUNT(*) as count FROM oncall_rotation_state`,
        (err, row) => {
          if (err) {
            console.error("Error checking oncall_rotation_state:", err.message);
            return;
          }
          if (row.count === 0) {
            // Check for names first to ensure there's someone to assign
            db.get(
              `SELECT id FROM names ORDER BY id ASC LIMIT 1`, // Get the first name by ID
              (err, nameRow) => {
                if (err || !nameRow) {
                  console.warn(
                    "No names found to initialize oncall_rotation_state. Ensure names are added."
                  );
                  return;
                }
                // Insert the first name's ID into oncall_rotation_state
                db.run(
                  `INSERT INTO oncall_rotation_state (id, last_assigned_name_id) VALUES (1, ?)`,
                  [nameRow.id],
                  (err) => {
                    if (err)
                      console.error(
                        "Error initializing oncall_rotation_state:",
                        err.message
                      );
                    else
                      console.log(
                        `oncall_rotation_state initialized with first person (ID: ${nameRow.id}).`
                      );
                  }
                );
              }
            );
          }
        }
      );
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
    await regenerateAll(date); // This will populate/maintain basic weekly and on-call duties

    const hourlyQuery = `SELECT hs.scheduled_time, hs.is_edited, hs.reason, n.name, hs.name_id, o.name as original_name FROM hourly_schedule hs JOIN names n ON hs.name_id = n.id LEFT JOIN names o ON hs.original_name_id = o.id WHERE hs.scheduled_date = ? ORDER BY hs.scheduled_time ASC`;
    const gateQuery = `SELECT main.id as main_id, main.name as main_name, backup.id as backup_id, backup.name as backup_name FROM gate_assignments ga JOIN names main ON ga.main_name_id = main.id LEFT JOIN names backup ON ga.backup_name_id = backup.id WHERE ga.assignment_date = ?`;
    const auditQuery = `SELECT user_name, reason, timestamp FROM audit_log WHERE action_date = ? AND action_type = 'shuffle' ORDER BY timestamp DESC LIMIT 1`;
    const absencesQuery = `SELECT name_id FROM absences WHERE absence_date = ?`;
    const startOfWeek = dayjs(date).startOf("isoWeek").format("YYYY-MM-DD");
    const weeklyQuery = `SELECT wd.week_start_date, wd.is_edited, wd.reason, n.name, wd.name_id, o.name as original_name, wd.week_number, wd.is_off_week FROM weekly_duty wd LEFT JOIN names n ON wd.name_id = n.id LEFT JOIN names o ON wd.original_name_id = o.id WHERE wd.week_start_date = ?`;

    const [hourlyRows, gateRow, weeklyRow, auditRow, absenceRows] =
      await Promise.all([
        dbAll(hourlyQuery, [date]),
        dbGet(gateQuery, [date]),
        dbGet(weeklyQuery, [startOfWeek]),
        dbGet(auditQuery, [date]),
        dbAll(absencesQuery, [date]),
      ]);

    console.log("Fetched weeklyRow for current date:", weeklyRow);

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

app.get("/api/weekly-duties/upcoming", async (req, res) => {
  const { count = 12 } = req.query;
  try {
    const today = dayjs().format("YYYY-MM-DD");
    const rows = await dbAll(
      `SELECT wd.week_start_date, wd.week_number, n.name, wd.is_edited, wd.reason, o.name as original_name, wd.is_off_week
       FROM weekly_duty wd
       LEFT JOIN names n ON wd.name_id = n.id
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

app.post("/api/weekly-duty/override", async (req, res) => {
  const { week_start_date, name_id, reason, is_off_week } = req.body;
  if (!week_start_date || (!name_id && is_off_week === 0) || !reason) {
    return res.status(400).json({
      error:
        "All required fields are missing: week_start_date, name_id (if not off-week), reason, is_off_week.",
    });
  }

  const newIsOffWeekInt = is_off_week ? 1 : 0;
  const actualNameId = newIsOffWeekInt === 1 ? null : name_id;

  try {
    await dbRun("BEGIN TRANSACTION;");

    const row = await dbGet(
      "SELECT id, name_id, is_edited, original_name_id, is_off_week FROM weekly_duty WHERE week_start_date = ?",
      [week_start_date]
    );

    const oldIsOffWeekInt = row ? row.is_off_week : 0;

    let originalNameIdToSave = null;
    if (row && row.is_edited === 0 && row.name_id !== actualNameId) {
      originalNameIdToSave = row.name_id;
    } else if (row && row.is_edited === 1) {
      originalNameIdToSave = row.original_name_id;
    }

    if (row) {
      await dbRun(
        `UPDATE weekly_duty SET name_id = ?, reason = ?, original_name_id = ?, is_edited = 1, is_off_week = ? WHERE id = ?;`,
        [actualNameId, reason, originalNameIdToSave, newIsOffWeekInt, row.id]
      );
    } else {
      await dbRun(
        `INSERT INTO weekly_duty (week_start_date, name_id, is_edited, reason, is_off_week, week_number, original_name_id) VALUES (?, ?, 1, ?, ?, ?, ?);`,
        [
          week_start_date,
          actualNameId,
          reason,
          newIsOffWeekInt,
          dayjs(week_start_date).isoWeek(),
          null,
        ]
      );
    }

    const isOffWeekStatusChanging = oldIsOffWeekInt !== newIsOffWeekInt;

    if (isOffWeekStatusChanging) {
      console.log(
        `Off-week status changed for ${week_start_date}. Deleting auto-generated future duties for re-shift.`
      );
      await dbRun(
        `DELETE FROM weekly_duty WHERE week_start_date > ? AND is_edited = 0;`,
        [week_start_date]
      );
      await regenerateWeeklyDuty(
        week_start_date,
        await dbAll(`SELECT * FROM names ORDER BY id`)
      );
    } else {
      console.log(
        `Off-week status NOT changed for ${week_start_date}. Performing direct override, no future shift triggered here.`
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

// NEW API ENDPOINT: Fetch On-Call Table Data
app.get("/api/oncall-table", async (req, res) => {
  const { date } = req.query; // Date for which to fetch the week's on-call
  if (!date) return res.status(400).json({ error: "Date is required." });

  try {
    const startOfWeek = dayjs(date).startOf("isoWeek").format("YYYY-MM-DD");

    const onCallQuery = `
            SELECT
                ocs.day_of_week,
                n.name AS assigned_name,
                n.id AS name_id
            FROM
                oncall_schedule ocs
            JOIN
                names n ON ocs.name_id = n.id
            WHERE
                ocs.week_start_date = ?
            ORDER BY
                CASE ocs.day_of_week
                    WHEN 'sun' THEN 1
                    WHEN 'mon' THEN 2
                    WHEN 'tue' THEN 3
                    WHEN 'wed' THEN 4
                    WHEN 'thu' THEN 5
                    WHEN 'fri' THEN 6
                    WHEN 'sat' THEN 7
                    ELSE 8
                END;
        `;
    const rows = await dbAll(onCallQuery, [startOfWeek]);

    // Ensure all 7 days are present, even if no assignment found in DB
    const DAYS_OF_WEEK_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const formattedSchedule = DAYS_OF_WEEK_KEYS.map((dayKey) => {
      const found = rows.find((row) => row.day_of_week === dayKey);
      return {
        day: dayKey,
        name: found ? found.assigned_name : "غير محدد",
        name_id: found ? found.name_id : null,
      };
    });

    res.json({ data: formattedSchedule, weekStartDate: startOfWeek });
  } catch (err) {
    console.error("Error fetching on-call table:", err.message);
    res
      .status(500)
      .json({ error: "Failed to fetch on-call table.", details: err.message });
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
  await generateOnCallSchedule(date, allNames); // NEW: Generate On-Call Schedule
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

async function regenerateWeeklyDuty(triggerDate, allNames) {
  if (allNames.length === 0) return;

  const WEEKS_TO_GENERATE = 52;
  const startOfWeekForTrigger = dayjs(triggerDate).startOf("isoWeek");

  console.log(`--- Regenerate Weekly Duty for triggerDate: ${triggerDate} ---`);

  const allExistingDuties = await dbAll(
    `SELECT * FROM weekly_duty ORDER BY week_start_date ASC`
  );
  const fixedDutiesMap = new Map();
  const allExistingMap = new Map();
  allExistingDuties.forEach((duty) => {
    allExistingMap.set(duty.week_start_date, duty);
    if (duty.is_edited === 1) {
      fixedDutiesMap.set(duty.week_start_date, duty);
    }
  });
  console.log(
    "Fixed duties map (only manually edited/off-weeks):",
    fixedDutiesMap
  );
  console.log("All existing duties map:", allExistingMap);

  let lastAssignedPersonId = null;

  const mostRecentActualDutyBeforeTrigger = await dbGet(
    `SELECT name_id, is_edited, is_off_week FROM weekly_duty WHERE name_id IS NOT NULL AND week_start_date < ? AND is_off_week = 0 ORDER BY week_start_date DESC LIMIT 1`,
    [startOfWeekForTrigger.format("YYYY-MM-DD")]
  );

  if (mostRecentActualDutyBeforeTrigger) {
    lastAssignedPersonId = mostRecentActualDutyBeforeTrigger.name_id;
  } else {
    if (allNames.length > 0) {
      lastAssignedPersonId = allNames[0].id;
    }
  }

  console.log(
    `Initial lastAssignedPersonId for rotation: ${lastAssignedPersonId}`
  );

  for (let i = 0; i < WEEKS_TO_GENERATE; i++) {
    const weekStartDate = dayjs(startOfWeekForTrigger)
      .add(i, "week")
      .startOf("isoWeek")
      .format("YYYY-MM-DD");
    const weekNumber = dayjs(weekStartDate).isoWeek();

    console.log(`Processing week: ${weekStartDate} (Week No: ${weekNumber})`);

    const existingFixedRecord = fixedDutiesMap.get(weekStartDate);
    const existingAnyRecord = allExistingMap.get(weekStartDate);

    if (existingFixedRecord) {
      console.log(
        `  Existing MANUALLY EDITED/FIXED record found for ${weekStartDate}:`,
        existingFixedRecord
      );
      if (
        existingFixedRecord.is_off_week === 0 &&
        existingFixedRecord.name_id !== null
      ) {
        lastAssignedPersonId = existingFixedRecord.name_id;
        console.log(
          `  Updated lastAssignedPersonId based on preserved fixed week: ${lastAssignedPersonId}`
        );
      } else if (existingFixedRecord.is_off_week === 1) {
        console.log(
          `  Skipping over fixed off-week: ${weekStartDate}. Rotation will effectively skip this "turn."`
        );
      }
      continue;
    }

    if (
      existingAnyRecord &&
      existingAnyRecord.is_edited === 0 &&
      existingAnyRecord.name_id !== null &&
      existingAnyRecord.is_off_week === 0
    ) {
      console.log(
        `  Existing auto-generated record is correctly populated. Keeping as is. New lastAssignedPersonId: ${existingAnyRecord.name_id}`
      );
      lastAssignedPersonId = existingAnyRecord.name_id;
      continue;
    }

    let expectedDutyPersonId = null;
    if (lastAssignedPersonId !== null) {
      const lastIndex = allNames.findIndex(
        (n) => n.id === lastAssignedPersonId
      );
      const nextIndex = (lastIndex + 1) % allNames.length;
      expectedDutyPersonId = allNames[nextIndex].id;
      console.log(`  Calculated expectedDutyPersonId: ${expectedDutyPersonId}`);
    } else if (allNames.length > 0) {
      expectedDutyPersonId = allNames[0].id;
      console.log(
        `  Calculated expectedDutyPersonId: (starting) ${expectedDutyPersonId}`
      );
    }

    if (expectedDutyPersonId) {
      if (existingAnyRecord) {
        console.log(
          `  Updating existing auto-generated (possibly NULL/incorrect) for ${weekStartDate}: name_id=${expectedDutyPersonId}`
        );
        try {
          await dbRun(
            `UPDATE weekly_duty SET name_id = ?, week_number = ?, is_edited = 0, is_off_week = 0, original_name_id = NULL, reason = NULL WHERE week_start_date = ?;`,
            [expectedDutyPersonId, weekNumber, weekStartDate]
          );
          lastAssignedPersonId = expectedDutyPersonId;
          console.log(
            `  Successfully UPDATED auto-generated. New lastAssignedPersonId: ${lastAssignedPersonId}`
          );
        } catch (err) {
          console.error(
            "Failed to update auto-generated weekly duty slot:",
            err.message
          );
        }
      } else {
        console.log(
          `  INSERTING new auto-generated entry for ${weekStartDate}: name_id=${expectedDutyPersonId}, week_number=${weekNumber}`
        );
        try {
          await dbRun(
            `INSERT INTO weekly_duty (week_start_date, name_id, week_number, is_edited, is_off_week, original_name_id, reason)
                     VALUES (?, ?, ?, 0, 0, NULL, NULL)`,
            [weekStartDate, expectedDutyPersonId, weekNumber]
          );
          lastAssignedPersonId = expectedDutyPersonId;
          console.log(
            `  Successfully INSERTED new auto-generated. New lastAssignedPersonId: ${lastAssignedPersonId}`
          );
        } catch (err) {
          console.error("Failed to insert new weekly duty slot:", err.message);
        }
      }
    } else {
      console.log(
        `  No expectedDutyPersonId for ${weekStartDate}. (Could happen if allNames is empty)`
      );
    }
  }
  console.log(`--- End Regenerate Weekly Duty ---`);
}

// NEW FUNCTION: generateOnCallSchedule
const DAYS_OF_WEEK_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

async function generateOnCallSchedule(triggerDate, allNames) {
  if (allNames.length === 0) {
    console.log("No names available to generate on-call schedule.");
    return;
  }

  const WEEKS_TO_GENERATE_ONCALL = 52; // Generate for a year
  const startDateForGeneration = dayjs(triggerDate).startOf("isoWeek");

  console.log(
    `--- Generating On-Call Schedule for triggerDate: ${triggerDate} ---`
  );

  // Get the last assigned person in the global rotation
  let lastGlobalOnCallPersonId = null;
  const rotationState = await dbGet(
    `SELECT last_assigned_name_id FROM oncall_rotation_state WHERE id = 1`
  );
  if (rotationState) {
    lastGlobalOnCallPersonId = rotationState.last_assigned_name_id;
  } else {
    // Initialize if no state exists
    // This block is for initial setup. If there's no state, we want the *first* assignment
    // to be "واحد" (ID:1). So, the "last assigned" person should be the one *before* "واحد"
    // in the rotation cycle. This means the *last* person in the allNames array.
    lastGlobalOnCallPersonId = allNames[allNames.length - 1].id; // Set to the last person's ID to start rotation with the first
    try {
      await dbRun(
        `INSERT INTO oncall_rotation_state (id, last_assigned_name_id) VALUES (1, ?)`,
        [lastGlobalOnCallPersonId]
      );
      console.log(
        `Initialized oncall_rotation_state with: ${lastGlobalOnCallPersonId} (to ensure first assignment is ${allNames[0].id})`
      );
    } catch (err) {
      console.error("Error initializing oncall_rotation_state:", err.message);
    }
  }

  // Fetch all existing on-call entries to avoid overwriting or to continue rotation correctly
  const existingOnCallEntries = await dbAll(
    `SELECT week_start_date, day_of_week, name_id FROM oncall_schedule ORDER BY week_start_date ASC`
  );
  const existingOnCallMap = new Map(); // Key: `${week_start_date}-${day_of_week}`
  existingOnCallEntries.forEach((entry) => {
    existingOnCallMap.set(
      `${entry.week_start_date}-${entry.day_of_week}`,
      entry
    );
  });
  console.log("Existing On-Call entries:", existingOnCallMap.size);

  let currentRotationPersonId = lastGlobalOnCallPersonId;

  // This check is important: If there are existing historical entries, they dictate the starting point.
  // We need to ensure that *if* there are no historical entries, we genuinely start the rotation
  // from the desired point.
  const mostRecentOnCallEntry = await dbGet(
    `SELECT week_start_date, day_of_week, name_id FROM oncall_schedule ORDER BY week_start_date DESC,
            CASE day_of_week
                WHEN 'sun' THEN 1 WHEN 'mon' THEN 2 WHEN 'tue' THEN 3 WHEN 'wed' THEN 4
                WHEN 'thu' THEN 5 WHEN 'fri' THEN 6 WHEN 'sat' THEN 7 ELSE 8
            END DESC LIMIT 1`
  );

  if (mostRecentOnCallEntry) {
    // If there's historical data, we continue from where it left off.
    currentRotationPersonId = mostRecentOnCallEntry.name_id;
    console.log(
      `Seeding currentRotationPersonId from most recent on-call entry: ${currentRotationPersonId}`
    );
  } else {
    // This is the true "cold start" logic for the on-call schedule assignments.
    // We want the *next* person to be the first in the list (واحد).
    // So, `currentRotationPersonId` must be the *last* person in the list.
    currentRotationPersonId = allNames[allNames.length - 1].id;
    console.log(
      `No prior on-call entries, starting currentRotationPersonId from last name (ID: ${currentRotationPersonId}) to ensure first assignment is first name.`
    );
  }

  for (let i = 0; i < WEEKS_TO_GENERATE_ONCALL; i++) {
    const currentWeekStartDate = dayjs(startDateForGeneration)
      .add(i, "week")
      .startOf("isoWeek")
      .format("YYYY-MM-DD");

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      // Iterate Sun (0) to Sat (6)
      const dayKey = DAYS_OF_WEEK_KEYS[dayIndex];
      const uniqueKey = `${currentWeekStartDate}-${dayKey}`;

      // Check if this specific day's slot already has an assignment in the DB
      if (existingOnCallMap.has(uniqueKey)) {
        // If it exists, update the `currentRotationPersonId` to this person
        // to correctly continue the global sequence for the *next* slot.
        currentRotationPersonId = existingOnCallMap.get(uniqueKey).name_id;
        continue; // Skip insertion for this slot as it's already populated
      }

      // If we are here, the slot needs to be assigned.
      // Get the next person in the overall rotation.
      const lastIndex = allNames.findIndex(
        (n) => n.id === currentRotationPersonId
      );
      const nextIndex = (lastIndex + 1) % allNames.length;
      const nextPersonId = allNames[nextIndex].id;

      try {
        await dbRun(
          `INSERT OR IGNORE INTO oncall_schedule (week_start_date, day_of_week, name_id) VALUES (?, ?, ?)`,
          [currentWeekStartDate, dayKey, nextPersonId]
        );
        currentRotationPersonId = nextPersonId; // Update for the next iteration
        console.log(
          `  Assigned ${
            allNames.find((n) => n.id === nextPersonId).name
          } (ID: ${nextPersonId}) to ${dayKey} for ${currentWeekStartDate}`
        );
      } catch (err) {
        console.error(
          `  Error inserting on-call for ${uniqueKey}:`,
          err.message
        );
      }
    }
  }
  // After generating for all weeks, update the global rotation state for future runs
  try {
    await dbRun(
      `UPDATE oncall_rotation_state SET last_assigned_name_id = ? WHERE id = 1`,
      [currentRotationPersonId]
    );
    console.log(
      `Final oncall_rotation_state updated to: ${currentRotationPersonId}`
    );
  } catch (err) {
    console.error("Error updating oncall_rotation_state:", err.message);
  }
}

// --- Serve Frontend ---
app.use(express.static(path.join(__dirname, "frontend", "dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "dist", "index.html"));
});
