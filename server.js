const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const http = require('http');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3001;
const API_KEY = 'c0b0ae17e5fc3886ce244878572ff181b3ff15b3';

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
let reconnectTimeout = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

function connectToAISStream() {
    console.log(`🚢 Connecting to AISStream.io... (attempt ${reconnectAttempts + 1})`);
    
    aisStream = new WebSocket('wss://stream.aisstream.io/v0/stream');
    
    aisStream.on('open', () => {
        console.log('✅ Connected to AISStream.io');
        console.log(`📡 Broadcasting to ${wss.clients.size} clients`);
        
        reconnectAttempts = 0; // Reset on successful connection
        
        // Send subscription message - must be within 3 seconds!
        // WORLDWIDE COVERAGE - Track all vessels globally
        const subscriptionMessage = {
            APIKey: API_KEY,
            BoundingBoxes: [
                [[-90, -180], [90, 180]]  // Entire world coverage
            ],
            FilterMessageTypes: ['PositionReport']
        };
        
        console.log('📤 Sending subscription:', JSON.stringify(subscriptionMessage));
        aisStream.send(JSON.stringify(subscriptionMessage));
        console.log('✅ Subscription sent successfully');
        
        // Clear any reconnect timeout
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
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
        console.error('Error code:', error.code);
        console.error('Error type:', error.type);
    });
    
    aisStream.on('close', (code, reason) => {
        console.log(`🔌 AISStream disconnected - Code: ${code}, Reason: ${reason || 'No reason provided'}`);
        
        // Don't reconnect immediately if we've failed too many times
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error(`❌ Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Waiting 60 seconds...`);
            reconnectTimeout = setTimeout(() => {
                reconnectAttempts = 0;
                connectToAISStream();
            }, 60000);
            return;
        }
        
        // Auto-reconnect after delay (exponential backoff)
        const delay = Math.min(5000 * Math.pow(2, reconnectAttempts), 30000);
        console.log(`🔄 Reconnecting in ${delay / 1000} seconds...`);
        
        reconnectAttempts++;
        reconnectTimeout = setTimeout(() => {
            connectToAISStream();
        }, delay);
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
    console.log(`🌍 Monitoring WORLDWIDE vessel traffic`);
    console.log(`🔑 API Key: ${API_KEY.substring(0, 8)}...`);
    
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
