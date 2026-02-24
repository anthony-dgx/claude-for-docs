import type { TokenManager } from './token-manager.js';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';

interface Comment {
  id: string;
  content: string;
  author: { displayName: string };
  createdTime: string;
  resolved: boolean;
  quotedFileContent?: { value: string; mimeType: string };
  replies: Array<{
    content: string;
    author: { displayName: string };
    createdTime: string;
  }>;
}

interface FileMetadata {
  name: string;
  mimeType: string;
  modifiedTime: string;
  owners?: Array<{ displayName: string; emailAddress: string }>;
  lastModifyingUser?: { displayName: string; emailAddress: string };
}

export class DriveApi {
  constructor(private tokenManager: TokenManager) {}

  private async headers(): Promise<Record<string, string>> {
    const token = await this.tokenManager.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  async getFileMetadata(fileId: string): Promise<FileMetadata> {
    const fields = 'name,mimeType,modifiedTime,owners,lastModifyingUser';
    const resp = await fetch(`${DRIVE_BASE}/files/${fileId}?fields=${fields}&supportsAllDrives=true`, {
      headers: await this.headers(),
    });
    if (!resp.ok) throw new Error(`getFileMetadata failed: ${resp.status} ${await resp.text()}`);
    return resp.json();
  }

  async exportAsText(fileId: string): Promise<string> {
    const resp = await fetch(`${DRIVE_BASE}/files/${fileId}/export?mimeType=text/plain`, {
      headers: await this.headers(),
    });
    if (!resp.ok) throw new Error(`exportAsText failed: ${resp.status} ${await resp.text()}`);
    return resp.text();
  }

  async listComments(fileId: string, includeResolved = false): Promise<Comment[]> {
    const fields = 'comments(id,content,author(displayName),createdTime,resolved,quotedFileContent,replies(content,author(displayName),createdTime))';
    const resp = await fetch(
      `${DRIVE_BASE}/files/${fileId}/comments?fields=${fields}&includeDeleted=false&pageSize=100`,
      { headers: await this.headers() },
    );
    if (!resp.ok) throw new Error(`listComments failed: ${resp.status} ${await resp.text()}`);
    const data = await resp.json();
    const comments: Comment[] = data.comments || [];
    if (!includeResolved) {
      return comments.filter((c) => !c.resolved);
    }
    return comments;
  }

  async createComment(fileId: string, content: string, quotedText?: string): Promise<Comment> {
    const body: Record<string, unknown> = { content };
    if (quotedText) {
      body.quotedFileContent = { value: quotedText, mimeType: 'text/plain' };
    }
    const resp = await fetch(`${DRIVE_BASE}/files/${fileId}/comments?fields=id,content,author,createdTime`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`createComment failed: ${resp.status} ${await resp.text()}`);
    return resp.json();
  }

  async replyToComment(fileId: string, commentId: string, content: string) {
    const resp = await fetch(
      `${DRIVE_BASE}/files/${fileId}/comments/${commentId}/replies?fields=id,content,author,createdTime`,
      {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify({ content }),
      },
    );
    if (!resp.ok) throw new Error(`replyToComment failed: ${resp.status} ${await resp.text()}`);
    return resp.json();
  }

  async resolveComment(fileId: string, commentId: string): Promise<void> {
    const resp = await fetch(`${DRIVE_BASE}/files/${fileId}/comments/${commentId}`, {
      method: 'PATCH',
      headers: await this.headers(),
      body: JSON.stringify({ resolved: true }),
    });
    if (!resp.ok) throw new Error(`resolveComment failed: ${resp.status} ${await resp.text()}`);
  }
}
