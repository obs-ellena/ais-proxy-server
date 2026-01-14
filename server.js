const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const http = require('http');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3001;
const API_KEY = 'c0b0ae17e5fc3886ce244878572ff181b3ff15b3';
const ENGLISH_CHANNEL_BBOX = [[-6.0, 48.0], [2.0, 51.5]];

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'running', 
        service: 'AIS Proxy Server',
        clients: wss.clients.size,
        aisConnected: aisStream && aisStream.readyState === WebSocket.OPEN
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server for clients
const wss = new WebSocket.Server({ server });

let aisStream = null;
let reconnectInterval = null;

function connectToAISStream() {
    console.log('🚢 Connecting to AISStream.io...');
    
    aisStream = new WebSocket('wss://stream.aisstream.io/v0/stream');
    
    aisStream.on('open', () => {
        console.log('✅ Connected to AISStream.io');
        console.log(`📡 Broadcasting to ${wss.clients.size} clients`);
        
        const subscriptionMessage = {
            APIKey: API_KEY,
            BoundingBoxes: [ENGLISH_CHANNEL_BBOX],
            FilterMessageTypes: ['PositionReport']
        };
        
        aisStream.send(JSON.stringify(subscriptionMessage));
        console.log('📤 Subscription sent for English Channel');
        
        // Clear any reconnect interval
        if (reconnectInterval) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
        }
    });
    
    aisStream.on('message', (data) => {
        const dataStr = data.toString();
        let messageCount = 0;
        
        // Broadcast to all connected browser clients
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(dataStr);
                messageCount++;
            }
        });
        
        // Log first few messages
        if (!global.aisMessageCount) global.aisMessageCount = 0;
        global.aisMessageCount++;
        
        if (global.aisMessageCount <= 5) {
            console.log(`📨 AIS message #${global.aisMessageCount} → ${messageCount} clients`);
        }
    });
    
    aisStream.on('error', (error) => {
        console.error('❌ AISStream error:', error.message);
    });
    
    aisStream.on('close', () => {
        console.log('🔌 AISStream disconnected');
        
        // Auto-reconnect after 5 seconds
        if (!reconnectInterval) {
            reconnectInterval = setTimeout(() => {
                console.log('🔄 Reconnecting to AISStream...');
                connectToAISStream();
            }, 5000);
        }
    });
}

// Handle client browser connections
wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    console.log(`🌐 Client connected from ${clientIP} (${wss.clients.size} total)`);
    
    // If AIS stream not connected, connect now
    if (!aisStream || aisStream.readyState !== WebSocket.OPEN) {
        connectToAISStream();
    }
    
    ws.on('close', () => {
        console.log(`👋 Client disconnected (${wss.clients.size} remaining)`);
    });
    
    ws.on('error', (error) => {
        console.error('Client WebSocket error:', error.message);
    });
});

// Start the server
server.listen(PORT, () => {
    console.log(`🚀 AIS Proxy Server running on port ${PORT}`);
    console.log(`📍 Monitoring English Channel: ${JSON.stringify(ENGLISH_CHANNEL_BBOX)}`);
    
    // Connect to AIS stream on startup
    connectToAISStream();
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 SIGTERM received, closing server...');
    server.close(() => {
        if (aisStream) aisStream.close();
        process.exit(0);
    });
});
