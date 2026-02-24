import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { handleConnection } from './ws/handler.js';
import { TokenManager } from './google/token-manager.js';
import { getAllSkillDefs } from './claude/skills-loader.js';
import { CONFIG } from './config.js';

const httpServer = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url === '/status') {
    let tokenStatus = 'unknown';
    let scope = 'unknown';
    try {
      const tm = new TokenManager();
      scope = tm.getScope();
      tokenStatus = 'ok';
    } catch (e) {
      tokenStatus = e instanceof Error ? e.message : 'error';
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        hasApiKey: !!process.env.ANTHROPIC_API_KEY,
        driveToken: tokenStatus,
        driveScope: scope,
      }),
    );
    return;
  }

  if (req.url === '/skills') {
    const skills = getAllSkillDefs().map((s) => ({
      name: s.name,
      description: s.description,
      type: s.type,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(skills));
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });
wss.on('connection', handleConnection);

httpServer.listen(CONFIG.port, () => {
  console.log(`DocPat server running on http://localhost:${CONFIG.port}`);
  console.log(`WebSocket available at ws://localhost:${CONFIG.port}`);
  console.log(`API key: ${process.env.ANTHROPIC_API_KEY ? 'set' : 'NOT SET'}`);
});
