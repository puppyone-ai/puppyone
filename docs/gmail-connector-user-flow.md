# Gmail Connector User Flow Documentation

This document describes the complete user flow for creating a Gmail connector in the PuppyOne (ContextBase) application.

## Overview

The Gmail connector allows users to authenticate with their Gmail account using OAuth 2.0, enabling the application to access Gmail data (emails, contacts) for integration into their projects.

## Prerequisites

- User must be logged into the PuppyOne application
- Application must have valid Gmail OAuth credentials configured in the backend
- User must have a valid Gmail account

## User Flow Steps

### 1. Login to the Application

**URL:** `http://localhost:3000/login`

**UI Elements:**
- PuppyBase logo at the top
- "Sign in to PuppyBase" title
- OAuth buttons:
  - "Continue with Google" (with Google icon)
  - "Continue with GitHub" (with GitHub icon)
- "or" divider
- Email/password form:
  - Email input field: `you@example.com`
  - Password input field: `••••••••`
  - "Sign In" button
- Mode switches:
  - "Don't have an account? Sign up"
  - "Forgot password?" link
- Terms text: "By continuing you agree to our Terms and Privacy Policy"

**Actions:**
1. User can sign in via Google OAuth (recommended for quick demo)
2. User can sign in via GitHub OAuth
3. User can sign in with email/password credentials
4. After successful login, user is redirected to `/home`

---

### 2. Navigate to Settings > Connect

**Navigation Path:**
- From home page, click on user menu or sidebar
- Click on "Settings" 
- Navigate to "Integrations" or "Connect" section

**Direct URL:** `http://localhost:3000/settings/connect`

**UI Elements:**
- Header bar:
  - Back button (← arrow)
  - Title: "Integrations"
- Content area with list of integration cards

---

### 3. Integration Cards List

The connect page displays a list of available SaaS platform integrations:

#### Available Platforms:

1. **GitHub**
   - Icon: GitHub logo
   - Name: "GitHub"
   - Description: "Issues, projects, repos"
   - Status indicator: Green/red lamp + status text
   - Toggle switch (on/off)

2. **Google Sheets**
   - Icon: Google Sheets logo
   - Name: "Google Sheets"
   - Description: "Spreadsheets, worksheets"
   - Status indicator: Green/red lamp + status text
   - Toggle switch (on/off)

3. **Google Docs**
   - Icon: Google Docs logo
   - Name: "Google Docs"
   - Description: "Documents, notes"
   - Status indicator: Green/red lamp + status text
   - Toggle switch (on/off)

4. **Gmail** ← Target connector
   - Icon: Gmail logo (`/icons/gmail.svg`)
   - Name: "Gmail"
   - Description: "Emails, contacts"
   - Status indicator: 
     - Disconnected: Gray lamp + "Not connected"
     - Connected: Green lamp with glow + "Connected to user@gmail.com"
   - Toggle switch (on/off)

5. **Google Calendar**
   - Icon: Google Calendar logo
   - Name: "Google Calendar"
   - Description: "Events, schedules"
   - Status indicator: Green/red lamp + status text
   - Toggle switch (on/off)

**Card Styling:**
- Background: `#1a1a1a`
- Border: `1px solid #2a2a2a`
- Border radius: `8px`
- Padding: `12px 16px`
- Each card has: Icon (20x20) | Name & Description | Status (lamp + text) | Toggle (48x26)

---

### 4. Initiate Gmail Connection

**User Action:** Click the toggle switch next to Gmail (from OFF to ON)

**Frontend Flow:**
1. `handlePlatformToggle('gmail', true)` is called
2. Updates Gmail state to loading:
   - Status text changes to "Connecting to Gmail…"
   - Toggle becomes disabled (opacity 0.4)
3. Calls `startOAuthConnect('gmail')`
4. Calls `openOAuthPopup('gmail')`

**Technical Details:**
```typescript
// From ConnectContentView.tsx
const startOAuthConnect = async (platformId: 'gmail') => {
  const saasType = 'gmail'; // platformToSaasType mapping
  
  updatePlatformState('gmail', {
    isLoading: true,
    label: 'Connecting to Gmail…',
  });
  
  const completed = await openOAuthPopup('gmail');
  // ... handle completion
}
```

---

### 5. OAuth Popup Window Opens

**Popup Window Specifications:**
- Width: 600px
- Height: 700px
- Position: Centered on parent window
- Features: `width=600,height=700,left={calculated},top={calculated}`

**OAuth Flow:**
1. Frontend calls backend: `GET /api/v1/oauth/gmail/authorize`
2. Backend returns Gmail OAuth authorization URL
3. Frontend opens popup with authorization URL
4. Popup navigates to Google OAuth consent screen

**Google OAuth Consent Screen (External):**
- Google account selection (if multiple accounts)
- Permission request screen showing:
  - Application name: "PuppyBase" or configured app name
  - Permissions requested (e.g., "Read, compose, send, and permanently delete all your email from Gmail")
  - "Allow" and "Cancel" buttons
- User reviews and clicks "Allow"

---

### 6. OAuth Callback

**Flow After User Clicks "Allow":**

1. Google redirects to callback URL: `http://localhost:3000/oauth/gmail/callback?code={auth_code}`
2. Callback page loads: `frontend/app/oauth/gmail/callback/page.tsx`
3. Callback page UI displays:
   - Dark background: `#0a0a0a`
   - Centered content card
   - **Loading State:**
     - Text: "Connecting to Gmail..."
     - Subtext: "Please wait while we complete the authorization"

**Technical Flow:**
```typescript
// From gmail/callback/page.tsx
useEffect(() => {
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  
  if (code) {
    const result = await gmailCallback(code);
    // Sends POST /api/v1/oauth/gmail/callback with code
    
    if (result.success) {
      setStatus('success');
      setMessage('Successfully connected to Gmail!');
      setTimeout(() => window.close(), 2000);
    }
  }
}, [searchParams]);
```

---

### 7. Callback Success Screen

**UI Display (Success State):**
- Background: `#0a0a0a`
- Centered card with:
  - Green checkmark: "✓" (font-size: 40px, color: `#22c55e`)
  - Title: "Success!" (color: `#22c55e`)
  - Message: "Successfully connected to Gmail!" or custom message from backend
  - Footer: "This window will close automatically..." (font-size: 12px, color: `#666`)

**Auto-close:**
- Window automatically closes after 2 seconds
- Parent window receives message (if using window.postMessage)

**Error State (if OAuth fails):**
- Red X: "✗" (font-size: 40px, color: `#ef4444`)
- Title: "Connection Failed" (color: `#ef4444`)
- Error message: Details from backend or generic error
- Footer: "This window will close automatically..."
- Window closes after 3 seconds

---

### 8. Main Window Status Update

**After Popup Closes:**

1. Parent window's `openOAuthPopup()` promise resolves
2. Frontend calls `checkGmailStatus()` to refresh connection status
3. Sends GET request: `/api/v1/oauth/gmail/status`
4. Backend responds with:
   ```json
   {
     "connected": true,
     "email": "user@gmail.com"
   }
   ```

**UI Updates in Connect Page:**
- Gmail card status changes:
  - Lamp color: Gray → Green with glow
  - Status text: "Not connected" → "Connected to user@gmail.com"
  - Toggle: OFF → ON (background: `#22c55e`)
  - Loading state removed

---

### 9. Connected State

**Gmail Card (Connected):**
- Icon: Gmail logo (colored)
- Name: "Gmail"
- Description: "Emails, contacts"
- Status lamp: Green circle with glow (`#22c55e` with `box-shadow: 0 0 8px rgba(34, 197, 94, 0.6)`)
- Status text: "Connected to user@gmail.com" (green color)
- Toggle: ON position (green background)

**User Can Now:**
- Use Gmail data in projects
- Import Gmail emails/contacts
- Toggle off to disconnect

---

### 10. Disconnect Flow (Optional)

**User Action:** Click toggle switch to turn OFF

**Confirmation Dialog:**
- Modal overlay: Dark background (`rgba(0, 0, 0, 0.65)`)
- Dialog box:
  - Title: "Disconnect Gmail?"
  - Message: "You will lose access to private Gmail content until you reconnect."
  - Buttons:
    - "Cancel" (gray, left)
    - "Disconnect" (red, right)

**If User Confirms:**
1. Calls `disconnectGmail()` API
2. Backend deletes stored OAuth tokens
3. Returns success response
4. Frontend updates state:
   - Status: "Not connected"
   - Lamp: Gray
   - Toggle: OFF

---

## Technical Architecture

### Frontend Components

1. **Login Page** (`frontend/app/login/page.tsx`)
   - Handles authentication
   - Redirects to `/home` after login

2. **Connect Page** (`frontend/app/(main)/settings/connect/page.tsx`)
   - Renders `ConnectContentView` component
   - Handles navigation

3. **ConnectContentView** (`frontend/components/ConnectContentView.tsx`)
   - Main integration management UI
   - Lists all available platforms
   - Manages OAuth flow initiation
   - Handles status polling

4. **Gmail Callback Page** (`frontend/app/oauth/gmail/callback/page.tsx`)
   - OAuth callback handler
   - Displays loading/success/error states
   - Auto-closes popup window

5. **OAuth API Client** (`frontend/lib/oauthApi.ts`)
   - `getGmailAuthUrl()` - Gets authorization URL from backend
   - `gmailCallback(code)` - Exchanges code for tokens
   - `getGmailStatus()` - Checks connection status
   - `disconnectGmail()` - Disconnects account
   - `openOAuthPopup(saasType)` - Opens and manages OAuth popup

### Backend Endpoints

1. **GET `/api/v1/oauth/gmail/authorize`**
   - Generates Gmail OAuth authorization URL
   - Includes state parameter for CSRF protection
   - Returns: `{ "authorization_url": "https://accounts.google.com/o/oauth2/v2/auth?..." }`

2. **POST `/api/v1/oauth/gmail/callback`**
   - Receives authorization code
   - Exchanges code for access/refresh tokens
   - Stores tokens in database (linked to user)
   - Returns: `{ "success": true, "message": "Successfully connected to Gmail!" }`

3. **GET `/api/v1/oauth/gmail/status`**
   - Checks if user has active Gmail connection
   - Returns email address if connected
   - Returns: `{ "connected": true, "email": "user@gmail.com" }`

4. **POST `/api/v1/oauth/gmail/disconnect`**
   - Revokes OAuth tokens
   - Deletes stored credentials
   - Returns: `{ "success": true, "message": "Disconnected from Gmail" }`

### Backend Implementation

**Service:** `backend/src/oauth/gmail_service.py`
- Handles Gmail OAuth flow
- Manages token storage and refresh
- Provides Gmail API integration

**Database Tables:**
- `oauth_connections` - Stores OAuth credentials per user
  - Fields: `user_id`, `provider` (gmail), `access_token`, `refresh_token`, `email`, `connected_at`

---

## Security Considerations

1. **CSRF Protection:**
   - State parameter included in OAuth URL
   - Validated on callback

2. **Token Storage:**
   - Tokens stored encrypted in database
   - Only accessible by authenticated user

3. **Popup Window:**
   - Isolated OAuth flow in popup
   - Prevents main window navigation
   - Auto-closes after completion

4. **Authorization Scopes:**
   - Minimal necessary permissions requested
   - User can see exact permissions in Google consent screen

---

## Error Handling

### Common Errors:

1. **User Cancels Authorization:**
   - URL parameter: `error=access_denied`
   - UI shows: "Authorization cancelled"
   - Auto-closes popup after 3 seconds

2. **Backend OAuth Config Missing:**
   - Error: "Gmail OAuth is not properly configured"
   - Status: Authorization error (red)

3. **Invalid Authorization Code:**
   - Error: "Failed to handle Gmail callback"
   - Shows error in callback popup

4. **Token Expired:**
   - Status check shows disconnected
   - User must reconnect
   - Backend attempts token refresh first

5. **Network Errors:**
   - Caught by try-catch blocks
   - Shows generic error message
   - User can retry

---

## Testing the Flow

### Manual Testing Steps:

1. Start backend server: `cd backend && uv run uvicorn src.main:app --port 9090`
2. Start frontend server: `cd frontend && npm run dev`
3. Navigate to: `http://localhost:3000/login`
4. Log in with test credentials or OAuth
5. Navigate to: `http://localhost:3000/settings/connect`
6. Locate Gmail card in integration list
7. Click toggle to connect
8. Popup opens → Click "Allow" in Google consent screen
9. Popup shows success → Auto-closes
10. Main window updates to "Connected to {email}"
11. Test disconnect by toggling off → Confirm in dialog

### Required Environment Variables:

**Backend** (`.env` or environment):
```
GOOGLE_OAUTH_CLIENT_ID=your_client_id
GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/oauth/gmail/callback
```

**Frontend** (`.env.local`):
```
NEXT_PUBLIC_API_URL=http://localhost:9090
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_key
```

---

## UI/UX Design Notes

### Color Palette:
- Background: `#0a0a0a` (very dark)
- Card background: `#1a1a1a`
- Borders: `#2a2a2a`
- Text primary: `#CDCDCD`
- Text secondary: `#8B8B8B`
- Success green: `#22c55e`
- Error red: `#ef4444`
- Disabled gray: `#595959`

### Typography:
- Main text: 16px, 500 weight
- Descriptions: 12px, normal weight
- Headers: 16px, 500 weight
- Status text: 12px, 500 weight

### Animations:
- Toggle switch: 0.2s ease transition
- Status lamp glow: Subtle shadow animation on connected state
- Hover effects: 0.15s ease on buttons

### Accessibility:
- Toggle has `aria-pressed` attribute
- Toggle has `aria-label` for platform name
- Keyboard navigation supported
- Focus states on interactive elements

---

## Future Enhancements

1. **Scope Selection:**
   - Allow users to choose specific Gmail permissions
   - Granular control over read/write access

2. **Multiple Accounts:**
   - Support connecting multiple Gmail accounts
   - Account switcher in UI

3. **Sync Status:**
   - Show last sync time
   - Display sync progress for emails

4. **Usage Statistics:**
   - Show number of emails imported
   - Display API usage/quota

5. **Advanced Settings:**
   - Configure sync frequency
   - Filter rules for email import
   - Label/folder selection

---

## Troubleshooting

### Issue: Popup Blocked
**Solution:** User must allow popups for the site

### Issue: "Authorization error" status
**Solution:** Click the card to see re-authorization prompt

### Issue: Connection shows as disconnected after successful OAuth
**Solution:** Check backend logs for token exchange errors

### Issue: Popup doesn't close automatically
**Solution:** Check if callback page is loading correctly, verify redirect URI

---

## Related Documentation

- [OAuth Integration Guide](./oauth-integration.md)
- [Backend OAuth Service](../backend/src/oauth/README.md)
- [SaaS Connectors Overview](./saas-connectors.md)
- [Google OAuth Setup](./google-oauth-setup.md)

---

## Conclusion

The Gmail connector flow provides a seamless OAuth 2.0 integration experience with clear visual feedback at each step. The popup-based flow keeps the main application state intact while securely handling the authorization process. Status indicators and auto-refresh ensure users always see accurate connection status.
