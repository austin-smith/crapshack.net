import './button.css';

export interface ButtonStyleOptions {
	variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'dashed';
	size?: 'sm' | 'md' | 'lg' | 'xl' | 'icon-sm' | 'icon';
}

/** Shared appearance for native buttons and anchors; adds no interaction or ARIA role. */
export function buttonVariants({ variant = 'default', size = 'md' }: ButtonStyleOptions = {}): string {
	return `ui-button ui-button--${variant} ui-button--size-${size}`;
}
