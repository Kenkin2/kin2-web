const { systemLogger, securityLogger } = require('../../utils/logger');

/**
 * Initialize WebSocket server
 */
function initializeWebSocket(wss, redisClient) {
  if (!wss || !redisClient) {
    systemLogger.warn('WebSocket initialization skipped: Missing wss or redisClient');
    return;
  }

  // Store connected clients
  const clients = new Map();
  
  // Subscribe to Redis channels for pub/sub
  const subscriber = redisClient.duplicate();
  subscriber.connect();

  wss.on('connection', (ws, req) => {
    const clientId = generateClientId();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Store client
    clients.set(clientId, {
      ws,
      ip,
      userId: null,
      connectedAt: new Date(),
      subscriptions: new Set()
    });

    systemLogger.info(`WebSocket client connected: ${clientId} from ${ip}`);

    // Handle messages
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleWebSocketMessage(clientId, message, clients, subscriber);
      } catch (error) {
        systemLogger.error('WebSocket message error:', error);
        sendError(ws, 'Invalid message format');
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      const client = clients.get(clientId);
      if (client) {
        // Unsubscribe from all Redis channels
        client.subscriptions.forEach(channel => {
          subscriber.unsubscribe(channel);
        });
        
        clients.delete(clientId);
        systemLogger.info(`WebSocket client disconnected: ${clientId}`);
      }
    });

    // Handle errors
    ws.on('error', (error) => {
      systemLogger.error(`WebSocket error for client ${clientId}:`, error);
      clients.delete(clientId);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      clientId,
      timestamp: new Date().toISOString()
    }));
  });

  // Handle Redis pub/sub messages
  subscriber.on('message', (channel, message) => {
    // Broadcast to subscribed clients
    clients.forEach((client) => {
      if (client.subscriptions.has(channel) && client.ws.readyState === 1) {
        try {
          client.ws.send(JSON.stringify({
            type: 'notification',
            channel,
            data: JSON.parse(message),
            timestamp: new Date().toISOString()
          }));
        } catch (error) {
          systemLogger.error('Failed to send WebSocket message:', error);
        }
      }
    });
  });

  // Heartbeat to keep connections alive
  setInterval(() => {
    clients.forEach((client) => {
      if (client.ws.readyState === 1) {
        try {
          client.ws.ping();
        } catch (error) {
          systemLogger.error('WebSocket ping error:', error);
        }
      }
    });
  }, 30000); // Every 30 seconds

  systemLogger.info('✅ WebSocket server initialized');
}

/**
 * Handle WebSocket messages
 */
async function handleWebSocketMessage(clientId, message, clients, subscriber) {
  const client = clients.get(clientId);
  if (!client) return;

  const { type, data } = message;

  switch (type) {
    case 'authenticate':
      await handleAuthentication(client, data, subscriber);
      break;
    
    case 'subscribe':
      await handleSubscribe(client, data, subscriber);
      break;
    
    case 'unsubscribe':
      await handleUnsubscribe(client, data, subscriber);
      break;
    
    case 'ping':
      client.ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      break;
    
    default:
      sendError(client.ws, 'Unknown message type');
  }
}

/**
 * Handle client authentication
 */
async function handleAuthentication(client, data, subscriber) {
  const { token, userId } = data;
  
  // Validate token (simplified - use proper JWT validation)
  if (token && userId) {
    client.userId = userId;
    
    // Subscribe to user-specific channels
    const userChannel = `user:${userId}`;
    await subscriber.subscribe(userChannel);
    client.subscriptions.add(userChannel);
    
    client.ws.send(JSON.stringify({
      type: 'authenticated',
      userId,
      timestamp: new Date().toISOString()
    }));
    
    systemLogger.info(`WebSocket client authenticated: ${userId}`);
  } else {
    sendError(client.ws, 'Authentication failed');
  }
}

/**
 * Handle channel subscription
 */
async function handleSubscribe(client, data, subscriber) {
  const { channels } = data;
  
  if (!Array.isArray(channels)) {
    sendError(client.ws, 'Channels must be an array');
    return;
  }
  
  for (const channel of channels) {
    await subscriber.subscribe(channel);
    client.subscriptions.add(channel);
  }
  
  client.ws.send(JSON.stringify({
    type: 'subscribed',
    channels,
    timestamp: new Date().toISOString()
  }));
}

/**
 * Handle channel unsubscription
 */
async function handleUnsubscribe(client, data, subscriber) {
  const { channels } = data;
  
  if (!Array.isArray(channels)) {
    sendError(client.ws, 'Channels must be an array');
    return;
  }
  
  for (const channel of channels) {
    await subscriber.unsubscribe(channel);
    client.subscriptions.delete(channel);
  }
  
  client.ws.send(JSON.stringify({
    type: 'unsubscribed',
    channels,
    timestamp: new Date().toISOString()
  }));
}

/**
 * Send error message
 */
function sendError(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'error',
      message,
      timestamp: new Date().toISOString()
    }));
  }
}

/**
 * Generate unique client ID
 */
function generateClientId() {
  return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Broadcast message to all connected clients
 */
function broadcast(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(message));
    }
  });
}

/**
 * Send message to specific user
 */
function sendToUser(userId, message) {
  // This would require maintaining a mapping of userId to WebSocket connections
  // Implement based on your needs
}

module.exports = {
  initializeWebSocket,
  broadcast,
  sendToUser
};
