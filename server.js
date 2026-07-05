const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static files from "tools" or "public" if they exist, otherwise fallback to root directory
let publicDir = __dirname;
if (fs.existsSync(path.join(__dirname, 'tools'))) {
    publicDir = path.join(__dirname, 'tools');
} else if (fs.existsSync(path.join(__dirname, 'public'))) {
    publicDir = path.join(__dirname, 'public');
}

app.use(express.static(publicDir));

// Fallback routing for support console or client direct links
app.get('/room/:roomId', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

// Store active rooms and their connected peers
// Structure: { roomId: { agent: WebSocket, client: WebSocket } }
const rooms = new Map();

wss.on('connection', (ws) => {
    let currentRoomId = null;
    let currentRole = null; // 'agent' or 'client'

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const { type, roomId, role, payload } = data;

            switch (type) {
                case 'join':
                    currentRoomId = roomId;
                    currentRole = role;

                    if (!rooms.has(roomId)) {
                        rooms.set(roomId, { agent: null, client: null });
                    }

                    const room = rooms.get(roomId);
                    room[role] = ws;

                    console.log(`[Room ${roomId}] ${role} connected.`);

                    // Notify the other peer if they are already in the room
                    const otherRole = role === 'agent' ? 'client' : 'agent';
                    if (room[otherRole]) {
                        // Send peer_joined to both to initiate WebRTC connection
                        ws.send(JSON.stringify({ type: 'peer_status', status: 'connected', otherRole }));
                        room[otherRole].send(JSON.stringify({ type: 'peer_status', status: 'connected', otherRole: role }));
                    } else {
                        ws.send(JSON.stringify({ type: 'peer_status', status: 'waiting' }));
                    }
                    break;

                case 'signal':
                    // Relay SDP offers, answers, and ICE candidates to the other peer in the room
                    if (currentRoomId && rooms.has(currentRoomId)) {
                        const activeRoom = rooms.get(currentRoomId);
                        const recipientRole = currentRole === 'agent' ? 'client' : 'agent';
                        const recipientSocket = activeRoom[recipientRole];

                        if (recipientSocket && recipientSocket.readyState === WebSocket.OPEN) {
                            recipientSocket.send(JSON.stringify({
                                type: 'signal',
                                senderRole: currentRole,
                                payload
                            }));
                        }
                    }
                    break;

                default:
                    console.warn(`Unknown message type: ${type}`);
            }
        } catch (error) {
            console.error('Error handling WebSocket message:', error);
        }
    });

    ws.on('close', () => {
        if (currentRoomId && rooms.has(currentRoomId)) {
            const room = rooms.get(currentRoomId);
            console.log(`[Room ${currentRoomId}] ${currentRole} disconnected.`);

            // Clear the disconnected peer from the room map
            room[currentRole] = null;

            // Notify the other peer that this peer left
            const otherRole = currentRole === 'agent' ? 'client' : 'agent';
            const otherSocket = room[otherRole];
            if (otherSocket && otherSocket.readyState === WebSocket.OPEN) {
                otherSocket.send(JSON.stringify({
                    type: 'peer_status',
                    status: 'disconnected',
                    otherRole: currentRole
                }));
            }

            // Clean up room if empty
            if (!room.agent && !room.client) {
                rooms.delete(currentRoomId);
                console.log(`[Room ${currentRoomId}] cleaned up and deleted.`);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(` Tawfeeq Assist Server is running on port ${PORT}`);
    console.log(` Local address: http://localhost:${PORT}`);
    console.log(`==================================================`);
});
