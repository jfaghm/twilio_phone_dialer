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
        const { phoneNumber, mode } = req.body;
        
        if (!phoneNumber || !phoneNumber.match(/^\+?[1-9]\d{1,14}$/)) {
            return res.status(400).json({ error: 'Invalid phone number format' });
        }

        // Determine calling mode (client mode overrides server config)
        const callingMode = mode || (process.env.BROWSER_CALLING === 'true' ? 'browser' : 'phone');

        if (callingMode === 'browser') {
            // Browser calls are handled client-side, but we can log them
            const mockCallSid = 'CA' + Math.random().toString(36).substr(2, 32);
            await db.insertCall(phoneNumber, mockCallSid);
            console.log(`BROWSER MODE: Client-side call initiated to ${phoneNumber}`);
            return res.json({ success: true, callSid: mockCallSid, mode: 'browser' });
        }

        // Phone mode - traditional Twilio call
        if (!twilioClient) {
            return res.status(500).json({ error: 'Twilio not configured' });
        }

        const call = await twilioClient.calls.create({
            url: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/voice?target=${encodeURIComponent(phoneNumber)}`,
            to: '+19147140068', // Your verified caller ID number
            from: process.env.TWILIO_PHONE_NUMBER,
            record: true,
            recordingStatusCallback: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/recording`,
            recordingStatusCallbackEvent: ['completed'],
            recordingStatusCallbackMethod: 'POST',
            statusCallback: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/status`,
            statusCallbackEvent: ['completed'],
            statusCallbackMethod: 'POST'
        });

        await db.insertCall(phoneNumber, call.sid);
        console.log(`PHONE MODE: Traditional call initiated to ${phoneNumber} with SID ${call.sid}`);
        
        res.json({ success: true, callSid: call.sid });
        
    } catch (error) {
        console.error('Error making call:', error);
        console.error('Error details:', error.message, error.code, error.moreInfo);
        res.status(500).json({ error: error.message || 'Failed to initiate call' });
    }
});

app.post('/api/webhooks/browser-voice', async (req, res) => {
    try {
        const twiml = new twilio.twiml.VoiceResponse();
        const targetNumber = req.body.To; // From browser calling
        const callSid = req.body.CallSid; // Twilio call SID
        const from = req.body.From; // Browser identity
        
        console.log(`🌐 Browser call initiated:`);
        console.log(`  Call SID: ${callSid}`);
        console.log(`  From: ${from}`);
        console.log(`  To: ${targetNumber}`);
        
        if (!targetNumber) {
            twiml.say('Error: No target number specified.');
            twiml.hangup();
        } else {
            // Log browser call to database
            if (db && callSid) {
                try {
                    await db.insertCall(targetNumber, callSid);
                    console.log(`✅ Browser call logged to database: ${callSid}`);
                } catch (dbError) {
                    console.error('Error logging browser call to database:', dbError);
                }
            }
            
            // Start real-time transcription for browser calls
            twiml.start().transcription({
                statusCallbackUrl: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/realtime-transcription`,
                transcriptionEngine: 'deepgram',
                speechModel: 'telephony',
                track: 'both_tracks',
                partialResults: false,
                languageCode: 'en-US'
            });
            
            twiml.say('Connecting your browser call. Please wait.');
            twiml.dial({
                callerId: process.env.TWILIO_PHONE_NUMBER,
                record: 'record-from-answer-dual',
                recordingStatusCallback: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/recording`,
                recordingStatusCallbackEvent: ['completed'],
                timeout: 30
            }, targetNumber);
            
            // Stop real-time transcription when call ends
            twiml.stop().transcription();
        }
        
        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        console.error('Error processing browser voice webhook:', error);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say('An error occurred. Please try again.');
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

app.post('/api/webhooks/voice', (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    const targetNumber = req.query.target;
    
    if (!targetNumber) {
        twiml.say('Error: No target number specified.');
        twiml.hangup();
    } else {
        // Start real-time transcription
        twiml.start().transcription({
            statusCallbackUrl: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/realtime-transcription`,
            transcriptionEngine: 'deepgram',
            speechModel: 'telephony',
            track: 'both_tracks',
            partialResults: false,
            languageCode: 'en-US'
        });
        
        twiml.say('Connecting your call. Please wait.');
        twiml.dial({
            callerId: process.env.TWILIO_PHONE_NUMBER,
            record: 'record-from-answer-dual',
            recordingStatusCallback: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/recording`,
            recordingStatusCallbackEvent: ['completed'],
            timeout: 30
        }, targetNumber);
        
        // Stop real-time transcription when call ends
        twiml.stop().transcription();
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

app.post('/api/webhooks/recording', async (req, res) => {
    try {
        const { CallSid, RecordingUrl, RecordingSid, CallDuration } = req.body;
        
        console.log(`🎙️ Recording webhook received:`);
        console.log(`  Call SID: ${CallSid}`);
        console.log(`  Recording SID: ${RecordingSid}`);
        console.log(`  Recording URL: ${RecordingUrl}`);
        console.log(`  Duration: ${CallDuration} seconds`);
        console.log(`  Full webhook body:`, req.body);
        
        await db.updateRecording(CallSid, RecordingUrl, RecordingSid);
        // Note: Call duration will be updated by the status webhook, not here
        
        console.log(`✅ Database updated for call ${CallSid}`);
        console.log(`🎙️ Recording completed - transcription will be handled via TwiML transcribeCallback`);
        
        // Set initial transcription status for real-time transcription
        await db.updateTranscript(CallSid, null, 'pending');
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Error processing recording webhook:', error);
        res.sendStatus(500);
    }
});

app.post('/api/webhooks/status', async (req, res) => {
    try {
        const { CallSid, CallStatus, CallDuration } = req.body;
        
        console.log(`📞 Call status webhook received:`);
        console.log(`  Call SID: ${CallSid}`);
        console.log(`  Status: ${CallStatus}`);
        console.log(`  Duration: ${CallDuration} seconds`);
        console.log(`  Full status body:`, req.body);
        
        await db.updateCallStatus(CallSid, CallStatus.toLowerCase(), parseInt(CallDuration) || 0);
        
        console.log(`✅ Call status updated: ${CallSid} -> ${CallStatus} (${CallDuration}s)`);
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Error processing status webhook:', error);
        res.sendStatus(500);
    }
});

app.post('/api/webhooks/realtime-transcription', async (req, res) => {
    try {
        const { 
            CallSid, 
            TranscriptionEvent,
            TranscriptionData,
            SequenceNumber
        } = req.body;
        
        console.log(`🎯 Real-time transcription event: ${TranscriptionEvent} for call ${CallSid}`);
        console.log(`  Sequence: ${SequenceNumber}`);
        
        if (!CallSid) {
            console.error('❌ No CallSid in real-time transcription webhook');
            return res.sendStatus(400);
        }
        
        switch (TranscriptionEvent) {
            case 'transcription-started':
                await db.updateTranscript(CallSid, '', 'streaming');
                console.log(`🎬 Real-time transcription started for call ${CallSid}`);
                break;
                
            case 'transcription-content':
                if (TranscriptionData && TranscriptionData.transcript) {
                    const { transcript, final } = TranscriptionData;
                    if (final && transcript.trim()) {
                        // Append final transcript segment
                        await db.appendTranscript(CallSid, transcript.trim());
                        console.log(`📝 Transcript segment added: "${transcript.trim().substring(0, 30)}..."`);
                    }
                }
                break;
                
            case 'transcription-stopped':
                // Check if we have any transcript text before marking as completed
                const call = await db.getCallBySid(CallSid);
                if (call && call.transcript_text && call.transcript_text.trim()) {
                    await db.updateTranscriptStatus(CallSid, 'completed');
                    console.log(`✅ Real-time transcription completed for call ${CallSid}`);
                } else {
                    await db.updateTranscript(CallSid, 'No speech detected in call', 'completed');
                    console.log(`⚠️ Real-time transcription stopped but no content for call ${CallSid}`);
                }
                break;
                
            case 'transcription-error':
                const errorMsg = TranscriptionData?.error || 'Real-time transcription failed';
                await db.updateTranscript(CallSid, errorMsg, 'failed');
                console.log(`❌ Real-time transcription error for call ${CallSid}: ${errorMsg}`);
                break;
                
            default:
                console.log(`⚠️ Unknown transcription event: ${TranscriptionEvent}`);
        }
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Error processing real-time transcription webhook:', error);
        res.sendStatus(500);
    }
});

// Legacy transcription webhook (fallback for old calls)
app.post('/api/webhooks/transcription', async (req, res) => {
    try {
        const { CallSid, TranscriptionText, TranscriptionStatus } = req.body;
        
        console.log(`📋 Legacy transcription webhook: ${TranscriptionStatus} for call ${CallSid}`);
        
        if (CallSid) {
            if (TranscriptionStatus === 'completed' && TranscriptionText) {
                await db.updateTranscript(CallSid, TranscriptionText, 'completed');
                console.log(`✅ Legacy transcription completed for call ${CallSid}`);
            } else if (TranscriptionStatus === 'failed') {
                await db.updateTranscript(CallSid, 'Transcription failed', 'failed');
                console.log(`❌ Legacy transcription failed for call ${CallSid}`);
            }
        }
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Error processing legacy transcription webhook:', error);
        res.sendStatus(500);
    }
});

app.get('/api/token', async (req, res) => {
    try {
        if (!twilioClient) {
            return res.status(500).json({ error: 'Twilio not configured' });
        }

        const AccessToken = twilio.jwt.AccessToken;
        const VoiceGrant = AccessToken.VoiceGrant;

        const accessToken = new AccessToken(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_API_KEY_SID || process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN,
            { identity: `browser-user-${Date.now()}` }
        );

        const voiceGrant = new VoiceGrant({
            outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
            incomingAllow: false
        });

        accessToken.addGrant(voiceGrant);

        const jwt = accessToken.toJwt();
        console.log('🔑 Generated token for identity:', accessToken.identity);
        console.log('📱 TwiML App SID:', process.env.TWILIO_TWIML_APP_SID);
        console.log('🔧 Using API Key SID:', process.env.TWILIO_API_KEY_SID || process.env.TWILIO_ACCOUNT_SID);

        res.json({
            accessToken: jwt,
            identity: accessToken.identity
        });
    } catch (error) {
        console.error('Error generating token:', error);
        res.status(500).json({ error: 'Failed to generate token' });
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

app.get('/api/config', (req, res) => {
    res.json({
        browserCalling: process.env.BROWSER_CALLING === 'true',
        phoneCalling: process.env.PHONE_CALLING === 'true'
    });
});

app.post('/api/manual-transcript', async (req, res) => {
    try {
        const { callSid, transcriptText } = req.body;
        
        if (!callSid || !transcriptText) {
            return res.status(400).json({ error: 'callSid and transcriptText are required' });
        }
        
        await db.updateTranscript(callSid, transcriptText, 'completed');
        console.log(`📝 Manual transcript added for call ${callSid}`);
        
        res.json({ success: true, message: 'Transcript added successfully' });
    } catch (error) {
        console.error('Error adding manual transcript:', error);
        res.status(500).json({ error: 'Failed to add transcript' });
    }
});


app.post('/api/cleanup-transcripts', async (req, res) => {
    try {
        console.log('🧽 Cleaning up stuck transcripts...');
        
        // Get calls with stuck transcript statuses
        const calls = await db.getAllCalls(100);
        const stuckCalls = calls.filter(call => 
            call.transcript_status === 'processing' || 
            call.transcript_status === 'streaming' || 
            call.transcript_status === 'pending'
        );
        
        console.log(`📋 Found ${stuckCalls.length} calls with stuck transcript status`);
        
        if (stuckCalls.length === 0) {
            return res.json({ success: true, message: 'No stuck transcripts found', updated: 0 });
        }
        
        let updatedCount = 0;
        
        for (const call of stuckCalls) {
            // If call is more than 5 minutes old and still stuck, mark as failed
            const callAge = Date.now() - new Date(call.updated_at).getTime();
            if (callAge > 5 * 60 * 1000) { // 5 minutes
                if (call.transcript_text && call.transcript_text.trim()) {
                    // Has text but stuck status - mark as completed
                    await db.updateTranscriptStatus(call.twilio_call_sid, 'completed');
                    console.log(`✅ Marked call ${call.twilio_call_sid} as completed (had text)`);
                } else {
                    // No text and stuck - mark as failed
                    await db.updateTranscript(call.twilio_call_sid, 'Transcription timed out', 'failed');
                    console.log(`❌ Marked call ${call.twilio_call_sid} as failed (no text)`);
                }
                updatedCount++;
            }
        }
        
        console.log(`🎉 Transcript cleanup completed: ${updatedCount} calls updated`);
        
        res.json({ 
            success: true, 
            message: `Transcript cleanup completed: ${updatedCount} calls updated`,
            updated: updatedCount
        });
        
    } catch (error) {
        console.error('Error in transcript cleanup:', error);
        res.status(500).json({ error: `Failed to cleanup transcripts: ${error.message}` });
    }
});

app.post('/api/backfill-durations', async (req, res) => {
    try {
        if (!twilioClient) {
            return res.status(500).json({ error: 'Twilio not configured' });
        }
        
        console.log('🔄 Starting duration backfill for existing calls...');
        
        // Get all calls with duration_seconds = 0
        const calls = await db.getAllCalls(100);
        const callsWithNoDuration = calls.filter(call => call.duration_seconds === 0 && call.twilio_call_sid);
        
        console.log(`📋 Found ${callsWithNoDuration.length} calls missing duration`);
        
        if (callsWithNoDuration.length === 0) {
            return res.json({ success: true, message: 'No calls need duration updates', updated: 0 });
        }
        
        let updatedCount = 0;
        let errors = 0;
        
        for (const call of callsWithNoDuration) {
            try {
                console.log(`🔍 Fetching duration for call ${call.twilio_call_sid}...`);
                
                // Fetch call details from Twilio
                const twilioCall = await twilioClient.calls(call.twilio_call_sid).fetch();
                
                const duration = twilioCall.duration ? parseInt(twilioCall.duration) : 0;
                
                if (duration > 0) {
                    await db.updateCallStatus(call.twilio_call_sid, 'completed', duration);
                    console.log(`✅ Updated call ${call.twilio_call_sid} with duration: ${duration}s`);
                    updatedCount++;
                } else {
                    console.log(`⚠️ Call ${call.twilio_call_sid} has no duration data`);
                }
                
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (callError) {
                console.error(`❌ Error fetching call ${call.twilio_call_sid}:`, callError.message);
                errors++;
            }
        }
        
        console.log(`🎉 Duration backfill completed: ${updatedCount} updated, ${errors} errors`);
        
        res.json({ 
            success: true, 
            message: `Duration backfill completed: ${updatedCount} calls updated, ${errors} errors`,
            updated: updatedCount,
            errors: errors
        });
        
    } catch (error) {
        console.error('Error in duration backfill:', error);
        res.status(500).json({ error: `Failed to backfill durations: ${error.message}` });
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

// Only start server if not in test mode
if (process.env.NODE_ENV !== 'test') {
    initializeServer().then(() => {
        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
            console.log(`Health check: http://localhost:${port}/health`);
        });
    });
} else {
    // For testing, initialize without starting server
    initializeServer();
}

module.exports = app;