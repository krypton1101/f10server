# Minecraft Player Tracker

A WebSocket and HTTP server for tracking Minecraft player positions in real-time.

## Features

- **WebSocket Server**: Accepts JSON player data from multiple connections
- **HTTP Server**: Provides a web interface to view player data and configuration
- **Database Storage**: SQLite database to store player position history
- **Real-time Updates**: Dynamic web interface with auto-refresh
- **Configuration**: Web-based configuration management

## JSON Format

The WebSocket server accepts JSON data in the following format:

```json
{
  "timestamp": 1234567890,
  "position": {
    "x": 1.0,
    "y": 2.0,
    "z": 3.0
  },
  "velocity": {
    "x": 0.1,
    "y": 0.0,
    "z": 0.2
  },
  "yaw": 45.0,
  "pitch": -10.0
}
```

## Installation

1. Install Node.js (version 14 or higher)
2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

### Start the server:
```bash
npm start
```

### Development mode (with auto-restart):
```bash
npm run dev
```

## Server Endpoints

- **HTTP Server**: `http://localhost:3000`
- **WebSocket Server**: `ws://localhost:8080`

### HTTP API Endpoints

- `GET /` - Main web interface
- `GET /api/players` - Get all players data
- `GET /api/players/:id` - Get specific player data
- `GET /api/config` - Get server configuration
- `POST /api/config` - Update server configuration

## Web Interface

The web interface provides:

1. **Players Tab**: 
   - Real-time list of all tracked players
   - Player statistics (total players, active players)
   - Position, velocity, and rotation data
   - Auto-refresh every 2 seconds

2. **Configuration Tab**:
   - Maximum players to track
   - Update interval settings
   - Server port information

## WebSocket Connection

Connect to the WebSocket server and send JSON data:

```javascript
const ws = new WebSocket('ws://localhost:8080');

ws.onopen = function() {
    const playerData = {
        timestamp: Date.now(),
        position: { x: 100, y: 64, z: 200 },
        velocity: { x: 0.1, y: 0, z: 0.2 },
        yaw: 45.0,
        pitch: -10.0
    };
    
    ws.send(JSON.stringify(playerData));
};

ws.onmessage = function(event) {
    const response = JSON.parse(event.data);
    console.log('Server response:', response);
};
```

## Database Schema

The SQLite database stores player data with the following structure:

```sql
CREATE TABLE players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL,
    velocity_x REAL NOT NULL,
    velocity_y REAL NOT NULL,
    velocity_z REAL NOT NULL,
    yaw REAL NOT NULL,
    pitch REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Environment Variables

- `PORT`: HTTP server port (default: 3000)
- `WS_PORT`: WebSocket server port (default: 8080)

## License

MIT
