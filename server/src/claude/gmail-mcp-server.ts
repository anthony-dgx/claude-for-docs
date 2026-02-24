import { tool, createSdkMcpServer } from '@anthropic-ai/claude-code';
import { z } from 'zod';
import type { GmailApi } from '../google/gmail-api.js';

export function createGmailMcpServer(gmailApi: GmailApi) {
  return createSdkMcpServer({
    name: 'gmail',
    version: '1.0.0',
    tools: [
      tool(
        'search_emails',
        'Search emails using Gmail query syntax (e.g. "from:john subject:meeting newer_than:7d", "is:unread", "has:attachment")',
        {
          query: z.string().describe('Gmail search query'),
          maxResults: z.number().optional().describe('Maximum number of results (default: 10)'),
        },
        async (args) => {
          const emails = await gmailApi.searchMessages(args.query, args.maxResults ?? 10);
          const summary = emails.map((e) => ({
            id: e.id,
            threadId: e.threadId,
            from: e.from,
            to: e.to,
            subject: e.subject,
            date: e.date,
            snippet: e.snippet,
            labels: e.labels,
          }));
          return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
        },
      ),

      tool(
        'read_email',
        'Read the full content of a specific email by its message ID',
        { messageId: z.string().describe('Gmail message ID') },
        async (args) => {
          const email = await gmailApi.getMessage(args.messageId);
          return { content: [{ type: 'text' as const, text: JSON.stringify(email, null, 2) }] };
        },
      ),

      tool(
        'read_thread',
        'Read an entire email thread (all messages in the conversation)',
        { threadId: z.string().describe('Gmail thread ID') },
        async (args) => {
          const messages = await gmailApi.getThread(args.threadId);
          return { content: [{ type: 'text' as const, text: JSON.stringify(messages, null, 2) }] };
        },
      ),

      tool(
        'send_email',
        'Send a new email. Use this for composing fresh emails, not for replies.',
        {
          to: z.string().describe('Recipient email address(es), comma-separated'),
          subject: z.string().describe('Email subject line'),
          body: z.string().describe('Email body (plain text)'),
          cc: z.string().optional().describe('CC recipients, comma-separated'),
          bcc: z.string().optional().describe('BCC recipients, comma-separated'),
        },
        async (args) => {
          const email = await gmailApi.sendMessage(args.to, args.subject, args.body, {
            cc: args.cc,
            bcc: args.bcc,
          });
          return { content: [{ type: 'text' as const, text: `Email sent to ${args.to}. ID: ${email.id}` }] };
        },
      ),

      tool(
        'reply_to_email',
        'Reply to an existing email. Keeps the message in the same thread.',
        {
          messageId: z.string().describe('ID of the message to reply to'),
          body: z.string().describe('Reply body (plain text)'),
          replyAll: z.boolean().optional().describe('Reply to all recipients (default: false)'),
        },
        async (args) => {
          // Fetch the original message to get headers for threading
          const original = await gmailApi.getMessage(args.messageId);
          const to = args.replyAll
            ? [original.from, original.to, original.cc].filter(Boolean).join(', ')
            : original.from;
          const subject = original.subject.startsWith('Re:')
            ? original.subject
            : `Re: ${original.subject}`;

          const email = await gmailApi.sendMessage(to, subject, args.body, {
            threadId: original.threadId,
            inReplyTo: args.messageId,
            references: args.messageId,
          });
          return { content: [{ type: 'text' as const, text: `Reply sent. ID: ${email.id}` }] };
        },
      ),

      tool(
        'create_draft',
        'Create a draft email without sending it',
        {
          to: z.string().describe('Recipient email address(es), comma-separated'),
          subject: z.string().describe('Email subject line'),
          body: z.string().describe('Email body (plain text)'),
          cc: z.string().optional().describe('CC recipients, comma-separated'),
          bcc: z.string().optional().describe('BCC recipients, comma-separated'),
        },
        async (args) => {
          const { draftId } = await gmailApi.createDraft(args.to, args.subject, args.body, {
            cc: args.cc,
            bcc: args.bcc,
          });
          return { content: [{ type: 'text' as const, text: `Draft created. Draft ID: ${draftId}` }] };
        },
      ),
    ],
  });
}
