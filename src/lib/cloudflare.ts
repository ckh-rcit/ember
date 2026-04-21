import { env } from '$env/dynamic/private';
import type { Snippet, SnippetRule, ZoneSummary } from '$lib/types';

const API_BASE = 'https://api.cloudflare.com/client/v4';

interface CfResponse<T> {
	success: boolean;
	errors?: Array<{ message?: string }>;
	result: T;
	result_info?: {
		page: number;
		per_page: number;
		total_pages: number;
	};
}

function getToken(): string {
	if (!env.CLOUDFLARE_API_TOKEN) {
		throw new Error('Missing CLOUDFLARE_API_TOKEN environment variable.');
	}
	return env.CLOUDFLARE_API_TOKEN;
}

function authHeaders(): HeadersInit {
	return {
		Authorization: `Bearer ${getToken()}`,
		'Content-Type': 'application/json'
	};
}

async function cfFetch<T>(path: string, init?: RequestInit): Promise<CfResponse<T>> {
	const response = await fetch(`${API_BASE}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${getToken()}`,
			...(init?.headers ?? {})
		}
	});

	const data = (await response.json()) as CfResponse<T>;

	if (!response.ok || !data.success) {
		const detail =
			data.errors?.map((e) => e.message).filter(Boolean).join('; ') || 'Cloudflare API error';
		throw new Error(detail);
	}

	return data;
}

// ── Zones ──────────────────────────────────────────────

export async function listZones(): Promise<ZoneSummary[]> {
	let page = 1;
	let totalPages = 1;
	const zones: ZoneSummary[] = [];

	do {
		const data = await cfFetch<Array<{ id: string; name: string }>>(
			`/zones?per_page=100&page=${page}`
		);
		zones.push(...data.result.map((z) => ({ id: z.id, name: z.name })));
		totalPages = data.result_info?.total_pages ?? 1;
		page += 1;
	} while (page <= totalPages);

	return zones.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Snippets ───────────────────────────────────────────

export async function listSnippets(zoneId: string): Promise<Snippet[]> {
	const data = await cfFetch<Snippet[]>(`/zones/${zoneId}/snippets`);
	return data.result;
}

export async function getSnippetContent(zoneId: string, name: string): Promise<string> {
	const response = await fetch(`${API_BASE}/zones/${zoneId}/snippets/${name}/content`, {
		headers: { Authorization: `Bearer ${getToken()}` }
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch snippet content for "${name}"`);
	}

	const contentType = response.headers.get('content-type') ?? '';

	// The API returns multipart/form-data — extract the JS file content
	if (contentType.includes('multipart/form-data')) {
		const formData = await response.formData();
		// Try common field names the API uses
		for (const [, value] of formData.entries()) {
			if (value instanceof Blob) {
				return value.text();
			}
			if (typeof value === 'string') {
				return value;
			}
		}
		throw new Error(`No file content found in multipart response for "${name}"`);
	}

	// Fallback: if it's returned as plain text/JS directly
	return response.text();
}

export async function putSnippet(
	zoneId: string,
	name: string,
	code: string,
	mainModule: string = 'snippet.js'
): Promise<void> {
	const metadata = JSON.stringify({
		main_module: mainModule
	});

	const form = new FormData();
	form.append('metadata', new Blob([metadata], { type: 'application/json' }), 'metadata.json');
	form.append(
		'files',
		new Blob([code], { type: 'application/javascript+module' }),
		mainModule
	);

	const response = await fetch(`${API_BASE}/zones/${zoneId}/snippets/${name}`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${getToken()}` },
		body: form
	});

	if (!response.ok) {
		const data = await response.json().catch(() => ({})) as CfResponse<unknown>;
		const detail =
			data.errors?.map((e) => e.message).filter(Boolean).join('; ') || 'Failed to upload snippet';
		throw new Error(detail);
	}
}

export async function deleteSnippet(zoneId: string, name: string): Promise<void> {
	const response = await fetch(`${API_BASE}/zones/${zoneId}/snippets/${name}`, {
		method: 'DELETE',
		headers: authHeaders()
	});

	if (!response.ok) {
		throw new Error(`Failed to delete snippet "${name}"`);
	}
}

// ── Snippet Rules ──────────────────────────────────────

export async function listSnippetRules(zoneId: string): Promise<SnippetRule[]> {
	const response = await fetch(`${API_BASE}/zones/${zoneId}/snippets/snippet_rules`, {
		headers: authHeaders()
	});

	// Zone has no snippet rules yet — not an error
	if (response.status === 404) {
		return [];
	}

	const data = (await response.json()) as CfResponse<SnippetRule[]>;

	if (!response.ok || !data.success) {
		const detail =
			data.errors?.map((e) => e.message).filter(Boolean).join('; ') || 'Cloudflare API error';
		throw new Error(detail);
	}

	return data.result;
}

export async function putSnippetRules(zoneId: string, rules: SnippetRule[]): Promise<SnippetRule[]> {
	const data = await cfFetch<SnippetRule[]>(`/zones/${zoneId}/snippets/snippet_rules`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ rules })
	});
	return data.result;
}
