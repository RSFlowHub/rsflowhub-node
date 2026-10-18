// Next.js App Router route handler: the API key stays on the server.
// .env.local: RSFLOWHUB_API_KEY=rfh_...
import { NextResponse } from 'next/server';
import { RSFlowHub, APIError } from 'rsflowhub';

const client = new RSFlowHub();

export async function POST(request: Request) {
  const { text } = await request.json();

  try {
    const res = await client.ai.sentimentAnalysis({ text });
    return NextResponse.json(res.result);
  } catch (error) {
    if (error instanceof APIError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}
