import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-code';
import { createGDocsMcpServer } from './gdocs-mcp-server.js';
import { buildSystemPrompt } from './system-prompt.js';
import { DriveApi } from '../google/drive-api.js';
import { DocsApi } from '../google/docs-api.js';
import { TokenManager } from '../google/token-manager.js';
import { CONFIG } from '../config.js';

const tokenManager = new TokenManager();
const driveApi = new DriveApi(tokenManager);
const docsApi = new DocsApi(tokenManager);

export interface AgentQueryParams {
  docId: string;
  userMessage: string;
  abortController: AbortController;
  onStream: (text: string) => void;
  onToolUse: (toolName: string, input: Record<string, unknown>) => void;
  onToolResult: (toolName: string, summary: string) => void;
  onDone: (result: { text: string; cost: number; turns: number }) => void;
  onError: (message: string) => void;
}

export async function runAgentQuery(params: AgentQueryParams) {
  const { docId, userMessage, abortController, onStream, onToolUse, onToolResult, onDone, onError } = params;

  const gdocsMcp = createGDocsMcpServer(driveApi, docsApi);

  const options: Options = {
    abortController,
    cwd: CONFIG.personalOsPath,
    appendSystemPrompt: buildSystemPrompt(docId),
    mcpServers: {
      gdocs: gdocsMcp,
    },
    allowedTools: [
      'mcp__gdocs__get_doc_content',
      'mcp__gdocs__get_doc_structure',
      'mcp__gdocs__get_doc_metadata',
      'mcp__gdocs__list_comments',
      'mcp__gdocs__add_comment',
      'mcp__gdocs__reply_to_comment',
      'mcp__gdocs__resolve_comment',
      'mcp__gdocs__insert_text',
      'mcp__gdocs__replace_text',
      'mcp__gdocs__append_text',
      'Read',
      'Glob',
      'Grep',
      'WebSearch',
      'WebFetch',
    ],
    additionalDirectories: [CONFIG.personalOsPath],
    permissionMode: 'bypassPermissions',
    includePartialMessages: true,
    maxTurns: CONFIG.maxTurns,
    model: CONFIG.model,
  };

  try {
    for await (const message of query({ prompt: userMessage, options })) {
      if (abortController.signal.aborted) break;

      switch (message.type) {
        case 'stream_event': {
          const event = message.event;
          if (event.type === 'content_block_delta' && 'delta' in event) {
            const delta = event.delta as any;
            if (delta.type === 'text_delta' && delta.text) {
              onStream(delta.text);
            }
          }
          break;
        }

        case 'assistant': {
          // Check for tool use blocks
          if (message.message?.content) {
            for (const block of message.message.content) {
              if (block.type === 'tool_use') {
                onToolUse(block.name, block.input as Record<string, unknown>);
              }
            }
          }
          break;
        }

        case 'result': {
          if (message.subtype === 'success') {
            onDone({
              text: message.result,
              cost: message.total_cost_usd,
              turns: message.num_turns,
            });
          } else {
            onError(`Agent stopped: ${message.subtype}`);
          }
          break;
        }
      }
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }
}
