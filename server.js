require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const Database = require('./database');

const app = express();
const port = process.env.PORT || 3000;

let db;
let twilioClient;
let intelligenceServiceSid;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const initializeIntelligenceService = async () => {
    try {
        if (!twilioClient) return;
        
        console.log('Checking Intelligence Service...');
        
        // Check if service already exists
        const services = await twilioClient.intelligence.v2.services.list({ limit: 1 });
        
        if (services.length > 0) {
            intelligenceServiceSid = services[0].sid;
            console.log(`Using existing Intelligence Service: ${intelligenceServiceSid}`);
        } else {
            // Create new Intelligence Service
            const service = await twilioClient.intelligence.v2.services.create({
                uniqueName: 'phone-dialer-transcription',
                friendlyName: 'Phone Dialer Transcription Service',
                dataLogging: false // For privacy
            });
            
            intelligenceServiceSid = service.sid;
            console.log(`Created Intelligence Service: ${intelligenceServiceSid}`);
        }
    } catch (error) {
        console.error('Failed to initialize Intelligence Service:', error);
        console.log('Transcription will fall back to legacy method');
        intelligenceServiceSid = null;
    }
};

const checkPendingTranscripts = async () => {
    if (!twilioClient || !db) return;
    
    try {
        console.log('🔄 Checking for pending transcripts...');
        
        // Get calls with processing or pending transcript status
        const calls = await db.getAllCalls(50);
        const pendingCalls = calls.filter(call => 
            call.transcript_status === 'processing' || 
            call.transcript_status === 'pending'
        );
        
        if (pendingCalls.length === 0) {
            console.log('✅ No pending transcripts to check');
            return;
        }
        
        console.log(`🔍 Found ${pendingCalls.length} calls with pending transcripts`);
        
        // List all transcripts from Intelligence API
        const transcripts = await twilioClient.intelligence.v2.transcripts.list({ limit: 100 });
        console.log(`📋 Retrieved ${transcripts.length} transcripts from Intelligence API`);
        
        let updatedCount = 0;
        
        for (const call of pendingCalls) {
            if (!call.recording_sid) continue;
            
            // Find matching transcript by recording SID
            const matchingTranscript = transcripts.find(t => 
                t.channel && 
                t.channel.media_properties && 
                t.channel.media_properties.source_sid === call.recording_sid
            );
            
            if (matchingTranscript && matchingTranscript.status === 'completed') {
                try {
                    console.log(`✅ Found completed transcript for call ${call.twilio_call_sid}: ${matchingTranscript.sid}`);
                    
                    // Extract transcript text
                    const sentences = await twilioClient.intelligence.v2.transcripts(matchingTranscript.sid).sentences.list();
                    if (sentences.length > 0) {
                        const transcriptText = sentences.map(s => s.transcript).join(' ');
                        await db.updateTranscript(call.twilio_call_sid, transcriptText, 'completed');
                        console.log(`📝 Updated transcript for call ${call.twilio_call_sid}: ${transcriptText.substring(0, 50)}...`);
                        updatedCount++;
                    } else {
                        console.log(`⚠️ Transcript ${matchingTranscript.sid} completed but has no sentences`);
                        await db.updateTranscript(call.twilio_call_sid, 'Transcript completed but no text available', 'completed');
                        updatedCount++;
                    }
                } catch (extractError) {
                    console.error(`❌ Error extracting text for transcript ${matchingTranscript.sid}:`, extractError);
                }
            }
        }
        
        if (updatedCount > 0) {
            console.log(`🎉 Successfully updated ${updatedCount} transcripts`);
        }
        
    } catch (error) {
        console.error('Error checking pending transcripts:', error);
    }
};

const initializeServer = async () => {
    try {
        db = new Database(process.env.DATABASE_FILE || './calls.db');
        await db.initialize();
        console.log('Database initialized successfully');

        if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
            twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            console.log('Twilio client initialized');
            
            // Initialize Intelligence Service for transcription
            await initializeIntelligenceService();
            
            // Start periodic transcript checking (every 2 minutes)
            setInterval(checkPendingTranscripts, 2 * 60 * 1000);
            console.log('🔄 Started periodic transcript checking (every 2 minutes)');
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
        const callingMode = mode || (process.env.DEMO_MODE === 'true' ? 'demo' : 
                                   process.env.BROWSER_CALLING === 'true' ? 'browser' : 'phone');

        if (callingMode === 'demo') {
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
            recordingStatusCallbackMethod: 'POST'
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

app.post('/api/webhooks/browser-voice', (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    const targetNumber = req.body.To; // From browser calling
    
    if (!targetNumber) {
        twiml.say('Error: No target number specified.');
        twiml.hangup();
    } else {
        twiml.say('Connecting your browser call. Please wait.');
        twiml.dial({
            callerId: process.env.TWILIO_PHONE_NUMBER,
            record: 'record-from-answer-dual',
            recordingStatusCallback: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/recording`,
            recordingStatusCallbackEvent: ['completed'],
            transcribe: true,
            transcribeCallback: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/transcription`,
            timeout: 30
        }, targetNumber);
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

app.post('/api/webhooks/voice', (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    const targetNumber = req.query.target;
    
    if (!targetNumber) {
        twiml.say('Error: No target number specified.');
        twiml.hangup();
    } else {
        twiml.say('Connecting your call. Please wait.');
        twiml.dial({
            callerId: process.env.TWILIO_PHONE_NUMBER,
            record: 'record-from-answer-dual',
            recordingStatusCallback: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/recording`,
            recordingStatusCallbackEvent: ['completed'],
            transcribe: true,
            transcribeCallback: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/transcription`,
            timeout: 30
        }, targetNumber);
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
        
        await db.updateRecording(CallSid, RecordingUrl, RecordingSid);
        await db.updateCallStatus(CallSid, 'completed', parseInt(CallDuration) || 0);
        
        console.log(`✅ Database updated for call ${CallSid}`);
        console.log(`🎙️ Recording completed - transcription will be handled via TwiML transcribeCallback`);
        
        // Set initial transcription status - will be updated by transcription webhook
        if (process.env.DEMO_MODE !== 'true') {
            await db.updateTranscript(CallSid, null, 'processing');
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
        const { 
            CallSid, 
            TranscriptionSid, 
            TranscriptionText, 
            TranscriptionStatus, 
            RecordingSid 
        } = req.body;
        
        console.log(`📋 Legacy transcription webhook received:`);
        console.log(`  Full body:`, req.body);
        console.log(`  Call SID: ${CallSid}`);
        console.log(`  Transcription SID: ${TranscriptionSid}`);
        console.log(`  Transcription Status: ${TranscriptionStatus}`);
        console.log(`  Recording SID: ${RecordingSid}`);
        console.log(`  Has transcript text: ${!!TranscriptionText}`);
        
        if (CallSid) {
            // Direct call SID mapping - much simpler!
            if (TranscriptionStatus === 'completed' && TranscriptionText) {
                await db.updateTranscript(CallSid, TranscriptionText, 'completed');
                console.log(`✅ Transcription completed for call ${CallSid}: ${TranscriptionText.substring(0, 50)}...`);
            } else if (TranscriptionStatus === 'failed') {
                await db.updateTranscript(CallSid, 'Transcription failed', 'failed');
                console.log(`❌ Transcription failed for call ${CallSid}`);
            } else {
                console.log(`📝 Transcription status: ${TranscriptionStatus} for call ${CallSid}`);
            }
        } else if (RecordingSid) {
            // Fallback: find call by recording SID
            console.log('No direct CallSid, searching by RecordingSid...');
            const calls = await db.getAllCalls(100);
            const matchingCall = calls.find(call => call.recording_sid === RecordingSid);
            
            if (matchingCall) {
                if (TranscriptionStatus === 'completed' && TranscriptionText) {
                    await db.updateTranscript(matchingCall.twilio_call_sid, TranscriptionText, 'completed');
                    console.log(`✅ Transcription completed for call ${matchingCall.twilio_call_sid}`);
                } else if (TranscriptionStatus === 'failed') {
                    await db.updateTranscript(matchingCall.twilio_call_sid, 'Transcription failed', 'failed');
                    console.log(`❌ Transcription failed for call ${matchingCall.twilio_call_sid}`);
                }
            } else {
                console.log(`⚠️ No matching call found for recording ${RecordingSid}`);
            }
        }
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Error processing transcription webhook:', error);
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
        demoMode: process.env.DEMO_MODE === 'true',
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

app.post('/api/check-transcripts', async (req, res) => {
    try {
        await checkPendingTranscripts();
        res.json({ success: true, message: 'Transcript check completed' });
    } catch (error) {
        console.error('Error in manual transcript check:', error);
        res.status(500).json({ error: `Failed to check transcripts: ${error.message}` });
    }
});

app.post('/api/find-transcript', async (req, res) => {
    try {
        const { recordingSid, callSid } = req.body;
        
        if (!recordingSid || !callSid) {
            return res.status(400).json({ error: 'recordingSid and callSid are required' });
        }
        
        if (!twilioClient) {
            return res.status(500).json({ error: 'Twilio not configured' });
        }
        
        console.log(`🔍 Searching for transcripts with recording SID: ${recordingSid}`);
        
        // List all transcripts and find the one matching our recording SID
        const transcripts = await twilioClient.intelligence.v2.transcripts.list({ limit: 50 });
        
        console.log(`📋 Found ${transcripts.length} transcripts, searching for match...`);
        
        const matchingTranscript = transcripts.find(t => 
            t.channel && 
            t.channel.media_properties && 
            t.channel.media_properties.source_sid === recordingSid
        );
        
        if (matchingTranscript) {
            console.log(`✅ Found matching transcript: ${matchingTranscript.sid} (status: ${matchingTranscript.status})`);
            
            if (matchingTranscript.status === 'completed') {
                // Fetch the transcript text using our existing logic
                try {
                    const sentences = await twilioClient.intelligence.v2.transcripts(matchingTranscript.sid).sentences.list();
                    if (sentences.length > 0) {
                        const transcriptText = sentences.map(s => s.transcript).join(' ');
                        await db.updateTranscript(callSid, transcriptText, 'completed');
                        console.log(`✅ Transcript text extracted and saved: ${transcriptText.substring(0, 100)}...`);
                        res.json({ success: true, transcriptSid: matchingTranscript.sid, transcriptText });
                    } else {
                        res.json({ success: false, message: 'Transcript completed but no sentences found', transcriptSid: matchingTranscript.sid });
                    }
                } catch (textError) {
                    console.error('Error extracting transcript text:', textError);
                    res.json({ success: false, message: 'Transcript found but text extraction failed', transcriptSid: matchingTranscript.sid });
                }
            } else {
                res.json({ success: false, message: `Transcript found but status is: ${matchingTranscript.status}`, transcriptSid: matchingTranscript.sid });
            }
        } else {
            console.log(`❌ No transcript found for recording SID: ${recordingSid}`);
            res.json({ success: false, message: 'No transcript found for this recording' });
        }
        
    } catch (error) {
        console.error('Error searching for transcript:', error);
        res.status(500).json({ error: `Failed to search for transcript: ${error.message}` });
    }
});

app.post('/api/fetch-transcript', async (req, res) => {
    try {
        const { transcriptSid, callSid } = req.body;
        
        if (!transcriptSid || !callSid) {
            return res.status(400).json({ error: 'transcriptSid and callSid are required' });
        }
        
        if (!twilioClient) {
            return res.status(500).json({ error: 'Twilio not configured' });
        }
        
        console.log(`🔍 Fetching transcript ${transcriptSid} for call ${callSid}`);
        
        const transcript = await twilioClient.intelligence.v2.transcripts(transcriptSid).fetch();
        
        console.log(`📋 Transcript status: ${transcript.status}`);
        console.log(`📋 Full transcript object:`, JSON.stringify(transcript, null, 2));
        
        // Also try to fetch sentences/results separately
        try {
            const sentences = await twilioClient.intelligence.v2.transcripts(transcriptSid).sentences.list();
            console.log(`📋 Sentences found: ${sentences.length}`);
            if (sentences.length > 0) {
                console.log(`📋 First sentence:`, sentences[0]);
            }
        } catch (sentenceError) {
            console.log(`📋 Could not fetch sentences:`, sentenceError.message);
        }
        
        if (transcript.status === 'completed') {
            // Try different possible locations for transcript text
            let transcriptText = null;
            
            // Try to get text from sentences if available
            try {
                const sentences = await twilioClient.intelligence.v2.transcripts(transcriptSid).sentences.list();
                if (sentences.length > 0) {
                    transcriptText = sentences.map(s => s.transcript).join(' ');
                    console.log(`📋 Extracted text from ${sentences.length} sentences`);
                }
            } catch (sentenceError) {
                console.log(`📋 Could not extract from sentences: ${sentenceError.message}`);
            }
            
            // Fallback to transcript object properties
            if (!transcriptText) {
                if (transcript.results && transcript.results.transcript) {
                    transcriptText = transcript.results.transcript;
                } else if (transcript.results && transcript.results.transcripts) {
                    transcriptText = transcript.results.transcripts[0]?.transcript;
                } else if (transcript.transcript) {
                    transcriptText = transcript.transcript;
                } else if (transcript.text) {
                    transcriptText = transcript.text;
                } else {
                    transcriptText = 'Transcription completed but text format not recognized. Check server logs for structure.';
                }
            }
            
            await db.updateTranscript(callSid, transcriptText, 'completed');
            console.log(`✅ Transcript fetched and saved: ${transcriptText.substring(0, 100)}...`);
            res.json({ success: true, message: 'Transcript fetched and saved', transcriptText });
        } else {
            console.log(`⏳ Transcript not ready yet, status: ${transcript.status}`);
            res.json({ success: false, message: `Transcript status: ${transcript.status}` });
        }
        
    } catch (error) {
        console.error('Error fetching transcript:', error);
        res.status(500).json({ error: `Failed to fetch transcript: ${error.message}` });
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