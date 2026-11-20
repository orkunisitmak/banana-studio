const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`;

export const brainstormImageCount = (count: number) => plural(count, 'image');

export const brainstormSummary = (ideas: number, perIdea: number, total: number) =>
  `${plural(ideas, 'idea')} × ${plural(perIdea, 'image')} = ${plural(total, 'image')}`;
