# bs

A Chrome extension that adds a one-click **block** button to every tweet on x.com.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this directory

## How it works

- A content script watches the timeline and adds a ⊘ button to each tweet's action bar (skipping your own tweets).
- Clicking it blocks the author using X's internal `blocks/create` endpoint with your existing session. If that call fails, it falls back to driving X's own `…` → **Block** → **Confirm** menu.
- Every visible tweet from that user collapses into a "Blocked @user · Undo" line. **Undo** unblocks them.
