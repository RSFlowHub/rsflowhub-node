// Cloudflare Workers / Vercel Edge: the SDK only needs fetch.
import { RSFlowHub } from 'rsflowhub';

export default {
  async fetch(request: Request, env: { RSFLOWHUB_API_KEY: string }): Promise<Response> {
    const client = new RSFlowHub({ apiKey: env.RSFLOWHUB_API_KEY });
    const { comment } = (await request.json()) as { comment: string };
    const res = await client.ai.commentModerate({ comment });
    return Response.json(res.result);
  },
};
