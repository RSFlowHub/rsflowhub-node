// Express backend for any frontend (React, Vue, Angular, Svelte, mobile).
// npm install express rsflowhub && RSFLOWHUB_API_KEY=rfh_... node server.mjs
import express from 'express';
import { RSFlowHub, APIError } from 'rsflowhub';

const app = express();
const client = new RSFlowHub();
app.use(express.json());

app.post('/api/summarize', async (req, res) => {
  try {
    const result = await client.ai.textSummarize({ text: req.body.text });
    res.json(result.result);
  } catch (error) {
    if (error instanceof APIError) return res.status(error.status).json({ error: error.message, code: error.code });
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.post('/api/ask', async (req, res) => {
  try {
    const answer = await client.knowledgeBases.ask(process.env.KB_ID, { question: req.body.question });
    res.json(answer.data);
  } catch (error) {
    if (error instanceof APIError) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.listen(3001, () => console.log('API on http://localhost:3001'));
