import { NextResponse } from 'next/server';
import { SERVER_ENV } from '@/lib/serverEnv';
import { filterRequestHeadersAndInjectAuth } from '@/lib/auth/http';

interface EmbedRequest {
  entries: any[];
  collection_name: string;
  model_id: string;
  model_provider: string;
  key_path?: string[];
  value_path?: string[];
}

interface EmbedResponse {
  success: boolean;
  collection_name?: string;
  vectors_count?: number;
  error?: string;
  message?: string;
}

export async function POST(request: Request) {
  try {
    const body: any = await request.json();
    console.log(
      '[Vector Embed Proxy] 📥 Received request from CloudTemplateLoader:',
      {
        hasEntries: !!body.entries,
        entriesLength: body.entries?.length,
        set_name: body.set_name,
        user_id: body.user_id,
      }
    );

    // Build PuppyStorage API URL
    const storageUrl = `${SERVER_ENV.PUPPY_STORAGE_BACKEND}/vector/embed`;
    console.log('[Vector Embed Proxy] 🎯 Target PuppyStorage URL:', storageUrl);

    // Filter and inject auth headers
    const headers = filterRequestHeadersAndInjectAuth(
      request,
      request.headers,
      {
        includeServiceKey: true,
        localFallback: true,
      }
    );
    console.log(
      '[Vector Embed Proxy] 🔑 Auth headers prepared:',
      Object.keys(headers)
    );

    // Transform PuppyFlow format to PuppyStorage format
    // PuppyFlow uses: { entries, model, set_name, vdb_type, user_id?, create_new? }
    // PuppyStorage expects: { chunks: [{content, metadata}], model, set_name, vdb_type, user_id }
    const storagePayload = {
      chunks: (body.entries || []).map((entry: any) => {
        // If entry already has {content, metadata} structure, use it directly
        if (entry && typeof entry === 'object' && 'content' in entry) {
          return {
            content: entry.content,
            metadata: entry.metadata || {},
          };
        }
        // Otherwise, treat entry as raw content
        return {
          content: typeof entry === 'string' ? entry : JSON.stringify(entry),
          metadata: {},
        };
      }),
      set_name: body.set_name,
      model: body.model || 'text-embedding-ada-002',
      vdb_type: body.vdb_type || 'pgvector',
      user_id: body.user_id || 'public',
    };

    console.log('[Vector Embed Proxy] 📤 Sending to PuppyStorage:', {
      url: storageUrl,
      chunksCount: storagePayload.chunks.length,
      set_name: storagePayload.set_name,
      model: storagePayload.model,
      vdb_type: storagePayload.vdb_type,
      user_id: storagePayload.user_id,
      firstChunkPreview: storagePayload.chunks[0]?.content?.substring(0, 100),
    });

    // Proxy to PuppyStorage
    const response = await fetch(storageUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(storagePayload),
    });

    console.log(
      '[Vector Embed Proxy] 📥 PuppyStorage response status:',
      response.status
    );

    const data: EmbedResponse = await response.json();

    if (!response.ok) {
      console.error('[Vector Embed Proxy] Embedding failed:', data);
      return NextResponse.json(data, { status: response.status });
    }

    console.log('[Vector Embed Proxy] Embedding succeeded:', {
      collection: data.collection_name,
      vectorsCount: data.vectors_count,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error('[Vector Embed Proxy] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'VECTOR_EMBED_ERROR',
        message: error instanceof Error ? error.message : 'Embedding failed',
      },
      { status: 500 }
    );
  }
}
