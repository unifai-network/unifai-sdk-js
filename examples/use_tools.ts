import OpenAI from 'openai';
import { Tools } from '../dist';

const tools = new Tools({ apiKey: 'YOUR_AGENT_API_KEY' });
const openai = new OpenAI();

const systemPrompt = `
You are a personal assistant capable of doing many things with your tools.
When you are given a task you cannot do (like something you don't know,
or requires you to take some action), try find appropriate tools to do it.
`;

async function run(msg: string) {
  const messages: any[] = [
    { content: systemPrompt, role: 'system' },
    { content: msg, role: 'user' },
  ];

  while (true) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      tools: tools.getTools(),
    });

    const message = response.choices[0].message;

    if (message.content) {
      console.log(message.content);
    }

    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      break;
    }

    console.log(
      'Calling tools: ',
      message.tool_calls?.map(
        toolCall => `${toolCall.function.name}(${toolCall.function.arguments})`
      )
    );

    const results = await tools.callTools(message.tool_calls);

    if (results.length === 0) {
      break;
    }

    messages.push(...results);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Please provide a message');
    process.exit(1);
  }
  const msg = args.join(' ');
  run(msg).catch(console.error);
}
