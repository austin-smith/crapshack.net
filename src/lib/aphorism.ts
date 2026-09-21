import { pickAphorism } from './aphorisms';
import { eraseTypedText, typedText } from './ui/typed-text';

export interface AphorismCycleOptions {
	erase?: boolean;
}

export interface AphorismController {
	cycle: (options?: AphorismCycleOptions) => Promise<boolean>;
	destroy: () => void;
}

export function createAphorismController(root: HTMLElement): AphorismController | undefined {
	const target = root.querySelector<HTMLElement>('[data-aphorism]');
	if (!target) return;

	let activeCycle: AbortController | undefined;
	let currentText: string | undefined;
	let destroyed = false;

	const cycle = async ({ erase = false }: AphorismCycleOptions = {}): Promise<boolean> => {
		if (destroyed) return false;
		const picked = pickAphorism(currentText);
		if (!picked) return false;

		activeCycle?.abort();
		const cycleController = new AbortController();
		activeCycle = cycleController;
		currentText = picked.text;

		if (erase) {
			await eraseTypedText(target, { signal: cycleController.signal });
		}

		if (cycleController.signal.aborted) return false;
		await typedText(target, picked.text, { signal: cycleController.signal });

		return !cycleController.signal.aborted && activeCycle === cycleController;
	};

	const destroy = (): void => {
		destroyed = true;
		activeCycle?.abort();
		activeCycle = undefined;
	};

	return { cycle, destroy };
}
