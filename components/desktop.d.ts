export {};
declare global {
  interface Window {
    focuslens?: {
      aiStatus(): Promise<{ configured: boolean }>;
      setApiKey(key: string): Promise<{ configured: boolean }>;
      chat(input: { message: string; summary: object; locale: string }): Promise<{ text: string; source: 'deepseek' | 'local' }>;
    };
  }
}
