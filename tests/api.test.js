const request = require('supertest');
const app = require('../server');

describe('API Endpoints', () => {
  describe('GET /health', () => {
    test('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('database');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/config', () => {
    test('should return configuration', async () => {
      const response = await request(app)
        .get('/api/config')
        .expect(200);

      expect(response.body).toHaveProperty('demoMode');
      expect(response.body).toHaveProperty('browserCalling');
      expect(response.body).toHaveProperty('phoneCalling');
      expect(response.body.demoMode).toBe(true); // Set in test setup
    });
  });

  describe('GET /api/calls', () => {
    test('should return empty call list initially', async () => {
      const response = await request(app)
        .get('/api/calls')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('POST /api/call', () => {
    test('should reject invalid phone number', async () => {
      const response = await request(app)
        .post('/api/call')
        .send({ phoneNumber: 'invalid' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Invalid phone number');
    });

    test('should accept valid phone number in demo mode', async () => {
      const response = await request(app)
        .post('/api/call')
        .send({ phoneNumber: '+1234567890' })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('callSid');
    });

    test('should handle missing phone number', async () => {
      const response = await request(app)
        .post('/api/call')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('POST /api/manual-transcript', () => {
    test('should require callSid and transcriptText', async () => {
      const response = await request(app)
        .post('/api/manual-transcript')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('callSid and transcriptText are required');
    });

    test('should accept valid manual transcript', async () => {
      const response = await request(app)
        .post('/api/manual-transcript')
        .send({
          callSid: 'CA_test_call_sid',
          transcriptText: 'Test transcript text'
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });
  });
});