import { json } from '@sveltejs/kit';
import { getSnippetContent, putSnippet, deleteSnippet } from '$lib/cloudflare';

export async function GET({ params }: { params: { zoneId: string; name: string } }) {
	try {
		const code = await getSnippetContent(params.zoneId, params.name);
		return json({ code });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unable to load snippet content';
		return json({ error: message }, { status: 500 });
	}
}

interface PutBody {
	code: string;
}

export async function PUT({ params, request }: { params: { zoneId: string; name: string }; request: Request }) {
	try {
		const body = (await request.json()) as PutBody;

		if (!body.code || typeof body.code !== 'string') {
			return json({ error: 'Snippet code is required.' }, { status: 400 });
		}

		await putSnippet(params.zoneId, params.name, body.code);
		return json({ ok: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unable to update snippet';
		return json({ error: message }, { status: 500 });
	}
}

export async function DELETE({ params }: { params: { zoneId: string; name: string } }) {
	try {
		await deleteSnippet(params.zoneId, params.name);
		return json({ ok: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unable to delete snippet';
		return json({ error: message }, { status: 500 });
	}
}
