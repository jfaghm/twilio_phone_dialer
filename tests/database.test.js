const Database = require('../database');

describe('Database Operations', () => {
  let db;

  beforeEach(async () => {
    // Use in-memory database for each test
    db = new Database(':memory:');
    await db.initialize();
    // Add a small delay to ensure tables are created
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    if (db) {
      try {
        await db.close();
      } catch (error) {
        // Ignore close errors in tests
      }
    }
  });

  describe('Call Operations', () => {
    test('should insert and retrieve calls', async () => {
      const phoneNumber = '+1234567890';
      const callSid = 'CA_test_call_sid';

      await db.insertCall(phoneNumber, callSid);
      
      const calls = await db.getAllCalls(10);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        phone_number: phoneNumber,
        twilio_call_sid: callSid,
        call_status: 'initiated'
      });
    });

    test('should update call status', async () => {
      const callSid = 'CA_test_call_sid';
      await db.insertCall('+1234567890', callSid);
      
      await db.updateCallStatus(callSid, 'completed', 120);
      
      const calls = await db.getAllCalls(10);
      expect(calls[0]).toMatchObject({
        call_status: 'completed',
        duration_seconds: 120
      });
    });

    test('should update recording information', async () => {
      const callSid = 'CA_test_call_sid';
      const recordingUrl = 'https://example.com/recording.wav';
      const recordingSid = 'RE_test_recording_sid';
      
      await db.insertCall('+1234567890', callSid);
      await db.updateRecording(callSid, recordingUrl, recordingSid);
      
      const calls = await db.getAllCalls(10);
      expect(calls[0]).toMatchObject({
        recording_url: recordingUrl,
        recording_sid: recordingSid
      });
    });

    test('should update transcript information', async () => {
      const callSid = 'CA_test_call_sid';
      const transcriptText = 'Hello world test transcript';
      
      await db.insertCall('+1234567890', callSid);
      await db.updateTranscript(callSid, transcriptText, 'completed');
      
      const calls = await db.getAllCalls(10);
      expect(calls[0]).toMatchObject({
        transcript_text: transcriptText,
        transcript_status: 'completed'
      });
    });
  });

  describe('Database Initialization', () => {
    test('should create tables on initialization', async () => {
      // This test verifies that initialization doesn't throw errors
      const testDb = new Database(':memory:');
      await expect(testDb.initialize()).resolves.not.toThrow();
      await testDb.close();
    });
  });
});