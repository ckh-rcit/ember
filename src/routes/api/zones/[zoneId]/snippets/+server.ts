import { json } from '@sveltejs/kit';
import { listSnippets, putSnippet } from '$lib/cloudflare';

export async function GET({ params }: { params: { zoneId: string } }) {
	try {
		const snippets = await listSnippets(params.zoneId);
		return json({ snippets });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unable to load snippets';
		return json({ error: message }, { status: 500 });
	}
}

interface PostBody {
	name: string;
	code: string;
}

export async function POST({ params, request }: { params: { zoneId: string }; request: Request }) {
	try {
		const body = (await request.json()) as PostBody;

		if (!body.name || typeof body.name !== 'string') {
			return json({ error: 'Snippet name is required.' }, { status: 400 });
		}

		if (!/^[A-Za-z0-9_]+$/.test(body.name)) {
			return json(
				{ error: 'Snippet name must contain only letters, numbers, and underscores.' },
				{ status: 400 }
			);
		}

		if (!body.code || typeof body.code !== 'string') {
			return json({ error: 'Snippet code is required.' }, { status: 400 });
		}

		await putSnippet(params.zoneId, body.name, body.code);
		return json({ ok: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unable to create snippet';
		return json({ error: message }, { status: 500 });
	}
}
