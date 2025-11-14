# IPL Auction Simulator

A real-time multiplayer IPL auction simulator built with Node.js, Socket.io, and vanilla JavaScript.

## Features

- **Multiplayer Support**: Create or join auction rooms with room codes
- **Real-time Bidding**: Synchronized bidding across all connected clients
- **Player Filtering**: Filter players by type (WK, Batsmen, All-Rounder, Bowler)
- **Team Management**: View your team and opponent teams
- **Dynamic Auction Pool**: Player pool size adjusts based on number of teams (2-6 teams)
- **Bid Timer**: Automatic timer with different durations based on bid amount
- **Team Purse**: All teams start with 0 CR purse

## Setup Instructions

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start the Server**
   ```bash
   npm start
   ```
   The server will run on `http://localhost:3000`

3. **Open the Application**
   - Open `http://localhost:3000` in your browser
   - Create a new room (host) or join an existing room with a room code
   - Enter your team name
   - Host clicks "Start Auction" to begin

## How to Play

### As Host:
1. Click "Create New Room" to generate a room code
2. Enter your team name
3. Share the room code with other players
4. Once all players have joined, click "Start Auction"
5. The auction will automatically start drawing players

### As Player:
1. Enter the room code provided by the host
2. Enter your team name
3. Wait for the host to start the auction
4. Click the "Bid" button to place bids on players

## Game Rules

- **Team Limits**: 2-6 teams per room
- **Player Pool**: Automatically generated based on number of teams
- **Bid Increments**:
  - Below 2.0 CR: +0.10 CR increments
  - 2.0-4.99 CR: +0.20 CR increments
  - 5.0+ CR: +0.25 CR increments
- **Timer**:
  - Initial window: 30 seconds
  - After bid: 45 seconds (or 60 seconds for bids >= 10 CR)
- **Starting Purse**: All teams start with 0 CR

## Project Structure

- `server.js` - Node.js/Express server with Socket.io
- `app.js` - Client-side JavaScript with Socket.io client
- `index.html` - Main HTML structure
- `styles.css` - Styling
- `package.json` - Dependencies and scripts

## Technologies Used

- Node.js
- Express
- Socket.io
- Vanilla JavaScript
- HTML5/CSS3

