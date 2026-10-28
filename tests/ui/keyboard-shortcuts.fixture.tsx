import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/styles/index.css';
window.__BANANA_STUDIO_CONFIG__={mode:'local',userId:'00000000-0000-0000-0000-000000000001',sessionId:'00000000-0000-0000-0000-000000000002'};
// All application requests are synthetic. No accounts, keys or provider calls.
window.fetch=async(input)=>{
  const path=String(input);
  if(path==='/api/gemini-status')return new Response(JSON.stringify({providers:{gemini:true,openai:true}}),{headers:{'Content-Type':'application/json'}});
  if(path==='/local/query')return new Response(JSON.stringify({data:[],error:null}),{headers:{'Content-Type':'application/json'}});
  throw new Error('The synthetic fixture blocks application network requests.');
};
const [{Controls},{HistoryPanel},{AdminPanel}]=await Promise.all([import('../../src/components/Controls'),import('../../src/components/HistoryPanel'),import('../../src/components/AdminPanel')]);
function Fixture(){
  const [count,setCount]=useState(0),[history,setHistory]=useState(false),[admin,setAdmin]=useState(false);
  const [config,setConfig]=useState<any>({prompt:'Synthetic keyboard test',count:1,aspectRatio:'1:1',resolution:'1K',imageModel:'gemini-nano-banana-2.1',referenceImages:[],referenceVideos:[],referenceAudios:[],mode:'image',videoModel:'seedance-2.5',videoOperation:'generate',videoAspectRatio:'16:9',videoQuality:'720p',videoDuration:5,audioEnabled:true,videoPromptExpansionMode:'balanced'});
  return <main className="min-h-screen bg-[#0d1117] p-5 text-white"><h1>Keyboard regression fixture</h1><output aria-label="Synthetic generation count">{count}</output><div className="flex gap-4"><button onClick={()=>setHistory(true)}>Open synthetic history</button><button onClick={()=>setAdmin(true)}>Open synthetic admin</button><button onClick={()=>setConfig({...config,prompt:''})}>Clear synthetic prompt</button></div><p>Generation only increments the visible counter. All requests are mocked.</p><Controls config={config} onChange={setConfig} onGenerate={()=>setCount(n=>n+1)} activeRequests={count?1:0} templates={[]} onSaveTemplate={()=>{}} onUpdateTemplate={()=>{}} onDeleteTemplate={()=>{}} onSelectTemplate={()=>{}}/><HistoryPanel images={[]} isOpen={history} onClose={()=>setHistory(false)} onSelect={()=>{}}/><AdminPanel isOpen={admin} onClose={()=>setAdmin(false)} onViewUserGallery={()=>{}}/></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
