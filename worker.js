// ZapCall Signaling Server - Cloudflare Worker Implementation

// Store active rooms and clients using Cloudflare's Durable Objects
// For simplicity in this example, we'll use in-memory storage
// In production, you should use Durable Objects for persistence
const rooms = new Map();

// Helper function to send message to a specific client
function sendToClient(webSocket, message) {
  if (webSocket.readyState === WebSocket.READY_STATE_OPEN) {
    webSocket.send(JSON.stringify(message));
  }
}

// Helper function to broadcast to all clients in a room except sender
function broadcastToRoom(roomId, message, excludeSocketId) {
  if (rooms.has(roomId)) {
    const room = rooms.get(roomId);
    room.forEach((client, userId) => {
      if (client.socketId !== excludeSocketId) {
        sendToClient(client.socket, message);
      }
    });
  }
}

addEventListener('fetch', event => {
  if (event.request.headers.get('Upgrade') === 'websocket') {
    return event.respondWith(handleWebSocket(event));
  } else {
    // Handle HTTP requests - could serve static files or API endpoints
    return event.respondWith(handleHttpRequest(event.request));
  }
});

async function handleWebSocket(event) {
  const upgradeHeader = event.request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }

  // Accept the WebSocket connection
  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);
  
  // Generate a unique socket ID
  const socketId = 'socket_' + Math.random().toString(36).substr(2, 9);
  
  // Handle WebSocket connection
  server.accept();
  
  // Send initial connection acknowledgment
  sendToClient(server, { type: 'connected' });
  
  // Set up event handlers for the WebSocket
  server.addEventListener('message', async event => {
    try {
      const message = JSON.parse(event.data);
      
      // Handle different message types
      switch (message.type) {
        case 'join-room':
          handleJoinRoom(server, socketId, message);
          break;
        case 'leave-room':
          handleLeaveRoom(server, socketId, message);
          break;
        case 'offer':
          handleOffer(server, socketId, message);
          break;
        case 'answer':
          handleAnswer(server, socketId, message);
          break;
        case 'ice-candidate':
          handleIceCandidate(server, socketId, message);
          break;
        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  });
  
  // Handle WebSocket closure
  server.addEventListener('close', event => {
    // Find and remove client from any rooms they were in
    rooms.forEach((clients, roomId) => {
      clients.forEach((client, userId) => {
        if (client.socketId === socketId) {
          handleLeaveRoom(server, socketId, { 
            roomId: roomId, 
            userId: userId 
          });
        }
      });
    });
  });
  
  return new Response(null, {
    status: 101,
    webSocket: client
  });
}

function handleJoinRoom(socket, socketId, data) {
  const { roomId, userId } = data;
  
  // Create room if it doesn't exist
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Map());
  }
  
  const room = rooms.get(roomId);
  
  // Add client to room
  room.set(userId, { 
    socket: socket, 
    socketId: socketId 
  });
  
  console.log(`User ${userId} joined room ${roomId}`);
  console.log(`Room ${roomId} has ${room.size} participants`);
  
  // Notify other peers in the room
  broadcastToRoom(roomId, {
    type: 'peer-joined',
    roomId: roomId,
    userId: userId
  }, socketId);
}

function handleLeaveRoom(socket, socketId, data) {
  const { roomId, userId } = data;
  
  if (rooms.has(roomId)) {
    const room = rooms.get(roomId);
    
    // Remove client from room
    room.delete(userId);
    
    console.log(`User ${userId} left room ${roomId}`);
    console.log(`Room ${roomId} has ${room.size} participants`);
    
    // Notify other peers in the room
    broadcastToRoom(roomId, {
      type: 'peer-left',
      roomId: roomId,
      userId: userId
    }, socketId);
    
    // Remove room if empty
    if (room.size === 0) {
      rooms.delete(roomId);
      console.log(`Room ${roomId} removed (empty)`);
    }
  }
}

function handleOffer(socket, socketId, data) {
  broadcastToRoom(data.roomId, {
    type: 'offer',
    sender: data.sender,
    offer: data.offer
  }, socketId);
}

function handleAnswer(socket, socketId, data) {
  broadcastToRoom(data.roomId, {
    type: 'answer',
    sender: data.sender,
    answer: data.answer
  }, socketId);
}

function handleIceCandidate(socket, socketId, data) {
  broadcastToRoom(data.roomId, {
    type: 'ice-candidate',
    sender: data.sender,
    candidate: data.candidate
  }, socketId);
}

async function handleHttpRequest(request) {
  // Handle CORS for HTTP requests
  if (request.method === 'OPTIONS') {
    return handleCORS(request);
  }
  
  // Return a simple status page
  return new Response('ZapCall Signaling Server - Cloudflare Worker', {
    headers: {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

function handleCORS(request) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}