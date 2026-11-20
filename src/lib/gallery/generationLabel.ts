export const getGenerationsInProgressLabel = (count: number): string =>
  `${count} ${count === 1 ? 'generation' : 'generations'} in progress`;
