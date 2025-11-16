import { config } from 'dotenv';
import OpenAI from 'openai';
import { Tools } from '../dist';

config({ path: 'examples/.env' });

async function run(
  msg: string, 
  options: { 
    staticToolkits?: string[],
    staticActions?: string[] 
  } = {}
) {
  const { staticToolkits, staticActions } = options;
  const tools = new Tools({ apiKey: process.env.UNIFAI_AGENT_API_KEY || '' });
  const openai = new OpenAI({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: 'https://api.anthropic.com/v1/',
  });

  const systemPrompt = `
You are a personal assistant capable of doing many things with your tools.
When you are given a task you cannot do (like something you don't know,
or requires you to take some action), try find appropriate tools to do it.
`;

  const messages: any[] = [
    { content: systemPrompt, role: 'system' },
    { content: msg, role: 'user' },
  ];

  const availableTools = await tools.getTools({
    dynamicTools: true,
    staticToolkits,
    staticActions,
  });

  while (true) {
    const response = await openai.chat.completions.create({
      model: 'claude-sonnet-4-5',
      messages,
      tools: availableTools,
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
  let staticToolkits: string[] | undefined = undefined;
  let staticActions: string[] | undefined = undefined;
  let messageArgs: string[] = [];

  args.forEach(arg => {
    if (arg.startsWith('--toolkit=')) {
      staticToolkits = arg.slice('--toolkit='.length).split(',');
    } else if (arg.startsWith('--action=')) {
      staticActions = arg.slice('--action='.length).split(',');
    } else {
      messageArgs.push(arg);
    }
  });

  if (messageArgs.length === 0 && !staticToolkits && !staticActions) {
    console.log('Usage: npm run use-tools [--toolkit=ID] [--action=ACTION] [your message here]');
    process.exit(1);
  }

  const msg = messageArgs.join(' ');
  run(msg, { staticToolkits, staticActions }).catch(console.error);
}
