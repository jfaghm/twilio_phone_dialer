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

        if (process.env.DEMO_MODE === 'true') {
            const mockCallSid = 'CA' + Math.random().toString(36).substr(2, 32);
            
            await db.insertCall(phoneNumber, mockCallSid);
            console.log(`DEMO MODE: Simulated call to ${phoneNumber} with SID ${mockCallSid}`);
            
            setTimeout(async () => {
                try {
                    await db.updateCallStatus(mockCallSid, 'completed', Math.floor(Math.random() * 120) + 10);
                    await db.updateRecording(mockCallSid, 
                        'https://api.twilio.com/demo-recording.wav', 
                        'RE' + Math.random().toString(36).substr(2, 32)
                    );
                    await db.updateTranscript(mockCallSid, 
                        'This is a demo transcript. The call was successfully completed in demo mode.',
                        'completed'
                    );
                    console.log(`DEMO MODE: Simulated call ${mockCallSid} completed with recording and transcript`);
                } catch (error) {
                    console.error('Error in demo mode simulation:', error);
                }
            }, 3000);
            
            return res.json({ success: true, callSid: mockCallSid });
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
        console.error('Error details:', error.message, error.code, error.moreInfo);
        res.status(500).json({ error: error.message || 'Failed to initiate call' });
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
        
        // Initiate modern transcription using Twilio Speech Recognition
        if (twilioClient && !process.env.DEMO_MODE) {
            try {
                await db.updateTranscript(CallSid, null, 'processing');
                
                const transcript = await twilioClient.intelligence.v2.transcripts.create({
                    recordingSid: RecordingSid,
                    operationCallback: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/transcription`
                });
                
                console.log(`Transcription initiated for call ${CallSid}: ${transcript.sid}`);
            } catch (transcriptionError) {
                console.error('Error initiating transcription:', transcriptionError);
                await db.updateTranscript(CallSid, null, 'failed');
            }
        }
        
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

app.post('/api/webhooks/transcription', async (req, res) => {
    try {
        const { transcript_sid, status, recording_sid } = req.body;
        
        console.log(`Transcription webhook: ${transcript_sid}, status: ${status}`);
        
        if (status === 'completed' && twilioClient) {
            try {
                // Fetch the completed transcript
                const transcript = await twilioClient.intelligence.v2.transcripts(transcript_sid).fetch();
                
                // Find the call by recording SID
                // Note: We'd need to store recording_sid -> call_sid mapping for this to work perfectly
                // For now, we'll update any call with this recording SID
                const calls = await db.getAllCalls(100);
                const matchingCall = calls.find(call => call.recording_sid === recording_sid);
                
                if (matchingCall && transcript.results) {
                    const transcriptText = transcript.results.transcript || 'Transcription completed but no text available';
                    await db.updateTranscript(matchingCall.twilio_call_sid, transcriptText, 'completed');
                    console.log(`Transcription completed for call ${matchingCall.twilio_call_sid}`);
                } else {
                    console.log('No matching call found for transcription or no transcript results');
                }
            } catch (fetchError) {
                console.error('Error fetching completed transcript:', fetchError);
            }
        } else if (status === 'failed') {
            console.log('Transcription failed');
            // Could update the transcript status to 'failed' here if we had the call SID
        }
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Error processing transcription webhook:', error);
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