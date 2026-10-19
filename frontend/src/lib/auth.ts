const TOKEN_KEY = 'ecom_vision_token';
const EMAIL_KEY = 'ecom_vision_email';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

export const getStoredEmail = (): string | null => localStorage.getItem(EMAIL_KEY);
export const setStoredEmail = (email: string): void => localStorage.setItem(EMAIL_KEY, email);
export const clearStoredEmail = (): void => localStorage.removeItem(EMAIL_KEY);
