import { json } from '@sveltejs/kit';
import { listSnippetRules, putSnippetRules } from '$lib/cloudflare';
import type { SnippetRule } from '$lib/types';

export async function GET({ params }: { params: { zoneId: string } }) {
	try {
		const rules = await listSnippetRules(params.zoneId);
		return json({ rules });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unable to load snippet rules';
		return json({ error: message }, { status: 500 });
	}
}

interface PutBody {
	rules: SnippetRule[];
}

export async function PUT({ params, request }: { params: { zoneId: string }; request: Request }) {
	try {
		const body = (await request.json()) as PutBody;

		if (!Array.isArray(body.rules)) {
			return json({ error: 'Request body must include rules array.' }, { status: 400 });
		}

		const rules = await putSnippetRules(params.zoneId, body.rules);
		return json({ rules });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unable to update snippet rules';
		return json({ error: message }, { status: 500 });
	}
}
