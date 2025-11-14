const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static(__dirname));

// Store rooms and their state
const rooms = new Map();

// Generate random room code
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Initialize room
function initRoom(roomCode) {
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, {
      code: roomCode,
      hostId: null,
      teams: [],
      auctionState: {
        initialized: false,
        pool: [],
        cursor: 0,
        currentLot: null,
        currentBidCr: null,
        leadingTeamId: null,
        roundEndsAtTs: null,
      },
      soldPlayers: [],
    });
  }
  return rooms.get(roomCode);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Create or join room
  socket.on('create-room', (data) => {
    const roomCode = generateRoomCode();
    const room = initRoom(roomCode);
    room.hostId = socket.id;
    
    socket.join(roomCode);
    socket.emit('room-created', { roomCode, isHost: true });
    console.log(`Room created: ${roomCode} by ${socket.id}`);
  });

  socket.on('join-room', (data) => {
    const { roomCode, teamName } = data;
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('join-error', { message: 'Room not found' });
      return;
    }

    // Check if team name already exists
    if (room.teams.some(t => t.name === teamName)) {
      socket.emit('join-error', { message: 'Team name already taken' });
      return;
    }

    // Check if this socket is already in the room (prevent duplicate joins)
    if (room.teams.some(t => t.socketId === socket.id)) {
      socket.emit('join-error', { message: 'You are already in this room' });
      return;
    }

    // Create team
    const teamId = `T${room.teams.length + 1}`;
    const team = {
      id: teamId,
      name: teamName,
      socketId: socket.id,
      purse: 100,
      players: [],
    };

    room.teams.push(team);
    socket.join(roomCode);
    socket.teamId = teamId;
    socket.roomCode = roomCode;

    // Notify all clients in room
    io.to(roomCode).emit('room-updated', {
      teams: room.teams,
      roomCode,
    });

    socket.emit('joined-room', {
      roomCode,
      teamId,
      isHost: room.hostId === socket.id,
    });

    console.log(`${teamName} joined room ${roomCode} (Host: ${room.hostId === socket.id})`);
  });

  // Host starts auction
  socket.on('start-auction', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);

    if (!room || room.hostId !== socket.id) {
      socket.emit('error', { message: 'Only host can start auction' });
      return;
    }

    const numTeams = room.teams.length;
    if (numTeams < 2 || numTeams > 6) {
      socket.emit('error', { message: 'Need 2-6 teams to start' });
      return;
    }

    // Initialize auction pool (this logic will be shared with client)
    // For now, we'll let client handle pool generation and sync it
    room.auctionState.initialized = true;
    
    io.to(roomCode).emit('auction-started', {
      numTeams,
      quotas: getQuotasByTeams(numTeams),
    });
  });

  // Sync auction pool from host
  socket.on('sync-auction-pool', (data) => {
    const { roomCode, pool } = data;
    const room = rooms.get(roomCode);
    if (room && room.hostId === socket.id) {
      room.auctionState.pool = pool;
      io.to(roomCode).emit('auction-pool-synced', { pool });
    }
  });

  // Start lot (host only)
  socket.on('start-lot', (data) => {
    const { roomCode, lot } = data;
    const room = rooms.get(roomCode);
    
    if (!room || room.hostId !== socket.id) {
      return;
    }

    room.auctionState.currentLot = lot;
    room.auctionState.currentBidCr = lot.baseCr;
    room.auctionState.leadingTeamId = null;
    room.auctionState.roundEndsAtTs = Date.now() + 30000; // 30 seconds

    io.to(roomCode).emit('lot-started', {
      lot,
      currentBidCr: lot.baseCr,
      roundEndsAtTs: room.auctionState.roundEndsAtTs,
    });
  });

  // Place bid
  socket.on('place-bid', (data) => {
    const { roomCode, bidCr } = data;
    const room = rooms.get(roomCode);
    
    if (!room || !room.auctionState.currentLot) {
      socket.emit('bid-error', { message: 'No active lot' });
      return;
    }

    const team = room.teams.find(t => t.socketId === socket.id);
    if (!team) {
      socket.emit('bid-error', { message: 'Team not found' });
      return;
    }

    // Validate bid
    const minNext = getMinNextBid(room.auctionState.currentBidCr);
    if (bidCr < minNext) {
      socket.emit('bid-error', { message: `Minimum bid is ${minNext.toFixed(2)} CR` });
      return;
    }

    room.auctionState.currentBidCr = bidCr;
    room.auctionState.leadingTeamId = team.id;
    room.auctionState.roundEndsAtTs = Date.now() + (bidCr >= 10 ? 60000 : 45000);

    io.to(roomCode).emit('bid-placed', {
      teamId: team.id,
      teamName: team.name,
      bidCr,
      roundEndsAtTs: room.auctionState.roundEndsAtTs,
    });
  });

  // Finalize lot (host only)
  socket.on('finalize-lot', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);
    
    if (!room || room.hostId !== socket.id || !room.auctionState.currentLot) {
      return;
    }

    const lot = room.auctionState.currentLot;
    let result;

    if (!room.auctionState.leadingTeamId) {
      result = { status: 'unsold', player: lot };
    } else {
      const team = room.teams.find(t => t.id === room.auctionState.leadingTeamId);
      if (team) {
        team.players.push(lot);
        team.purse = Math.max(0, team.purse - room.auctionState.currentBidCr);
        result = {
          status: 'sold',
          player: lot,
          teamId: team.id,
          teamName: team.name,
          priceCr: room.auctionState.currentBidCr,
        };
        room.soldPlayers.push(result);
      }
    }

    // Clear current lot
    room.auctionState.currentLot = null;
    room.auctionState.currentBidCr = null;
    room.auctionState.leadingTeamId = null;
    room.auctionState.roundEndsAtTs = null;
    room.auctionState.cursor++;

    io.to(roomCode).emit('lot-finalized', {
      result,
      teams: room.teams,
      cursor: room.auctionState.cursor,
      poolLength: room.auctionState.pool.length,
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Remove team from room if exists
    for (const [code, room] of rooms.entries()) {
      const teamIndex = room.teams.findIndex(t => t.socketId === socket.id);
      if (teamIndex !== -1) {
        room.teams.splice(teamIndex, 1);
        io.to(code).emit('room-updated', {
          teams: room.teams,
          roomCode: code,
        });
        break;
      }
    }
  });
});

// Helper functions
function getQuotasByTeams(numTeams) {
  const quotas = {
    2: { WK: 4, BAT: 8, AR: 6, BOWL: 7 },
    3: { WK: 7, BAT: 12, AR: 10, BOWL: 11 },
    4: { WK: 9, BAT: 16, AR: 13, BOWL: 14 },
    5: { WK: 11, BAT: 19, AR: 16, BOWL: 18 },
    6: { WK: 13, BAT: 23, AR: 19, BOWL: 22 },
  };
  return quotas[Math.max(2, Math.min(6, numTeams))] || quotas[3];
}

function getMinNextBid(currentBid) {
  if (currentBid < 2.0) return currentBid + 0.10;
  if (currentBid < 5.0) return currentBid + 0.20;
  return currentBid + 0.25;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

