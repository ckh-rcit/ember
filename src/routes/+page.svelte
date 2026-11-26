<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
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
		ruleSnapshot: string;
		code: string;
		savedCode: string;
		codeLoaded: boolean;
		codeLoading: boolean;
		expanded: boolean;
		saving: boolean;
		savedAt: Date | null;
	}

	// ── State ──────────────────────────────────────────

	const zones = $state<ZoneSummary[]>([]);
	let zonesLoading = $state(false);
	let zoneQuery = $state('');
	let zoneListOpen = $state(false);
	let zoneActiveIndex = $state(0);
	let selectedZoneId = $state('');

	let activeTab = $state<Tab>('manage');
	let toast = $state<{ id: number; type: 'ok' | 'error'; message: string } | null>(null);
	let toastSeed = 0;
	let busy = $state(false);
	let listLoading = $state(false);

	// Manage tab
	let mergedSnippets = $state<MergedSnippet[]>([]);
	let snippetQuery = $state('');
	let recentName = $state<string | null>(null);
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

	function searchTokens(query: string): string[] {
		return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	}

	function matchesAll(haystack: string, tokens: string[]): boolean {
		const lower = haystack.toLowerCase();
		return tokens.every((t) => lower.includes(t));
	}

	function getMatchingZones(query: string): ZoneSummary[] {
		const tokens = searchTokens(query);
		if (tokens.length === 0) return zones;
		const first = tokens[0];
		const rank = (name: string): number => {
			const lower = name.toLowerCase();
			if (lower === first) return 0;
			if (lower.startsWith(first)) return 1;
			return 2;
		};
		return zones
			.filter((zone) => matchesAll(zone.name, tokens))
			.sort((a, b) => rank(a.name) - rank(b.name));
	}

	const selectedZoneName = $derived(zones.find((z) => z.id === selectedZoneId)?.name ?? '');

	// Showing the full list when the input still holds the selected zone lets users browse after focusing.
	const effectiveZoneQuery = $derived(zoneQuery === selectedZoneName ? '' : zoneQuery);
	const filteredZones = $derived(getMatchingZones(effectiveZoneQuery));

	const filteredSnippets = $derived.by(() => {
		const tokens = searchTokens(snippetQuery);
		if (tokens.length === 0) return mergedSnippets;
		return mergedSnippets.filter((m) =>
			matchesAll(
				[m.snippet.snippet_name, m.rule?.description ?? '', m.rule?.expression ?? '', m.code].join(
					'\n'
				),
				tokens
			)
		);
	});

	const codePending = $derived(
		snippetQuery.trim() ? mergedSnippets.filter((m) => !m.codeLoaded).length : 0
	);

	const editorSearch = $derived.by(() => {
		const tokens = searchTokens(snippetQuery);
		if (tokens.length <= 1) return { query: tokens[0] ?? '', regexp: false };
		return { query: tokens.map(escapeRegExp).join('|'), regexp: true };
	});

	interface CodeHit {
		lineNo: number;
		text: string;
	}

	const MAX_CODE_HITS = 3;

	function findCodeHits(code: string, query: string): { hits: CodeHit[]; total: number } {
		const tokens = searchTokens(query);
		const hits: CodeHit[] = [];
		let total = 0;
		if (tokens.length === 0 || !code) return { hits, total };
		const lines = code.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const lower = lines[i].toLowerCase();
			if (!tokens.some((t) => lower.includes(t))) continue;
			total += 1;
			if (hits.length < MAX_CODE_HITS) hits.push({ lineNo: i + 1, text: lines[i].trim() });
		}
		return { hits, total };
	}

	const dirtyCount = $derived(mergedSnippets.filter((m) => isDirty(m)).length);

	const nameValid = $derived(/^[A-Za-z0-9_]+$/.test(newSnippetName));
	const nameTaken = $derived(
		mergedSnippets.some((m) => m.snippet.snippet_name === newSnippetName)
	);

	// ── Helpers ────────────────────────────────────────

	function showToast(type: 'ok' | 'error', message: string): void {
		const id = ++toastSeed;
		toast = { id, type, message };
		setTimeout(
			() => {
				if (toast?.id === id) toast = null;
			},
			type === 'error' ? 9000 : 4000
		);
	}

	function ruleKey(rule: SnippetRule | undefined): string {
		if (!rule) return '';
		return JSON.stringify({
			expression: rule.expression,
			description: rule.description,
			enabled: rule.enabled
		});
	}

	function isDirty(entry: MergedSnippet): boolean {
		if (entry.codeLoaded && entry.code !== entry.savedCode) return true;
		return !!entry.rule && ruleKey(entry.rule) !== entry.ruleSnapshot;
	}

	function savedRuleOf(entry: MergedSnippet): SnippetRule | undefined {
		if (!entry.rule) return undefined;
		return { ...entry.rule, ...JSON.parse(entry.ruleSnapshot) };
	}

	function escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function highlightMatch(text: string, query: string): string {
		const tokens = searchTokens(query);
		if (tokens.length === 0) return escapeHtml(text);
		const pattern = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
		return text
			.split(pattern)
			.map((part, i) => (i % 2 === 1 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
			.join('');
	}

	function formatTime(date: Date): string {
		return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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
		// Existing expressions can't be parsed back into simple conditions, so show the raw expression.
		expressionViews[name] = scope === 'custom' ? 'expression' : 'simple';
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

	let loadedZoneId = '';

	function rulesPayload(override?: MergedSnippet, overrideRule?: SnippetRule): SnippetRule[] {
		return mergedSnippets
			.filter((m) => m.rule)
			.map((m) => (m === override && overrideRule ? overrideRule : savedRuleOf(m)!));
	}

	async function loadSnippetsAndRules(): Promise<void> {
		const zoneId = selectedZoneId;
		if (!zoneId) return;
		const sameZone = zoneId === loadedZoneId;
		const previous = new Map(
			(sameZone ? mergedSnippets : []).map((m) => [m.snippet.snippet_name, m])
		);
		if (!sameZone) {
			mergedSnippets = [];
			snippetQuery = '';
		}
		listLoading = mergedSnippets.length === 0;
		try {
			const [snippetsRes, rulesRes] = await Promise.all([
				fetch(`/api/zones/${zoneId}/snippets`),
				fetch(`/api/zones/${zoneId}/snippets/rules`)
			]);

			const snippetsData = (await snippetsRes.json()) as SnippetsResponse;
			const rulesData = (await rulesRes.json()) as RulesResponse;

			if (!snippetsRes.ok) throw new Error(snippetsData.error || 'Failed to load snippets');
			if (!rulesRes.ok) throw new Error(rulesData.error || 'Failed to load snippet rules');
			if (zoneId !== selectedZoneId) return;

			const snippets = [...(snippetsData.snippets ?? [])].sort((a, b) =>
				a.snippet_name.localeCompare(b.snippet_name, undefined, { sensitivity: 'base' })
			);
			const rules = rulesData.rules ?? [];
			snippetRules = rules;

			mergedSnippets = snippets.map((snippet) => {
				const name = snippet.snippet_name;
				const prev = previous.get(name);
				if (prev && isDirty(prev)) {
					return { ...prev, snippet };
				}
				const rule = rules.find((r) => r.snippet_name === name);
				if (rule) initRuleEditorState(name, rule.expression);
				return {
					snippet,
					rule,
					ruleSnapshot: ruleKey(rule),
					code: '',
					savedCode: '',
					codeLoaded: false,
					codeLoading: false,
					expanded: prev?.expanded ?? false,
					saving: false,
					savedAt: prev?.savedAt ?? null
				};
			});
			loadedZoneId = zoneId;
			allCodeRequested = false;
			if (searchTokens(snippetQuery).length > 0) loadAllCode();

			for (const entry of mergedSnippets) {
				if (entry.expanded && !entry.codeLoaded) loadSnippetCode(entry);
			}
		} catch (error) {
			showToast('error', error instanceof Error ? error.message : 'Failed to load data');
		} finally {
			listLoading = false;
		}
	}

	async function loadSnippetCode(entry: MergedSnippet): Promise<void> {
		if (entry.codeLoaded || entry.codeLoading) return;
		entry.codeLoading = true;
		try {
			const response = await fetch(
				`/api/zones/${selectedZoneId}/snippets/${entry.snippet.snippet_name}`
			);
			const data = (await response.json()) as CodeResponse;
			if (!response.ok) throw new Error(data.error || 'Failed to load code');
			entry.code = data.code;
			entry.savedCode = data.code;
			entry.codeLoaded = true;
		} catch (error) {
			showToast('error', error instanceof Error ? error.message : 'Failed to load snippet code');
		} finally {
			entry.codeLoading = false;
		}
	}

	let allCodeRequested = false;

	async function loadAllCode(): Promise<void> {
		if (allCodeRequested) return;
		allCodeRequested = true;
		const queue = mergedSnippets.filter((m) => !m.codeLoaded && !m.codeLoading);
		const worker = async () => {
			for (let next = queue.shift(); next; next = queue.shift()) {
				await loadSnippetCode(next);
			}
		};
		await Promise.all(Array.from({ length: 4 }, worker));
	}

	let codeSearchTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const active = searchTokens(snippetQuery).length > 0 && mergedSnippets.length > 0;
		clearTimeout(codeSearchTimer);
		if (active) codeSearchTimer = setTimeout(() => untrack(loadAllCode), 250);
	});

	async function toggleExpand(entry: MergedSnippet): Promise<void> {
		entry.expanded = !entry.expanded;
		if (entry.expanded && !entry.codeLoaded) {
			await loadSnippetCode(entry);
		}
	}

	async function saveSnippet(entry: MergedSnippet): Promise<void> {
		if (entry.saving || !isDirty(entry)) return;
		const name = entry.snippet.snippet_name;
		const codeToSave = entry.code;
		const ruleToSave = entry.rule ? { ...entry.rule } : undefined;
		const codeChanged = entry.codeLoaded && codeToSave !== entry.savedCode;
		const ruleChanged = !!ruleToSave && ruleKey(ruleToSave) !== entry.ruleSnapshot;
		entry.saving = true;
		try {
			if (codeChanged) {
				const codeRes = await fetch(`/api/zones/${selectedZoneId}/snippets/${name}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ code: codeToSave })
				});
				const codeData = (await codeRes.json()) as ApiError;
				if (!codeRes.ok) throw new Error(codeData.error || 'Could not save code');
				entry.savedCode = codeToSave;
				entry.snippet.modified_on = new Date().toISOString();
			}

			if (ruleChanged) {
				const rulesToSave = rulesPayload(entry, ruleToSave);
				const rulesRes = await fetch(`/api/zones/${selectedZoneId}/snippets/rules`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ rules: rulesToSave })
				});
				const rulesData = (await rulesRes.json()) as RulesResponse;
				if (!rulesRes.ok) {
					throw new Error(
						codeChanged
							? `Code saved, but the rule was not: ${rulesData.error || 'unknown error'}`
							: rulesData.error || 'Could not save rule'
					);
				}
				snippetRules = rulesData.rules ?? rulesToSave;
				entry.ruleSnapshot = ruleKey(ruleToSave);
			}

			entry.savedAt = new Date();
			showToast('ok', `Saved "${name}" to ${selectedZoneName}.`);
		} catch (error) {
			showToast('error', error instanceof Error ? error.message : 'Save failed');
		} finally {
			entry.saving = false;
		}
	}

	function discardChanges(entry: MergedSnippet): void {
		entry.code = entry.savedCode;
		if (entry.rule) {
			Object.assign(entry.rule, JSON.parse(entry.ruleSnapshot));
			initRuleEditorState(entry.snippet.snippet_name, entry.rule.expression);
		}
	}

	async function toggleRuleEnabled(entry: MergedSnippet): Promise<void> {
		if (!entry.rule || entry.saving) return;
		const name = entry.snippet.snippet_name;
		const enabled = !entry.rule.enabled;
		const savedRule = { ...savedRuleOf(entry)!, enabled };
		entry.rule.enabled = enabled;
		entry.saving = true;
		try {
			const rulesToSave = rulesPayload(entry, savedRule);
			const res = await fetch(`/api/zones/${selectedZoneId}/snippets/rules`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ rules: rulesToSave })
			});
			const data = (await res.json()) as RulesResponse;
			if (!res.ok) throw new Error(data.error || 'Could not update rule');
			snippetRules = data.rules ?? rulesToSave;
			entry.ruleSnapshot = ruleKey(savedRule);
			showToast('ok', `"${name}" ${enabled ? 'enabled' : 'disabled'}.`);
		} catch (error) {
			entry.rule.enabled = !enabled;
			showToast('error', error instanceof Error ? error.message : 'Could not update rule');
		} finally {
			entry.saving = false;
		}
	}

	function selectZone(zone: ZoneSummary): void {
		zoneListOpen = false;
		if (zone.id === selectedZoneId) {
			zoneQuery = zone.name;
			return;
		}
		if (dirtyCount > 0 && !confirm(`Discard unsaved changes in ${dirtyCount} snippet(s)?`)) {
			zoneQuery = selectedZoneName;
			return;
		}
		selectedZoneId = zone.id;
		zoneQuery = zone.name;
	}

	function closeZoneList(): void {
		zoneListOpen = false;
		zoneQuery = selectedZoneName;
	}

	function onZoneKeydown(event: KeyboardEvent): void {
		const count = filteredZones.length;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			zoneListOpen = true;
			if (count) zoneActiveIndex = (zoneActiveIndex + 1) % count;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			zoneListOpen = true;
			if (count) zoneActiveIndex = (zoneActiveIndex - 1 + count) % count;
		} else if (event.key === 'Enter') {
			const zone = filteredZones[zoneActiveIndex];
			if (zoneListOpen && zone) {
				event.preventDefault();
				selectZone(zone);
			}
		} else if (event.key === 'Escape') {
			closeZoneList();
		}
	}

	$effect(() => {
		if (!zoneListOpen) return;
		document
			.getElementById(`zone-opt-${zoneActiveIndex}`)
			?.scrollIntoView({ block: 'nearest' });
	});

	function onWindowKeydown(event: KeyboardEvent): void {
		if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
		const host = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-snippet]');
		if (!host) return;
		event.preventDefault();
		const entry = mergedSnippets.find((m) => m.snippet.snippet_name === host.dataset.snippet);
		if (entry) saveSnippet(entry);
	}

	function onBeforeUnload(event: BeforeUnloadEvent): void {
		if (dirtyCount > 0) event.preventDefault();
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
		if (!nameError && nameTaken) nameError = 'A snippet with this name already exists in this zone.';
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

			showToast('ok', `Deployed "${newSnippetName}" to ${selectedZoneName}.`);
			const deployedName = newSnippetName;
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
			await revealSnippet(deployedName);
		} catch (error) {
			showToast('error', error instanceof Error ? error.message : 'Deploy failed');
		} finally {
			busy = false;
		}
	}

	async function revealSnippet(name: string): Promise<void> {
		const entry = mergedSnippets.find((m) => m.snippet.snippet_name === name);
		if (!entry) return;
		snippetQuery = '';
		recentName = name;
		setTimeout(() => {
			if (recentName === name) recentName = null;
		}, 2500);
		await tick();
		document
			.querySelector(`[data-snippet-row="${CSS.escape(name)}"]`)
			?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
			for (const entry of mergedSnippets) {
				if (!entry.codeLoaded) await loadSnippetCode(entry);
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

	function exportSingleSnippet(entry: MergedSnippet): void {
		if (!entry.codeLoaded) return;

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
			untrack(() => loadSnippetsAndRules());
		}
	});
</script>

<svelte:window onkeydown={onWindowKeydown} onbeforeunload={onBeforeUnload} />

<!-- ─── Zone Picker ─────────────────────────────────── -->
<div class="panel zone-picker">
	<label class="muted" for="zone-search">Zone</label>
	<div class="combobox">
		<input
			id="zone-search"
			class="input"
			type="text"
			role="combobox"
			autocomplete="off"
			spellcheck="false"
			aria-expanded={zoneListOpen}
			aria-controls="zone-listbox"
			aria-autocomplete="list"
			aria-activedescendant={zoneListOpen && filteredZones.length ? `zone-opt-${zoneActiveIndex}` : undefined}
			placeholder={zonesLoading ? 'Loading zones…' : `Search ${zones.length} zones`}
			disabled={zonesLoading}
			bind:value={zoneQuery}
			onfocus={(e) => { e.currentTarget.select(); zoneListOpen = true; zoneActiveIndex = 0; }}
			oninput={() => { zoneListOpen = true; zoneActiveIndex = 0; }}
			onkeydown={onZoneKeydown}
			onblur={closeZoneList}
		/>
		{#if zoneListOpen && !zonesLoading}
			<ul id="zone-listbox" class="combobox-list" role="listbox" aria-label="Zones">
				{#each filteredZones as zone, zi (zone.id)}
					<li
						id="zone-opt-{zi}"
						role="option"
						aria-selected={zone.id === selectedZoneId}
						class:active={zi === zoneActiveIndex}
						onmousedown={(e) => { e.preventDefault(); selectZone(zone); }}
						onmousemove={() => (zoneActiveIndex = zi)}
					>
						{@html highlightMatch(zone.name, effectiveZoneQuery)}
					</li>
				{:else}
					<li class="combobox-empty">No zones match "{zoneQuery.trim()}"</li>
				{/each}
			</ul>
		{/if}
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
		{#if listLoading}
			<div class="skeleton-table" aria-busy="true" aria-label="Loading snippets">
				<div class="skeleton-row skeleton-header">
					<div class="skeleton-cell" style="width: 24%;"></div>
					<div class="skeleton-cell" style="width: 30%;"></div>
					<div class="skeleton-cell" style="width: 10%;"></div>
					<div class="skeleton-cell" style="width: 16%;"></div>
					<div class="skeleton-cell" style="width: 20%;"></div>
				</div>
				{#each { length: 3 } as _}
					<div class="skeleton-row">
						<div class="skeleton-cell" style="width: 24%;"></div>
						<div class="skeleton-cell" style="width: 30%;"></div>
						<div class="skeleton-cell" style="width: 10%;"></div>
						<div class="skeleton-cell" style="width: 16%;"></div>
						<div class="skeleton-cell" style="width: 20%;"></div>
					</div>
				{/each}
			</div>
		{:else if mergedSnippets.length === 0}
			<p class="muted" style="text-align: center; padding: 1.5rem 0;">
				{#if selectedZoneId}
					No snippets in {selectedZoneName} yet.
					<button class="link-button" onclick={() => (activeTab = 'create')}>Create one</button>
				{:else}
					Pick a zone to see its snippets.
				{/if}
			</p>
		{:else}
			<div class="list-toolbar">
				<input
					class="input"
					type="search"
					placeholder="Search names, rules, and code"
					aria-label="Search snippets"
					bind:value={snippetQuery}
					onkeydown={(e) => { if (e.key === 'Escape') snippetQuery = ''; }}
				/>
				<span class="muted" aria-live="polite">
					{#if snippetQuery.trim()}
						{filteredSnippets.length} of {mergedSnippets.length}{#if codePending > 0}, searching code ({mergedSnippets.length - codePending}/{mergedSnippets.length}){/if}
					{:else}
						{mergedSnippets.length} snippet{mergedSnippets.length === 1 ? '' : 's'}
					{/if}{#if dirtyCount > 0}<span class="unsaved-count">, {dirtyCount} unsaved</span>{/if}
				</span>
				<button class="button secondary" disabled={listLoading} onclick={loadSnippetsAndRules}>
					Refresh
				</button>
			</div>
			{#if filteredSnippets.length === 0}
				<p class="muted" style="text-align: center; padding: 1.5rem 0;">
					No snippets match "{snippetQuery.trim()}".
					<button class="link-button" onclick={() => (snippetQuery = '')}>Clear filter</button>
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
					{#each filteredSnippets as entry (entry.snippet.snippet_name)}
						{@const dirty = isDirty(entry)}
						<tr
							class="snippet-row"
							class:expanded={entry.expanded}
							class:recent={recentName === entry.snippet.snippet_name}
							data-snippet-row={entry.snippet.snippet_name}
							onclick={() => toggleExpand(entry)}
						>
							<td>
								<button
									class="row-toggle"
									aria-expanded={entry.expanded}
									onclick={(e) => { e.stopPropagation(); toggleExpand(entry); }}
								>
									<span class="chevron" aria-hidden="true">{entry.expanded ? '▾' : '▸'}</span>
									<span class="row-name">{@html highlightMatch(entry.snippet.snippet_name, snippetQuery)}</span>
								</button>
								{#if entry.saving}
									<span class="pill saving">Saving…</span>
								{:else if dirty}
									<span class="pill unsaved">Unsaved</span>
								{/if}
							</td>
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
											aria-label="Enable {entry.snippet.snippet_name}"
											checked={entry.rule.enabled}
											disabled={entry.saving}
											onchange={() => toggleRuleEnabled(entry)}
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
											title="Download as .js"
											onclick={(e) => { e.stopPropagation(); exportSingleSnippet(entry); }}
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

						{#if !entry.expanded && snippetQuery.trim()}
							{@const found = findCodeHits(entry.code, snippetQuery)}
							{#if found.total > 0}
								<tr class="code-hits" onclick={() => toggleExpand(entry)}>
									<td colspan="5">
										{#each found.hits as hit (hit.lineNo)}
											<div class="code-hit">
												<span class="code-hit-line">{hit.lineNo}</span>
												<code>{@html highlightMatch(hit.text, snippetQuery)}</code>
											</div>
										{/each}
										{#if found.total > found.hits.length}
											<div class="muted code-hit-more">
												{found.total - found.hits.length} more matching line{found.total - found.hits.length === 1 ? '' : 's'}
											</div>
										{/if}
									</td>
								</tr>
							{/if}
						{/if}

						{#if entry.expanded}
							<tr class="snippet-detail">
								<td colspan="5" style="padding: 0.5rem;" data-snippet={entry.snippet.snippet_name}>
									{#if !entry.codeLoaded}
										<p class="muted">Loading code…</p>
									{:else}
										<div class="stack" style="gap: 0.5rem; min-width: 0; max-width: 100%;">
											<CodeEditor
												code={entry.code}
												minHeight="180px"
												searchQuery={editorSearch.query}
												searchRegexp={editorSearch.regexp}
												onchange={(val) => (entry.code = val)}
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

											<div class="save-bar" class:dirty>
												<button
													class="button"
													class:secondary={!dirty}
													disabled={!dirty || entry.saving}
													title="Save (Ctrl+S)"
													aria-keyshortcuts="Control+S Meta+S"
													onclick={() => saveSnippet(entry)}
												>
													{entry.saving ? 'Saving…' : 'Save changes'}
												</button>
												{#if dirty && !entry.saving}
													<button class="button secondary" onclick={() => discardChanges(entry)}>
														Discard
													</button>
												{/if}
												<span class="save-state" role="status">
													{#if entry.saving}
														Saving to {selectedZoneName}…
													{:else if dirty}
														Unsaved changes
													{:else if entry.savedAt}
														<span class="saved-ok">Saved at {formatTime(entry.savedAt)}</span>
													{:else}
														No changes
													{/if}
												</span>
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
			{/if}
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
						aria-invalid={!!nameError}
						aria-describedby={nameError ? 'snippet-name-error' : undefined}
						oninput={() => (nameError = validateSnippetName(newSnippetName) || (nameTaken ? 'A snippet with this name already exists in this zone.' : ''))}
					/>
					{#if nameError}
						<span id="snippet-name-error" style="color: var(--danger); font-size: 0.72rem;">{nameError}</span>
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
					disabled={busy || !selectedZoneId || !nameValid || nameTaken || !newSnippetCode.trim()}
					onclick={deployNewSnippet}
				>
					{busy ? 'Deploying…' : selectedZoneName ? `Deploy to ${selectedZoneName}` : 'Pick a zone to deploy'}
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
						{busy ? 'Deleting…' : 'Delete'}
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
<div class="toast" aria-live="polite">
	{#if toast}
		<div
			class="status"
			class:ok={toast.type === 'ok'}
			class:error={toast.type === 'error'}
		>
			<span>{toast.message}</span>
			<button class="toast-close" aria-label="Dismiss" onclick={() => (toast = null)}>✕</button>
		</div>
	{/if}
</div>
