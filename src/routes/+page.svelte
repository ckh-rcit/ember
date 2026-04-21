<script lang="ts">
	import { onMount } from 'svelte';
	import CodeEditor from '$lib/components/CodeEditor.svelte';
	import type { Snippet, SnippetRule, ZoneSummary, EmberExportPayload, SnippetExport } from '$lib/types';

	type Tab = 'manage' | 'create';
	type RuleScope = 'all' | 'custom';
	type ExpressionView = 'simple' | 'expression';

	interface MatchFieldOption {
		label: string;
		value: string;
	}

	interface MatchOperatorOption {
		label: string;
		value: string;
		expressionOp: string;
		negated?: boolean;
		fn?: boolean;
	}

	interface SimpleCondition {
		id: number;
		join: 'and' | 'or';
		field: string;
		operator: string;
		value: string;
	}

	const MATCH_FIELDS: MatchFieldOption[] = [
		{ label: 'URI Full', value: 'http.request.full_uri' },
		{ label: 'URI', value: 'http.request.uri' },
		{ label: 'URI Path', value: 'http.request.uri.path' },
		{ label: 'URI Query String', value: 'http.request.uri.query' },
		{ label: 'Hostname', value: 'http.host' },
		{ label: 'User Agent', value: 'http.user_agent' },
		{ label: 'Referer', value: 'http.referer' },
		{ label: 'Request Method', value: 'http.request.method' },
		{ label: 'IP Source Address', value: 'ip.src' },
		{ label: 'Country', value: 'ip.src.country' },
		{ label: 'Cookie', value: 'http.cookie' },
		{ label: 'HTTP Version', value: 'http.request.version' },
		{ label: 'X-Forwarded-For', value: 'http.x_forwarded_for' },
	];

	const MATCH_OPERATORS: MatchOperatorOption[] = [
		{ label: 'equals', value: 'equals', expressionOp: 'eq' },
		{ label: 'does not equal', value: 'not_equals', expressionOp: 'ne' },
		{ label: 'contains', value: 'contains', expressionOp: 'contains' },
		{ label: 'does not contain', value: 'not_contains', expressionOp: 'contains', negated: true },
		{ label: 'matches regex', value: 'matches_regex', expressionOp: 'matches' },
		{ label: 'starts with', value: 'starts_with', expressionOp: 'starts_with', fn: true },
		{ label: 'ends with', value: 'ends_with', expressionOp: 'ends_with', fn: true },
		{ label: 'wildcard', value: 'wildcard', expressionOp: 'wildcard' },
	];

	let conditionSeed = 0;
	function nextConditionId(): number {
		conditionSeed += 1;
		return conditionSeed;
	}

	function defaultCondition(join: 'and' | 'or' = 'and'): SimpleCondition {
		return { id: nextConditionId(), join, field: 'http.request.full_uri', operator: 'equals', value: '' };
	}

	function escapeExpressionValue(input: string): string {
		return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
	}

	function buildClauseFromCondition(c: SimpleCondition): string {
		const escaped = escapeExpressionValue(c.value);
		const op = MATCH_OPERATORS.find((o) => o.value === c.operator);
		if (!op) return `(${c.field} eq "${escaped}")`;

		if (op.fn) {
			return `(${op.expressionOp}(${c.field}, "${escaped}"))`;
		}
		if (op.negated) {
			return `(not ${c.field} ${op.expressionOp} "${escaped}")`;
		}
		if (op.value === 'matches_regex' || op.value === 'wildcard') {
			return `(${c.field} ${op.expressionOp} r"${escaped}")`;
		}
		return `(${c.field} ${op.expressionOp} "${escaped}")`;
	}

	function buildExpressionFromConditions(conditions: SimpleCondition[]): string {
		return conditions
			.map((c, i) => {
				const clause = buildClauseFromCondition(c);
				if (i === 0) return clause;
				return `${c.join} ${clause}`;
			})
			.join(' ');
	}

	function detectRuleScope(expression: string): RuleScope {
		return expression.trim() === 'true' ? 'all' : 'custom';
	}

	function displayExpression(expression: string): string {
		return expression.trim() === 'true' ? 'All incoming requests' : expression;
	}

	interface ApiError {
		error?: string;
	}

	interface ZonesResponse extends ApiError {
		zones: ZoneSummary[];
	}

	interface SnippetsResponse extends ApiError {
		snippets: Snippet[];
	}

	interface RulesResponse extends ApiError {
		rules: SnippetRule[];
	}

	interface CodeResponse extends ApiError {
		code: string;
	}

	interface MergedSnippet {
		snippet: Snippet;
		rule?: SnippetRule;
		code: string;
		codeLoaded: boolean;
		codeModified: boolean;
		expanded: boolean;
	}

	// ── State ──────────────────────────────────────────

	const zones = $state<ZoneSummary[]>([]);
	let zonesLoading = $state(false);
	let zoneQuery = $state('');
	let selectedZoneId = $state('');

	let activeTab = $state<Tab>('manage');
	let toast = $state<{ type: 'ok' | 'error'; message: string } | null>(null);
	let busy = $state(false);

	// Manage tab
	let mergedSnippets = $state<MergedSnippet[]>([]);
	let snippetRules = $state<SnippetRule[]>([]);
	let deleteConfirmName = $state<string | null>(null);
	let renameTarget = $state<string | null>(null);
	let renameNewName = $state('');
	let renameError = $state('');

	// Create tab
	let newSnippetName = $state('');
	let newSnippetCode = $state(
		`export default {
  async fetch(request) {
    const response = await fetch(request);
    return response;
  },
};
`
	);
	let newRuleExpression = $state('');
	let newRuleDescription = $state('');
	let newRuleEnabled = $state(true);
	let nameError = $state('');

	// Rule expression editor state
	let newRuleScope = $state<RuleScope>('all');
	let newExpressionView = $state<ExpressionView>('simple');
	let newSimpleConditions = $state<SimpleCondition[]>([defaultCondition()]);

	// Per-snippet expression editor state (manage tab)
	let ruleScopes = $state<Record<string, RuleScope>>({});
	let expressionViews = $state<Record<string, ExpressionView>>({});
	let simpleConditionsMap = $state<Record<string, SimpleCondition[]>>({});

	// Import
	let importSnippets = $state<SnippetExport[]>([]);
	let importSelected = $state<Set<number>>(new Set());
	let showImportDialog = $state(false);

	// ── Derived ────────────────────────────────────────

	function getMatchingZones(query: string): ZoneSummary[] {
		const normalized = query.trim().toLowerCase();
		if (!normalized) return zones;
		return zones.filter((zone) => zone.name.toLowerCase().includes(normalized));
	}

	const filteredZones = $derived(getMatchingZones(zoneQuery));

	$effect(() => {
		if (zonesLoading) return;
		if (filteredZones.length === 0) return;
		// If the user already selected a zone that's no longer visible in filtered results, clear it
		if (selectedZoneId && !filteredZones.some((zone) => zone.id === selectedZoneId)) {
			selectedZoneId = '';
		}
	});

	const selectedZoneName = $derived(zones.find((z) => z.id === selectedZoneId)?.name ?? '');

	const nameValid = $derived(/^[A-Za-z0-9_]+$/.test(newSnippetName));

	// ── Helpers ────────────────────────────────────────

	function showToast(type: 'ok' | 'error', message: string): void {
		toast = { type, message };
		setTimeout(() => {
			if (toast?.message === message) toast = null;
		}, 4500);
	}

	function escapeHtml(value: string): string {
		return value
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function highlightExpression(expression: string): string {
		const regex =
			/(http\.[A-Za-z0-9_.]+|ip\.src[A-Za-z0-9_.]*|ssl|cf\.[A-Za-z0-9_.]+)|\b(not in|eq|ne|contains|matches|in|starts_with|ends_with|lt|le|gt|ge|wildcard|strict wildcard)\b|\b(and|or|not)\b/gi;
		let out = '';
		let lastIndex = 0;

		for (const match of expression.matchAll(regex)) {
			const index = match.index ?? 0;
			out += escapeHtml(expression.slice(lastIndex, index));

			if (match[1]) {
				out += `<span class="token-field">${escapeHtml(match[1])}</span>`;
			} else if (match[2]) {
				out += `<span class="token-operator">${escapeHtml(match[2])}</span>`;
			} else if (match[3]) {
				out += `<span class="token-logical">${escapeHtml(match[3])}</span>`;
			}

			lastIndex = index + match[0].length;
		}

		out += escapeHtml(expression.slice(lastIndex));
		return out;
	}

	function formatDate(iso: string): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function validateSnippetName(name: string): string {
		if (!name) return 'Name is required.';
		if (!/^[A-Za-z0-9_]+$/.test(name)) return 'Only letters, numbers, and underscores allowed.';
		return '';
	}

	// ── Expression editor helpers ──────────────────────

	function initRuleEditorState(name: string, expression: string): void {
		const scope = detectRuleScope(expression);
		ruleScopes[name] = scope;
		expressionViews[name] = 'simple';
		simpleConditionsMap[name] = scope === 'custom' ? [defaultCondition()] : [];
	}

	function getRuleScope(name: string): RuleScope {
		return ruleScopes[name] ?? 'all';
	}

	function getExpressionView(name: string): ExpressionView {
		return expressionViews[name] ?? 'simple';
	}

	function getSimpleConditions(name: string): SimpleCondition[] {
		return simpleConditionsMap[name] ?? [defaultCondition()];
	}

	function setRuleScope(name: string, scope: RuleScope, rule: SnippetRule): void {
		ruleScopes[name] = scope;
		if (scope === 'all') {
			rule.expression = 'true';
			simpleConditionsMap[name] = [];
		} else {
			if (rule.expression === 'true') rule.expression = '';
			if (!simpleConditionsMap[name] || simpleConditionsMap[name].length === 0) {
				simpleConditionsMap[name] = [defaultCondition()];
			}
		}
	}

	function addCondition(name: string, join: 'and' | 'or' = 'and'): void {
		const current = simpleConditionsMap[name] ?? [defaultCondition()];
		simpleConditionsMap[name] = [...current, defaultCondition(join)];
	}

	function removeCondition(name: string, conditionId: number): void {
		const current = simpleConditionsMap[name] ?? [];
		if (current.length <= 1) return;
		const filtered = current.filter((c) => c.id !== conditionId);
		if (filtered.length > 0) filtered[0].join = 'and';
		simpleConditionsMap[name] = filtered;
	}

	function rebuildExpressionFromSimple(name: string, rule: SnippetRule): void {
		const conditions = simpleConditionsMap[name] ?? [];
		if (conditions.length === 0) return;
		rule.expression = buildExpressionFromConditions(conditions);
	}

	function setNewRuleScope(scope: RuleScope): void {
		newRuleScope = scope;
		if (scope === 'all') {
			newRuleExpression = 'true';
		} else {
			if (newRuleExpression === 'true') newRuleExpression = '';
			if (newSimpleConditions.length === 0) {
				newSimpleConditions = [defaultCondition()];
			}
		}
	}

	function rebuildNewExpression(): void {
		if (newRuleScope === 'all') {
			newRuleExpression = 'true';
			return;
		}
		newRuleExpression = buildExpressionFromConditions(newSimpleConditions);
	}

	// ── API Calls ──────────────────────────────────────

	async function loadZones(): Promise<void> {
		zonesLoading = true;
		try {
			const response = await fetch('/api/zones');
			const data = (await response.json()) as ZonesResponse;
			if (!response.ok) throw new Error(data.error || 'Failed to load zones');
			zones.splice(0, zones.length, ...(data.zones ?? []));
		} catch (error) {
			showToast('error', error instanceof Error ? error.message : 'Could not load zones');
		} finally {
			zonesLoading = false;
		}
	}

	async function loadSnippetsAndRules(): Promise<void> {
		if (!selectedZoneId) return;
		busy = true;
		try {
			const [snippetsRes, rulesRes] = await Promise.all([
				fetch(`/api/zones/${selectedZoneId}/snippets`),
				fetch(`/api/zones/${selectedZoneId}/snippets/rules`)
			]);

			const snippetsData = (await snippetsRes.json()) as SnippetsResponse;
			const rulesData = (await rulesRes.json()) as RulesResponse;

			if (!snippetsRes.ok) throw new Error(snippetsData.error || 'Failed to load snippets');
			if (!rulesRes.ok) throw new Error(rulesData.error || 'Failed to load snippet rules');

			const snippets = snippetsData.snippets ?? [];
			const rules = rulesData.rules ?? [];
			snippetRules = rules;

			mergedSnippets = snippets.map((snippet) => {
				const rule = rules.find((r) => r.snippet_name === snippet.snippet_name);
				if (rule) {
					initRuleEditorState(snippet.snippet_name, rule.expression);
				}
				return {
					snippet,
					rule,
					code: '',
					codeLoaded: false,
					codeModified: false,
					expanded: false
				};
			});

			showToast('ok', `Loaded ${snippets.length} snippet(s), ${rules.length} rule(s).`);
		} catch (error) {
			showToast('error', error instanceof Error ? error.message : 'Failed to load data');
		} finally {
			busy = false;
		}
	}

	async function loadSnippetCode(index: number): Promise<void> {
		const entry = mergedSnippets[index];
		if (!entry || entry.codeLoaded) return;

		try {
			const response = await fetch(
				`/api/zones/${selectedZoneId}/snippets/${entry.snippet.snippet_name}`
			);
			const data = (await response.json()) as CodeResponse;
			if (!response.ok) throw new Error(data.error || 'Failed to load code');
			mergedSnippets[index].code = data.code;
			mergedSnippets[index].codeLoaded = true;
		} catch (error) {
			showToast('error', error instanceof Error ? error.message : 'Failed to load snippet code');
		}
	}

	async function toggleExpand(index: number): Promise<void> {
		mergedSnippets[index].expanded = !mergedSnippets[index].expanded;
		if (mergedSnippets[index].expanded && !mergedSnippets[index].codeLoaded) {
			await loadSnippetCode(index);
		}
	}

	async function saveSnippet(index: number): Promise<void> {
		const entry = mergedSnippets[index];
		if (!entry) return;
		busy = true;
		try {
			// Save code
			const codeRes = await fetch(
				`/api/zones/${selectedZoneId}/snippets/${entry.snippet.snippet_name}`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ code: entry.code })
				}
			);
			const codeData = (await codeRes.json()) as ApiError;
			if (!codeRes.ok) throw new Error(codeData.error || 'Failed to save code');
			mergedSnippets[index].codeModified = false;

			// Save rules
			const rulesToSave = mergedSnippets
				.filter((m) => m.rule)
				.map((m) => m.rule!);

			const rulesRes = await fetch(`/api/zones/${selectedZoneId}/snippets/rules`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ rules: rulesToSave })
			});
			const rulesData = (await rulesRes.json()) as RulesResponse;
			if (!rulesRes.ok) throw new Error(rulesData.error || 'Failed to save rules');
			snippetRules = rulesData.rules ?? rulesToSave;

			showToast('ok', `Snippet "${entry.snippet.snippet_name}" saved.`);
		} catch (error) {
			showToast('error', error instanceof Error ? error.message : 'Save failed');
		} finally {
			busy = false;
		}
	}

	function requestDelete(name: string): void {
		deleteConfirmName = name;
	}

	function requestRename(name: string): void {
		renameTarget = name;
		renameNewName = name;
		renameError = '';
	}

	async function confirmRename(): Promise<void> {
		if (!renameTarget) return;
		const trimmed = renameNewName.trim();
		const validation = validateSnippetName(trimmed);
		if (validation) {
			renameError = validation;
			return;
		}
		if (trimmed === renameTarget) {
			renameError = 'New name is the same as the current name.';
			return;
		}
		busy = true;
		try {
			const response = await fetch(
				`/api/zones/${selectedZoneId}/snippets/${renameTarget}/rename`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ newName: trimmed })
				}
			);
			const data = (await response.json()) as ApiError;
			if (!response.ok) throw new Error(data.error || 'Rename failed');
			showToast('ok', `Snippet renamed to "${trimmed}".`);
			renameTarget = null;
			await loadSnippetsAndRules();
		} catch (error) {
			showToast('error', error instanceof Error ? error.message : 'Rename failed');
		} finally {
			busy = false;
		}
	}

	async function confirmDelete(): Promise<void> {
		if (!deleteConfirmName) return;
		busy = true;
		try {
			const response = await fetch(
				`/api/zones/${selectedZoneId}/snippets/${deleteConfirmName}`,
				{ method: 'DELETE' }
			);
			const data = (await response.json()) as ApiError;
			if (!response.ok) throw new Error(data.error || 'Delete failed');
			showToast('ok', `Snippet "${deleteConfirmName}" deleted.`);
			deleteConfirmName = null;
			await loadSnippetsAndRules();
		} catch (error) {
			showToast('error', error instanceof Error ? error.message : 'Delete failed');
		} finally {
			busy = false;
		}
	}

	async function deployNewSnippet(): Promise<void> {
		nameError = validateSnippetName(newSnippetName);
		if (nameError) return;
		if (!newSnippetCode.trim()) {
			showToast('error', 'Snippet code is required.');
			return;
		}
		busy = true;
		try {
			// 1. Upload the snippet code
			const createRes = await fetch(`/api/zones/${selectedZoneId}/snippets`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newSnippetName, code: newSnippetCode })
			});
			const createData = (await createRes.json()) as ApiError;
			if (!createRes.ok) throw new Error(createData.error || 'Failed to create snippet');

			// 2. Add snippet rule — "true" for all requests, or custom expression
			const ruleExpression = newRuleScope === 'all' ? 'true' : newRuleExpression.trim();
			if (ruleExpression) {
				const existingRulesRes = await fetch(`/api/zones/${selectedZoneId}/snippets/rules`);
				const existingRulesData = (await existingRulesRes.json()) as RulesResponse;
				const currentRules = existingRulesData.rules ?? [];

				const newRule: SnippetRule = {
					snippet_name: newSnippetName,
					expression: ruleExpression,
					description: newRuleDescription.trim(),
					enabled: newRuleEnabled
				};

				const rulesRes = await fetch(`/api/zones/${selectedZoneId}/snippets/rules`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ rules: [...currentRules, newRule] })
				});
				const rulesData = (await rulesRes.json()) as ApiError;
				if (!rulesRes.ok) throw new Error(rulesData.error || 'Snippet created but rule failed');
			}

			showToast('ok', `Snippet "${newSnippetName}" deployed.`);
			newSnippetName = '';
			newSnippetCode = `export default {
  async fetch(request) {
    const response = await fetch(request);
    return response;
  },
};
`;
			newRuleExpression = '';
			newRuleDescription = '';
			newRuleEnabled = true;
			newRuleScope = 'all';
			newExpressionView = 'simple';
			newSimpleConditions = [defaultCondition()];
			nameError = '';
			activeTab = 'manage';
			await loadSnippetsAndRules();
		} catch (error) {
			showToast('error', error instanceof Error ? error.message : 'Deploy failed');
		} finally {
			busy = false;
		}
	}

	// ── Import / Export ────────────────────────────────

	async function exportSnippets(): Promise<void> {
		if (mergedSnippets.length === 0) {
			showToast('error', 'No snippets to export.');
			return;
		}
		busy = true;
		try {
			// Ensure all code is loaded
			for (let i = 0; i < mergedSnippets.length; i++) {
				if (!mergedSnippets[i].codeLoaded) {
					await loadSnippetCode(i);
				}
			}

			const payload: EmberExportPayload = {
				metadata: {
					zone: selectedZoneName,
					exportedAt: new Date().toISOString()
				},
				snippets: mergedSnippets.map((m) => ({
					name: m.snippet.snippet_name,
					code: m.code,
					rule: m.rule
						? {
								expression: m.rule.expression,
								description: m.rule.description,
								enabled: m.rule.enabled
							}
						: undefined
				}))
			};

			const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `ember-export-${selectedZoneName}-${Date.now()}.json`;
			a.click();
			URL.revokeObjectURL(url);
			showToast('ok', `Exported ${payload.snippets.length} snippet(s).`);
		} catch (error) {
			showToast('error', error instanceof Error ? error.message : 'Export failed');
		} finally {
			busy = false;
		}
	}

	function exportSingleSnippet(index: number): void {
		const entry = mergedSnippets[index];
		if (!entry || !entry.codeLoaded) return;

		const blob = new Blob([entry.code], { type: 'application/javascript' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${entry.snippet.snippet_name}.js`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function onImportUpload(event: Event): Promise<void> {
		const target = event.currentTarget as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		try {
			const text = await file.text();
			const data = JSON.parse(text) as EmberExportPayload;

			if (!Array.isArray(data.snippets) || data.snippets.length === 0) {
				throw new Error('Invalid export file: no snippets found.');
			}

			importSnippets = data.snippets;
			importSelected = new Set(data.snippets.map((_: SnippetExport, i: number) => i));
			showImportDialog = true;
		} catch (error) {
			showToast('error', error instanceof Error ? error.message : 'Failed to parse import file');
		}
		target.value = '';
	}

	function toggleImportSelection(index: number): void {
		const next = new Set(importSelected);
		if (next.has(index)) {
			next.delete(index);
		} else {
			next.add(index);
		}
		importSelected = next;
	}

	async function executeImport(): Promise<void> {
		const selected = importSnippets.filter((_, i) => importSelected.has(i));
		if (selected.length === 0) {
			showToast('error', 'No snippets selected for import.');
			return;
		}
		busy = true;
		try {
			// Upload each snippet
			for (const snippet of selected) {
				const response = await fetch(`/api/zones/${selectedZoneId}/snippets`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: snippet.name, code: snippet.code })
				});
				if (!response.ok) {
					const data = (await response.json()) as ApiError;
					throw new Error(data.error || `Failed to import snippet "${snippet.name}"`);
				}
			}

			// Add rules for snippets that have them
			const snippetsWithRules = selected.filter((s) => s.rule);
			if (snippetsWithRules.length > 0) {
				const existingRulesRes = await fetch(`/api/zones/${selectedZoneId}/snippets/rules`);
				const existingRulesData = (await existingRulesRes.json()) as RulesResponse;
				const currentRules = existingRulesData.rules ?? [];

				const newRules: SnippetRule[] = snippetsWithRules.map((s) => ({
					snippet_name: s.name,
					expression: s.rule!.expression,
					description: s.rule!.description,
					enabled: s.rule!.enabled
				}));

				const rulesRes = await fetch(`/api/zones/${selectedZoneId}/snippets/rules`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ rules: [...currentRules, ...newRules] })
				});
				if (!rulesRes.ok) {
					showToast('error', 'Snippets imported but some rules failed.');
				}
			}

			showToast('ok', `Imported ${selected.length} snippet(s).`);
			showImportDialog = false;
			importSnippets = [];
			importSelected = new Set();
			await loadSnippetsAndRules();
		} catch (error) {
			showToast('error', error instanceof Error ? error.message : 'Import failed');
		} finally {
			busy = false;
		}
	}

	// ── Lifecycle ──────────────────────────────────────

	onMount(async () => {
		await loadZones();
	});

	$effect(() => {
		if (selectedZoneId) {
			loadSnippetsAndRules();
		}
	});
</script>

<!-- ─── Zone Picker ─────────────────────────────────── -->
<div class="panel stack">
	<div class="grid-2">
		<div class="stack" style="gap: 0.3rem;">
			<label class="muted" for="zone-query">Search Zones</label>
			<input
				id="zone-query"
				class="input"
				type="text"
				placeholder="Filter zones…"
				bind:value={zoneQuery}
			/>
		</div>
		<div class="stack" style="gap: 0.3rem;">
			<label class="muted" for="zone-select">Zone</label>
			<select id="zone-select" class="select" bind:value={selectedZoneId}>
				<option value="" disabled>Select a zone…</option>
				{#each filteredZones as zone (zone.id)}
					<option value={zone.id}>{zone.name}</option>
				{/each}
			</select>
		</div>
	</div>
</div>

<!-- ─── Tab Bar ─────────────────────────────────────── -->
<div class="panel" style="margin-top: 0.65rem;">
	<div class="row" style="gap: 0.35rem; margin-bottom: 0.55rem;">
		<button
			class="button"
			class:secondary={activeTab !== 'manage'}
			onclick={() => (activeTab = 'manage')}
		>
			Manage Snippets
		</button>
		<button
			class="button"
			class:secondary={activeTab !== 'create'}
			onclick={() => (activeTab = 'create')}
		>
			Create Snippet
		</button>
		<div style="flex: 1;"></div>
		<button class="button secondary" onclick={exportSnippets} disabled={busy || mergedSnippets.length === 0}>
			Export All
		</button>
		<label class="button secondary" style="cursor: pointer;">
			Import
			<input type="file" accept=".json" style="display: none;" onchange={onImportUpload} />
		</label>
	</div>

	<!-- ─── Manage Tab ──────────────────────────────── -->
	{#if activeTab === 'manage'}
		{#if mergedSnippets.length === 0 && !busy}
			<p class="muted" style="text-align: center; padding: 1.5rem 0;">
				{#if selectedZoneId}
					No snippets found for this zone.
				{:else}
					Select a zone to view snippets.
				{/if}
			</p>
		{:else}
			<div style="overflow-x: auto;">
			<table>
				<thead>
					<tr>
						<th style="width: 24%;">Name</th>
						<th style="width: 30%;">Rule Expression</th>
						<th style="width: 10%;">Enabled</th>
						<th style="width: 16%;">Modified</th>
						<th style="width: 20%;">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each mergedSnippets as entry, i (entry.snippet.snippet_name)}
						<tr
							style="cursor: pointer;"
							onclick={() => toggleExpand(i)}
						>
							<td style="font-weight: 600;">{entry.snippet.snippet_name}</td>
							<td>
								{#if entry.rule}
									{#if entry.rule.expression.trim() === 'true'}
										<span class="muted" style="font-size: 0.72rem;">All incoming requests</span>
									{:else}
										<span style="font-size: 0.72rem; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">
											{@html highlightExpression(entry.rule.expression)}
										</span>
									{/if}
								{:else}
									<span class="muted">No rule</span>
								{/if}
							</td>
							<td>
								{#if entry.rule}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
									<label class="toggle" onclick={(e) => e.stopPropagation()}>
										<input
											type="checkbox"
											bind:checked={entry.rule.enabled}
										/>
										<span class="toggle-slider"></span>
									</label>
								{:else}
									<span class="muted">—</span>
								{/if}
							</td>
							<td class="muted">{formatDate(entry.snippet.modified_on)}</td>
							<td>
								<div class="row" style="gap: 0.25rem;">
									{#if entry.expanded && entry.codeLoaded}
										<button
											class="button secondary"
											style="font-size: 0.68rem; padding: 0.25rem 0.45rem;"
											onclick={(e) => { e.stopPropagation(); exportSingleSnippet(i); }}
										>
											.js
										</button>
									{/if}
									<button
										class="button danger"
										style="font-size: 0.68rem; padding: 0.25rem 0.45rem;"
										onclick={(e) => { e.stopPropagation(); requestDelete(entry.snippet.snippet_name); }}
									>
										Delete
									</button>
								</div>
							</td>
						</tr>

						{#if entry.expanded}
							<tr>
								<td colspan="5" style="padding: 0.5rem;">
									{#if !entry.codeLoaded}
										<p class="muted">Loading code…</p>
									{:else}
										<div class="stack" style="gap: 0.5rem; min-width: 0; max-width: 100%;">
											<CodeEditor
												code={entry.code}
												minHeight="180px"
												onchange={(val) => {
													mergedSnippets[i].code = val;
													mergedSnippets[i].codeModified = true;
												}}
											/>

											{#if entry.rule}
												{@const sname = entry.snippet.snippet_name}
												<!-- svelte-ignore a11y_label_has_associated_control -->
												<label class="muted" style="font-size: 0.72rem;">Rule Scope</label>
												<div class="row" style="gap: 0.5rem;">
													<label class="row" style="gap: 0.3rem; cursor: pointer; font-size: 0.76rem;">
														<input
															type="radio"
															name="scope-{sname}"
															value="all"
															checked={getRuleScope(sname) === 'all'}
															onchange={() => setRuleScope(sname, 'all', entry.rule!)}
														/>
														All incoming requests
													</label>
													<label class="row" style="gap: 0.3rem; cursor: pointer; font-size: 0.76rem;">
														<input
															type="radio"
															name="scope-{sname}"
															value="custom"
															checked={getRuleScope(sname) === 'custom'}
															onchange={() => setRuleScope(sname, 'custom', entry.rule!)}
														/>
														Custom filter expression
													</label>
												</div>

												{#if getRuleScope(sname) === 'custom'}
													<div class="row" style="gap: 0.25rem; margin-top: 0.2rem;">
														<button
															class="button secondary"
															style="font-size: 0.66rem; padding: 0.2rem 0.5rem;"
															class:active={getExpressionView(sname) === 'simple'}
															onclick={() => (expressionViews[sname] = 'simple')}
														>
															Simple
														</button>
														<button
															class="button secondary"
															style="font-size: 0.66rem; padding: 0.2rem 0.5rem;"
															class:active={getExpressionView(sname) === 'expression'}
															onclick={() => (expressionViews[sname] = 'expression')}
														>
															Edit Expression
														</button>
													</div>

													{#if getExpressionView(sname) === 'simple'}
														<div class="stack" style="gap: 0.4rem;">
															{#each getSimpleConditions(sname) as condition, ci (condition.id)}
																{#if ci > 0}
																	<div class="row" style="gap: 0.3rem;">
																		<select
																			class="select"
																			style="width: 70px; font-size: 0.7rem;"
																			bind:value={condition.join}
																			onchange={() => rebuildExpressionFromSimple(sname, entry.rule!)}
																		>
																			<option value="and">And</option>
																			<option value="or">Or</option>
																		</select>
																	</div>
																{/if}
																<div class="row" style="gap: 0.35rem; flex-wrap: nowrap;">
																	<select
																		class="select"
																		style="width: 170px; font-size: 0.72rem;"
																		bind:value={condition.field}
																		onchange={() => rebuildExpressionFromSimple(sname, entry.rule!)}
																	>
																		{#each MATCH_FIELDS as f}
																			<option value={f.value}>{f.label}</option>
																		{/each}
																	</select>
																	<select
																		class="select"
																		style="width: 150px; font-size: 0.72rem;"
																		bind:value={condition.operator}
																		onchange={() => rebuildExpressionFromSimple(sname, entry.rule!)}
																	>
																		{#each MATCH_OPERATORS as op}
																			<option value={op.value}>{op.label}</option>
																		{/each}
																	</select>
																	<input
																		class="input"
																		style="flex: 1; font-size: 0.72rem;"
																		placeholder="Value"
																		bind:value={condition.value}
																		oninput={() => rebuildExpressionFromSimple(sname, entry.rule!)}
																	/>
																	{#if getSimpleConditions(sname).length > 1}
																		<button
																			class="button danger"
																			style="font-size: 0.62rem; padding: 0.2rem 0.4rem;"
																			onclick={() => { removeCondition(sname, condition.id); rebuildExpressionFromSimple(sname, entry.rule!); }}
																		>
																			✕
																		</button>
																	{/if}
																</div>
															{/each}
															<div class="row" style="gap: 0.3rem;">
																<button
																	class="button secondary"
																	style="font-size: 0.66rem; padding: 0.2rem 0.5rem;"
																	onclick={() => { addCondition(sname, 'and'); rebuildExpressionFromSimple(sname, entry.rule!); }}
																>
																	+ And
																</button>
																<button
																	class="button secondary"
																	style="font-size: 0.66rem; padding: 0.2rem 0.5rem;"
																	onclick={() => { addCondition(sname, 'or'); rebuildExpressionFromSimple(sname, entry.rule!); }}
																>
																	+ Or
																</button>
															</div>
														</div>
													{:else}
														<div class="expression-editor" style="min-height: 48px;">
															<pre class="expression-highlight">{@html highlightExpression(entry.rule.expression)}</pre>
															<textarea
																class="expression-input"
																style="min-height: 48px;"
																bind:value={entry.rule.expression}
															></textarea>
														</div>
													{/if}

													{#if entry.rule.expression}
														<div class="muted" style="font-size: 0.66rem; padding: 0.2rem 0; overflow-wrap: anywhere;">
															Expression: {@html highlightExpression(entry.rule.expression)}
														</div>
													{/if}
												{/if}

												<div class="grid-2">
													<div class="stack" style="gap: 0.3rem;">
														<!-- svelte-ignore a11y_label_has_associated_control -->
														<label class="muted">Description</label>
														<input class="input" bind:value={entry.rule.description} />
													</div>
												</div>
											{:else}
												<p class="muted" style="font-size: 0.72rem;">
													This snippet has no associated rule. It will not trigger on any traffic until a rule is added via the Create tab or Cloudflare dashboard.
												</p>
											{/if}

											<div class="row">
												<button
													class="button save"
													disabled={busy}
													onclick={() => saveSnippet(i)}
												>
													Save
												</button>
											</div>
										</div>
									{/if}
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
			</div>

			<div class="row" style="margin-top: 0.55rem;">
				<button class="button secondary" disabled={busy} onclick={loadSnippetsAndRules}>
					Refresh
				</button>
			</div>
		{/if}

	<!-- ─── Create Tab ──────────────────────────────── -->
	{:else if activeTab === 'create'}
		<div class="stack" style="gap: 0.6rem;">
			<div class="grid-2">
				<div class="stack" style="gap: 0.3rem;">
					<label class="muted" for="snippet-name">Snippet Name</label>
					<input
						id="snippet-name"
						class="input"
						type="text"
						placeholder="my_snippet"
						bind:value={newSnippetName}
						oninput={() => (nameError = validateSnippetName(newSnippetName))}
					/>
					{#if nameError}
						<span style="color: var(--danger); font-size: 0.72rem;">{nameError}</span>
					{/if}
				</div>
			</div>

			<div class="stack" style="gap: 0.3rem;">
				<!-- svelte-ignore a11y_label_has_associated_control -->
				<label class="muted">Snippet Code (JavaScript)</label>
				<CodeEditor
					code={newSnippetCode}
					minHeight="260px"
					onchange={(val: string) => (newSnippetCode = val)}
				/>
			</div>

			<div class="stack" style="gap: 0.3rem;">
				<!-- svelte-ignore a11y_label_has_associated_control -->
				<label class="muted">Rule Scope <span style="font-size: 0.66rem;">(determines which requests trigger this snippet)</span></label>
				<div class="row" style="gap: 0.5rem;">
					<label class="row" style="gap: 0.3rem; cursor: pointer; font-size: 0.76rem;">
						<input
							type="radio"
							name="new-scope"
							value="all"
							checked={newRuleScope === 'all'}
							onchange={() => setNewRuleScope('all')}
						/>
						All incoming requests
					</label>
					<label class="row" style="gap: 0.3rem; cursor: pointer; font-size: 0.76rem;">
						<input
							type="radio"
							name="new-scope"
							value="custom"
							checked={newRuleScope === 'custom'}
							onchange={() => setNewRuleScope('custom')}
						/>
						Custom filter expression
					</label>
				</div>

				{#if newRuleScope === 'custom'}
					<div class="row" style="gap: 0.25rem; margin-top: 0.2rem;">
						<button
							class="button secondary"
							style="font-size: 0.66rem; padding: 0.2rem 0.5rem;"
							class:active={newExpressionView === 'simple'}
							onclick={() => (newExpressionView = 'simple')}
						>
							Simple
						</button>
						<button
							class="button secondary"
							style="font-size: 0.66rem; padding: 0.2rem 0.5rem;"
							class:active={newExpressionView === 'expression'}
							onclick={() => (newExpressionView = 'expression')}
						>
							Edit Expression
						</button>
					</div>

					{#if newExpressionView === 'simple'}
						<div class="stack" style="gap: 0.4rem;">
							{#each newSimpleConditions as condition, ci (condition.id)}
								{#if ci > 0}
									<div class="row" style="gap: 0.3rem;">
										<select
											class="select"
											style="width: 70px; font-size: 0.7rem;"
											bind:value={condition.join}
											onchange={rebuildNewExpression}
										>
											<option value="and">And</option>
											<option value="or">Or</option>
										</select>
									</div>
								{/if}
								<div class="row" style="gap: 0.35rem; flex-wrap: nowrap;">
									<select
										class="select"
										style="width: 170px; font-size: 0.72rem;"
										bind:value={condition.field}
										onchange={rebuildNewExpression}
									>
										{#each MATCH_FIELDS as f}
											<option value={f.value}>{f.label}</option>
										{/each}
									</select>
									<select
										class="select"
										style="width: 150px; font-size: 0.72rem;"
										bind:value={condition.operator}
										onchange={rebuildNewExpression}
									>
										{#each MATCH_OPERATORS as op}
											<option value={op.value}>{op.label}</option>
										{/each}
									</select>
									<input
										class="input"
										style="flex: 1; font-size: 0.72rem;"
										placeholder="Value"
										bind:value={condition.value}
										oninput={rebuildNewExpression}
									/>
									{#if newSimpleConditions.length > 1}
										<button
											class="button danger"
											style="font-size: 0.62rem; padding: 0.2rem 0.4rem;"
											onclick={() => { newSimpleConditions = newSimpleConditions.filter((c) => c.id !== condition.id); if (newSimpleConditions.length > 0) newSimpleConditions[0].join = 'and'; rebuildNewExpression(); }}
										>
											✕
										</button>
									{/if}
								</div>
							{/each}
							<div class="row" style="gap: 0.3rem;">
								<button
									class="button secondary"
									style="font-size: 0.66rem; padding: 0.2rem 0.5rem;"
									onclick={() => { newSimpleConditions = [...newSimpleConditions, defaultCondition('and')]; rebuildNewExpression(); }}
								>
									+ And
								</button>
								<button
									class="button secondary"
									style="font-size: 0.66rem; padding: 0.2rem 0.5rem;"
									onclick={() => { newSimpleConditions = [...newSimpleConditions, defaultCondition('or')]; rebuildNewExpression(); }}
								>
									+ Or
								</button>
							</div>
						</div>
					{:else}
						<div class="expression-editor" style="min-height: 56px;">
							<pre class="expression-highlight" style="min-height: 56px;">{@html highlightExpression(newRuleExpression)}</pre>
							<textarea
								class="expression-input"
								style="min-height: 56px;"
								placeholder='e.g. http.host eq "example.com"'
								bind:value={newRuleExpression}
							></textarea>
						</div>
					{/if}

					{#if newRuleExpression && newRuleExpression !== 'true'}
						<div class="muted" style="font-size: 0.66rem; padding: 0.2rem 0; overflow-wrap: anywhere;">
							Expression: {@html highlightExpression(newRuleExpression)}
						</div>
					{/if}
				{/if}
			</div>

			<div class="grid-2">
				<div class="stack" style="gap: 0.3rem;">
					<label class="muted" for="rule-desc">Rule Description</label>
					<input
						id="rule-desc"
						class="input"
						type="text"
						placeholder="Optional description"
						bind:value={newRuleDescription}
					/>
				</div>
				<div class="row" style="gap: 0.5rem; align-self: end;">
					<label class="muted" style="display: flex; align-items: center; gap: 0.4rem;">
						Enabled
						<label class="toggle">
							<input type="checkbox" bind:checked={newRuleEnabled} />
							<span class="toggle-slider"></span>
						</label>
					</label>
				</div>
			</div>

			<div class="row" style="margin-top: 0.3rem;">
				<button
					class="button"
					disabled={busy || !nameValid || !newSnippetCode.trim()}
					onclick={deployNewSnippet}
				>
					Deploy Snippet
				</button>
			</div>
		</div>
	{/if}
</div>

<!-- ─── Delete Confirmation Dialog ──────────────────── -->
{#if deleteConfirmName}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="dialog-backdrop" onclick={() => (deleteConfirmName = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="dialog panel" onclick={(e) => e.stopPropagation()}>
			<div class="stack" style="gap: 0.5rem;">
				<p style="font-size: 0.82rem;">
					Delete snippet <strong>"{deleteConfirmName}"</strong>?
				</p>
				<p class="muted">
					This will permanently delete the snippet and its associated rule from Cloudflare.
					This action cannot be undone.
				</p>
				<div class="row" style="justify-content: flex-end;">
					<button class="button secondary" onclick={() => (deleteConfirmName = null)}>
						Cancel
					</button>
					<button class="button danger" disabled={busy} onclick={confirmDelete}>
						Delete
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- ─── Rename Dialog ───────────────────────────────── -->
{#if renameTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="dialog-backdrop" onclick={() => (renameTarget = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="dialog panel" onclick={(e) => e.stopPropagation()}>
			<div class="stack" style="gap: 0.5rem;">
				<p style="font-size: 0.82rem;">
					Rename snippet <strong>"{renameTarget}"</strong>
				</p>
				<p class="muted" style="font-size: 0.72rem;">
					This will create the snippet with the new name, update any associated rules, and delete the old one.
				</p>
				<input
					class="input"
					type="text"
					placeholder="New snippet name"
					bind:value={renameNewName}
					oninput={() => (renameError = validateSnippetName(renameNewName.trim()))}
				/>
				{#if renameError}
					<p style="color: oklch(0.7 0.2 25); font-size: 0.72rem;">{renameError}</p>
				{/if}
				<div class="row" style="justify-content: flex-end;">
					<button class="button secondary" onclick={() => (renameTarget = null)}>
						Cancel
					</button>
					<button
						class="button"
						disabled={busy || !!renameError || !renameNewName.trim() || renameNewName.trim() === renameTarget}
						onclick={confirmRename}
					>
						Rename
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- ─── Rename Dialog ───────────────────────────────── -->
{#if renameTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="dialog-backdrop" onclick={() => (renameTarget = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="dialog panel" onclick={(e) => e.stopPropagation()}>
			<div class="stack" style="gap: 0.5rem;">
				<p style="font-size: 0.82rem;">
					Rename snippet <strong>"{renameTarget}"</strong>
				</p>
				<p class="muted" style="font-size: 0.72rem;">
					This will create the snippet with the new name, update any associated rules, and delete the old one.
				</p>
				<input
					class="input"
					type="text"
					placeholder="New snippet name"
					bind:value={renameNewName}
					oninput={() => (renameError = validateSnippetName(renameNewName.trim()))}
				/>
				{#if renameError}
					<p style="color: oklch(0.7 0.2 25); font-size: 0.72rem;">{renameError}</p>
				{/if}
				<div class="row" style="justify-content: flex-end;">
					<button class="button secondary" onclick={() => (renameTarget = null)}>
						Cancel
					</button>
					<button
						class="button"
						disabled={busy || !!renameError || !renameNewName.trim() || renameNewName.trim() === renameTarget}
						onclick={confirmRename}
					>
						Rename
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- ─── Import Dialog ───────────────────────────────── -->
{#if showImportDialog}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="dialog-backdrop" onclick={() => (showImportDialog = false)}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="dialog panel" onclick={(e) => e.stopPropagation()} style="max-height: 80vh; overflow-y: auto;">
			<div class="stack" style="gap: 0.5rem;">
				<p style="font-size: 0.82rem; font-weight: 600;">Import Snippets</p>
				<p class="muted">Select which snippets to import into <strong>{selectedZoneName}</strong>:</p>

				{#each importSnippets as snippet, i (i)}
					<label class="row" style="gap: 0.4rem; cursor: pointer; padding: 0.3rem 0;">
						<input
							type="checkbox"
							checked={importSelected.has(i)}
							onchange={() => toggleImportSelection(i)}
						/>
						<span style="font-weight: 600;">{snippet.name}</span>
						{#if snippet.rule}
							<span class="muted" style="font-size: 0.68rem;">
								({@html highlightExpression(snippet.rule.expression)})
							</span>
						{:else}
							<span class="muted" style="font-size: 0.68rem;">(no rule)</span>
						{/if}
					</label>
				{/each}

				<div class="row" style="justify-content: flex-end; margin-top: 0.3rem;">
					<button class="button secondary" onclick={() => (showImportDialog = false)}>
						Cancel
					</button>
					<button
						class="button"
						disabled={busy || importSelected.size === 0}
						onclick={executeImport}
					>
						Import {importSelected.size} Snippet(s)
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- ─── Toast ───────────────────────────────────────── -->
{#if toast}
	<div class="toast">
		<div class="status" class:ok={toast.type === 'ok'} class:error={toast.type === 'error'}>
			{toast.message}
		</div>
	</div>
{/if}
