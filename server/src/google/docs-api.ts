import type { TokenManager } from './token-manager.js';

const DOCS_BASE = 'https://docs.googleapis.com/v1';

export class DocsApi {
  constructor(private tokenManager: TokenManager) {}

  private async headers(): Promise<Record<string, string>> {
    const token = await this.tokenManager.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  async getDocument(docId: string): Promise<any> {
    const resp = await fetch(`${DOCS_BASE}/documents/${docId}`, {
      headers: await this.headers(),
    });
    if (!resp.ok) throw new Error(`getDocument failed: ${resp.status} ${await resp.text()}`);
    return resp.json();
  }

  async insertText(docId: string, text: string, index: number): Promise<void> {
    const resp = await fetch(`${DOCS_BASE}/documents/${docId}:batchUpdate`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              location: { index },
              text,
            },
          },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`insertText failed: ${resp.status} ${await resp.text()}`);
  }

  async replaceAllText(
    docId: string,
    find: string,
    replace: string,
    matchCase = true,
  ): Promise<{ occurrencesChanged: number }> {
    const resp = await fetch(`${DOCS_BASE}/documents/${docId}:batchUpdate`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        requests: [
          {
            replaceAllText: {
              containsText: { text: find, matchCase },
              replaceText: replace,
            },
          },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`replaceAllText failed: ${resp.status} ${await resp.text()}`);
    const data = await resp.json();
    return { occurrencesChanged: data.replies?.[0]?.replaceAllText?.occurrencesChanged || 0 };
  }
}
