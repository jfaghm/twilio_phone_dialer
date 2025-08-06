// Test setup and global mocks
process.env.NODE_ENV = 'test';
process.env.DATABASE_FILE = ':memory:'; // Use in-memory database for tests
process.env.DEMO_MODE = 'true';

// Set test timeout
jest.setTimeout(10000);

// Mock Twilio to avoid real API calls during testing
jest.mock('twilio', () => {
  return jest.fn(() => ({
    calls: {
      create: jest.fn().mockResolvedValue({
        sid: 'CA_test_call_sid_12345',
        status: 'initiated'
      })
    },
    applications: {
      create: jest.fn().mockResolvedValue({
        sid: 'AP_test_app_sid_12345'
      })
    },
    intelligence: {
      v2: {
        services: {
          list: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({
            sid: 'GA_test_service_sid_12345'
          })
        },
        transcripts: jest.fn(() => ({
          fetch: jest.fn().mockResolvedValue({
            sid: 'GT_test_transcript_sid_12345',
            status: 'completed'
          }),
          sentences: {
            list: jest.fn().mockResolvedValue([
              { transcript: 'Hello world test transcript' }
            ])
          }
        }))
      }
    }
  }));
});