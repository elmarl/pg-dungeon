export const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`)
