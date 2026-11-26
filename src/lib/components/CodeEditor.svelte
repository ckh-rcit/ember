<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { EditorState } from '@codemirror/state';
	import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
	import { javascript } from '@codemirror/lang-javascript';
	import { oneDark } from '@codemirror/theme-one-dark';
	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
	import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
	import {
		search,
		searchKeymap,
		highlightSelectionMatches,
		openSearchPanel,
		closeSearchPanel,
		setSearchQuery,
		SearchQuery
	} from '@codemirror/search';

	interface Props {
		code: string;
		readonly?: boolean;
		minHeight?: string;
		searchQuery?: string;
		searchRegexp?: boolean;
		onchange?: (value: string) => void;
	}

	let { code, readonly = false, minHeight = '200px', searchQuery = '', searchRegexp = false, onchange }: Props = $props();

	let container: HTMLDivElement;
	let view: EditorView | undefined;
	let skipNextUpdate = false;

	function createState(doc: string): EditorState {
		return EditorState.create({
			doc,
			extensions: [
				lineNumbers(),
				highlightActiveLine(),
				highlightActiveLineGutter(),
				history(),
				bracketMatching(),
				closeBrackets(),
				search({ top: true }),
				highlightSelectionMatches(),
				javascript(),
				oneDark,
				syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
				keymap.of([...defaultKeymap, ...historyKeymap, ...closeBracketsKeymap, ...searchKeymap]),
				EditorState.readOnly.of(readonly),
				EditorView.theme({
					'&': { minHeight },
					'.cm-scroller': { overflow: 'auto' }
				}),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) {
						skipNextUpdate = true;
						const value = update.state.doc.toString();
						onchange?.(value);
					}
				})
			]
		});
	}

	onMount(() => {
		view = new EditorView({
			state: createState(code),
			parent: container
		});
		applySearch(searchQuery, searchRegexp);
	});

	let appliedSearch = '';

	function applySearch(query: string, regexp: boolean): void {
		const key = query ? `${regexp}:${query}` : '';
		if (!view || key === appliedSearch) return;
		appliedSearch = key;
		if (!query) {
			closeSearchPanel(view);
			return;
		}
		const previous = document.activeElement;
		openSearchPanel(view);
		// openSearchPanel moves focus into the panel; keep it where the user is typing.
		if (previous instanceof HTMLElement && !container.contains(previous)) previous.focus();
		view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query, regexp })) });
	}

	$effect(() => {
		applySearch(searchQuery, searchRegexp);
	});

	onDestroy(() => {
		view?.destroy();
	});

	$effect(() => {
		if (!view) return;
		if (skipNextUpdate) {
			skipNextUpdate = false;
			return;
		}
		const current = view.state.doc.toString();
		if (current !== code) {
			view.dispatch({
				changes: { from: 0, to: current.length, insert: code }
			});
		}
	});
</script>

<div bind:this={container} class="code-editor-container"></div>

<style>
	.code-editor-container {
		width: 100%;
		min-width: 0;
		overflow: hidden;
	}

	.code-editor-container :global(.cm-editor) {
		height: auto;
	}

	.code-editor-container :global(.cm-scroller) {
		overflow-x: auto;
	}
</style>
