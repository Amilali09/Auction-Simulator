// ==================== SOCKET.IO & MULTIPLAYER SETUP ====================
// cd "C:\Users\aliaj\OneDrive\Desktop\Auction Cursor"
let socket = null;
let currentRoomCode = null;
let currentTeamId = null;
let currentTeamName = null;
let isHost = false;
let teams = [];
let activeTeamId = null;

// Initialize Socket.io connection
function initSocket() {
  // Check if Socket.io is loaded
  if (typeof io === 'undefined') {
    console.error('Socket.io not loaded! Make sure the server is running and you are accessing via http://localhost:3000');
    const statusEl = $('room-status');
    if (statusEl) {
      statusEl.textContent = 'Socket.io not loaded - Make sure server is running!';
      statusEl.style.color = 'var(--bright-pink)';
    }
    // Show error message in modal
    const errorEl = $('room-error');
    if (errorEl) {
      errorEl.textContent = 'Server not running! Please start the server with: npm start';
      errorEl.style.display = 'block';
    }
    return;
  }
  
  console.log('Initializing socket...');
  socket = io();
  
  socket.on('connect', () => {
    console.log('Connected to server');
    const statusEl = $('room-status');
    if (statusEl) {
      statusEl.textContent = 'Connected';
      statusEl.style.color = 'var(--accent-a)';
    }
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
    if ($('room-status')) {
      $('room-status').textContent = 'Disconnected';
    }
  });

  socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    if ($('room-status')) {
      $('room-status').textContent = 'Connection Error';
    }
  });

  socket.on('room-created', (data) => {
    console.log('Room created:', data);
    currentRoomCode = data.roomCode;
    isHost = true;
    
    const codeDisplay = $('room-code-display');
    const headerCode = $('header-room-code');
    const createSection = $('room-create-section');
    const joinSection = $('room-join-section');
    const status = $('room-status');
    
    if (codeDisplay) codeDisplay.textContent = data.roomCode;
    if (headerCode) headerCode.textContent = data.roomCode;
    if (createSection) createSection.style.display = 'block';
    if (joinSection) joinSection.style.display = 'none';
    if (status) status.textContent = 'Room Created';
    
    console.log('Room code displayed:', data.roomCode);
  });

  socket.on('joined-room', (data) => {
    currentRoomCode = data.roomCode;
    currentTeamId = data.teamId;
    isHost = data.isHost;
    $('header-room-code').textContent = data.roomCode;
    if (!isHost) {
      // Non-host players see waiting message
      $('room-modal').style.display = 'none';
      showWaitingMessage();
    } else {
      // Host stays in modal to start auction
      $('room-status').textContent = `Room: ${data.roomCode} - Waiting for players...`;
    }
  });

  socket.on('room-updated', (data) => {
    teams = data.teams;
    updateTeamCards();
    updateBottomPanel();
    // Update host UI if they're waiting
    if (isHost && currentRoomCode) {
      const teamCount = data.teams.length;
      const startBtn = $('start-auction-btn');
      if (startBtn) {
        if (teamCount >= 2) {
          startBtn.disabled = false;
          startBtn.textContent = `Start Auction (${teamCount} teams joined)`;
        } else {
          startBtn.disabled = true;
          startBtn.textContent = `Waiting for players... (${teamCount}/2)`;
        }
      }
    }
  });

  socket.on('auction-started', (data) => {
    auctionState.quotas = data.quotas;
    hideWaitingMessage();
    if (isHost) {
      const { pool } = buildAuctionPool(data.numTeams);
      auctionState.pool = pool;
      socket.emit('sync-auction-pool', { roomCode: currentRoomCode, pool });
      // Host starts first lot
      setTimeout(() => {
        if (auctionState.pool.length > 0) {
          startNextLot();
        }
      }, 1000);
    }
  });

  socket.on('auction-pool-synced', (data) => {
    auctionState.pool = data.pool;
  });

  socket.on('lot-started', (data) => {
    auctionState.currentLot = data.lot;
    auctionState.currentBidCr = data.currentBidCr;
    auctionState.roundEndsAtTs = data.roundEndsAtTs;
    scheduleTick();
    animateDrawReveal(data.lot);
    updateCenterPlayerUI(data.lot);
    updateBidPanelUI();
  });

  socket.on('bid-placed', (data) => {
    auctionState.currentBidCr = data.bidCr;
    auctionState.leadingTeamId = data.teamId;
    auctionState.roundEndsAtTs = data.roundEndsAtTs;
    updateBidPanelUI();
  });

  socket.on('lot-finalized', (data) => {
    clearInterval(auctionState.roundTimerId);
    auctionState.currentLot = null;
    auctionState.currentBidCr = null;
    auctionState.leadingTeamId = null;
    auctionState.roundEndsAtTs = null;
    teams = data.teams;
    auctionState.cursor = data.cursor;
    
    updateTeamCards();
    updateBottomPanel();
    updateBidPanelUI();
    
    // Check if auction should continue
    if (isHost && data.cursor < data.poolLength) {
      setTimeout(() => {
        startNextLot();
      }, 2000);
    } else if (isHost && data.cursor >= data.poolLength) {
      alert('Auction Complete! All players have been drawn.');
    }
  });

  socket.on('join-error', (data) => {
    const errorEl = $('room-error');
    errorEl.textContent = data.message;
    errorEl.style.display = 'block';
  });

  socket.on('bid-error', (data) => {
    alert(data.message);
  });
}

// Room management functions
function createRoom() {
  console.log('createRoom called');
  console.log('Socket:', socket);
  console.log('Socket connected:', socket?.connected);
  
  if (!socket) {
    alert('Socket not initialized. Please refresh the page.');
    return;
  }
  
  if (!socket.connected) {
    alert('Not connected to server. Please wait for connection...');
    console.log('Waiting for connection...');
    socket.once('connect', () => {
      console.log('Connected, creating room now');
      socket.emit('create-room');
    });
    return;
  }
  
  console.log('Emitting create-room');
  socket.emit('create-room');
}

function joinRoom() {
  const roomCode = $('join-room-code').value.trim().toUpperCase();
  const teamName = $('join-team-name').value.trim();
  if (!roomCode || !teamName) {
    $('room-error').textContent = 'Please enter both room code and team name';
    $('room-error').style.display = 'block';
    return;
  }
  socket.emit('join-room', { roomCode, teamName });
  currentTeamName = teamName;
}

function startAuction() {
  const teamName = $('host-team-name').value.trim();
  if (!teamName) {
    alert('Please enter your team name');
    return;
  }
  if (!currentRoomCode) {
    alert('Room not created yet');
    return;
  }
  
  // Host joins their own room first if not already joined
  if (!currentTeamId) {
    socket.emit('join-room', { roomCode: currentRoomCode, teamName });
    currentTeamName = teamName;
    // Wait for both joined-room and room-updated events
    let joined = false;
    let teamsUpdated = false;
    
    const tryStart = () => {
      if (joined && teamsUpdated && teams.length >= 2) {
        socket.emit('start-auction', { roomCode: currentRoomCode });
        $('room-modal').style.display = 'none';
      } else if (joined && teamsUpdated && teams.length < 2) {
        alert('Need at least 2 teams to start auction. Waiting for more players...');
      }
    };
    
    socket.once('joined-room', () => {
      joined = true;
      tryStart();
    });
    
    socket.once('room-updated', () => {
      teamsUpdated = true;
      tryStart();
    });
  } else {
    // Already joined, just start auction
    if (teams.length >= 2) {
      socket.emit('start-auction', { roomCode: currentRoomCode });
      $('room-modal').style.display = 'none';
    } else {
      alert('Need at least 2 teams to start auction');
    }
  }
}

function startNextLot() {
  if (!isHost || !auctionState.pool || auctionState.cursor >= auctionState.pool.length) {
    return;
  }
  const lot = auctionState.pool[auctionState.cursor];
  socket.emit('start-lot', { roomCode: currentRoomCode, lot });
}

// Show waiting message for non-host players
function showWaitingMessage() {
  const waitingDiv = document.createElement('div');
  waitingDiv.id = 'waiting-message';
  waitingDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--panel);padding:30px;border-radius:10px;border:2px solid var(--bright-blue);z-index:1000;text-align:center;';
  waitingDiv.innerHTML = `
    <h2 style="color:var(--bright-blue);margin-bottom:15px;">Waiting for Auction to Start</h2>
    <p style="color:var(--muted);">The host will start the auction once all players have joined.</p>
    <div class="spinner" style="margin:20px auto;"></div>
  `;
  document.body.appendChild(waitingDiv);
}

function hideWaitingMessage() {
  const waitingDiv = $('waiting-message');
  if (waitingDiv) {
    waitingDiv.remove();
  }
}

// ==================== PLAYER DATA & TYPES ====================
const PLAYER_TYPES = {
  WK: "Wicketkeeper",
  BAT: "Batsman",
  AR: "All-Rounder",
  BOWL: "Bowler",
};

// Helper function to generate player image URL
function getPlayerImageUrl(playerName) {
  // Use ui-avatars.com to generate avatar with player name initials
  const initials = playerName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(playerName)}&size=200&background=random&color=fff&bold=true&font-size=0.5`;
}

const PLAYERS_DATA = [
  // --- Wicketkeepers (15) ---
  { id: 'wk1', name: "MS Dhoni", type: "WK", baseCr: 2.0, img: getPlayerImageUrl("MS Dhoni") },
  { id: 'wk2', name: "Rishabh Pant", type: "WK", baseCr: 2.0, img: getPlayerImageUrl("Rishabh Pant") },
  { id: 'wk3', name: "Jos Buttler", type: "WK", baseCr: 2.0, img: getPlayerImageUrl("Jos Buttler") },
  { id: 'wk4', name: "Quinton de Kock", type: "WK", baseCr: 2.0, img: getPlayerImageUrl("Quinton de Kock") },
  { id: 'wk5', name: "Sanju Samson", type: "WK", baseCr: 2.0, img: getPlayerImageUrl("Sanju Samson") },
  { id: 'wk6', name: "Ishan Kishan", type: "WK", baseCr: 2.0, img: getPlayerImageUrl("Ishan Kishan") },
  { id: 'wk7', name: "Nicholas Pooran", type: "WK", baseCr: 2.0, img: getPlayerImageUrl("Nicholas Pooran") },
  { id: 'wk8', name: "Jitesh Sharma", type: "WK", baseCr: 2.0, img: getPlayerImageUrl("Jitesh Sharma") },
  { id: 'wk9', name: "K.L. Rahul", type: "WK", baseCr: 2.0, img: getPlayerImageUrl("K.L. Rahul") },
  { id: 'wk10', name: "Devon Conway", type: "WK", baseCr: 1.5, img: getPlayerImageUrl("Devon Conway") },
  { id: 'wk11', name: "Prabhsimran Singh", type: "WK", baseCr: 1.5, img: getPlayerImageUrl("Prabhsimran Singh") },
  { id: 'wk12', name: "Rahmanullah Gurbaz", type: "WK", baseCr: 1.0, img: getPlayerImageUrl("Rahmanullah Gurbaz") },
  { id: 'wk13', name: "Jonny Bairstow", type: "WK", baseCr: 1.0, img: getPlayerImageUrl("Jonny Bairstow") },
  { id: 'wk14', name: "Wriddhiman Saha", type: "WK", baseCr: 1.0, img: getPlayerImageUrl("Wriddhiman Saha") },
  { id: 'wk15', name: "Matthew Wade", type: "WK", baseCr: 1.0, img: getPlayerImageUrl("Matthew Wade") },

  // --- Batsmen (30) ---
  { id: 'bat1', name: "Virat Kohli", type: "BAT", baseCr: 2.0, img: getPlayerImageUrl("Virat Kohli") },
  { id: 'bat2', name: "Rohit Sharma", type: "BAT", baseCr: 2.0, img: getPlayerImageUrl("Rohit Sharma") },
  { id: 'bat3', name: "Tim David", type: "BAT", baseCr: 2.0, img: getPlayerImageUrl("Tim David") },
  { id: 'bat4', name: "Suryakumar Yadav", type: "BAT", baseCr: 2.0, img: getPlayerImageUrl("Suryakumar Yadav") },
  { id: 'bat5', name: "Shreyas Iyer", type: "BAT", baseCr: 2.0, img: getPlayerImageUrl("Shreyas Iyer") },
  { id: 'bat6', name: "Shubman Gill", type: "BAT", baseCr: 2.0, img: getPlayerImageUrl("Shubman Gill") },
  { id: 'bat7', name: "Ruturaj Gaikwad", type: "BAT", baseCr: 2.0, img: getPlayerImageUrl("Ruturaj Gaikwad") },
  { id: 'bat8', name: "Rinku Singh", type: "BAT", baseCr: 2.0, img: getPlayerImageUrl("Rinku Singh") },
  { id: 'bat9', name: "Travis Head", type: "BAT", baseCr: 2.0, img: getPlayerImageUrl("Travis Head") },
  { id: 'bat10', name: "Yashasvi Jaiswal", type: "BAT", baseCr: 2.0, img: getPlayerImageUrl("Yashasvi Jaiswal") },
  { id: 'bat11', name: "Phil Salt", type: "BAT", baseCr: 2.0, img: getPlayerImageUrl("Phil Salt") },
  { id: 'bat12', name: "Tilak Varma", type: "BAT", baseCr: 2.0, img: getPlayerImageUrl("Tilak Varma") },
  { id: 'bat13', name: "Abhishek Sharma", type: "BAT", baseCr: 2.0, img: getPlayerImageUrl("Abhishek Sharma") },
  { id: 'bat14', name: "Dewald Brevis", type: "BAT", baseCr: 2.0, img: getPlayerImageUrl("Dewald Brevis") },
  { id: 'bat15', name: "Deepak Hooda", type: "BAT", baseCr: 1.5, img: getPlayerImageUrl("Deepak Hooda") },
  { id: 'bat16', name: "Nitish Rana", type: "BAT", baseCr: 1.5, img: getPlayerImageUrl("Nitish Rana") },
  { id: 'bat17', name: "Rovman Powell", type: "BAT", baseCr: 1.5, img: getPlayerImageUrl("Rovman Powell") },
  { id: 'bat18', name: "Harry Brook", type: "BAT", baseCr: 1.5, img: getPlayerImageUrl("Harry Brook") },
  { id: 'bat19', name: "Sai Sudharsan", type: "BAT", baseCr: 1.5, img: getPlayerImageUrl("Sai Sudharsan") },
  { id: 'bat20', name: "Vaibhav Suryavanshi", type: "BAT", baseCr: 1.0, img: getPlayerImageUrl("Vaibhav Suryavanshi") },
  { id: 'bat21', name: "Kane Williamson", type: "BAT", baseCr: 1.0, img: getPlayerImageUrl("Kane Williamson") },
  { id: 'bat22', name: "Faf du Plessis", type: "BAT", baseCr: 1.0, img: getPlayerImageUrl("Faf du Plessis") },
  { id: 'bat23', name: "Mayank Agarwal", type: "BAT", baseCr: 1.0, img: getPlayerImageUrl("Mayank Agarwal") },
  { id: 'bat24', name: "Prithvi Shaw", type: "BAT", baseCr: 1.0, img: getPlayerImageUrl("Prithvi Shaw") },
  { id: 'bat25', name: "Manish Pandey", type: "BAT", baseCr: 1.0, img: getPlayerImageUrl("Manish Pandey") },
  { id: 'bat26', name: "Shahrukh Khan", type: "BAT", baseCr: 1.0, img: getPlayerImageUrl("Shahrukh Khan") },
  { id: 'bat27', name: "Ajinkya Rahane", type: "BAT", baseCr: 1.0, img: getPlayerImageUrl("Ajinkya Rahane") },
  { id: 'bat28', name: "David Miller", type: "BAT", baseCr: 1.0, img: getPlayerImageUrl("David Miller") },
  { id: 'bat29', name: "Ramandeep Singh", type: "BAT", baseCr: 1.0, img: getPlayerImageUrl("Ramandeep Singh") },
  { id: 'bat30', name: "Sarfaraz Khan", type: "BAT", baseCr: 1.0, img: getPlayerImageUrl("Sarfaraz Khan") },

  // --- All-Rounders (25) ---
  { id: 'ar1', name: "Hardik Pandya", type: "AR", baseCr: 2.0, img: getPlayerImageUrl("Hardik Pandya") },
  { id: 'ar2', name: "Ravindra Jadeja", type: "AR", baseCr: 2.0, img: getPlayerImageUrl("Ravindra Jadeja") },
  { id: 'ar3', name: "Ben Stokes", type: "AR", baseCr: 2.0, img: getPlayerImageUrl("Ben Stokes") },
  { id: 'ar4', name: "Andre Russell", type: "AR", baseCr: 2.0, img: getPlayerImageUrl("Andre Russell") },
  { id: 'ar5', name: "Glenn Maxwell", type: "AR", baseCr: 2.0, img: getPlayerImageUrl("Glenn Maxwell") },
  { id: 'ar6', name: "Marcus Stoinis", type: "AR", baseCr: 2.0, img: getPlayerImageUrl("Marcus Stoinis") },
  { id: 'ar7', name: "Liam Livingstone", type: "AR", baseCr: 2.0, img: getPlayerImageUrl("Liam Livingstone") },
  { id: 'ar8', name: "Sam Curran", type: "AR", baseCr: 2.0, img: getPlayerImageUrl("Sam Curran") },
  { id: 'ar9', name: "Washington Sundar", type: "AR", baseCr: 2.0, img: getPlayerImageUrl("Washington Sundar") },
  { id: 'ar10', name: "Mitchell Marsh", type: "AR", baseCr: 2.0, img: getPlayerImageUrl("Mitchell Marsh") },
  { id: 'ar11', name: "Wanindu Hasaranga", type: "AR", baseCr: 2.0, img: getPlayerImageUrl("Wanindu Hasaranga") },
  { id: 'ar12', name: "Dwayne Bravo", type: "AR", baseCr: 2.0, img: getPlayerImageUrl("Dwayne Bravo") },
  { id: 'ar13', name: "Riyan Parag", type: "AR", baseCr: 2.0, img: getPlayerImageUrl("Riyan Parag") },
  { id: 'ar14', name: "Krunal Pandya", type: "AR", baseCr: 2.0, img: getPlayerImageUrl("Krunal Pandya") },
  { id: 'ar15', name: "Axar Patel", type: "AR", baseCr: 2.0, img: getPlayerImageUrl("Axar Patel") },
  { id: 'ar16', name: "Cameron Green", type: "AR", baseCr: 1.5, img: getPlayerImageUrl("Cameron Green") },
  { id: 'ar17', name: "Moeen Ali", type: "AR", baseCr: 1.5, img: getPlayerImageUrl("Moeen Ali") },
  { id: 'ar18', name: "Rahul Tewatia", type: "AR", baseCr: 1.5, img: getPlayerImageUrl("Rahul Tewatia") },
  { id: 'ar19', name: "Shahbaz Ahmed", type: "AR", baseCr: 1.5, img: getPlayerImageUrl("Shahbaz Ahmed") },
  { id: 'ar20', name: "Marco Jansen", type: "AR", baseCr: 1.5, img: getPlayerImageUrl("Marco Jansen") },
  { id: 'ar21', name: "Shivam Dube", type: "AR", baseCr: 1.5, img: getPlayerImageUrl("Shivam Dube") },
  { id: 'ar22', name: "Azmatullah Omarzai", type: "AR", baseCr: 1.5, img: getPlayerImageUrl("Azmatullah Omarzai") },
  { id: 'ar23', name: "Jason Holder", type: "AR", baseCr: 1.0, img: getPlayerImageUrl("Jason Holder") },
  { id: 'ar24', name: "David Wiese", type: "AR", baseCr: 1.0, img: getPlayerImageUrl("David Wiese") },
  { id: 'ar25', name: "Vijay Shankar", type: "AR", baseCr: 1.0, img: getPlayerImageUrl("Vijay Shankar") },

  // --- Bowlers (25) ---
  { id: 'bw1', name: "Jasprit Bumrah", type: "BOWL", baseCr: 2.0, img: getPlayerImageUrl("Jasprit Bumrah") },
  { id: 'bw2', name: "Rashid Khan", type: "BOWL", baseCr: 2.0, img: getPlayerImageUrl("Rashid Khan") },
  { id: 'bw3', name: "Arshdeep Singh", type: "BOWL", baseCr: 2.0, img: getPlayerImageUrl("Arshdeep Singh") },
  { id: 'bw4', name: "Mohammed Shami", type: "BOWL", baseCr: 2.0, img: getPlayerImageUrl("Mohammed Shami") },
  { id: 'bw5', name: "Kagiso Rabada", type: "BOWL", baseCr: 2.0, img: getPlayerImageUrl("Kagiso Rabada") },
  { id: 'bw6', name: "Yuzvendra Chahal", type: "BOWL", baseCr: 2.0, img: getPlayerImageUrl("Yuzvendra Chahal") },
  { id: 'bw7', name: "Mohammed Siraj", type: "BOWL", baseCr: 2.0, img: getPlayerImageUrl("Mohammed Siraj") },
  { id: 'bw8', name: "Bhuvneshwar Kumar", type: "BOWL", baseCr: 2.0, img: getPlayerImageUrl("Bhuvneshwar Kumar") },
  { id: 'bw9', name: "Pat Cummins", type: "BOWL", baseCr: 2.0, img: getPlayerImageUrl("Pat Cummins") },
  { id: 'bw10', name: "Mitchell Starc", type: "BOWL", baseCr: 2.0, img: getPlayerImageUrl("Mitchell Starc") },
  { id: 'bw11', name: "Deepak Chahar", type: "BOWL", baseCr: 2.0, img: getPlayerImageUrl("Deepak Chahar") },
  { id: 'bw12', name: "Kuldeep Yadav", type: "BOWL", baseCr: 2.0, img: getPlayerImageUrl("Kuldeep Yadav") },
  { id: 'bw13', name: "Varun Chakravarthy", type: "BOWL", baseCr: 2.0, img: getPlayerImageUrl("Varun Chakravarthy") },
  { id: 'bw14', name: "Trent Boult", type: "BOWL", baseCr: 2.0, img: getPlayerImageUrl("Trent Boult") },
  { id: 'bw15', name: "Shardul Thakur", type: "BOWL", baseCr: 2.0, img: getPlayerImageUrl("Shardul Thakur") },
  { id: 'bw16', name: "Harshal Patel", type: "BOWL", baseCr: 1.5, img: getPlayerImageUrl("Harshal Patel") },
  { id: 'bw17', name: "Anrich Nortje", type: "BOWL", baseCr: 1.5, img: getPlayerImageUrl("Anrich Nortje") },
  { id: 'bw18', name: "T. Natarajan", type: "BOWL", baseCr: 1.5, img: getPlayerImageUrl("T. Natarajan") },
  { id: 'bw19', name: "Ravi Bishnoi", type: "BOWL", baseCr: 1.5, img: getPlayerImageUrl("Ravi Bishnoi") },
  { id: 'bw20', name: "Adam Zampa", type: "BOWL", baseCr: 1.5, img: getPlayerImageUrl("Adam Zampa") },
  { id: 'bw21', name: "Lungi Ngidi", type: "BOWL", baseCr: 1.0, img: getPlayerImageUrl("Lungi Ngidi") },
  { id: 'bw22', name: "Umran Malik", type: "BOWL", baseCr: 1.0, img: getPlayerImageUrl("Umran Malik") },
  { id: 'bw23', name: "Rahul Chahar", type: "BOWL", baseCr: 1.0, img: getPlayerImageUrl("Rahul Chahar") },
  { id: 'bw24', name: "Mujeeb Ur Rahman", type: "BOWL", baseCr: 1.0, img: getPlayerImageUrl("Mujeeb Ur Rahman") },
  { id: 'bw25', name: "Nathan Ellis", type: "BOWL", baseCr: 1.0, img: getPlayerImageUrl("Nathan Ellis") },
];

// (sorted and reindexed above, no runtime sorting needed)

// Teams array will be populated from server

const MAX_SQUAD_SIZE = 20; // Increased max capacity

// Utility function to get element by ID
const $ = (id) => {
  const el = document.getElementById(id);
  if (!el && id) {
    console.warn(`Element with id "${id}" not found`);
  }
  return el;
};
const $$ = (selector) => document.querySelectorAll(selector);

// Auction core: quotas and random lot generation
const TEAM_LIMITS = { min: 2, max: 6 };
const TYPES = ['WK', 'BAT', 'AR', 'BOWL'];
// Exact quotas per number of teams
const QUOTAS_BY_TEAMS = {
  2: { WK: 4,  BAT: 8,  AR: 6,  BOWL: 7  },
  3: { WK: 7,  BAT: 12, AR: 10, BOWL: 11 },
  4: { WK: 9,  BAT: 16, AR: 13, BOWL: 14 },
  5: { WK: 11, BAT: 19, AR: 16, BOWL: 18 },
  6: { WK: 13, BAT: 23, AR: 19, BOWL: 22 },
};

function computeQuotas(numTeams) {
  const t = Math.max(TEAM_LIMITS.min, Math.min(TEAM_LIMITS.max, numTeams));
  if (QUOTAS_BY_TEAMS[t]) return { ...QUOTAS_BY_TEAMS[t] };
  return { ...QUOTAS_BY_TEAMS[3] }; // fallback (shouldn't happen due to limits)
}

function indexPlayersByType() {
  const map = { WK: [], BAT: [], AR: [], BOWL: [] };
  for (const p of PLAYERS_DATA) map[p.type].push(p);
  return map;
}

function buildAuctionPool(numTeams) {
  const quotas = computeQuotas(numTeams);
  const byType = indexPlayersByType();
  const available = {
    WK: [...byType.WK],
    BAT: [...byType.BAT],
    AR: [...byType.AR],
    BOWL: [...byType.BOWL],
  };
  const remaining = { ...quotas };
  const pool = [];

  const totalRequired = TYPES.reduce((s, ty) => s + remaining[ty], 0);
  let guard = 0;
  while (pool.length < totalRequired && guard++ < 100000) {
    const selectableTypes = TYPES.filter(ty => remaining[ty] > 0 && available[ty].length > 0);
    if (selectableTypes.length === 0) break;
    const tIndex = Math.floor(Math.random() * selectableTypes.length);
    const ty = selectableTypes[tIndex];
    const list = available[ty];
    const pIndex = Math.floor(Math.random() * list.length); // inclusive bounds handled by length
    const [picked] = list.splice(pIndex, 1);
    pool.push(picked);
    remaining[ty] -= 1;
  }

  return { quotas, pool, byType };
}

const auctionState = {
  quotas: null,
  pool: [],
  byType: null,
  cursor: 0,
  // round state
  currentLot: null,
  currentBidCr: null,
  leadingTeamId: null,
  roundTimerId: null,
  roundEndsAtTs: null,
};

function initAuction(numTeams) {
  if (typeof numTeams !== 'number' || Number.isNaN(numTeams)) numTeams = teams.length;
  if (numTeams < TEAM_LIMITS.min || numTeams > TEAM_LIMITS.max) {
    throw new Error(`Teams must be between ${TEAM_LIMITS.min} and ${TEAM_LIMITS.max}. Received ${numTeams}.`);
  }
  const { quotas, pool, byType } = buildAuctionPool(numTeams);
  auctionState.quotas = quotas;
  auctionState.pool = pool;
  auctionState.byType = byType;
  auctionState.cursor = 0;
  auctionState.currentLot = null;
  auctionState.currentBidCr = null;
  auctionState.leadingTeamId = null;
  clearInterval(auctionState.roundTimerId);
  auctionState.roundTimerId = null;
  auctionState.roundEndsAtTs = null;
}

function nextAuctionLot() {
  if (!auctionState.pool || auctionState.cursor >= auctionState.pool.length) return null;
  return auctionState.pool[auctionState.cursor++];
}

function remainingByType() {
  const counts = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
  for (let i = auctionState.cursor; i < auctionState.pool.length; i++) {
    counts[auctionState.pool[i].type]++;
  }
  return counts;
}

// Expose minimal controls for testing in console
window.auction = { init: initAuction, next: nextAuctionLot, remainingByType };

// ---------------------
// Bidding and Timer API
// ---------------------
const TIMER_RULES = {
  firstWindowSec: 30, // before first bid
  postBidSec: 45,     // after each bid
  highBidSec: 60,     // when bid >= 10 CR
  highBidThresholdCr: 10.0,
};

function getNowTs() { return Date.now(); }

function scheduleTick() {
  clearInterval(auctionState.roundTimerId);
  auctionState.roundTimerId = setInterval(() => {
    const now = getNowTs();
    if (auctionState.roundEndsAtTs && now >= auctionState.roundEndsAtTs) {
      if (isHost) {
        finalizeCurrentLot();
      }
    }
    // Update bid panel timer every tick
    try { updateBidPanelUI(); } catch (e) {}
  }, 250);
}

// startLot function removed - now handled by startNextLot() which syncs via socket

function resetTimerAfterBid() {
  const dur = (auctionState.currentBidCr >= TIMER_RULES.highBidThresholdCr)
    ? TIMER_RULES.highBidSec
    : TIMER_RULES.postBidSec;
  auctionState.roundEndsAtTs = getNowTs() + dur * 1000;
}

function findTeam(teamId) { return teams.find(t => t.id === teamId); }

function placeBid(bidCr) {
  if (!auctionState.currentLot || !currentTeamId) {
    alert('No active lot or team not set');
    return;
  }
  if (!socket) {
    alert('Not connected to server');
    return;
  }
  // Calculate minimum next bid
  const incrementFor = (amount) => {
    if (amount < 2.0) return 0.10;
    if (amount < 5.0) return 0.20;
    return 0.25;
  };
  const step = incrementFor(auctionState.currentBidCr || 0);
  const minNext = +((auctionState.currentBidCr || 0) + step).toFixed(2);
  
  if (typeof bidCr !== 'number' || Number.isNaN(bidCr)) {
    bidCr = minNext; // Auto-bid minimum increment
  }
  
  if (+(bidCr.toFixed(2)) < minNext) {
    alert(`Minimum next bid is ${minNext.toFixed(2)} CR`);
    return;
  }
  
  socket.emit('place-bid', { roomCode: currentRoomCode, bidCr: +bidCr.toFixed(2) });
}

function finalizeCurrentLot() {
  if (!isHost) return;
  if (!socket || !currentRoomCode) return;
  socket.emit('finalize-lot', { roomCode: currentRoomCode });
}

function getRoundState() {
  const remainingMs = auctionState.roundEndsAtTs ? Math.max(0, auctionState.roundEndsAtTs - getNowTs()) : null;
  return {
    lot: auctionState.currentLot,
    currentBidCr: auctionState.currentBidCr,
    leadingTeamId: auctionState.leadingTeamId,
    endsInMs: remainingMs,
  };
}

// Extend console API
window.auction = {
  init: initAuction,
  next: nextAuctionLot,
  remainingByType,
  startNextLot: startNextLot,
  placeBid: placeBid,
  finalize: finalizeCurrentLot,
  state: getRoundState
};

// ---------------------
// Draw Visual Helpers
// ---------------------
function qs(sel){ return document.querySelector(sel); }
function setText(el, txt){ if(el) el.textContent = txt; }
function setImg(el, src, alt){ if(!el) return; el.innerHTML = `<img src="${src}" alt="${alt}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`; }

let drawAnimTimer = null;
function animateDrawReveal(finalPlayer){
  const root = qs('#draw-visual');
  if(!root) return;
  const nameEl = root.querySelector('.draw-name');
  const typeEl = root.querySelector('.draw-type');
  const imgEl = root.querySelector('.draw-img');
  if (drawAnimTimer) { clearInterval(drawAnimTimer); drawAnimTimer = null; }
  // Start with spinner
  if (imgEl) imgEl.innerHTML = '<div class="spinner"></div>';
  setText(nameEl, 'Drawing…');
  setText(typeEl, '');

  // Cycle a few random candidates for visual effect
  const candidates = PLAYERS_DATA;
  let cycles = 0;
  drawAnimTimer = setInterval(() => {
    cycles++;
    const p = candidates[Math.floor(Math.random()*candidates.length)];
    setText(nameEl, p.name);
    setText(typeEl, `${PLAYER_TYPES[p.type]} • Base ${p.baseCr.toFixed(2)}CR`);
  }, 120);

  // Reveal final after ~1.2s
  setTimeout(() => {
    clearInterval(drawAnimTimer); drawAnimTimer = null;
    setText(nameEl, finalPlayer.name);
    setText(typeEl, `${PLAYER_TYPES[finalPlayer.type]} • Base ${finalPlayer.baseCr.toFixed(2)}CR`);
    setImg(imgEl, finalPlayer.img, finalPlayer.name);
  }, 1200);
}

// ---------------------
// UI Rendering: center and bid panel + players list
// ---------------------
function updateCenterPlayerUI(player){
  const img = document.getElementById('center-player-img');
  const nameEl = document.getElementById('center-player-name');
  const typeEl = document.getElementById('center-player-type');
  const baseEl = document.getElementById('center-player-base');
  if (img) img.src = player.img;
  if (nameEl) nameEl.textContent = player.name;
  if (typeEl) typeEl.textContent = PLAYER_TYPES[player.type] || player.type;
  if (baseEl) baseEl.textContent = `${player.baseCr.toFixed(2)}CR`;
}

function updateBidPanelUI(){
  const bidderEl = document.getElementById('bidder-name');
  const amountEl = document.getElementById('bid-amount');
  const timerEl = document.getElementById('bid-timer');
  if (!auctionState.currentLot) {
    if (bidderEl) bidderEl.textContent = '—';
    if (amountEl) amountEl.textContent = '—';
    if (timerEl) timerEl.textContent = '—';
    return;
  }
  const leader = auctionState.leadingTeamId ? teams.find(t => t.id === auctionState.leadingTeamId) : null;
  if (bidderEl) bidderEl.textContent = leader ? leader.name : '—';
  if (amountEl) amountEl.textContent = `${auctionState.currentBidCr?.toFixed(2)}CR`;
  if (timerEl) {
    const ms = auctionState.roundEndsAtTs ? Math.max(0, auctionState.roundEndsAtTs - getNowTs()) : 0;
    timerEl.textContent = `${Math.ceil(ms/1000)} Sec`;
  }
}

let activeFilter = 'All'; // To keep track of the currently active filter

// Mapping from chip text to player type code
const CHIP_TO_TYPE_MAP = {
  'All': 'All',
  'WK': 'WK',
  'Batsmen': 'BAT',
  'All-Rounder': 'AR',
  'Bowler': 'BOWL'
};

function renderLeftPlayersList(filterType = 'All') {
  const listEl = document.getElementById('left-players-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  const playersToRender = filterType === 'All'
    ? PLAYERS_DATA
    : PLAYERS_DATA.filter(p => p.type === filterType);

  for (const p of playersToRender) {
    const row = document.createElement('div');
    row.className = 'player-item';
    row.style.cursor = 'pointer';
    row.innerHTML = `<img src="${p.img}" alt="${p.name}"><div><b>${p.name}</b><div class="player-meta">${PLAYER_TYPES[p.type]} • Base ${p.baseCr.toFixed(2)}CR</div></div>`;
    row.addEventListener('click', () => {
      updateCenterPlayerUI(p);
    });
    listEl.appendChild(row);
  }
}

function filterPlayers(chipText) {
  const filterType = CHIP_TO_TYPE_MAP[chipText] || 'All';
  activeFilter = chipText; // Store the chip text for UI highlighting
  renderLeftPlayersList(filterType);
  updateFilterChipsUI(); // A new function to update chip highlighting
}

function updateFilterChipsUI() {
  const chips = document.querySelectorAll('.filters .chip');
  chips.forEach(chip => {
    if (chip.textContent === activeFilter) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

function updateTeamCards() {
  const topTeamsContainer = $('top-teams-container');
  if (!topTeamsContainer) return;
  topTeamsContainer.innerHTML = '';

  teams.forEach((team) => {
    // Only display opponent teams in the top bar (not current user's team)
    if (team.id !== currentTeamId) {
      const teamCard = document.createElement('div');
      teamCard.className = 'team';
      teamCard.innerHTML = `<h4>${team.name}</h4><div class="meta"><span>Slots: <strong>${team.players.length}/${MAX_SQUAD_SIZE}</strong></span><span>Purse: <strong>${team.purse.toFixed(2)}CR</strong></span></div>`;
      teamCard.addEventListener('click', () => openTeamDetailsModal(team.id));
      topTeamsContainer.appendChild(teamCard);
    }
  });
}

function updateBottomPanel() {
  const myTeam = teams.find(t => t.id === currentTeamId);
  if (myTeam) {
    $('player-count-display').textContent = myTeam.players.length;
    $('purse-display').textContent = `${myTeam.purse.toFixed(2)}Cr`;
    $('active-team-name').textContent = myTeam.name;
    activeTeamId = currentTeamId;
  }
}

function initializeTeamCards() {
  updateTeamCards();
  updateBottomPanel();
}

function openTeamDetailsModal(teamId) {
  const team = teams.find(t => t.id === teamId);
  if (!team) return;

  // Update modal title
  const modalTeamNameSpan = $('modal-team-name');
  if (modalTeamNameSpan) modalTeamNameSpan.textContent = team.name;

  // Update modal general info (Purse, Total Players) - horizontal layout
  const modalGeneralInfoDiv = $('modal-general-info');
  if (modalGeneralInfoDiv) {
    modalGeneralInfoDiv.innerHTML = `
      <div style="display:flex; justify-content:space-around; align-items:center; background:var(--glass); padding:10px; border-radius:8px;">
        <div style="text-align:center;">
          <span class="info-label" style="font-size:13px;">Team Name</span><br>
          <strong style="color:var(--bright-blue); font-size:16px;">${team.name}</strong>
        </div>
        <div style="text-align:center;">
          <span class="info-label" style="font-size:13px;">Purse Left</span><br>
          <strong style="color:var(--bright-green); font-size:16px;">${team.purse}CR</strong>
        </div>
        <div style="text-align:center;">
          <span class="info-label" style="font-size:13px;">Total Players</span><br>
          <strong style="color:var(--bright-pink); font-size:16px;">${team.players.length}/${MAX_SQUAD_SIZE}</strong>
        </div>
      </div>
    `;
  }

  // Clear and populate player roster by type
  const rosterColumnsContainer = $('modal-roster-columns');
  if (rosterColumnsContainer) {
    rosterColumnsContainer.innerHTML = ''; // Clear previous content
    const playerTypes = { 'WK': [], 'BAT': [], 'AR': [], 'BOWL': [] };

    team.players.forEach(player => {
      if (playerTypes[player.type]) {
        playerTypes[player.type].push(player);
      }
    });

    for (const type in playerTypes) {
      const column = document.createElement('div');
      column.className = 'roster-column panel'; // Re-use panel style
      column.innerHTML = `<h4>${PLAYER_TYPES[type]} (${playerTypes[type].length})</h4>`;

      const playersListContainer = document.createElement('div');
      playersListContainer.className = 'roster-players-list'; // New class for scrollable list

      if (playerTypes[type].length === 0) {
        playersListContainer.innerHTML += `<p class="muted">No ${PLAYER_TYPES[type]} yet.</p>`;
      } else {
        playerTypes[type].forEach(player => {
          playersListContainer.innerHTML += `
            <div class="player-item-small">
              <img src="${player.img}" alt="${player.name}">
              <span>${player.name}</span>
            </div>
          `;
        });
      }
      column.appendChild(playersListContainer);
      rosterColumnsContainer.appendChild(column);
    }
  }

  // Show the modal
  const modal = $('team-details-modal');
  if (modal) modal.style.display = 'flex';
}

function closeTeamDetailsModal() {
  const modal = $('team-details-modal');
  if (modal) modal.style.display = 'none';
}

// Call this function when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM Content Loaded');
  initSocket();
  try { renderLeftPlayersList(); } catch (e) {
    console.error('Error rendering players list:', e);
  }

  // Set up room button event listeners immediately
  const createBtn = $('create-room-btn');
  const joinBtn = $('join-room-btn');
  const startBtn = $('start-auction-btn');
  
  console.log('Buttons found:', { createBtn, joinBtn, startBtn });
  
  if (createBtn) {
    createBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('Create room button clicked');
      createRoom();
    });
  } else {
    console.error('Create room button not found!');
  }
  
  if (joinBtn) {
    joinBtn.addEventListener('click', (e) => {
      e.preventDefault();
      joinRoom();
    });
  }
  
  if (startBtn) {
    startBtn.addEventListener('click', (e) => {
      e.preventDefault();
      startAuction();
    });
    startBtn.disabled = true;
    startBtn.textContent = 'Waiting for players... (0/2)';
  }

  // Bid button
  const bidBtn = $('bid-btn');
  if (bidBtn) {
    bidBtn.addEventListener('click', () => {
      if (!auctionState.currentLot) {
        alert('No active lot to bid on');
        return;
      }
      placeBid(); // Auto-bid minimum increment
    });
  }

  const closeModalBtn = document.querySelector('#team-details-modal .close-btn');
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeTeamDetailsModal);

  const modal = $('team-details-modal');
  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeTeamDetailsModal();
      }
    });
  }

  // Add event listeners for filter chips
  const filterChips = document.querySelectorAll('.filters .chip');
  filterChips.forEach(chip => {
    chip.addEventListener('click', (event) => {
      const chipText = event.target.textContent.trim();
      filterPlayers(chipText);
    });
  });

  // Set initial active filter chip
  updateFilterChipsUI();
  
  // View team button
  const viewTeamButton = $('view-team-btn');
  if (viewTeamButton) {
    viewTeamButton.addEventListener('click', () => {
      if (currentTeamId) {
        openTeamDetailsModal(currentTeamId);
      }
    });
  }
});




