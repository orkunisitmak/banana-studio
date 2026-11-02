import { createChatTextHandler } from './_lib/chatCompletionsText.js';
import { liquidTextProvider } from './_lib/textProviders.js';

export const config = { maxDuration: 300 };
export default createChatTextHandler(liquidTextProvider);
