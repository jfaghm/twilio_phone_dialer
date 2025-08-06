# Twilio Phone Dialer

A comprehensive phone dialer system with call recording and transcription using Twilio APIs.

## Features

- **Multiple Calling Modes**:
  - Demo Mode: Simulated calls for testing
  - Phone Mode: Traditional phone calls (your phone rings first)
  - Browser Mode: WebRTC calls directly in browser

- **Call Recording**: Automatic recording of all calls
- **Transcription**: Automatic speech-to-text using Twilio Recording API
- **Call History**: Web interface showing all calls with recordings and transcripts
- **Real-time Updates**: Live call status updates via Server-Sent Events

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables in `.env`:
   ```
   TWILIO_ACCOUNT_SID=your_account_sid
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_PHONE_NUMBER=your_twilio_number
   TWILIO_TWIML_APP_SID=your_twiml_app_sid
   WEBHOOK_BASE_URL=your_ngrok_or_public_url
   ```

3. Start the server:
   ```bash
   npm start
   ```

## API Endpoints

- `POST /api/call` - Initiate a call
- `GET /api/calls` - Get call history
- `GET /api/token` - Get access token for browser calling
- `POST /api/manual-transcript` - Add manual transcript
- `POST /api/find-transcript` - Find transcript by recording SID
- `POST /api/check-transcripts` - Manually trigger transcript checking

## Architecture

- **Backend**: Node.js with Express
- **Database**: SQLite for call data storage
- **Frontend**: Vanilla HTML/JS with Twilio Client SDK
- **Webhooks**: ngrok for local development tunneling

## Testing Plan (TODO)

### Test Framework Setup
- [ ] Install Jest testing framework
- [ ] Configure test environment with separate test database
- [ ] Set up mocking for Twilio API calls

### API Endpoint Tests
- [ ] `POST /api/call` - Test call initiation in all modes (demo, phone, browser)
- [ ] `GET /api/calls` - Test call history retrieval and pagination
- [ ] `GET /api/token` - Test browser calling token generation
- [ ] `GET /api/config` - Test configuration endpoint
- [ ] `POST /api/manual-transcript` - Test manual transcript addition
- [ ] `POST /api/find-transcript` - Test transcript search functionality
- [ ] `POST /api/check-transcripts` - Test automated transcript checking
- [ ] `GET /health` - Test health check endpoint

### Database Operation Tests
- [ ] Call insertion with proper data validation
- [ ] Call status updates (initiated → completed)
- [ ] Recording data storage and retrieval
- [ ] Transcript operations (insert, update, status changes)
- [ ] Database initialization and migration
- [ ] Error handling for database operations

### Webhook Handler Tests
- [ ] Recording webhook processing (`/api/webhooks/recording`)
- [ ] Transcription webhook handling (`/api/webhooks/transcription`)
- [ ] Call status webhook (`/api/webhooks/status`)
- [ ] Browser voice webhook (`/api/webhooks/browser-voice`)
- [ ] TwiML generation for different scenarios
- [ ] Error handling in webhook endpoints

### Integration Tests
- [ ] End-to-end call flow (demo mode)
- [ ] Database persistence across operations
- [ ] Webhook callback processing
- [ ] Token generation and browser calling flow
- [ ] Transcript processing pipeline
- [ ] Error scenarios and recovery

### Performance Tests
- [ ] Database query performance with large datasets
- [ ] Concurrent call handling
- [ ] Memory usage during transcript processing
- [ ] API response times under load

### Security Tests
- [ ] Environment variable handling
- [ ] Input validation and sanitization
- [ ] Webhook signature verification
- [ ] Token expiration and refresh

### Test Data Fixtures
- [ ] Sample call data for different scenarios
- [ ] Mock Twilio API responses
- [ ] Test audio files for transcription testing
- [ ] Database seed data for comprehensive testing

### Test Commands (Future)
```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:integration  # Integration tests
npm run test:watch    # Watch mode for development
npm run test:coverage # Generate coverage report
```

## Development

- Use `npm run dev` for development with nodemon auto-reload
- Check logs in `server.log` for debugging
- Use browser dev tools to debug frontend issues
- Test webhooks locally using ngrok tunnel

## Deployment

- Set up production environment variables
- Configure proper webhook URLs for production
- Set up SSL certificates for HTTPS webhooks
- Configure database backup strategy