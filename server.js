require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const Database = require('./database');

const app = express();
const port = process.env.PORT || 3000;

let db;
let twilioClient;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const initializeServer = async () => {
    try {
        db = new Database(process.env.DATABASE_FILE || './calls.db');
        await db.initialize();
        console.log('Database initialized successfully');

        if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
            twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            console.log('Twilio client initialized');
        } else {
            console.warn('Twilio credentials not found. Please check your .env file');
        }

    } catch (error) {
        console.error('Failed to initialize server:', error);
        process.exit(1);
    }
};

app.post('/api/call', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber || !phoneNumber.match(/^\+?[1-9]\d{1,14}$/)) {
            return res.status(400).json({ error: 'Invalid phone number format' });
        }

        if (!twilioClient) {
            return res.status(500).json({ error: 'Twilio not configured' });
        }

        const call = await twilioClient.calls.create({
            url: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/voice`,
            to: phoneNumber,
            from: process.env.TWILIO_PHONE_NUMBER,
            record: true,
            recordingStatusCallback: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/recording`,
            recordingStatusCallbackEvent: ['completed'],
            recordingStatusCallbackMethod: 'POST'
        });

        await db.insertCall(phoneNumber, call.sid);
        
        res.json({ success: true, callSid: call.sid });
        
    } catch (error) {
        console.error('Error making call:', error);
        res.status(500).json({ error: 'Failed to initiate call' });
    }
});

app.post('/api/webhooks/voice', (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    
    twiml.say('This call is being recorded for quality and training purposes.');
    twiml.pause({ length: 1 });
    twiml.say('Thank you for using our service. This call will now end.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

app.post('/api/webhooks/recording', async (req, res) => {
    try {
        const { CallSid, RecordingUrl, RecordingSid, CallDuration } = req.body;
        
        await db.updateRecording(CallSid, RecordingUrl, RecordingSid);
        await db.updateCallStatus(CallSid, 'completed', parseInt(CallDuration) || 0);
        
        console.log(`Recording completed for call ${CallSid}: ${RecordingUrl}`);
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Error processing recording webhook:', error);
        res.sendStatus(500);
    }
});

app.post('/api/webhooks/status', async (req, res) => {
    try {
        const { CallSid, CallStatus, CallDuration } = req.body;
        
        await db.updateCallStatus(CallSid, CallStatus.toLowerCase(), parseInt(CallDuration) || 0);
        
        console.log(`Call status updated: ${CallSid} -> ${CallStatus}`);
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Error processing status webhook:', error);
        res.sendStatus(500);
    }
});

app.get('/api/calls', async (req, res) => {
    try {
        const calls = await db.getAllCalls();
        res.json(calls);
    } catch (error) {
        console.error('Error fetching calls:', error);
        res.status(500).json({ error: 'Failed to fetch calls' });
    }
});

app.get('/api/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    res.write('data: {"type":"connected"}\n\n');

    const interval = setInterval(() => {
        res.write('data: {"type":"heartbeat"}\n\n');
    }, 30000);

    req.on('close', () => {
        clearInterval(interval);
    });
});

app.get('/health', async (req, res) => {
    const checks = {
        database: db ? 'ok' : 'error',
        twilio: twilioClient ? 'ok' : 'not_configured',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    };

    if (db) {
        try {
            await db.getAllCalls(1);
        } catch (error) {
            checks.database = 'error';
        }
    }

    res.json(checks);
});

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Twilio Phone Dialer</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body>
            <h1>Twilio Phone Dialer</h1>
            <p>Server is running. API endpoints:</p>
            <ul>
                <li><strong>POST /api/call</strong> - Make a call</li>
                <li><strong>GET /api/calls</strong> - Get call history</li>
                <li><strong>GET /health</strong> - Health check</li>
            </ul>
            <p>Frontend interface coming soon...</p>
        </body>
        </html>
    `);
});

process.on('SIGINT', () => {
    console.log('Shutting down server...');
    if (db) {
        db.close();
    }
    process.exit(0);
});

initializeServer().then(() => {
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
        console.log(`Health check: http://localhost:${port}/health`);
    });
});

module.exports = app;