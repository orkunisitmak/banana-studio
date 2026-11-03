// Round for display without landing on the accepted range: 30.001 is shown as
// 30.01 and 3.999 as 3.99, so the number never contradicts the refusal.
export const formatRejectedDuration = (duration: number, min: number, max: number): string => {
  const shown = duration.toFixed(2);
  if (duration < min && Number(shown) >= min) return (Math.floor(duration * 100) / 100).toFixed(2);
  if (duration > max && Number(shown) <= max) return (Math.ceil(duration * 100) / 100).toFixed(2);
  return shown;
};
