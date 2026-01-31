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
app.use(express.json({limit: "50mb"}));
app.use(express.static('public'));
app.use('/fonts', express.static('fonts'));

// Database setup
const db = new sqlite3.Database('players.db');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS players (
    player_uuid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    team_id INTEGER NOT NULL,
    score INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    on_pitstop BOOLEAN DEFAULT 0,
    FOREIGN KEY (team_id) REFERENCES teams (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS laps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_uuid TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    is_start BOOLEAN DEFAULT 0,
    FOREIGN KEY (player_uuid) REFERENCES players (player_uuid)
  )`);
});

// Function to synchronize lap count for a player
function syncLapCount(ws, playerUuid, playerData) {
  // Get current lap count for the player
  db.get(`
    SELECT COUNT(*) as current_lap_count
    FROM laps
    WHERE player_uuid = ?
  `, [playerUuid], (err, row) => {
    if (err) {
      console.error('Error getting current lap count:', err);
      ws.send(JSON.stringify({ error: 'Database error' }));
      return;
    }
    
    const currentLapCount = row.current_lap_count;
    const targetLapCount = playerData.lap_count;
    
    console.log(`Player ${playerData.nickname} has ${currentLapCount} laps, target is ${targetLapCount}`);
    
    if (currentLapCount < targetLapCount) {
      // Need to add laps
      const lapsToAdd = targetLapCount - currentLapCount;
      console.log(`Adding ${lapsToAdd} laps for player ${playerData.nickname}`);
      
      // Add the required number of laps using a transaction-like approach
      let insertQueries = [];
      for (let i = 0; i < lapsToAdd; i++) {
        insertQueries.push(new Promise((resolve, reject) => {
          db.run(`
            INSERT INTO laps (player_uuid, timestamp, is_start)
            VALUES (?, ?, ?)
          `, [playerUuid, playerData.timestamp + i, playerData.is_start], (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        }));
      }
      
      Promise.all(insertQueries)
        .then(() => {
          ws.send(JSON.stringify({
            status: 'success',
            player_uuid: playerUuid,
            message: `Added ${lapsToAdd} laps for player ${playerData.nickname}`
          }));
          console.log(`Successfully added ${lapsToAdd} laps for player ${playerData.nickname}`);
        })
        .catch((err) => {
          console.error('Error adding laps:', err);
          ws.send(JSON.stringify({ error: 'Failed to add laps' }));
        });
    } else if (currentLapCount > targetLapCount) {
      // Need to remove laps
      const lapsToRemove = currentLapCount - targetLapCount;
      console.log(`Removing ${lapsToRemove} laps for player ${playerData.nickname}`);
      
      // Remove the required number of laps (newest first)
      db.run(`
        DELETE FROM laps
        WHERE player_uuid = ?
        AND id IN (
          SELECT id FROM laps
          WHERE player_uuid = ?
          ORDER BY timestamp DESC
          LIMIT ?
        )
      `, [playerUuid, playerUuid, lapsToRemove], function(err) {
        if (err) {
          console.error('Error removing laps:', err);
          ws.send(JSON.stringify({ error: 'Failed to remove laps' }));
          return;
        }
        
        ws.send(JSON.stringify({
          status: 'success',
          player_uuid: playerUuid,
          message: `Removed ${lapsToRemove} laps for player ${playerData.nickname}`
        }));
        console.log(`Successfully removed ${lapsToRemove} laps for player ${playerData.nickname}`);
      });
    } else {
      // Lap count is already correct
      ws.send(JSON.stringify({
        status: 'success',
        player_uuid: playerUuid,
        message: `Lap count for player ${playerData.nickname} is already correct (${targetLapCount})`
      }));
      console.log(`Lap count for player ${playerData.nickname} is already correct (${targetLapCount})`);
    }
  });
}

// WebSocket Server
const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection established');
  
  ws.on('message', (data) => {
    try {
      const playerData = JSON.parse(data);
      
      // Validate the JSON structure
    	// "{\"nickname\":\"%s\",\"lap_count\":%d,\"timestamp\":%d,\"is_start\":%b}"
      if (!playerData.nickname || playerData.lap_count === undefined ||
         playerData.lap_count === null || typeof playerData.lap_count !== 'number' ||
         !playerData.timestamp || playerData.is_start === undefined || playerData.is_start === null) {
        ws.send(JSON.stringify({ error: 'Invalid JSON format' }));
        console.log(`Received invalid data: ${data}`);
        return;
      }
      
      // Get or create player
      db.get(`
        SELECT player_uuid FROM players WHERE name = ?
      `, [playerData.nickname], (err, row) => {
        if (err) {
          console.error('Error querying player:', err);
          ws.send(JSON.stringify({ error: 'Database error' }));
          return;
        }
        
        if (!row) {
          // Player doesn't exist, create new player
          const newPlayerUuid = 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
          db.run(`
            INSERT INTO players (player_uuid, name, team_id)
            VALUES (?, ?, 0)
          `, [newPlayerUuid, playerData.nickname], function(err) {
            if (err) {
              console.error('Error creating player:', err);
              ws.send(JSON.stringify({ error: 'Failed to create player' }));
              return;
            }
            
            console.log(`Created new player ${playerData.nickname} with UUID ${newPlayerUuid}`);
            syncLapCount(ws, newPlayerUuid, playerData);
          });
        } else {
          // Player exists, sync lap count
          syncLapCount(ws, row.player_uuid, playerData);
        }
      });
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
  res.sendFile(path.join(__dirname, 'public', 'leaderboard.html'));
});

// Serve teams page
app.get('/teams', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teams.html'));
});

// Get all players with team information
app.get('/api/players', (req, res) => {
  db.all(`
    SELECT p.player_uuid, p.name as player_name, p.is_active, p.on_pitstop, t.name as team_name, t.color as team_color, COUNT(l.id) as lap_count
    FROM players p
    LEFT JOIN teams t ON p.team_id = t.id
    LEFT JOIN laps l ON p.player_uuid = l.player_uuid
    GROUP BY p.player_uuid, player_name, team_name, team_color
    ORDER BY p.name
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Get player details with team information
app.get('/api/players/:id/details', (req, res) => {
  const player_UUID = req.params.id;
  db.get(`
    SELECT p.*, t.name as team_name, t.color as team_color
    FROM players p
    LEFT JOIN teams t ON p.team_id = t.id
    WHERE p.player_uuid = ?
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

// Update player details
app.put('/api/players/:id', (req, res) => {
  const player_UUID = req.params.id;
  const { name, team_id, score, is_active, on_pitstop } = req.body;
  
  if (!name || !team_id) {
    res.status(400).json({ error: 'Name and team_id are required' });
    return;
  }
  
  db.run(`
    INSERT OR REPLACE INTO players (player_uuid, name, team_id, score, is_active, on_pitstop)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [player_UUID, name, team_id, score || 0, is_active ? 1 : 0, on_pitstop ? 1 : 0], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (this.changes === 0) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }
    
    res.json({
      status: 'success',
      message: 'Player updated successfully'
    });
  });
});

// Delete player details
app.delete('/api/players/:id', (req, res) => {
  const player_UUID = req.params.id;
  
  db.run(`
    DELETE FROM players
    WHERE player_uuid = ?
  `, [player_UUID], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (this.changes === 0) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }
    
    res.json({
      status: 'success',
      message: 'Player deleted successfully'
    });
  });
});

// Get lap times for a specific player
app.get('/api/players/:id/laps', (req, res) => {
  const player_UUID = req.params.id;
  db.all(`
    SELECT timestamp
    FROM laps
    WHERE player_uuid = ?
    ORDER BY timestamp DESC
  `, [player_UUID], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Delete last lap for a specific player
app.delete('/api/players/:id/lap', (req, res) => {
  const player_UUID = req.params.id;
  
  db.run(`
    DELETE FROM laps
    WHERE player_uuid = ? AND timestamp = (
      SELECT MAX(timestamp)
      FROM laps
      WHERE player_uuid = ?
    )
  `, [player_UUID, player_UUID], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (this.changes === 0) {
      res.status(404).json({ error: 'Lap not found' });
      return;
    }
    
    res.json({
      status: 'success',
      message: 'Lap deleted successfully'
    });
  });
});

// Add a lap for a specific player
app.post('/api/players/:id/laps', (req, res) => {
  const player_UUID = req.params.id;
  const timestamp = Date.now();
  
  db.run(`
    INSERT INTO laps (player_uuid, timestamp)
    VALUES (?, ?)
  `, [player_UUID, timestamp], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    res.json({
      status: 'success',
      message: 'Lap added successfully',
      lapId: this.lastID
    });
  });
});

// Toggle player pitstop status
app.put('/api/players/:id/pitstop', (req, res) => {
  const player_UUID = req.params.id;
  
  db.run(`
    UPDATE players
    SET on_pitstop = NOT on_pitstop
    WHERE player_uuid = ?
  `, [player_UUID], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (this.changes === 0) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }
    
    // Get the updated player status
    db.get(`
      SELECT on_pitstop
      FROM players
      WHERE player_uuid = ?
    `, [player_UUID], (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      res.json({
        status: 'success',
        message: 'Pitstop status toggled successfully',
        on_pitstop: row.on_pitstop
      });
    });
  });
});

// Toggle player active status
app.put('/api/players/:id/active', (req, res) => {
  const player_UUID = req.params.id;
  
  db.run(`
    UPDATE players
    SET is_active = NOT is_active
    WHERE player_uuid = ?
  `, [player_UUID], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (this.changes === 0) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }
    
    // Get the updated player status
    db.get(`
      SELECT is_active
      FROM players
      WHERE player_uuid = ?
    `, [player_UUID], (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      res.json({
        status: 'success',
        message: 'Active status toggled successfully',
        is_active: row.is_active
      });
    });
  });
});

// Teams API
app.get('/api/teams', (req, res) => {
  db.all(`
    SELECT t.*, COUNT(p.player_uuid) as player_count
    FROM teams t
    LEFT JOIN players p ON t.id = p.team_id
    GROUP BY t.id
    ORDER BY t.name
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/teams', (req, res) => {
  const { name, color } = req.body;
  
  if (!name || !color) {
    res.status(400).json({ error: 'Name and color are required' });
    return;
  }
  
  db.run(`
    INSERT INTO teams (name, color)
    VALUES (?, ?)
  `, [name, color], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    res.json({ 
      status: 'success', 
      message: 'Team created successfully',
      teamId: this.lastID
    });
  });
});

app.delete('/api/teams/:id', (req, res) => {
  const teamId = req.params.id;
  
  db.run(`
    DELETE FROM teams WHERE id = ?
  `, [teamId], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (this.changes === 0) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    
    res.json({ 
      status: 'success', 
      message: 'Team deleted successfully'
    });
  });
});

// Player-Team assignment API
app.post('/api/player-team', (req, res) => {
  const { player_uuid, team_id, name } = req.body;
  
  if (!player_uuid || !team_id || !name) {
    res.status(400).json({ error: 'Player UUID and team ID are required' });
    return;
  }
  
  db.run(`
    INSERT OR REPLACE INTO players (player_uuid, team_id, name)
    VALUES (?, ?, ?)
  `, [player_uuid, team_id, name], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    res.json({ 
      status: 'success', 
      message: 'Player assigned to team successfully'
    });
  });
});

// Leaderboard API
app.get('/api/leaderboard', (req, res) => {
  db.all(`
    SELECT p.player_uuid, p.name, t.color, p.on_pitstop, p.is_active,
           COUNT(laps.id) as lap_count
    FROM players p
    LEFT JOIN teams t ON t.id = p.team_id
    LEFT JOIN laps ON p.player_uuid = laps.player_uuid
    GROUP BY p.player_uuid, p.name, t.color, p.on_pitstop
    ORDER BY p.is_active DESC, lap_count DESC, p.name
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Get recent lap completions
app.get('/api/laps', (req, res) => {
  db.all(`
    SELECT l.player_uuid, p.name, t.color, l.timestamp
    FROM laps l
    JOIN players p ON l.player_uuid = p.player_uuid
    LEFT JOIN teams t ON p.team_id = t.id
    ORDER BY l.timestamp DESC
    LIMIT 50
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
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

// Export functions for testing
module.exports = {
  // Empty for now
};
