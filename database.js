const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class Database {
    constructor(dbPath = './calls.db') {
        this.dbPath = dbPath;
        this.db = null;
    }

    async initialize() {
        const dbExists = fs.existsSync(this.dbPath);
        
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Error opening database:', err.message);
                    reject(err);
                    return;
                }
                
                console.log(`Connected to SQLite database at ${this.dbPath}`);
                
                if (!dbExists) {
                    console.log('Database file not found, creating new database...');
                    this.createTables()
                        .then(() => resolve())
                        .catch(reject);
                } else {
                    console.log('Using existing database');
                    resolve();
                }
            });
        });
    }

    async createTables() {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT NOT NULL,
                twilio_call_sid TEXT UNIQUE NOT NULL,
                duration_seconds INTEGER DEFAULT 0,
                recording_url TEXT,
                recording_sid TEXT,
                transcript_text TEXT,
                transcript_status TEXT DEFAULT 'pending',
                call_status TEXT DEFAULT 'initiated',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `;

        const createIndexes = [
            'CREATE INDEX IF NOT EXISTS idx_created_at ON calls(created_at DESC);',
            'CREATE INDEX IF NOT EXISTS idx_call_sid ON calls(twilio_call_sid);'
        ];

        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run(createTableSQL, (err) => {
                    if (err) {
                        console.error('Error creating table:', err.message);
                        reject(err);
                        return;
                    }
                    console.log('Calls table created successfully');
                });

                createIndexes.forEach(indexSQL => {
                    this.db.run(indexSQL, (err) => {
                        if (err) {
                            console.error('Error creating index:', err.message);
                        }
                    });
                });

                resolve();
            });
        });
    }

    insertCall(phoneNumber, callSid) {
        return new Promise((resolve, reject) => {
            const sql = 'INSERT INTO calls (phone_number, twilio_call_sid) VALUES (?, ?)';
            this.db.run(sql, [phoneNumber, callSid], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, callSid });
                }
            });
        });
    }

    updateCallStatus(callSid, status, duration = null) {
        return new Promise((resolve, reject) => {
            const sql = duration !== null 
                ? 'UPDATE calls SET call_status = ?, duration_seconds = ?, updated_at = CURRENT_TIMESTAMP WHERE twilio_call_sid = ?'
                : 'UPDATE calls SET call_status = ?, updated_at = CURRENT_TIMESTAMP WHERE twilio_call_sid = ?';
            
            const params = duration !== null 
                ? [status, duration, callSid]
                : [status, callSid];

            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ changes: this.changes });
                }
            });
        });
    }

    updateRecording(callSid, recordingUrl, recordingSid) {
        return new Promise((resolve, reject) => {
            const sql = `UPDATE calls SET 
                recording_url = ?, 
                recording_sid = ?, 
                updated_at = CURRENT_TIMESTAMP 
                WHERE twilio_call_sid = ?`;
            
            this.db.run(sql, [recordingUrl, recordingSid, callSid], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ changes: this.changes });
                }
            });
        });
    }

    updateTranscript(callSid, transcriptText, transcriptStatus = 'completed') {
        return new Promise((resolve, reject) => {
            const sql = `UPDATE calls SET 
                transcript_text = ?, 
                transcript_status = ?, 
                updated_at = CURRENT_TIMESTAMP 
                WHERE twilio_call_sid = ?`;
            
            this.db.run(sql, [transcriptText, transcriptStatus, callSid], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ changes: this.changes });
                }
            });
        });
    }

    getAllCalls(limit = 100) {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM calls ORDER BY created_at DESC LIMIT ?';
            this.db.all(sql, [limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    getCallBySid(callSid) {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM calls WHERE twilio_call_sid = ?';
            this.db.get(sql, [callSid], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err.message);
                } else {
                    console.log('Database connection closed');
                }
            });
        }
    }
}

module.exports = Database;