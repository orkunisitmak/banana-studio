export default {
 content: ['./index.html', './share.html', './src/**/*.{ts,tsx}'],
 theme: { extend: {
  colors: { gray: { 750: '#2d3748', 850: '#1a202c', 950: '#0d1117' } },
  animation: { 'pulse-fast': 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite', 'progress-indeterminate': 'progress-indeterminate 1.5s infinite linear',
   'bar-in': 'bar-in 420ms cubic-bezier(0.32, 0.72, 0, 1) backwards', 'bar-out': 'bar-out 260ms cubic-bezier(0.4, 0, 1, 1) forwards', 'preview-in': 'preview-in 180ms cubic-bezier(0.32, 0.72, 0, 1) backwards' },
  keyframes: { 'progress-indeterminate': { '0%': { transform: 'translateX(-100%)', width: '20%' }, '100%': { transform: 'translateX(400%)', width: '20%' } },
   'bar-in': { '0%': { transform: 'translateY(calc(100% + 1.5rem))', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
   'bar-out': { '0%': { transform: 'translateY(0)', opacity: '1' }, '100%': { transform: 'translateY(calc(100% + 1.5rem))', opacity: '0' } },
   'preview-in': { '0%': { transform: 'translate(-50%, -100%) translateY(6px) scale(0.96)', opacity: '0' }, '100%': { transform: 'translate(-50%, -100%)', opacity: '1' } } }
 } }, plugins: []
};
