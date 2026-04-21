import { json } from '@sveltejs/kit';
import {
	getSnippetContent,
	putSnippet,
	deleteSnippet,
	listSnippetRules,
	putSnippetRules
} from '$lib/cloudflare';

interface RenameBody {
	newName: string;
}

export async function POST({
	params,
	request
}: {
	params: { zoneId: string; name: string };
	request: Request;
}) {
	try {
		const body = (await request.json()) as RenameBody;
		const newName = body.newName?.trim();

		if (!newName) {
			return json({ error: 'New name is required.' }, { status: 400 });
		}
		if (!/^[A-Za-z0-9_]+$/.test(newName)) {
			return json(
				{ error: 'Only letters, numbers, and underscores allowed.' },
				{ status: 400 }
			);
		}
		if (newName === params.name) {
			return json({ error: 'New name is the same as the current name.' }, { status: 400 });
		}

		// 1. Get the existing snippet code
		const code = await getSnippetContent(params.zoneId, params.name);

		// 2. Create a new snippet with the new name
		await putSnippet(params.zoneId, newName, code);

		// 3. Update any rules that reference the old name
		const rules = await listSnippetRules(params.zoneId);
		const hasMatchingRule = rules.some((r) => r.snippet_name === params.name);
		if (hasMatchingRule) {
			const updatedRules = rules.map((r) =>
				r.snippet_name === params.name ? { ...r, snippet_name: newName } : r
			);
			await putSnippetRules(params.zoneId, updatedRules);
		}

		// 4. Delete the old snippet
		await deleteSnippet(params.zoneId, params.name);

		return json({ ok: true, newName });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unable to rename snippet';
		return json({ error: message }, { status: 500 });
	}
}
