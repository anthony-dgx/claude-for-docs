import type { WebSocket } from 'ws';
import { runAgentQuery } from '../claude/agent.js';

function send(ws: WebSocket, data: Record<string, unknown>) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export function handleConnection(ws: WebSocket) {
  let currentDocId: string | null = null;
  let abortController: AbortController | null = null;

  console.log('[ws] client connected');

  ws.on('message', async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'init': {
        currentDocId = msg.docId;
        console.log(`[ws] init doc: ${currentDocId}`);
        send(ws, { type: 'ready', docId: currentDocId });
        break;
      }

      case 'chat': {
        const docId = msg.docId || currentDocId;
        if (!docId) {
          send(ws, { type: 'error', message: 'No document ID. Send init first.' });
          return;
        }
        currentDocId = docId;

        // Cancel any in-flight query
        abortController?.abort();
        abortController = new AbortController();

        console.log(`[ws] chat: "${msg.message?.substring(0, 80)}..."`);

        try {
          await runAgentQuery({
            docId,
            userMessage: msg.message,
            abortController,
            onStream: (text) => send(ws, { type: 'stream', text }),
            onToolUse: (toolName, input) => {
              console.log(`[ws] tool_use: ${toolName}`);
              send(ws, { type: 'tool_use', toolName, input });
            },
            onToolResult: (toolName, summary) => {
              send(ws, { type: 'tool_result', toolName, summary });
            },
            onDone: (result) => {
              console.log(`[ws] done (cost: $${result.cost.toFixed(4)}, turns: ${result.turns})`);
              send(ws, { type: 'done', ...result });
            },
            onError: (message) => {
              console.error(`[ws] error: ${message}`);
              send(ws, { type: 'error', message });
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[ws] unhandled error: ${message}`);
          send(ws, { type: 'error', message });
        }
        break;
      }

      case 'cancel': {
        console.log('[ws] cancel');
        abortController?.abort();
        abortController = null;
        break;
      }

      default: {
        send(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
      }
    }
  });

  ws.on('close', () => {
    console.log('[ws] client disconnected');
    abortController?.abort();
  });
}
