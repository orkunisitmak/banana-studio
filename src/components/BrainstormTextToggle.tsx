import React from 'react';

export const BrainstormTextToggle = ({ noText = false, onChange }: { noText?: boolean; onChange: (noText: boolean) => void }) => (
  <div role="group" aria-label="Text in brainstorm images" className="flex w-full gap-1 rounded-lg bg-gray-900 p-1">
    {[false, true].map(value => (
      <button key={String(value)} type="button" aria-pressed={noText === value} onClick={() => onChange(value)}
        className={`min-h-10 flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-lime-400 ${noText === value ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
        {value ? 'No text' : 'Text'}
      </button>
    ))}
  </div>
);
