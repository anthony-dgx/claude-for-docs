import { tool, createSdkMcpServer } from '@anthropic-ai/claude-code';
import { z } from 'zod';
import type { DriveApi } from '../google/drive-api.js';
import type { DocsApi } from '../google/docs-api.js';

export function createGDocsMcpServer(driveApi: DriveApi, docsApi: DocsApi) {
  return createSdkMcpServer({
    name: 'gdocs',
    version: '1.0.0',
    tools: [
      tool(
        'get_doc_content',
        'Get the full text content of a Google Doc',
        { docId: z.string().describe('Google Doc file ID') },
        async (args) => {
          const text = await driveApi.exportAsText(args.docId);
          return { content: [{ type: 'text' as const, text }] };
        },
      ),

      tool(
        'get_doc_structure',
        'Get the structured JSON representation of a Google Doc (paragraphs, headings, tables)',
        { docId: z.string().describe('Google Doc file ID') },
        async (args) => {
          const doc = await docsApi.getDocument(args.docId);
          return { content: [{ type: 'text' as const, text: JSON.stringify(doc, null, 2) }] };
        },
      ),

      tool(
        'get_doc_metadata',
        'Get metadata about a Google Doc (title, owner, last modified)',
        { docId: z.string().describe('Google Doc file ID') },
        async (args) => {
          const metadata = await driveApi.getFileMetadata(args.docId);
          return { content: [{ type: 'text' as const, text: JSON.stringify(metadata, null, 2) }] };
        },
      ),

      tool(
        'list_comments',
        'List all comments on a Google Doc, including replies and quoted text',
        {
          docId: z.string().describe('Google Doc file ID'),
          includeResolved: z.boolean().optional().describe('Include resolved comments (default: false)'),
        },
        async (args) => {
          const comments = await driveApi.listComments(args.docId, args.includeResolved ?? false);
          return { content: [{ type: 'text' as const, text: JSON.stringify(comments, null, 2) }] };
        },
      ),

      tool(
        'add_comment',
        'Add a new comment to a Google Doc. Optionally anchor it to specific text in the document.',
        {
          docId: z.string().describe('Google Doc file ID'),
          content: z.string().describe('Comment text'),
          quotedText: z.string().optional().describe('Exact text in the doc to anchor this comment to'),
        },
        async (args) => {
          const comment = await driveApi.createComment(args.docId, args.content, args.quotedText);
          return { content: [{ type: 'text' as const, text: `Comment created: ${JSON.stringify(comment)}` }] };
        },
      ),

      tool(
        'reply_to_comment',
        'Reply to an existing comment on a Google Doc',
        {
          docId: z.string().describe('Google Doc file ID'),
          commentId: z.string().describe('ID of the comment to reply to'),
          content: z.string().describe('Reply text'),
        },
        async (args) => {
          const reply = await driveApi.replyToComment(args.docId, args.commentId, args.content);
          return { content: [{ type: 'text' as const, text: `Reply added: ${JSON.stringify(reply)}` }] };
        },
      ),

      tool(
        'resolve_comment',
        'Mark a comment as resolved on a Google Doc',
        {
          docId: z.string().describe('Google Doc file ID'),
          commentId: z.string().describe('ID of the comment to resolve'),
        },
        async (args) => {
          await driveApi.resolveComment(args.docId, args.commentId);
          return { content: [{ type: 'text' as const, text: 'Comment resolved.' }] };
        },
      ),

      tool(
        'insert_text',
        'Insert text at a specific position in a Google Doc',
        {
          docId: z.string().describe('Google Doc file ID'),
          text: z.string().describe('Text to insert'),
          index: z.number().describe('Character index (1-based) where to insert'),
        },
        async (args) => {
          await docsApi.insertText(args.docId, args.text, args.index);
          return { content: [{ type: 'text' as const, text: `Inserted text at index ${args.index}` }] };
        },
      ),

      tool(
        'replace_text',
        'Find and replace text in a Google Doc',
        {
          docId: z.string().describe('Google Doc file ID'),
          find: z.string().describe('Text to find'),
          replace: z.string().describe('Replacement text'),
          matchCase: z.boolean().optional().describe('Case-sensitive match (default: true)'),
        },
        async (args) => {
          const result = await docsApi.replaceAllText(args.docId, args.find, args.replace, args.matchCase ?? true);
          return {
            content: [{ type: 'text' as const, text: `Replaced ${result.occurrencesChanged} occurrence(s)` }],
          };
        },
      ),

      tool(
        'append_text',
        'Append text to the end of a Google Doc',
        {
          docId: z.string().describe('Google Doc file ID'),
          text: z.string().describe('Text to append'),
        },
        async (args) => {
          const doc = await docsApi.getDocument(args.docId);
          const bodyContent = doc.body?.content;
          if (!bodyContent || bodyContent.length === 0) {
            return { content: [{ type: 'text' as const, text: 'Error: document body is empty' }] };
          }
          const endIndex = bodyContent[bodyContent.length - 1].endIndex - 1;
          await docsApi.insertText(args.docId, args.text, endIndex);
          return { content: [{ type: 'text' as const, text: 'Text appended to document.' }] };
        },
      ),
    ],
  });
}
