// node examples/node-quickstart.mjs   (needs RSFLOWHUB_API_KEY)
import { RSFlowHub, APIError } from 'rsflowhub';

const client = new RSFlowHub();

try {
  const sentiment = await client.ai.sentimentAnalysis({ text: 'Setup took two minutes and support answered right away.' });
  console.log(sentiment.result);

  const translation = await client.ai.translation({ text: 'Thanks for your order!', target_language: 'Spanish' });
  console.log(translation.result);
} catch (error) {
  if (error instanceof APIError) console.error(`${error.code}: ${error.message} (request ${error.requestId})`);
  else throw error;
}
