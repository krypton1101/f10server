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

// Create tables if they don't exist
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

  db.run(`CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    lap_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_start_finish BOOLEAN DEFAULT 0,
    min_x REAL NOT NULL,
    min_y REAL NOT NULL,
    min_z REAL NOT NULL,
    max_x REAL NOT NULL,
    max_y REAL NOT NULL,
    max_z REAL NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS player_teams (
    player_uuid TEXT PRIMARY KEY,
    team_id INTEGER NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS player_checkpoints (
    player_uuid TEXT NOT NULL,
    checkpoint_id INTEGER NOT NULL,
    collected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (player_uuid, checkpoint_id),
    FOREIGN KEY (player_uuid) REFERENCES player_teams (player_uuid),
    FOREIGN KEY (checkpoint_id) REFERENCES checkpoints (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS player_positions_history (
    player_uuid TEXT PRIMARY KEY,
    prev_x REAL,
    prev_y REAL,
    prev_z REAL,
    curr_x REAL,
    curr_y REAL,
    curr_z REAL,
    last_update DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Helper functions for checkpoint detection
function lineSegmentIntersectsAABB(p1, p2, aabbMin, aabbMax) {
  const dir = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
  let tmin = 0, tmax = 1;
  
  for (let axis of ['x', 'y', 'z']) {
    if (Math.abs(dir[axis]) < 1e-8) {
      if (p1[axis] < aabbMin[axis] || p1[axis] > aabbMax[axis]) return false;
    } else {
      let t1 = (aabbMin[axis] - p1[axis]) / dir[axis];
      let t2 = (aabbMax[axis] - p1[axis]) / dir[axis];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

function checkPlayerCheckpoints(playerUuid, callback) {
  db.all(`
    SELECT COUNT(DISTINCT pc.checkpoint_id) as collected_count
    FROM player_checkpoints pc
    JOIN checkpoints c ON pc.checkpoint_id = c.id
    WHERE pc.player_uuid = ? AND c.is_start_finish = 0
  `, [playerUuid], (err, rows) => {
    if (err) {
      callback(err, null);
      return;
    }
    
    const collectedCount = rows[0]?.collected_count || 0;
    
    // Get total non-start/finish checkpoints
    db.get(`
      SELECT COUNT(*) as total_count
      FROM checkpoints
      WHERE is_start_finish = 0
    `, (err, totalRow) => {
      if (err) {
        callback(err, null);
        return;
      }
      
      const totalCount = totalRow?.total_count || 0;
      callback(null, collectedCount >= totalCount);
    });
  });
}

function processCheckpointCrossing(playerUuid, teamId, checkpointId, callback) {
  db.get(`
    SELECT is_start_finish FROM checkpoints WHERE id = ?
  `, [checkpointId], (err, checkpoint) => {
    if (err) {
      callback(err);
      return;
    }
    
    if (!checkpoint) {
      callback(new Error('Checkpoint not found'));
      return;
    }
    
    if (checkpoint.is_start_finish) {
      // Check if player has all other checkpoints
      checkPlayerCheckpoints(playerUuid, (err, hasAllCheckpoints) => {
        if (err) {
          callback(err);
          return;
        }
        
        if (hasAllCheckpoints) {
          // Complete lap for the team
          db.run(`
            UPDATE teams SET lap_count = lap_count + 1, is_active = CASE WHEN lap_count + 1 >= 20 THEN 0 ELSE 1 END
            WHERE id = ?
          `, [teamId], (err) => {
            if (err) {
              callback(err);
              return;
            }
            
            // Clear player checkpoints
            db.run(`
              DELETE FROM player_checkpoints WHERE player_uuid = ?
            `, [playerUuid], (err) => {
              if (err) {
                callback(err);
                return;
              }
              
              console.log(`Player ${playerUuid} completed lap for team ${teamId}!`);
              callback(null, true); // Lap completed
            });
          });
        } else {
          callback(null, false); // Not enough checkpoints for lap completion
        }
      });
    } else {
      // Regular checkpoint, just mark as collected by this player
      db.run(`
        INSERT OR IGNORE INTO player_checkpoints (player_uuid, checkpoint_id)
        VALUES (?, ?)
      `, [playerUuid, checkpointId], (err) => {
        if (err) {
          callback(err);
          return;
        }
        
        console.log(`Player ${playerUuid} collected checkpoint ${checkpointId}`);
        callback(null, false); // No lap completed
      });
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
      if (!playerData.UUID || !playerData.timestamp || !playerData.position || !playerData.velocity || 
          playerData.yaw === undefined || playerData.pitch === undefined) {
        ws.send(JSON.stringify({ error: 'Invalid JSON format' }));
        return;
      }
      
      // Store current position in database
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
      
      // Get player's team
      db.get(`
        SELECT t.id as team_id FROM player_teams pt
        JOIN teams t ON pt.team_id = t.id
        WHERE pt.player_uuid = ? AND t.is_active = 1
      `, [playerData.UUID], (err, teamRow) => {
        if (err || !teamRow) {
          ws.send(JSON.stringify({ 
            status: 'success', 
            UUID: playerData.UUID,
            message: 'Position data stored successfully (no team assigned)' 
          }));
          return;
        }
        
        const teamId = teamRow.team_id;
        
        // Get previous position for trajectory checking
        db.get(`
          SELECT prev_x, prev_y, prev_z, curr_x, curr_y, curr_z
          FROM player_positions_history
          WHERE player_uuid = ?
        `, [playerData.UUID], (err, posRow) => {
          if (err) {
            console.error('Error getting position history:', err);
            return;
          }
          
          // Update position history
          const updatePosStmt = db.prepare(`
            INSERT OR REPLACE INTO player_positions_history 
            (player_uuid, prev_x, prev_y, prev_z, curr_x, curr_y, curr_z, last_update)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `);
          
          if (posRow) {
            updatePosStmt.run(
              playerData.UUID,
              posRow.curr_x, posRow.curr_y, posRow.curr_z, // previous becomes current
              playerData.position.x, playerData.position.y, playerData.position.z, // new current
            );
          } else {
            updatePosStmt.run(
              playerData.UUID,
              playerData.position.x, playerData.position.y, playerData.position.z, // no previous
              playerData.position.x, playerData.position.y, playerData.position.z, // current
            );
          }
          updatePosStmt.finalize();
          
          // Check checkpoint crossings if we have previous position
          if (posRow && posRow.prev_x !== null) {
            db.all(`
              SELECT id, name, is_start_finish, min_x, min_y, min_z, max_x, max_y, max_z
              FROM checkpoints
              ORDER BY order_index
            `, (err, checkpoints) => {
              if (err) {
                console.error('Error getting checkpoints:', err);
                return;
              }
              
              const prevPos = { x: posRow.prev_x, y: posRow.prev_y, z: posRow.prev_z };
              const currPos = { x: playerData.position.x, y: playerData.position.y, z: playerData.position.z };
              
              checkpoints.forEach(checkpoint => {
                const aabbMin = { x: checkpoint.min_x, y: checkpoint.min_y, z: checkpoint.min_z };
                const aabbMax = { x: checkpoint.max_x, y: checkpoint.max_y, z: checkpoint.max_z };
                
                if (lineSegmentIntersectsAABB(prevPos, currPos, aabbMin, aabbMax)) {
                  // Check if this checkpoint was already collected by this player
                  db.get(`
                    SELECT 1 FROM player_checkpoints 
                    WHERE player_uuid = ? AND checkpoint_id = ?
                  `, [playerData.UUID, checkpoint.id], (err, collectedRow) => {
                    if (err || collectedRow) {
                      return; // Already collected or error
                    }
                    
                    // Process checkpoint crossing
                    processCheckpointCrossing(playerData.UUID, teamId, checkpoint.id, (err, lapCompleted) => {
                      if (err) {
                        console.error('Error processing checkpoint crossing:', err);
                        return;
                      }
                      
                      if (lapCompleted) {
                        console.log(`Player ${playerData.UUID} completed a lap for team ${teamId}!`);
                      }
                    });
                  });
                }
              });
            });
          }
        });
        
        ws.send(JSON.stringify({ 
          status: 'success', 
          UUID: playerData.UUID,
          teamId: teamId,
          message: 'Position data stored and processed successfully' 
        }));
      });
      
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

// Serve config page
app.get('/config', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'config.html'));
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

// Teams API
app.get('/api/teams', (req, res) => {
  db.all(`
    SELECT t.*, COUNT(pt.player_uuid) as player_count,
           COALESCE(MAX(player_checkpoint_counts.checkpoint_count), 0) as max_checkpoints
    FROM teams t
    LEFT JOIN player_teams pt ON t.id = pt.team_id
    LEFT JOIN (
      SELECT player_uuid, COUNT(DISTINCT checkpoint_id) as checkpoint_count
      FROM player_checkpoints
      GROUP BY player_uuid
    ) player_checkpoint_counts ON pt.player_uuid = player_checkpoint_counts.player_uuid
    GROUP BY t.id
    ORDER BY t.lap_count DESC, max_checkpoints DESC, t.name
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

// Checkpoints API
app.get('/api/checkpoints', (req, res) => {
  db.all(`
    SELECT * FROM checkpoints
    ORDER BY order_index, name
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/checkpoints', (req, res) => {
  const { name, is_start_finish, min_x, min_y, min_z, max_x, max_y, max_z, order_index } = req.body;
  
  if (!name || min_x === undefined || min_y === undefined || min_z === undefined || 
      max_x === undefined || max_y === undefined || max_z === undefined) {
    res.status(400).json({ error: 'Name and coordinates are required' });
    return;
  }
  
  db.run(`
    INSERT INTO checkpoints (name, is_start_finish, min_x, min_y, min_z, max_x, max_y, max_z, order_index)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [name, is_start_finish || 0, min_x, min_y, min_z, max_x, max_y, max_z, order_index || 0], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    res.json({ 
      status: 'success', 
      message: 'Checkpoint created successfully',
      checkpointId: this.lastID
    });
  });
});

app.delete('/api/checkpoints/:id', (req, res) => {
  const checkpointId = req.params.id;
  
  db.run(`
    DELETE FROM checkpoints WHERE id = ?
  `, [checkpointId], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (this.changes === 0) {
      res.status(404).json({ error: 'Checkpoint not found' });
      return;
    }
    
    res.json({ 
      status: 'success', 
      message: 'Checkpoint deleted successfully'
    });
  });
});

// Player-Team assignment API
app.post('/api/player-team', (req, res) => {
  const { player_uuid, team_id } = req.body;
  
  if (!player_uuid || !team_id) {
    res.status(400).json({ error: 'Player UUID and team ID are required' });
    return;
  }
  
  db.run(`
    INSERT OR REPLACE INTO player_teams (player_uuid, team_id)
    VALUES (?, ?)
  `, [player_uuid, team_id], function(err) {
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
    SELECT t.id, t.name, t.color, t.lap_count, t.is_active,
           COUNT(pt.player_uuid) as player_count,
           COALESCE(MAX(player_checkpoint_counts.checkpoint_count), 0) as max_checkpoints
    FROM teams t
    LEFT JOIN player_teams pt ON t.id = pt.team_id
    LEFT JOIN (
      SELECT player_uuid, COUNT(DISTINCT checkpoint_id) as checkpoint_count
      FROM player_checkpoints
      GROUP BY player_uuid
    ) player_checkpoint_counts ON pt.player_uuid = player_checkpoint_counts.player_uuid
    WHERE t.is_active = 1
    GROUP BY t.id
    ORDER BY t.lap_count DESC, max_checkpoints DESC, t.name
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
