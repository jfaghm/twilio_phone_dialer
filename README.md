# Twilio Phone Dialer

A full-stack web application for making phone calls with automatic recording and real-time transcription using Twilio's Voice API.

## 🎯 Key Features

- **Dual Calling Modes**: Phone calls (traditional) and Browser calls (WebRTC)
- **Automatic Recording**: All calls are recorded with Twilio's recording service
- **Real-time Transcription**: Live transcription during calls using Deepgram engine
- **Call History**: Web interface with searchable call logs and transcript viewing
- **Webhook Integration**: Real-time updates via Twilio webhooks
- **Testing Suite**: Comprehensive test coverage with Jest

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ 
- Twilio account with phone number
- ngrok (for local webhook testing)

### Installation

```bash
# Clone and install dependencies
git clone <repository>
cd twilio_phone_dialer
npm install

# Copy environment template
cp .env.example .env

# Configure your .env file (see Configuration section)
# Start the application
npm start

# For development with auto-reload
npm run dev
```

### First Run
1. Start ngrok: `ngrok http 3000`
2. Update `WEBHOOK_BASE_URL` in .env with your ngrok URL
3. Visit `http://localhost:3000`
4. Test with a phone call

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │    │    Backend       │    │   Database      │
│  (index.html)   │◄──►│   (server.js)    │◄──►│   (SQLite)      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       
         │                       ▼                       
         │              ┌──────────────────┐              
         └─────────────►│   Twilio APIs    │              
                        │  - Voice/Calls   │              
                        │  - Recording     │              
                        │  - Transcription │              
                        └──────────────────┘              
```

### File Structure
```
├── server.js           # Main Express application & API endpoints
├── database.js         # SQLite database operations & schema
├── public/
│   └── index.html      # Frontend interface with calling modes
├── tests/              # Jest test suites
│   ├── api.test.js     # API endpoint tests  
│   └── database.test.js # Database operation tests
├── .env                # Environment configuration
└── calls.db           # SQLite database file (created on first run)
```

## 📡 API Reference

### Core Endpoints

| Endpoint | Method | Description | Request Body |
|----------|--------|-------------|--------------|
| `/api/call` | POST | Initiate phone call | `{ phoneNumber, mode? }` |
| `/api/calls` | GET | Get call history | - |
| `/api/token` | GET | Browser calling JWT | - |
| `/api/config` | GET | Client configuration | - |
| `/health` | GET | System health check | - |

### Webhook Endpoints (Twilio)

| Endpoint | Purpose | Triggers |
|----------|---------|----------|
| `/api/webhooks/voice` | Call routing TwiML | Outbound call start |
| `/api/webhooks/browser-voice` | Browser call TwiML | WebRTC call start |
| `/api/webhooks/recording` | Recording completion | Call recording done |
| `/api/webhooks/realtime-transcription` | Live transcription | Transcription events |
| `/api/webhooks/status` | Call status updates | Call state changes |

### Example API Usage

```javascript
// Make a phone call
fetch('/api/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
        phoneNumber: '+1234567890',
        mode: 'phone' // or 'browser'
    })
});

// Get call history
const calls = await fetch('/api/calls').then(r => r.json());
```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file with these required variables:

```bash
# Twilio Configuration (Required)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890

# Browser Calling (Optional - for WebRTC)
TWILIO_API_KEY_SID=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY_SECRET=your_api_key_secret_here
TWILIO_TWIML_APP_SID=APxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Server Configuration
PORT=3000
DATABASE_FILE=./calls.db
WEBHOOK_BASE_URL=https://your-ngrok-url.ngrok.io

# Feature Flags
BROWSER_CALLING=true
PHONE_CALLING=true
```

### Twilio Setup

1. **Create Twilio Account** and get Account SID/Auth Token
2. **Purchase Phone Number** for outbound calls
3. **Create TwiML App** (for browser calling):
   - Voice Request URL: `https://your-domain.com/api/webhooks/browser-voice`
4. **Create API Keys** (for browser calling JWT tokens)

### Local Development Setup

```bash
# Install ngrok for webhook tunneling
npm install -g ngrok

# Start ngrok in separate terminal
ngrok http 3000

# Update .env with ngrok URL
WEBHOOK_BASE_URL=https://abc123.ngrok.io

# Start development server
npm run dev
```

## 🧪 Testing

### Run Tests
```bash
# Run all tests
npm test

# Run with coverage report
npm run test:coverage

# Run specific test file
npm test database.test.js
```

### Test Coverage
- **Database Layer**: 55% coverage with CRUD operations
- **API Endpoints**: 23% coverage with integration tests
- **Mock Integration**: Twilio API calls are mocked for reliable testing

### Writing Tests
Tests use Jest with in-memory SQLite databases for isolation:

```javascript
describe('Database Operations', () => {
    let db;
    
    beforeEach(async () => {
        db = new Database(':memory:');
        await db.initialize();
    });
    
    test('should insert and retrieve calls', async () => {
        // Test implementation
    });
});
```

## 🔧 Development Guide

### Database Schema

```sql
CREATE TABLE calls (
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
```

### Adding New Features

1. **API Endpoints**: Add to `server.js` following existing patterns
2. **Database Operations**: Add methods to `database.js` 
3. **Frontend Updates**: Modify `public/index.html` JavaScript
4. **Tests**: Add corresponding test cases

### Webhook Flow

```
Twilio Call → /api/webhooks/voice → TwiML Response → Call Connected →
Recording Starts → /api/webhooks/recording → Database Update →
Real-time Transcription → /api/webhooks/realtime-transcription →
Transcript Updates → Call Ends → /api/webhooks/status → Final Update
```

## 🚢 Deployment

### Production Checklist

- [ ] Configure production database (PostgreSQL recommended)
- [ ] Set up HTTPS for webhook security  
- [ ] Configure proper logging and monitoring
- [ ] Set up database backups
- [ ] Configure rate limiting
- [ ] Review security headers and CORS
- [ ] Set up error tracking (e.g., Sentry)

### Environment Considerations

**Development**: SQLite, ngrok, detailed logging  
**Staging**: PostgreSQL, HTTPS, production-like config  
**Production**: PostgreSQL, monitoring, backup strategy, security hardening

### Common Issues

**Webhooks not working**: Check ngrok URL and Twilio webhook configuration  
**Browser calling fails**: Verify TwiML App SID and API keys  
**Transcription stuck**: Check webhook URLs and Deepgram configuration  
**Database errors**: Ensure proper file permissions for SQLite

## 📊 System Status

The application includes a health check endpoint at `/health` that reports:

```json
{
    "database": "ok",
    "twilio": "ok", 
    "uptime": 3600,
    "timestamp": "2025-01-XX..."
}
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Write tests for new functionality
4. Ensure all tests pass: `npm test`
5. Submit a pull request

## 📝 License

This project is intended for educational and development purposes. Ensure compliance with Twilio's terms of service and applicable telecommunications regulations.

---

**Need Help?** Check the health endpoint, review logs, or examine the test files for usage examples.