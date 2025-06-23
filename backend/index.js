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
      // Create a master table for names
      db.run(
        `CREATE TABLE IF NOT EXISTS names (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE
        )`,
        (err) => {
          if (err) console.error("Error creating names table", err.message);
          else console.log("Table 'names' is ready.");
        }
      );

      // Create a table to store the generated daily schedules
      db.run(
        `CREATE TABLE IF NOT EXISTS daily_schedule (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name_id INTEGER NOT NULL,
          scheduled_date TEXT NOT NULL,
          scheduled_time INTEGER NOT NULL,
          FOREIGN KEY (name_id) REFERENCES names (id) ON DELETE CASCADE,
          UNIQUE(scheduled_date, scheduled_time),
          UNIQUE(scheduled_date, name_id)
        )`,
        (err) => {
          if (err)
            console.error("Error creating daily_schedule table", err.message);
          else console.log("Table 'daily_schedule' is ready.");
        }
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

// --- API Route for Generating and Fetching Schedule ---
app.get("/api/schedule", (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res
      .status(400)
      .json({ error: "Valid date query (YYYY-MM-DD) is required." });
  }

  const sqlGetExisting = `SELECT ds.scheduled_time, n.name, n.id AS name_id FROM daily_schedule ds
                            JOIN names n ON ds.name_id = n.id
                            WHERE ds.scheduled_date = ? ORDER BY ds.scheduled_time ASC`;

  db.all(sqlGetExisting, [date], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    if (rows.length > 0) {
      return res.json({ date: date, data: rows });
    } else {
      // Generate a new schedule if one doesn't exist
      regenerateSchedule(date, res);
    }
  });
});

// --- API Route to Regenerate Today's Schedule ---
app.post("/api/schedule/regenerate", (req, res) => {
  // We now expect the current hour from the frontend
  const { date, hour } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "A valid date is required." });
  }
  // Pass the hour to the regeneration function. Default to 0 if not provided.
  regenerateSchedule(date, res, hour || 0);
});

// --- Reusable function to generate/regenerate a schedule for a given date ---
function regenerateSchedule(date, res, fromHour = 0) {
  // This function is now structured with nested callbacks to prevent race conditions.

  // Step 1: Get all names and past assignments in parallel.
  const allNamesQuery = `SELECT * FROM names`;
  const pastAssignmentsQuery = `SELECT name_id FROM daily_schedule WHERE scheduled_date = ? AND scheduled_time < ?`;

  db.all(allNamesQuery, [], (err, allNames) => {
    if (err) {
      return res.status(500).json({ error: "Could not fetch names." });
    }

    db.all(pastAssignmentsQuery, [date, fromHour], (err, pastAssignments) => {
      if (err) {
        return res
          .status(500)
          .json({ error: "Could not fetch past assignments." });
      }

      // Step 2: Determine available names using Javascript, which is safer than complex SQL.
      const preservedNameIds = new Set(pastAssignments.map((a) => a.name_id));
      const availableNames = allNames.filter(
        (name) => !preservedNameIds.has(name.id)
      );

      // Step 3: Run the rest of the logic inside a transaction.
      db.serialize(() => {
        db.run("BEGIN TRANSACTION;");

        // Step 4: Delete only the schedule entries for the upcoming hours.
        db.run(
          "DELETE FROM daily_schedule WHERE scheduled_date = ? AND scheduled_time >= ?",
          [date, fromHour]
        );

        if (availableNames.length > 0) {
          // Step 5: Shuffle the available names for randomness.
          let shuffledNames = [...availableNames];
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
            "INSERT INTO daily_schedule (name_id, scheduled_date, scheduled_time) VALUES (?, ?, ?)"
          );

          // Step 6: Prepare the new schedule for insertion into future slots.
          shuffledNames.forEach((assignedName, index) => {
            const time = futureTimeSlots[index];
            if (time !== undefined) {
              insertStmt.run(assignedName.id, date, time);
            }
          });
          insertStmt.finalize();
        }

        // Step 7: Commit the transaction.
        db.run("COMMIT;", (err) => {
          if (err) {
            db.run("ROLLBACK;");
            return res
              .status(500)
              .json({ error: "Failed to commit schedule regeneration." });
          }

          // Step 8: Fetch the complete, updated schedule for the day and send it back ONLY after the commit is successful.
          const finalScheduleQuery = `SELECT ds.scheduled_time, n.name, n.id AS name_id FROM daily_schedule ds JOIN names n ON ds.name_id = n.id WHERE ds.scheduled_date = ? ORDER BY ds.scheduled_time ASC`;
          db.all(finalScheduleQuery, [date], (err, finalRows) => {
            if (err) {
              return res
                .status(500)
                .json({ error: "Failed to retrieve final schedule." });
            }
            res.status(201).json({ date: date, data: finalRows });
          });
        });
      });
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
