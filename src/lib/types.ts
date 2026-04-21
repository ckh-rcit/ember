export interface Snippet {
	snippet_name: string;
	created_on: string;
	modified_on: string;
}

export interface SnippetRule {
	id?: string;
	expression: string;
	description: string;
	enabled: boolean;
	snippet_name: string;
	last_updated?: string;
}

export interface ZoneSummary {
	id: string;
	name: string;
}

export interface SnippetWithCode extends Snippet {
	code: string;
}

export interface SnippetExport {
	name: string;
	code: string;
	rule?: {
		expression: string;
		description: string;
		enabled: boolean;
	};
}

export interface EmberExportPayload {
	metadata: {
		zone: string;
		exportedAt: string;
	};
	snippets: SnippetExport[];
}
