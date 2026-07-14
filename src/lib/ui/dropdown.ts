let initialized = false;

function getTrigger(dropdown: HTMLElement): HTMLButtonElement | null {
	return dropdown.querySelector<HTMLButtonElement>('[data-dropdown-trigger]');
}

function getMenu(dropdown: HTMLElement): HTMLElement | null {
	return dropdown.querySelector<HTMLElement>('[data-dropdown-menu]');
}

function getOptions(dropdown: HTMLElement): HTMLButtonElement[] {
	return Array.from(dropdown.querySelectorAll<HTMLButtonElement>('[data-dropdown-option]'));
}

function setOpen(dropdown: HTMLElement, open: boolean): void {
	const trigger = getTrigger(dropdown);
	const menu = getMenu(dropdown);
	if (!trigger || !menu) return;

	trigger.setAttribute('aria-expanded', String(open));
	menu.hidden = !open;
}

function closeOtherDropdowns(current?: HTMLElement): void {
	document.querySelectorAll<HTMLElement>('[data-dropdown]').forEach((dropdown) => {
		if (dropdown !== current) setOpen(dropdown, false);
	});
}

function selectOption(dropdown: HTMLElement, option: HTMLButtonElement): void {
	const value = option.dataset.dropdownOption;
	const label = dropdown.querySelector<HTMLElement>('[data-dropdown-label]');
	if (!value || !label) return;

	dropdown.dataset.dropdownValue = value;
	label.textContent = option.textContent?.trim() ?? '';
	getOptions(dropdown).forEach((candidate) => {
		candidate.setAttribute('aria-selected', String(candidate === option));
	});

	dropdown.dispatchEvent(new CustomEvent('dropdown-change', {
		detail: { value },
		bubbles: true,
	}));
}

function focusOption(dropdown: HTMLElement, direction: 'selected' | 'first' | 'last'): void {
	const options = getOptions(dropdown);
	if (direction === 'first') options[0]?.focus();
	if (direction === 'last') options.at(-1)?.focus();
	if (direction === 'selected') {
		options.find((option) => option.getAttribute('aria-selected') === 'true')?.focus();
	}
}

export function initDropdowns(): void {
	if (initialized) return;
	initialized = true;

	document.addEventListener('click', (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;

		const trigger = target.closest<HTMLElement>('[data-dropdown-trigger]');
		if (trigger) {
			const dropdown = trigger.closest<HTMLElement>('[data-dropdown]');
			if (!dropdown) return;
			const open = trigger.getAttribute('aria-expanded') !== 'true';
			closeOtherDropdowns(dropdown);
			setOpen(dropdown, open);
			if (open) focusOption(dropdown, 'selected');
			return;
		}

		const option = target.closest<HTMLButtonElement>('[data-dropdown-option]');
		if (option) {
			const dropdown = option.closest<HTMLElement>('[data-dropdown]');
			if (!dropdown) return;
			selectOption(dropdown, option);
			setOpen(dropdown, false);
			getTrigger(dropdown)?.focus();
			return;
		}

		closeOtherDropdowns();
	});

	document.addEventListener('keydown', (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;

		const dropdown = target.closest<HTMLElement>('[data-dropdown]');
		if (!dropdown) return;

		if (target.matches('[data-dropdown-trigger]')) {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				closeOtherDropdowns(dropdown);
				setOpen(dropdown, true);
				focusOption(dropdown, event.key === 'ArrowDown' ? 'first' : 'last');
			}
			if (event.key === 'Escape') setOpen(dropdown, false);
			return;
		}

		const options = getOptions(dropdown);
		const currentIndex = options.indexOf(target as HTMLButtonElement);
		if (currentIndex < 0) return;

		let nextIndex: number | undefined;
		if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % options.length;
		if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + options.length) % options.length;
		if (event.key === 'Home') nextIndex = 0;
		if (event.key === 'End') nextIndex = options.length - 1;
		if (nextIndex !== undefined) {
			event.preventDefault();
			options[nextIndex]?.focus();
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			setOpen(dropdown, false);
			getTrigger(dropdown)?.focus();
		}
	});

	document.addEventListener('dropdown-set-value', ((event: CustomEvent<{ id: string; value: string }>) => {
		const dropdown = document.getElementById(event.detail.id);
		const option = dropdown?.querySelector<HTMLButtonElement>(`[data-dropdown-option="${CSS.escape(event.detail.value)}"]`);
		if (dropdown && option) selectOption(dropdown, option);
	}) as EventListener);
}
