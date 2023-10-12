import * as Obsidian from 'obsidian';

interface EmbeddingResponse {
  usage: {
    total_tokens: number;
  };
  data: Array<{
    embedding: number[];
    index: number;
  }>;
}

/** Requests openai embedding endpoint */
export async function requestEmbedding(
  embedInputs: string[],
  apiKey: string,
  retries = 0,
): Promise<EmbeddingResponse | undefined> {
  if (embedInputs.length === 0) {
    return;
  }
  const usedParams = {
    model: 'text-embedding-ada-002',
    input: embedInputs,
  };
  const reqParams = {
    url: `https://api.openai.com/v1/embeddings`,
    method: 'POST',
    body: JSON.stringify(usedParams),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  };
  try {
    const resp = await (0, Obsidian.request)(reqParams);
    return JSON.parse(resp) as EmbeddingResponse;
  } catch (error: unknown) {
    // retry request if error is 429
    if (!(error instanceof Object) || !('status' in error)) {
      return;
    }
    if (error.status === 429 && retries < 3) {
      retries++;
      // exponential backoff
      const backoff = Math.pow(retries, 2);
      console.log(`retrying request (429) in ${backoff} seconds...`);
      await new Promise((r) => setTimeout(r, 1000 * backoff));
      return await requestEmbedding(embedInputs, apiKey, retries);
    }
    return;
  }
}
