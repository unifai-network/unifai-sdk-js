import { config } from 'dotenv'
import OpenAI from 'openai'
import { Tools } from '../dist'

config({ path: 'examples/.env' })

async function run(
	msg: string,
	options: {
		staticToolkits?: string[]
		staticActions?: string[]
	} = {}
) {
	const { staticToolkits, staticActions } = options
	const tools = new Tools({ apiKey: process.env.UNIFAI_AGENT_API_KEY || '' })
	const openai = new OpenAI({
		apiKey: process.env.ANTHROPIC_API_KEY,
		baseURL: 'https://api.anthropic.com/v1/',
	})

	const systemPrompt = `
You are a personal assistant capable of doing many things with your tools.
When you are given a task you cannot do (like something you don't know,
or requires you to take some action), try find appropriate tools to do it.
`

	const messages: any[] = [
		{ content: systemPrompt, role: 'system' },
		{ content: msg, role: 'user' },
	]

	const availableTools = await tools.getTools({
		dynamicTools: true,
		staticToolkits,
		staticActions,
	})

	while (true) {
		const response = await openai.chat.completions.create({
			model: 'claude-3-7-sonnet-20250219',
			messages,
			tools: availableTools,
		})

		const message = response.choices[0].message

		if (message.content) {
			console.log(message.content)
		}

		messages.push(message)

		if (!message.tool_calls || message.tool_calls.length === 0) {
			break
		}

		console.log(
			'Calling tools: ',
			message.tool_calls?.map(
				(toolCall) =>
					`${toolCall.function.name}(${toolCall.function.arguments})`
			)
		)

		const results = await tools.callTools(message.tool_calls)

		if (results.length === 0) {
			break
		}

		messages.push(...results)
	}
}

if (require.main === module) {
	let staticToolkits: string[] | undefined = [
		'bC5cVCSkocd4mnsPeQLNDTIaw8CUYi5LAsCc56Xgtxy',
	]
	let staticActions: string[] | undefined = [
		'getSolBalance',
		'getSPLBalance',
		'getTxStatus',
		'createSellTransaction',
		'createBuyTransaction',
	]
	let messageArgs: string[] = [
		'check this solana tx status  4a6SLwV5YTdz7pzEhqY4zA3jNXS3aM4JqSaE7p6L9PdLPmsHdD8Kt2dcteWG1gzUuoYsVtbucd7ScUNbLwTbmrNd',
	]

	run(messageArgs.join(' '), { staticToolkits, staticActions }).catch(
		console.error
	)
}

// ## Solana Transaction Status Report

// The transaction with ID `4a6SLwV5YTdz7pzEhqY4zA3jNXS3aM4JqSaE7p6L9PdLPmsHdD8Kt2dcteWG1gzUuoYsVtbucd7ScUNbLwTbmrNd` has been successfully processed on the Solana blockchain.

// ### Transaction Details:
// - **Status**: Successful (confirmed)
// - **Block Time**: 1748914658
// - **Block Slot**: 344241343
// - **Transaction Fee**: 0.000005 SOL (5000 lamports)
// - **Compute Units Consumed**: 35,565

// ### Transaction Operations:
// The transaction included multiple operations:
// 1. Account initialization via the System Program
// 2. Token account initialization
// 3. Token transfers (multiple) via the Token Program
// 4. Account closure

// The transaction involved operations with two tokens:
// - SOL (native Solana token)
// - A SPL token with mint address: BJKoVTcoEzCpnSBbgp951T38uHx5dbRjn4sRBoCzcpeu

// ### Balance Changes:
// One of the wallets involved (5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1):
// - SOL balance increased from 362.057304714 to 362.083136395 SOL
// - Token balance decreased from 138,803.202905 to 138,793.325183 units

// Another address involved (8xHAsQZWsoqku2bGxktw3ra5V3QyH2JFgzsWLVks7soU):
// - Token balance increased from 95,000,482.110892 to 95,000,491.988614 units

// This appears to be a successful token swap or exchange transaction that was executed through a decentralized exchange protocol on Solana.
