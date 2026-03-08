# Gmail Connector User Flow - Visual Diagram

This document provides a visual representation of the Gmail connector user flow.

## Flow Diagram (Text-based)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         START: User Opens App                        │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 1: Login Page (http://localhost:3000/login)                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│              ╔═══════════════════════════════════╗                   │
│              ║     🐕 PuppyBase Logo             ║                   │
│              ║  Sign in to PuppyBase             ║                   │
│              ╠═══════════════════════════════════╣                   │
│              ║  [ Continue with Google     ]     ║                   │
│              ║  [ Continue with GitHub     ]     ║                   │
│              ║          ────── or ──────         ║                   │
│              ║  Email: [_________________ ]      ║                   │
│              ║  Pass:  [_________________ ]      ║                   │
│              ║         [ Sign In ]               ║                   │
│              ║                                   ║                   │
│              ║  Don't have an account? Sign up   ║                   │
│              ║  Forgot password?                 ║                   │
│              ╚═══════════════════════════════════╝                   │
│                                                                       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ User logs in
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 2: Navigate to Settings → Connect                             │
│          URL: http://localhost:3000/settings/connect                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ╔═══════════════════════════════════════════════════════════════╗  │
│  ║  ← Integrations                                                ║  │
│  ╠═══════════════════════════════════════════════════════════════╣  │
│  ║                                                                ║  │
│  ║  ┌────────────────────────────────────────────────────────┐   ║  │
│  ║  │ [🐙] GitHub                            ⚫ Not connected │   ║  │
│  ║  │      Issues, projects, repos                 [ OFF ] ▸ │   ║  │
│  ║  └────────────────────────────────────────────────────────┘   ║  │
│  ║                                                                ║  │
│  ║  ┌────────────────────────────────────────────────────────┐   ║  │
│  ║  │ [📊] Google Sheets                     ⚫ Not connected │   ║  │
│  ║  │      Spreadsheets, worksheets                [ OFF ] ▸ │   ║  │
│  ║  └────────────────────────────────────────────────────────┘   ║  │
│  ║                                                                ║  │
│  ║  ┌────────────────────────────────────────────────────────┐   ║  │
│  ║  │ [📄] Google Docs                       ⚫ Not connected │   ║  │
│  ║  │      Documents, notes                        [ OFF ] ▸ │   ║  │
│  ║  └────────────────────────────────────────────────────────┘   ║  │
│  ║                                                                ║  │
│  ║  ┌────────────────────────────────────────────────────────┐   ║  │
│  ║  │ [✉️] Gmail                             ⚫ Not connected │  ║  │
│  ║  │      Emails, contacts                        [ OFF ] ▸ │  ║  │ ← TARGET
│  ║  └────────────────────────────────────────────────────────┘   ║  │
│  ║                                                                ║  │
│  ║  ┌────────────────────────────────────────────────────────┐   ║  │
│  ║  │ [📅] Google Calendar                   ⚫ Not connected │   ║  │
│  ║  │      Events, schedules                       [ OFF ] ▸ │   ║  │
│  ║  └────────────────────────────────────────────────────────┘   ║  │
│  ║                                                                ║  │
│  ╚═══════════════════════════════════════════════════════════════╝  │
│                                                                       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ User clicks Gmail toggle ON
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 3: Gmail Card Changes to Loading State                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │ [✉️] Gmail                          ⚫ Connecting to Gmail… │    │
│  │      Emails, contacts                            [ .... ] ▸ │    │
│  └────────────────────────────────────────────────────────────┘     │
│                      (Toggle disabled, opacity reduced)              │
│                                                                       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ Opens OAuth popup
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 4: OAuth Popup Opens (600x700px, centered)                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│           ┌──────────────────────────────────┐                       │
│           │  Google OAuth Consent Screen     │                       │
│           ├──────────────────────────────────┤                       │
│           │                                  │                       │
│           │  Choose an account               │                       │
│           │  ┌────────────────────────────┐  │                       │
│           │  │ 🔵 user@gmail.com         │  │                       │
│           │  └────────────────────────────┘  │                       │
│           │                                  │                       │
│           │  PuppyBase wants to access:      │                       │
│           │  ✓ Read, compose, send emails    │                       │
│           │  ✓ Manage contacts               │                       │
│           │                                  │                       │
│           │  [ Cancel ]    [ Allow ]         │                       │
│           └──────────────────────────────────┘                       │
│                                                                       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ User clicks "Allow"
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 5: Google Redirects to Callback                               │
│          URL: /oauth/gmail/callback?code=AUTH_CODE_HERE              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│           ┌──────────────────────────────────┐                       │
│           │         Loading State            │                       │
│           ├──────────────────────────────────┤                       │
│           │                                  │                       │
│           │      Connecting to Gmail...      │                       │
│           │                                  │                       │
│           │   Please wait while we complete  │                       │
│           │      the authorization           │                       │
│           │                                  │                       │
│           └──────────────────────────────────┘                       │
│                (Dark background: #0a0a0a)                            │
│                                                                       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ Backend exchanges code for tokens
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 6: Success Screen in Popup                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│           ┌──────────────────────────────────┐                       │
│           │         Success State            │                       │
│           ├──────────────────────────────────┤                       │
│           │                                  │                       │
│           │              ✓                   │                       │
│           │            (Green)               │                       │
│           │                                  │                       │
│           │           Success!               │                       │
│           │                                  │                       │
│           │  Successfully connected to Gmail!│                       │
│           │                                  │                       │
│           │   This window will close         │                       │
│           │      automatically...            │                       │
│           │                                  │                       │
│           └──────────────────────────────────┘                       │
│                    (Auto-closes after 2 seconds)                     │
│                                                                       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ Popup closes
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 7: Main Window Updates - Connected State                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │ [✉️] Gmail              🟢 Connected to user@gmail.com    │    │
│  │      Emails, contacts               (Green glow)  [ ON ] ▸ │    │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                       │
│  Status lamp: Green with glow effect                                 │
│  Toggle: ON position (green background #22c55e)                      │
│  Label: Shows connected email address                                │
│                                                                       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    ✅ GMAIL CONNECTOR ACTIVE                         │
│                                                                       │
│  User can now:                                                       │
│  • Access Gmail data in projects                                     │
│  • Import emails and contacts                                        │
│  • Use Gmail in AI agent context                                     │
│  • Disconnect by toggling OFF (with confirmation)                    │
└─────────────────────────────────────────────────────────────────────┘
```

## Disconnect Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  User Clicks Toggle to Turn OFF (When Connected)                    │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Confirmation Dialog Appears                                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│      ┌────────────────────────────────────────────┐                 │
│      │  Disconnect Gmail?                         │                 │
│      ├────────────────────────────────────────────┤                 │
│      │                                            │                 │
│      │  You will lose access to private Gmail    │                 │
│      │  content until you reconnect.              │                 │
│      │                                            │                 │
│      │  [ Cancel ]         [ Disconnect ]         │                 │
│      │   (Gray)              (Red)                │                 │
│      └────────────────────────────────────────────┘                 │
│                                                                       │
└────────────────────┬───────────────────┬───────────────────────────┘
                     │                   │
          User clicks Cancel    User clicks Disconnect
                     │                   │
                     ▼                   ▼
            Dialog closes       Calls disconnectGmail()
            No changes          Deletes OAuth tokens
                                        │
                                        ▼
                     ┌──────────────────────────────────┐
                     │  Gmail Card Updates              │
                     ├──────────────────────────────────┤
                     │  ⚫ Not connected                 │
                     │  Toggle: OFF                     │
                     │  Status: Gray                    │
                     └──────────────────────────────────┘
```

## Error Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  Error Can Occur At Multiple Points                                 │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
          ▼                      ▼                      ▼
   User Cancels          Backend Error         Network Error
   in Google OAuth       (Config missing)      (Timeout)
          │                      │                      │
          └──────────────────────┴──────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Error Screen in Popup                                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│           ┌──────────────────────────────────┐                       │
│           │         Error State              │                       │
│           ├──────────────────────────────────┤                       │
│           │                                  │                       │
│           │              ✗                   │                       │
│           │            (Red)                 │                       │
│           │                                  │                       │
│           │      Connection Failed           │                       │
│           │                                  │                       │
│           │  [Error message details here]    │                       │
│           │                                  │                       │
│           │   This window will close         │                       │
│           │      automatically...            │                       │
│           │                                  │                       │
│           └──────────────────────────────────┘                       │
│                    (Auto-closes after 3 seconds)                     │
│                                                                       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
                  ┌───────────────────────────────┐
                  │  Main Window Shows Error      │
                  ├───────────────────────────────┤
                  │  ⚫ Authorization error        │
                  │  Status: Red                  │
                  │  User can click to retry      │
                  └───────────────────────────────┘
```

## State Transitions

```
                    Gmail Connector States
                    
    ┌─────────────┐
    │ Initial     │
    │ Load        │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │ Disconnected│◄─────┐
    │ ⚫ Gray      │      │
    │ "Not        │      │
    │ connected"  │      │
    └──────┬──────┘      │
           │             │
           │ Click       │ Disconnect
           │ Toggle ON   │ (with confirm)
           │             │
           ▼             │
    ┌─────────────┐      │
    │ Loading     │      │
    │ ⚫ Gray      │      │
    │ "Connecting │      │
    │ to Gmail…"  │      │
    └──────┬──────┘      │
           │             │
           │ OAuth       │
           │ Success     │ OAuth
           │             │ Failure
           ▼             │
    ┌─────────────┐      │
    │ Connected   │──────┘
    │ 🟢 Green    │
    │ "Connected  │
    │ to email"   │
    └─────────────┘
           │
           │ Error
           │ (token expired)
           │
           ▼
    ┌─────────────┐
    │ Error       │
    │ 🔴 Red      │
    │ "Authorization
    │ error"      │
    └──────┬──────┘
           │
           │ Click card
           │ to retry
           │
           └──────────► (Back to Loading)
```

## UI Component Breakdown

### Integration Card Anatomy

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ┌──┐  Gmail                        ⚫ Not connected   ┌──┐     │
│  │📧│  Emails, contacts              Status Text      │  │     │
│  └──┘  Description                   Status Lamp      └──┘     │
│  Icon                                                  Toggle   │
│  (20px)                                                (48x26)  │
│                                                                  │
│  ◄────────────────────────────────────────────────────────────► │
│  Padding: 12px 16px                                             │
│  Background: #1a1a1a                                            │
│  Border: 1px solid #2a2a2a                                      │
│  Border-radius: 8px                                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Toggle Switch States

```
Disconnected (OFF):
┌────────────────────┐
│ ⚪                │  ← White circle on left
│      (Gray bg)     │     Background: #2a2a2a
└────────────────────┘     Border: #3a3a3a

Connected (ON):
┌────────────────────┐
│                 ⚪ │  ← White circle on right
│    (Green bg)      │     Background: #22c55e
└────────────────────┘     Border: #15803d
```

### Status Lamp States

```
Disconnected:  ⚫  Gray (#595959)
Connected:     🟢  Green (#22c55e) with glow
Error:         🔴  Red (#ef4444)
```

## Technical Sequence Diagram

```
User          Frontend           Popup          Backend         Google
 │                │                │               │              │
 │ Click Toggle   │                │               │              │
 ├───────────────>│                │               │              │
 │                │ GET /authorize │               │              │
 │                ├───────────────────────────────>│              │
 │                │                │               │              │
 │                │ Return auth URL                │              │
 │                │<───────────────────────────────┤              │
 │                │                │               │              │
 │                │ Open Popup     │               │              │
 │                ├───────────────>│               │              │
 │                │                │               │              │
 │                │                │ Redirect to Google           │
 │                │                ├──────────────────────────────>│
 │                │                │               │              │
 │  [User reviews permissions and clicks Allow]    │              │
 │                │                │               │              │
 │                │                │ Redirect with code           │
 │                │                │<──────────────────────────────┤
 │                │                │               │              │
 │                │                │ POST /callback with code     │
 │                │                ├──────────────>│              │
 │                │                │               │              │
 │                │                │               │ Exchange code│
 │                │                │               ├─────────────>│
 │                │                │               │              │
 │                │                │               │ Return tokens│
 │                │                │               │<─────────────┤
 │                │                │               │              │
 │                │                │ Store tokens  │              │
 │                │                │ Return success│              │
 │                │                │<──────────────┤              │
 │                │                │               │              │
 │                │   Show success │               │              │
 │                │   Close popup  │               │              │
 │                │<───────────────┤               │              │
 │                │                │               │              │
 │                │ GET /status    │               │              │
 │                ├───────────────────────────────>│              │
 │                │                │               │              │
 │                │ Return connected status        │              │
 │                │<───────────────────────────────┤              │
 │                │                │               │              │
 │ Update UI      │                │               │              │
 │<───────────────┤                │               │              │
 │ Show connected │                │               │              │
```

---

## Color Reference

### Main Palette
- **Very Dark Background**: `#0a0a0a`
- **Card Background**: `#1a1a1a`
- **Border Color**: `#2a2a2a`
- **Hover Border**: `#3a3a3a`
- **Text Primary**: `#CDCDCD`
- **Text Secondary**: `#8B8B8B`
- **Text Tertiary**: `#666666`

### Status Colors
- **Success Green**: `#22c55e`
- **Success Green Dark**: `#15803d`
- **Error Red**: `#ef4444`
- **Error Red Dark**: `#b91c1c`
- **Disconnected Gray**: `#595959`

### Interactive Elements
- **Toggle Off Background**: `#2a2a2a`
- **Toggle On Background**: `#22c55e`
- **Button Hover**: `#353535`

---

## Responsive Considerations

### Popup Window
- Fixed size: 600x700px
- Centered on parent window
- Not responsive (OAuth pages control layout)

### Integration Cards
- Full width of container
- Max width: 760px (centered)
- Mobile: Stack elements vertically
- Tablet: Same as desktop

---

## Accessibility Features

1. **Toggle Switch**:
   - `aria-pressed` attribute
   - `aria-label` with platform name
   - Keyboard accessible (Tab + Space/Enter)

2. **Status Indicators**:
   - Text labels supplement color
   - Not relying on color alone

3. **Modal Dialog**:
   - Focus trap when open
   - ESC key to close
   - Overlay click to close

4. **Loading States**:
   - Text indicators for screen readers
   - Visual feedback for all actions

---

End of Visual Diagram Documentation
