const express = require('express');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database setup
const db = new sqlite3.Database('players.db');

// Create players table if it doesn't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_uuid TEXT NOT NULL,
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
  )`);
});

// WebSocket Server
const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection established');
  
  ws.on('message', (data) => {
    try {
      const playerData = JSON.parse(data);
      
      // Validate the JSON structure
      if (!playerData.UUID || !playerData.timestamp || !playerData.position || !playerData.velocity || 
          playerData.yaw === undefined || playerData.pitch === undefined) {
        ws.send(JSON.stringify({ error: 'Invalid JSON format' }));
        return;
      }
      
      // Store in database
      const stmt = db.prepare(`
        INSERT INTO players (player_uuid, timestamp, x, y, z, velocity_x, velocity_y, velocity_z, yaw, pitch)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        playerData.UUID,
        playerData.timestamp,
        playerData.position.x,
        playerData.position.y,
        playerData.position.z,
        playerData.velocity.x,
        playerData.velocity.y,
        playerData.velocity.z,
        playerData.yaw,
        playerData.pitch
      );
      
      stmt.finalize();
      
      // Send acknowledgment
      ws.send(JSON.stringify({ 
        status: 'success', 
        UUID: playerData.UUID,
        message: 'Position data stored successfully' 
      }));
      
      console.log(`Stored position data for player ${playerData.UUID}`);
      
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
      ws.send(JSON.stringify({ error: 'Failed to process data' }));
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// HTTP Routes

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get all players
app.get('/api/players', (req, res) => {
  db.all(`
    SELECT player_uuid, max(timestamp), x, y, z, velocity_x, velocity_y, velocity_z, yaw, pitch, created_at
    FROM players 
    GROUP BY player_uuid
    ORDER BY created_at DESC 
    LIMIT 100
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Get player by ID
app.get('/api/players/:id', (req, res) => {
  const player_UUID = req.params.id;
  db.get(`
    SELECT * FROM players 
    WHERE player_uuid = ? 
    ORDER BY created_at DESC 
    LIMIT 1
  `, [player_UUID], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }
    res.json(row);
  });
});

// Configuration endpoint
app.get('/api/config', (req, res) => {
  res.json({
    websocketPort: WS_PORT,
    httpPort: PORT,
    maxPlayers: 100,
    updateInterval: 1000
  });
});

// Update configuration
app.post('/api/config', (req, res) => {
  const { maxPlayers, updateInterval } = req.body;
  
  // Here you could store configuration in database or file
  console.log('Configuration updated:', { maxPlayers, updateInterval });
  
  res.json({ 
    status: 'success', 
    message: 'Configuration updated',
    config: { maxPlayers, updateInterval }
  });
});

// Start HTTP server
app.listen(PORT, () => {
  console.log(`HTTP Server running on port ${PORT}`);
  console.log(`WebSocket Server running on port ${WS_PORT}`);
  console.log(`Visit http://localhost:${PORT} to view the player tracker`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down servers...');
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});
