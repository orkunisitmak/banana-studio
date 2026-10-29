/** Shared by every chat-completion route so providers receive the same task. */
export const ANALYSIS_SYSTEM_PROMPT = 'Prepare the requested factual episode analysis using only the supplied footage or verified observations. Report unavailable footage honestly; never invent events, identities, prices, outcomes or timestamps. Return exactly the requested JSON object.';
export const TEXT_TASK_SYSTEM_PROMPT = 'Complete the requested prompt-writing task using the supplied brief and references. Make reasonable creative decisions without follow-up questions. Return only the finished deliverable.';
export const BRAINSTORM_FORMAT = {
  type: 'json_schema', name: 'brainstorm_ideas', strict: true,
  schema: { type: 'object', additionalProperties: false,
    properties: { ideas: { type: 'array', minItems: 1, items: { type: 'string' } } }, required: ['ideas'] },
};
export const BRAINSTORM_WARDROBE_FORMAT = {
  type: 'json_schema', name: 'brainstorm_wardrobe_ideas', strict: true,
  schema: { type: 'object', additionalProperties: false, required: ['ideas'],
    properties: { ideas: { type: 'array', minItems: 1, items: {
      type: 'object', additionalProperties: false, required: ['prompt', 'wardrobe'],
      properties: {
        prompt: { type: 'string' }, wardrobe: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['personId', 'garments', 'outfit'],
          properties: { personId: { type: 'integer' }, garments: { type: 'array', items: { type: 'string' } }, outfit: { type: 'string' } },
        } },
      },
    } } },
  },
};

export const isBrainstormCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20;

/** Claude supports minItems only for 0/1 and does not support maxItems.
 * Required named slots enforce the full batch using its supported schema
 * subset. Keep the array schema for already-open clients without a count. */
export const buildBrainstormOutputFormat = (wardrobe: boolean, count?: number) => {
  const format = wardrobe ? BRAINSTORM_WARDROBE_FORMAT : BRAINSTORM_FORMAT;
  if (count == null) return format;
  if (!isBrainstormCount(count)) throw new Error('Invalid Brainstorm idea count.');
  const slots = Array.from({ length: count }, (_, index) => `idea_${index + 1}`);
  return { ...format, schema: {
    type: 'object', additionalProperties: false, required: ['ideas'],
    $defs: { idea: format.schema.properties.ideas.items },
    properties: { ideas: {
      type: 'object', additionalProperties: false, required: slots,
      description: `Exactly ${count} distinct complete ideas, in numbered order. Fill every required slot.`,
      properties: Object.fromEntries(slots.map(slot => [slot, { $ref: '#/$defs/idea' }])),
    } },
  } };
};

export const brainstormOutputInstruction = (wardrobe: boolean, count?: number): string => {
  const item = wardrobe ? 'idea objects, each with its scene prompt and per-person wardrobe selection' : 'complete idea prompt strings';
  return count == null
    ? ` Put the requested number of ${item} in the ideas array of the required JSON object; do not return a bare array, commentary, or Markdown.`
    : ` Return exactly ${count} distinct ${item}. The final output schema takes precedence over array-format examples in the brief: return one JSON object with an ideas object containing every required slot idea_1 through idea_${count}, in order. Each slot is ONE finished idea, not a person, a variation, an outline, or the whole batch. Complete all ${count} slots; do not merge or omit any. No commentary or Markdown.`;
};
export const YOUTUBE_ANALYSIS_FORMAT = {
  type: 'json_schema', name: 'youtube_video_analysis', strict: true,
  schema: { type: 'object', additionalProperties: false,
    required: ['videoAvailable', 'brief', 'premise', 'evidence', 'limitation'],
    properties: {
      videoAvailable: { type: 'boolean' }, brief: { type: 'string' }, premise: { type: 'string' }, limitation: { type: 'string' },
      evidence: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['timestamp', 'fact', 'relevance'], properties: {
          timestamp: { type: 'string' }, fact: { type: 'string' }, relevance: { type: 'string', enum: ['premise', 'context'] },
        },
      } },
    },
  },
};

/** Preserve the browser's existing idea-array shape without losing recoverable
 * wardrobe omissions. No provider retry or model repair is needed here. */
export const normalizeBrainstormOutput = (text: string, wardrobe: boolean, count?: number): string | null => {
  let ideas: any;
  try { ideas = JSON.parse(text)?.ideas; } catch { return null; }
  if (count != null) {
    if (!isBrainstormCount(count)) return null;
    if (ideas && typeof ideas === 'object' && !Array.isArray(ideas)) {
      const slots = Array.from({ length: count }, (_, index) => `idea_${index + 1}`);
      if (Object.keys(ideas).length !== count || !slots.every(slot => Object.hasOwn(ideas, slot))) return null;
      ideas = slots.map(slot => ideas[slot]);
    }
    if (!Array.isArray(ideas) || ideas.length !== count) return null;
  }
  const valid = (idea: any) => typeof idea === 'string' ? !!idea.trim()
    : wardrobe && idea && typeof idea.prompt === 'string' && !!idea.prompt.trim();
  if (!Array.isArray(ideas) || !ideas.length || !ideas.every(valid)) return null;
  return JSON.stringify(ideas.map((idea: any) => typeof idea === 'string' ? idea.trim() : { ...idea, prompt: idea.prompt.trim() }));
};
