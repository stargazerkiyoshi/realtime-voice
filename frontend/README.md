# Frontend Console

## Run
```bash
pnpm install
pnpm dev
```

Default URL: `http://localhost:5173`

## Voice Test Page
- Path: `/voice`
- Features:
  - Connect/disconnect WebSocket server
  - Start/stop session
  - Microphone capture (browser audio -> PCM16/16k -> websocket)
  - Show ASR partial/final text
  - Show assistant text
  - Play TTS PCM audio returned by backend

## Backend WS URL
Set in the top input of the page, default:
`ws://localhost:3000/ws/voice`
