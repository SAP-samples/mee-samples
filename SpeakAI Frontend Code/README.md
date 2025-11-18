# UI5 Application 

A UI5-based chat interface for interacting with an AI agent over WebSocket. The application provides a responsive chat UI, real-time connection status, markdown-rendered agent responses, and helpful UX features like scroll-to-latest and action hints.

## Overview

This app demonstrates a TypeScript setup for developing UI5 applications while implementing a real-time chat with an AI backend. The frontend connects to a WebSocket server and exchanges messages using a simple JSON protocol. Agent responses are rendered as sanitized Markdown.

- Framework: SAP UI5 (sap.m, sap.ui.layout)
- Language: TypeScript
- Theme: SAP Horizon
- Internationalization: English (default), German
- Runtime: UI5 Tooling with dev server at http://localhost:8080

The central entry point for information about using TypeScript with UI5 is at [https://sap.github.io/ui5-typescript](https://sap.github.io/ui5-typescript).

## Features

- Real-time chat via WebSocket with automatic reconnect
- Connection status MessageStrip (Connected, Connecting, Disconnected, Error)
- Agent “current action” hint (e.g., “Reasoning”) while thinking

## Architecture

Key files:

- `webapp/Component.ts`
  - Initializes theme, models (`agent`, `ui`, `device`)
  - Configures UI5 loader `paths` and `shim` for third-party modules (`markdown-it`, `DOMPurify`)
  - Creates `WebSocketClient` with default endpoint `ws://localhost:8000/ws`
  - Starts the router
- `webapp/service/WebSocketClient.ts`
  - Lightweight wrapper around `WebSocket`
  - Event emitter API (`on`, `off`) with events: `open`, `close`, `error`, `message`
  - Queueing unsent messages while disconnected
  - Reconnect with backoff (`maxReconnectAttempts = 5`)
- `webapp/view/Main.view.xml`
  - Page with top bar showing connection status
  - List bound to `agent>/messages`
  - Agent messages rendered as sanitized Markdown (`core:HTML` + formatter)
  - User messages as plain text
  - Footer input for composing messages, plus scroll-to-bottom button
- `webapp/controller/Main.controller.ts`
  - Binds WebSocket events to the `agent` model
  - Handles send, scroll, sidebar toggle, and UI visibility logic
  - Maintains scroll binding and resize listeners to keep scroll-to-bottom state in sync
- `webapp/model/formatter.ts`
  - Lazily loads `markdown-it` and `DOMPurify` via the UI5 loader
  - `formatMarkdown`: converts Markdown to sanitized HTML
  - `isComposerEnabled` / `getSendIcon` / `isLastMessageFromUser`

## 4. Project Structure

```
webapp/
  Component.ts
  controller/
    App.controller.ts
    Main.controller.ts
  service/
    WebSocketClient.ts
    TableFilterHandler.ts
    TableFilterExporter.ts
  model/
    formatter.ts
    models.ts
  delegates/
    JSONTableDelegate.js
    JSONTableFilterDelegate.js
  view/
    Main.view.xml
    App.view.xml
  i18n/
    i18n.properties
  mockdata/
    speakers.json (GENERATED – may be absent; see sync script)
scripts/
  sync-data.js
```

### sync-data.js
The pre-start script (`_prestart` in `package.json`) calls `scripts/sync-data.js` to fetch speaker data from an API (default `http://localhost:8000/api`) and write it to `webapp/mockdata/speakers.json`. If `speakers.json` is missing (not committed to the repository), run:

```sh
node ./scripts/sync-data.js --url http://localhost:8000/api --pretty
```

Flags:
- `--url <endpoint>`: Base API endpoint to pull data.
- `--pretty`: Write formatted JSON for easier diffing.

If the mockdata JSON is not present in the repo, the application still runs; it simply lacks local sample data until the script is executed.

## Backend WebSocket Protocol

The app expects a WebSocket server accessible at `ws://localhost:8000/ws/{clientId}` (configurable in `Component.ts`).

Outbound user message (from frontend):
```json
{
  "message": "Hello",
  "user_id": "client-123"
}
```

Server messages (to frontend):
```json
{
  "type": "response" | "xai" | "error",
  "content": "string",
  "user_id": "client-123",
  "timestamp": "2025-10-08T08:00:00.000Z"
}
```

Behavior:
- `type: "xai"`: The app treats `content` as a current action/status hint (e.g., “Searching docs…”) and shows it next to a busy indicator.
- `type: "response"`: The app renders `content` as sanitized Markdown in the chat as an agent message.
- `type: "error"`: The app marks the connection status as Error and appends an error message entry.

## Requirements

- [Node.js](https://nodejs.org/) and [npm](https://www.npmjs.com/) (or [yarn](https://yarnpkg.com/))
- A reachable WebSocket backend endpoint (default `ws://localhost:8000/ws`)

## Preparation

Install dependencies:

```sh
npm install
```

(Or `yarn` if you prefer.)

## Run the App (Development)

Start the UI5 dev server:

```sh
npm start
```

The app runs at:
- http://localhost:8080/index.html

Ensure your backend WebSocket server is running and listening at `ws://localhost:8000/ws`. If your backend uses a different host/port/path, set it in `webapp/manifest.json`:

```json
{
  "sap.ui5": {
    "config": {
      "wsBaseUrl": "wss://your-host:your-port/ws"
    }
  }
}
```

If `wsBaseUrl` is omitted, the app defaults to `ws(s)://<window.location.host>/ws`.

## CDN Bootstrap Option

You can also use the CDN bootstrap (useful for static hosting):

- `webapp/index-cdn.html` loads `sap-ui-core.js` from `https://ui5.sap.com/1.141.0/resources/sap-ui-core.js`

Serve the `webapp` folder with any static web server and open `index-cdn.html`.

## Build the App

### Unoptimized (quick)

```sh
npm run build
npm run start:dist
```

This places the result into `dist` and serves it. For production deployments, adjust the bootstrap URL if needed (e.g., use the CDN or host UI5 resources locally).

### Optimized (self-contained)

```sh
npm run build:opt
npm run start:dist
```

Creates a self-contained bundle including required UI5 JS resources. The app loads from `sap-ui-custom.js`. Non-JS assets (i18n texts, CSS) are still required.

### Type Checking and Linting

```sh
npm run ts-typecheck
npm run lint
```

## Configuration Notes

- WebSocket endpoint:
  - Set in `webapp/manifest.json` under `sap.ui5/config/wsBaseUrl` (e.g., "ws://localhost:8000/ws").
  - If omitted, the app defaults to `ws(s)://<window.location.host>/ws`.
- Third-party modules:
  - `markdown-it` and `DOMPurify` are loaded via UI5 loader `paths`/`shim` defined in `Component.ts`.
  - Assets reside under `webapp/thirdparty/`.

## License

This project is licensed under the Apache Software License, version 2.0 except as noted otherwise in the [LICENSE](LICENSE) file.
